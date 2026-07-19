import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { household, householdUser, householdJoinRequest } from './schema/household';
import { recipeBook, recipeCategory, recipe, recipeIngredient } from './schema/recipe';
import { recipeShare } from './schema/social';
import { ingredient } from './schema/ingredient';
import { auth } from './lib/auth';

const EMAIL = 'test2@gmail.com';
const PASSWORD = 'test-123';
const FIRST = 'Test';
const LAST = 'Two';
const HANDLE = 'test2user';
const HOUSEHOLD_NAME = 'Test 2';
const NATHAN_EMAIL = 'nathanblaga90@gmail.com';

async function seed() {
  // 1. Create or find test2 user
  let [testUser2] = await db.select().from(user).where(eq(user.email, EMAIL)).limit(1);

  if (!testUser2) {
    const res = await auth.api.signUpEmail({
      body: {
        email: EMAIL,
        password: PASSWORD,
        name: `${FIRST} ${LAST}`,
        firstName: FIRST,
        lastName: LAST,
      },
    });
    if (!res) { console.error('Sign-up failed.'); process.exit(1); }
    [testUser2] = await db.select().from(user).where(eq(user.email, EMAIL)).limit(1);
    console.log('Created test2 user.');
  } else {
    console.log('test2 user already exists.');
  }

  await db.update(user).set({ emailVerified: true, handle: HANDLE }).where(eq(user.id, testUser2.id));

  // 2. Create or find household
  const existingHu = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, testUser2.id))
    .limit(1);

  let householdId: string;

  if (existingHu.length > 0) {
    householdId = existingHu[0].householdId;
    console.log('test2 household already exists.');
  } else {
    const [h] = await db
      .insert(household)
      .values({ name: HOUSEHOLD_NAME })
      .returning();
    householdId = h.id;

    await db.insert(householdUser).values({ householdId, userId: testUser2.id, role: 'OWNER' });

    const [book] = await db.insert(recipeBook).values({ householdId }).returning();

    // Create a category and recipe so we can share
    const [cat] = await db
      .insert(recipeCategory)
      .values({ recipeBookId: book.id, name: 'Favourites' })
      .returning();

    const recipes = [
      { title: 'Lemon Pasta', description: 'A light and zesty pasta dish perfect for summer evenings.' },
      { title: 'Chocolate Mousse', description: 'Rich and creamy chocolate mousse that melts in your mouth.' },
    ];

    for (const r of recipes) {
      const [rec] = await db
        .insert(recipe)
        .values({
          recipeBookId: book.id,
          categoryId: cat.id,
          title: r.title,
          description: r.description,
          baseServings: 4,
          steps: ['Prepare ingredients.', 'Cook according to method.', 'Serve and enjoy.'].map((s) => ({ text: s, subSteps: [] as string[] })),
        })
        .returning();

      // Add a couple of ingredients
      const [ing] = await db
        .insert(ingredient)
        .values({ name: 'Salt' })
        .onConflictDoNothing()
        .returning();

      const saltId = ing?.id ?? (
        await db.select({ id: ingredient.id }).from(ingredient).where(eq(ingredient.name, 'Salt')).limit(1)
      )[0].id;

      await db.insert(recipeIngredient).values({
        recipeId: rec.id,
        ingredientId: saltId,
        note: 'to taste',
        sortOrder: 0,
      });
    }
    console.log(`Created household "${HOUSEHOLD_NAME}" with 2 recipes.`);
  }

  // 3. Find Nathan's user
  const [nathan] = await db.select({ id: user.id }).from(user).where(eq(user.email, NATHAN_EMAIL)).limit(1);
  if (!nathan) {
    console.log(`Nathan's account (${NATHAN_EMAIL}) not found — skipping notifications.`);
    process.exit(0);
  }

  // 4. Create pending invite from test2's household to Nathan
  const existingInvite = await db
    .select({ id: householdJoinRequest.id })
    .from(householdJoinRequest)
    .where(
      eq(householdJoinRequest.householdId, householdId),
    )
    .limit(1);

  if (existingInvite.length === 0) {
    await db.insert(householdJoinRequest).values({
      householdId,
      userId: nathan.id,
      initiatedByUserId: testUser2.id,
      type: 'INVITE',
      status: 'PENDING',
    });
    console.log('Created household invite to Nathan.');
  } else {
    console.log('Household invite already exists.');
  }

  // 5. Find a recipe in test2's book to share
  const [book2] = await db
    .select()
    .from(recipeBook)
    .where(eq(recipeBook.householdId, householdId))
    .limit(1);

  if (book2) {
    const recipes2 = await db.select().from(recipe).where(eq(recipe.recipeBookId, book2.id));

    if (recipes2.length > 0) {
      const existingShare = await db
        .select({ id: recipeShare.id })
        .from(recipeShare)
        .where(eq(recipeShare.toUserId, nathan.id))
        .limit(1);

      if (existingShare.length === 0) {
        await db.insert(recipeShare).values({
          recipeId: recipes2[0].id,
          fromUserId: testUser2.id,
          toUserId: nathan.id,
          status: 'PENDING',
        });
        console.log(`Created pending share of "${recipes2[0].title}" to Nathan.`);
      } else {
        console.log('Share to Nathan already exists.');
      }
    }
  }

  console.log('Done! Nathan should now see 2 notifications (1 invite + 1 share).');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
