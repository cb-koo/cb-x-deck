import { writeFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
const OUT = '/private/tmp/claude-502/-Users-koo-clinicbridge-cb-x-deck/c4ca3ef1-d8e0-4675-8fee-3aae55104a54/scratchpad/roster.json';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select handle, display_name,
           (select jsonb_agg(x->>'type') from jsonb_array_elements(payment_methods) x) as types
      from influencer order by handle`;
  writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`명부 ${rows.length}명 → ${OUT}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
