import 'dotenv/config';
import { db } from './db';
import { recipe, recipeBook } from './schema/recipe';
import { recipeShare as recipeShareTable } from './schema/social';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { eq, ilike, and } from 'drizzle-orm';

async function main() {
  // Find Nathan
  const [nathan] = await db.select({ id: user.id, name: user.name }).from(user).where(ilike(user.name, '%nathan%'));
  if (!nathan) { console.error('Nathan not found'); process.exit(1); }
  console.log('Nathan:', nathan.name, nathan.id);

  const [nathanHU] = await db.select({ householdId: householdUser.householdId }).from(householdUser).where(eq(householdUser.userId, nathan.id));
  if (!nathanHU) { console.error('Nathan has no household'); process.exit(1); }
  const nathanHouseholdId = nathanHU.householdId;

  const [nathanBook] = await db.select({ id: recipeBook.id }).from(recipeBook).where(eq(recipeBook.householdId, nathanHouseholdId));
  if (!nathanBook) { console.error('Nathan has no recipe book'); process.exit(1); }

  // Update all recipes with realistic prep/cook times based on title keywords
  const recipes = await db.select({ id: recipe.id, title: recipe.title, prepTime: recipe.prepTime, cookTime: recipe.cookTime })
    .from(recipe)
    .where(eq(recipe.recipeBookId, nathanBook.id));

  console.log(`Found ${recipes.length} recipes to update`);

  const TIMES: Record<string, { prep: number; cook: number }> = {
    'banana bread': { prep: 15, cook: 60 },
    'beef taco': { prep: 15, cook: 20 },
    'spaghetti bolognese': { prep: 10, cook: 45 },
    'spaghetti carbonara': { prep: 10, cook: 20 },
    'avocado toast': { prep: 5, cook: 5 },
    'chocolate lava': { prep: 20, cook: 12 },
    'chicken': { prep: 20, cook: 35 },
    'pasta': { prep: 10, cook: 20 },
    'soup': { prep: 15, cook: 40 },
    'salad': { prep: 15, cook: 0 },
    'risotto': { prep: 10, cook: 35 },
    'pie': { prep: 30, cook: 45 },
    'cake': { prep: 20, cook: 40 },
    'bread': { prep: 20, cook: 35 },
    'stew': { prep: 20, cook: 90 },
    'curry': { prep: 15, cook: 40 },
    'burger': { prep: 15, cook: 15 },
    'pizza': { prep: 30, cook: 20 },
    'steak': { prep: 5, cook: 15 },
    'cobbler': { prep: 20, cook: 45 },
    'omelet': { prep: 5, cook: 8 },
    'omelette': { prep: 5, cook: 8 },
    'pancake': { prep: 10, cook: 20 },
    'waffle': { prep: 10, cook: 20 },
    'muffin': { prep: 15, cook: 22 },
    'brownie': { prep: 15, cook: 25 },
    'cookie': { prep: 15, cook: 12 },
    'frittata': { prep: 10, cook: 25 },
    'quiche': { prep: 20, cook: 40 },
    'roast': { prep: 20, cook: 90 },
    'stir fry': { prep: 15, cook: 15 },
    'fried rice': { prep: 10, cook: 15 },
    'noodle': { prep: 10, cook: 20 },
  };

  let updated = 0;
  for (const r of recipes) {
    if (r.prepTime != null && r.cookTime != null) { console.log(`  SKIP (already set): ${r.title}`); continue; }

    const titleLower = r.title.toLowerCase();
    let times = { prep: 15, cook: 30 }; // sensible defaults

    for (const [keyword, t] of Object.entries(TIMES)) {
      if (titleLower.includes(keyword)) { times = t; break; }
    }

    await db.update(recipe)
      .set({ prepTime: times.prep, cookTime: times.cook > 0 ? times.cook : null })
      .where(eq(recipe.id, r.id));
    console.log(`  Updated: ${r.title} → prep ${times.prep}min, cook ${times.cook > 0 ? times.cook : '-'}min`);
    updated++;
  }
  console.log(`\nUpdated ${updated} recipes with prep/cook times`);

  // ── Create an inbound share example ────────────────────────────────────────

  // Find a second user (demo or test user) who has their own recipe to share
  const allUsers = await db.select({ id: user.id, name: user.name }).from(user);
  const otherUser = allUsers.find(u => u.id !== nathan.id);
  if (!otherUser) {
    console.log('No second user found — skipping inbound share example');
    process.exit(0);
  }
  console.log('\nOther user:', otherUser.name, otherUser.id);

  // Find a recipe in the other user's household book (if any)
  const [otherHU] = await db.select({ householdId: householdUser.householdId }).from(householdUser).where(eq(householdUser.userId, otherUser.id));
  if (!otherHU) { console.log('Other user has no household — skipping share'); process.exit(0); }

  const [otherBook] = await db.select({ id: recipeBook.id }).from(recipeBook).where(eq(recipeBook.householdId, otherHU.householdId));
  if (!otherBook) { console.log('Other user has no recipe book — skipping share'); process.exit(0); }

  const [sourceRecipe] = await db.select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(eq(recipe.recipeBookId, otherBook.id))
    .limit(1);

  if (!sourceRecipe) { console.log('Other user has no recipes — skipping share'); process.exit(0); }

  // Check if a share to nathan already exists
  const [existing] = await db.select({ id: recipeShareTable.id })
    .from(recipeShareTable)
    .where(and(
      eq(recipeShareTable.recipeId, sourceRecipe.id),
      eq(recipeShareTable.fromUserId, otherUser.id),
      eq(recipeShareTable.toUserId, nathan.id),
    ))
    .limit(1);

  if (existing) {
    console.log('Share already exists:', existing.id);
  } else {
    const [share] = await db.insert(recipeShareTable).values({
      recipeId: sourceRecipe.id,
      fromUserId: otherUser.id,
      toUserId: nathan.id,
      status: 'PENDING',
    }).returning();
    console.log(`\n✓ Created inbound share: "${sourceRecipe.title}" from ${otherUser.name} to Nathan (id: ${share.id})`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
