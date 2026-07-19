import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from './db/index';

async function main() {
  console.log('Running migrations...');

  // recipe_cook: add servings
  await db.execute(sql`ALTER TABLE recipe_cook ADD COLUMN IF NOT EXISTS servings integer`);
  console.log('✓ recipe_cook.servings');

  // pantry_item: add in_stock, quantity, unit, notes; drop old columns
  await db.execute(sql`ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true`);
  await db.execute(sql`ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS quantity smallint`);
  await db.execute(sql`ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS unit text`);
  await db.execute(sql`ALTER TABLE pantry_item ADD COLUMN IF NOT EXISTS notes text`);
  await db.execute(sql`ALTER TABLE pantry_item DROP COLUMN IF EXISTS quantity_note`);
  console.log('✓ pantry_item columns');

  // shopping_list_item: add added_by_user_id and sort_order
  await db.execute(sql`ALTER TABLE shopping_list_item ADD COLUMN IF NOT EXISTS added_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL`);
  await db.execute(sql`ALTER TABLE shopping_list_item ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0`);
  console.log('✓ shopping_list_item.added_by_user_id + sort_order');

  // Migrate existing string steps to {text, subSteps} format
  await db.execute(sql`
    UPDATE recipe
    SET steps = (
      SELECT jsonb_agg(jsonb_build_object('text', elem#>>${'{}'}::text[], 'subSteps', '[]'::jsonb))
      FROM jsonb_array_elements(steps) AS elem
    )
    WHERE jsonb_typeof(steps) = 'array'
      AND jsonb_array_length(steps) > 0
      AND jsonb_typeof(steps->0) = 'string'
  `);
  console.log('✓ recipe steps migrated to {text, subSteps} format');

  console.log('\nAll migrations complete.');
  process.exit(0);
}

main().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
