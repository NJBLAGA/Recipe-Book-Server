import { config } from 'dotenv';
config({ path: '.env.test', override: true });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function cols(table: string) {
  const r = await sql.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [table]);
  return ((r as any).rows ?? r as any[]).map((x: any) => x.column_name).join(', ');
}

async function main() {
  for (const t of ['shopping_list_item', 'follow']) {
    console.log(`${t}: ${await cols(t)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
