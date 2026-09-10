// 읽기 전용 — 수수료 스냅샷이 박힌 정산 요청 확인.
import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select c.name as campaign, r.influencer_handle as handle, r.task_type,
           r.amount_net, r.fee_amount, r.amount_gross, r.payout_currency,
           r.fee, r.status, r.external_status,
           (c.name like '테스트%' or c.name like '(삭제)%') as is_test
      from payment_request r left join campaign c on c.id = r.campaign_id
     where r.fee is not null or r.fee_amount > 0
     order by is_test, c.name, r.created_at`;
  if (rows.length === 0) { console.log('수수료가 박힌 요청 없음'); await sql.end(); return; }
  for (const r of rows) {
    console.log(`${r.is_test ? '[테스트] ' : '🔴[실제] '}${r.campaign} | @${r.handle} ${r.task_type}`);
    console.log(`    순액 ${r.amount_net} + 수수료 ${r.fee_amount} = 송금 ${r.amount_gross}${r.payout_currency} | ${JSON.stringify(r.fee)}`);
    console.log(`    우리:${r.status} 그쪽:${r.external_status ?? '(미확인)'}`);
  }
  console.log(`\n총 ${rows.length}건 (실제 캠페인 ${rows.filter((r) => !r.is_test).length}건 / 테스트 ${rows.filter((r) => r.is_test).length}건)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
