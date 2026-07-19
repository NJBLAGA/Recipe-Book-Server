import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from './db/index';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { recipeBook, recipe } from './schema/recipe';
import { recipeShare, review } from './schema/social';

const NATHAN_EMAIL = 'nathanblaga90@gmail.com';
const TEST1_EMAIL  = 'test@gmail.com';
const TEST2_EMAIL  = 'test2@gmail.com';

const REVIEW_COMMENTS = [
  'Absolutely brilliant — made this twice in one week already.',
  'The flavours are perfectly balanced. A definite keeper.',
  'My whole family loved this. Will be making it on repeat.',
  'Simple to follow and the result is restaurant quality.',
  'I added a bit more spice and it was incredible. Very adaptable.',
  'Honestly better than I expected. The technique makes all the difference.',
  'This has become my go-to for dinner parties.',
  'Took a bit longer than expected but so worth the patience.',
  'Clean, fresh and incredibly satisfying. Love this one.',
  'Perfect weeknight meal — quick, easy and delicious.',
  'Made this for a potluck and came home with an empty dish.',
  'The texture is spot-on. Really impressive result.',
  'Subtle yet complex. Exactly the kind of recipe I was looking for.',
  'Crispy on the outside, tender on the inside — nailed it.',
  'Brought this to work and got asked for the recipe three times.',
  'Surprisingly easy for how impressive it looks.',
  'This is comfort food at its absolute finest.',
  'Adjusted the seasoning slightly and it was perfect for us.',
  'The whole house smelled incredible while this was cooking.',
  'Great base recipe — easy to make your own.',
];

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

async function getUserId(email: string): Promise<string | null> {
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  return u?.id ?? null;
}

async function getRecipeIdsForUser(userId: string): Promise<string[]> {
  const [hu] = await db
    .select({ householdId: householdUser.householdId })
    .from(householdUser)
    .where(eq(householdUser.userId, userId))
    .limit(1);

  if (!hu) return [];

  const [book] = await db
    .select()
    .from(recipeBook)
    .where(eq(recipeBook.householdId, hu.householdId))
    .limit(1);

  if (!book) return [];

  const recipes = await db
    .select({ id: recipe.id })
    .from(recipe)
    .where(eq(recipe.recipeBookId, book.id));

  return recipes.map((r) => r.id);
}

async function createShare(recipeId: string, fromUserId: string, toUserId: string): Promise<string> {
  const [share] = await db
    .insert(recipeShare)
    .values({ recipeId, fromUserId, toUserId, status: 'ACCEPTED' })
    .returning();
  return share.id;
}

async function seed() {
  // 1. Get user IDs
  const nathanId = await getUserId(NATHAN_EMAIL);
  const test1Id  = await getUserId(TEST1_EMAIL);
  const test2Id  = await getUserId(TEST2_EMAIL);

  if (!nathanId) { console.error('Nathan account not found.'); process.exit(1); }
  if (!test1Id)  { console.error('test@gmail.com not found. Run seed-test-recipes.ts first.'); process.exit(1); }
  if (!test2Id)  { console.error('test2@gmail.com not found. Run seed-test2-recipes.ts first.'); process.exit(1); }

  // 2. Delete ALL existing reviews and shares used for reviews
  const allReviews = await db.select({ shareId: review.shareId }).from(review);
  for (const r of allReviews) {
    await db.delete(review).where(eq(review.shareId, r.shareId));
  }
  console.log(`Deleted ${allReviews.length} existing reviews.`);

  // Delete shares that exist (we'll recreate what we need)
  await db.delete(recipeShare).where(eq(recipeShare.fromUserId, test1Id));
  await db.delete(recipeShare).where(eq(recipeShare.fromUserId, test2Id));
  console.log('Cleared existing shares from test users.');

  // 3. Gather all recipes
  const test1RecipeIds = await getRecipeIdsForUser(test1Id);
  const test2RecipeIds = await getRecipeIdsForUser(test2Id);

  console.log(`Found ${test1RecipeIds.length} recipes for test1, ${test2RecipeIds.length} for test2.`);

  // 4. For each recipe, randomly assign 0–3 reviews
  // Reviewers for test1's recipes: nathan and/or test2
  // Reviewers for test2's recipes: nathan and/or test1

  let totalReviews = 0;
  let seed = 42;

  const addReviews = async (
    recipeIds: string[],
    ownerId: string,
    reviewerIds: string[],
  ) => {
    for (const recipeId of recipeIds) {
      seed++;
      const reviewCount = Math.floor(seededRandom(seed) * 4); // 0, 1, 2, or 3
      if (reviewCount === 0) continue;

      // Pick reviewers (may be 1 or 2 depending on reviewCount)
      const selectedReviewers = reviewerIds.slice(0, reviewCount);

      for (const reviewerId of selectedReviewers) {
        seed++;
        const shareId = await createShare(recipeId, ownerId, reviewerId);
        const rating = Math.floor(seededRandom(seed) * 3) + 3; // 3, 4, or 5 stars
        seed++;
        const commentIndex = Math.floor(seededRandom(seed) * REVIEW_COMMENTS.length);
        const comment = REVIEW_COMMENTS[commentIndex];

        await db.insert(review).values({
          shareId,
          rating,
          comment,
        });

        totalReviews++;
      }
    }
  };

  // test1's recipes reviewed by nathan + test2
  await addReviews(test1RecipeIds, test1Id, [nathanId, test2Id]);

  // test2's recipes reviewed by nathan + test1
  await addReviews(test2RecipeIds, test2Id, [nathanId, test1Id]);

  console.log(`Created ${totalReviews} reviews across all recipes.`);
  console.log('Done!');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
