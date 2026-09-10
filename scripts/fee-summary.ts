import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select i.handle, m->>'type' as type, m->'fee' as fee, (m->>'isDefault')::boolean as def
      from influencer i, jsonb_array_elements(i.payment_methods) m
     where m->'fee' is not null and m->'fee' <> 'null'::jsonb
     order by m->>'type', i.handle`;
  for (const r of rows) console.log(`   ${r.type.padEnd(7)} @${String(r.handle).padEnd(20)} ${JSON.stringify(r.fee)}${r.def ? ' (기본)' : ' (보조)'}`);
  console.log(`   총 ${rows.length}건`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
