import 'dotenv/config';
import { db } from './db';
import { user } from './schema/auth';
import { householdUser } from './schema/household';
import { ingredient } from './schema/ingredient';
import { recipeBook, recipe, recipeIngredient } from './schema/recipe';
import { pantry, pantryItem } from './schema/pantry';
import { eq, ilike } from 'drizzle-orm';

async function main() {
  // Find Nathan
  const users = await db.select({ id: user.id, name: user.name }).from(user).where(ilike(user.name, '%nathan%'));
  if (!users.length) { console.error('No user matching "nathan" found'); process.exit(1); }
  const u = users[0];
  console.log('Found user:', u.name, u.id);

  // Find household
  const hus = await db.select({ householdId: householdUser.householdId }).from(householdUser).where(eq(householdUser.userId, u.id));
  if (!hus.length) { console.error('User has no household'); process.exit(1); }
  const householdId = hus[0].householdId;
  console.log('Household:', householdId);

  // Find pantry
  const pantries = await db.select({ id: pantry.id }).from(pantry).where(eq(pantry.householdId, householdId));
  if (!pantries.length) { console.error('No pantry found'); process.exit(1); }
  const pantryId = pantries[0].id;
  console.log('Pantry:', pantryId);

  // Find recipe book
  const books = await db.select({ id: recipeBook.id }).from(recipeBook).where(eq(recipeBook.householdId, householdId));
  if (!books.length) { console.error('No recipe book found'); process.exit(1); }
  const bookId = books[0].id;

  // Get all unique ingredients from recipes in this book
  const rows = await db
    .select({ ingredientId: recipeIngredient.ingredientId, name: ingredient.name })
    .from(recipeIngredient)
    .innerJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
    .innerJoin(recipe, eq(recipeIngredient.recipeId, recipe.id))
    .where(eq(recipe.recipeBookId, bookId));

  const uniqueByIngredientId = new Map<string, string>();
  for (const row of rows) uniqueByIngredientId.set(row.ingredientId, row.name);

  console.log(`Found ${uniqueByIngredientId.size} unique ingredients across all recipes`);

  // Check what's already in the pantry
  const existing = await db.select({ ingredientId: pantryItem.ingredientId }).from(pantryItem).where(eq(pantryItem.pantryId, pantryId));
  const existingIds = new Set(existing.map((e) => e.ingredientId));
  console.log(`${existingIds.size} already in pantry`);

  // Vary in-stock status to simulate realistic pantry
  const stockPattern = [true, true, true, true, true, false, true, true, false, true];
  let added = 0;
  let idx = 0;

  for (const [ingredientId, name] of uniqueByIngredientId) {
    if (existingIds.has(ingredientId)) {
      console.log(`  Skip (exists): ${name}`);
      continue;
    }

    const inStock = stockPattern[idx % stockPattern.length];
    idx++;

    await db.insert(pantryItem).values({ pantryId, ingredientId, inStock });

    console.log(`  Added: ${name} — ${inStock ? 'in stock' : 'out of stock'}`);
    added++;
  }

  console.log(`\nDone — added ${added} pantry items`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
