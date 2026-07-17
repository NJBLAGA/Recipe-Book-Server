import 'dotenv/config';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { eq, inArray } from 'drizzle-orm';
import { pantry, pantryItem, pantryBatch } from '../src/schema/pantry';
import { ingredient } from '../src/schema/ingredient';

neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  // Get the first pantry (for the household in use)
  const pantries = await db.select({ id: pantry.id, householdId: pantry.householdId }).from(pantry).limit(5);
  if (pantries.length === 0) { console.error('No pantry found — create a household first'); process.exit(1); }

  const target = pantries[0];
  console.log(`Seeding pantry ${target.id} (household ${target.householdId})`);

  // Get all ingredients
  const allIngredients = await db.select({ id: ingredient.id, name: ingredient.name }).from(ingredient);
  if (allIngredients.length === 0) { console.log('No ingredients in DB — add some recipes first'); process.exit(0); }

  // Take 95% of them (rounded down)
  const take = Math.floor(allIngredients.length * 0.95);
  const selection = allIngredients.slice(0, take);
  console.log(`Found ${allIngredients.length} ingredients — adding ${take} (95%) to pantry`);

  // Get already-existing pantry items to skip duplicates
  const existing = await db
    .select({ ingredientId: pantryItem.ingredientId })
    .from(pantryItem)
    .where(eq(pantryItem.pantryId, target.id));
  const existingIds = new Set(existing.map((e) => e.ingredientId));

  const toAdd = selection.filter((ing) => !existingIds.has(ing.id));
  console.log(`${existingIds.size} already in pantry — inserting ${toAdd.length} new items`);

  if (toAdd.length === 0) { console.log('Nothing to add.'); await pool.end(); return; }

  // Insert pantry items in one batch
  const inserted = await db
    .insert(pantryItem)
    .values(toAdd.map((ing) => ({
      pantryId: target.id,
      ingredientId: ing.id,
      categoryId: null,
    })))
    .returning({ id: pantryItem.id, ingredientId: pantryItem.ingredientId });

  // Insert one batch at 100% fill level for each item
  await db.insert(pantryBatch).values(
    inserted.map((item) => ({
      pantryItemId: item.id,
      fillLevel: 100,
    })),
  );

  console.log(`Done — added ${inserted.length} pantry items at 100% fill.`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
