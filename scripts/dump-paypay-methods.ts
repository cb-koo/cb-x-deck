// 읽기 전용 — 명부의 PayPay 수단 전량. 슬랙 대조용.
import { writeFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
const OUT = '/private/tmp/claude-502/-Users-koo-clinicbridge-cb-x-deck/c4ca3ef1-d8e0-4675-8fee-3aae55104a54/scratchpad/paypay-db.json';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select i.handle, i.display_name,
           m->>'holder' as holder, m->>'identifier' as identifier,
           m->'fee' as fee, (m->>'isDefault')::boolean as is_default, m->>'id' as method_id,
           (select jsonb_agg(x->>'type') from jsonb_array_elements(i.payment_methods) x) as all_types
      from influencer i, jsonb_array_elements(i.payment_methods) m
     where m->>'type' = 'paypay'
     order by i.handle`;
  writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`PayPay 수단 ${rows.length}건 → ${OUT}\n`);
  for (const r of rows)
    console.log(`@${r.handle}  수취인 ${r.holder} | 식별값 ${r.identifier ?? '(없음)'} | ${r.is_default ? '기본' : '보조'} | 보유수단 ${JSON.stringify(r.all_types)} | 수수료 ${r.fee ? JSON.stringify(r.fee) : '없음'}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
