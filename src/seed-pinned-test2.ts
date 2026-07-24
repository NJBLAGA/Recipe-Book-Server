import 'dotenv/config';
import { db } from './db';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { recipe, recipeBook } from './schema/recipe';
import { userPinnedRecipe } from './schema/social';
import { eq } from 'drizzle-orm';

const TEST2_EMAIL = 'test2@gmail.com';

async function main() {
  const [test2] = await db.select({ id: user.id }).from(user).where(eq(user.email, TEST2_EMAIL));
  if (!test2) { console.error('test2 user not found'); process.exit(1); }

  const [hu] = await db.select({ householdId: householdUser.householdId })
    .from(householdUser).where(eq(householdUser.userId, test2.id));
  if (!hu) { console.error('test2 has no household'); process.exit(1); }

  const [rb] = await db.select({ id: recipeBook.id })
    .from(recipeBook).where(eq(recipeBook.householdId, hu.householdId));
  if (!rb) { console.error('No recipe book for test2 household'); process.exit(1); }

  const recipes = await db
    .select({ id: recipe.id, title: recipe.title })
    .from(recipe)
    .where(eq(recipe.recipeBookId, rb.id))
    .limit(5);

  if (recipes.length === 0) { console.error('No recipes found in test2 household'); process.exit(1); }

  await db.delete(userPinnedRecipe).where(eq(userPinnedRecipe.userId, test2.id));

  for (let i = 0; i < Math.min(5, recipes.length); i++) {
    await db.insert(userPinnedRecipe).values({
      userId: test2.id,
      recipeId: recipes[i].id,
      position: i + 1,
    });
    console.log(`✓ Pinned position ${i + 1}: ${recipes[i].title}`);
  }

  console.log(`\nDone — pinned ${Math.min(5, recipes.length)} recipes for test2.`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
