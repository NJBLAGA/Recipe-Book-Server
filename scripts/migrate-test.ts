/**
 * Applies missing DDL to the test Neon branch.
 * Run with: npx tsx scripts/migrate-test.ts
 * Loads .env.test automatically.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { neon } from '@neondatabase/serverless';

const rawSql = neon(process.env.DATABASE_URL!);

async function run(stmt: string) {
  await rawSql.query(stmt);
}

async function main() {
  console.log('Applying missing DDL to test branch...');

  const stmts = [
    // user table additions
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "is_public" boolean NOT NULL DEFAULT true`,

    // shopping_list_item_image table (may be missing)
    `CREATE TABLE IF NOT EXISTS "shopping_list_item_image" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "item_id" uuid NOT NULL REFERENCES "shopping_list_item"("id") ON DELETE CASCADE,
      "url" text NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`,

    // recipe_cook additions
    `ALTER TABLE "recipe_cook" ADD COLUMN IF NOT EXISTS "servings" integer`,

    // pantry_item: new stock/quantity/notes columns (refactored from pantry_batch model)
    `ALTER TABLE "pantry_item" ADD COLUMN IF NOT EXISTS "in_stock" boolean NOT NULL DEFAULT true`,
    `ALTER TABLE "pantry_item" ADD COLUMN IF NOT EXISTS "quantity" smallint`,
    `ALTER TABLE "pantry_item" ADD COLUMN IF NOT EXISTS "unit" text`,
    `ALTER TABLE "pantry_item" ADD COLUMN IF NOT EXISTS "notes" text`,

    // recipe: source field
    `ALTER TABLE "recipe" ADD COLUMN IF NOT EXISTS "source" text`,

    // shopping_list_item: new fields
    `ALTER TABLE "shopping_list_item" ADD COLUMN IF NOT EXISTS "note" text`,
    `ALTER TABLE "shopping_list_item" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0`,
    `ALTER TABLE "shopping_list_item" ADD COLUMN IF NOT EXISTS "added_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL`,
  ];

  for (const stmt of stmts) {
    try {
      await run(stmt);
      console.log(`  ✓ ${stmt.slice(0, 70).trim()}`);
    } catch (e: any) {
      console.error(`  ✗ ${e.message?.slice(0, 120)}`);
    }
  }

  console.log('Done.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
