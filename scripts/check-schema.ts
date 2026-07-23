/**
 * Checks current column structure of key tables in the test DB.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function cols(table: string) {
  const rows = await sql.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  const data = (rows as any).rows ?? rows;
  return data as any[];
}

async function tables() {
  const rows = await sql.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  const data = (rows as any).rows ?? rows;
  return (data as any[]).map((r: any) => r.table_name);
}

async function main() {
  const tbls = await tables();
  console.log('Tables:', tbls.join(', '));
  console.log();

  for (const t of ['pantry_item', 'recipe', 'user_pinned_recipe', 'recipe_cook']) {
    if (tbls.includes(t)) {
      const cs = await cols(t);
      console.log(`${t}:`, cs.map((c: any) => c.column_name).join(', '));
    } else {
      console.log(`${t}: MISSING`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
