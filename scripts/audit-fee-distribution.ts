// 읽기 전용 — 전체 결제수단의 수수료 분포. 5%가 표준인지 판별용.
import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select m->>'type' as type, m->'fee' as fee, count(*) as n
      from influencer i, jsonb_array_elements(i.payment_methods) m
     group by 1,2 order by 1, 3 desc`;
  console.log('결제수단 유형 × 수수료 분포:');
  for (const r of rows) console.log(`   ${r.type.padEnd(7)} | ${r.fee ? JSON.stringify(r.fee) : '(없음 = 인플 부담)'} : ${r.n}개`);

  const edited = await sql`
    select i.handle, m->'fee' as fee
      from influencer i, jsonb_array_elements(i.payment_methods) m
     where m->'fee' is not null and m->'fee' <> 'null'::jsonb
     order by i.handle`;
  console.log(`\n수수료가 붙은 수단 ${edited.length}개 전량:`);
  for (const r of edited) console.log(`   @${r.handle}: ${JSON.stringify(r.fee)}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
