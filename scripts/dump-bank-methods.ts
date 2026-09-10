// 읽기 전용 — 명부의 계좌이체(bank) 수단 전량. 슬랙 대조용.
import { writeFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';

const OUT = '/private/tmp/claude-502/-Users-koo-clinicbridge-cb-x-deck/c4ca3ef1-d8e0-4675-8fee-3aae55104a54/scratchpad/bank-db.json';

async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select i.handle, i.display_name,
           m->>'holder' as holder, m->>'bank' as bank, m->>'branch' as branch,
           m->>'account' as account, m->>'currency' as currency,
           m->'fee' as fee, (m->>'isDefault')::boolean as is_default,
           m->>'id' as method_id
      from influencer i, jsonb_array_elements(i.payment_methods) m
     where m->>'type' = 'bank'
     order by i.handle`;
  writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`계좌이체 수단 ${rows.length}건 → ${OUT}\n`);
  for (const r of rows) {
    console.log(`@${r.handle} ("${r.display_name ?? '-'}")`);
    console.log(`   ${r.holder} | ${r.bank}${r.branch ? ' / ' + r.branch : ''} / ${r.account} | ${r.currency}${r.is_default ? ' (기본)' : ' (보조)'}`);
    console.log(`   수수료: ${r.fee ? JSON.stringify(r.fee) : '없음'}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
