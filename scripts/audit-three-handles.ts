// 읽기 전용 — 수수료를 되돌린 3개 계정의 정산 요청 전량(취소·재요청 패턴 확인).
import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select r.influencer_handle as handle, c.name as campaign, r.external_id,
           to_char(r.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as created,
           r.amount_net, r.fee_amount, r.amount_gross, r.payout_currency,
           r.fee, r.status, r.cancel_reason, r.external_status, r.external_note,
           to_char(r.cancelled_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as cancelled,
           r.task_id
      from payment_request r left join campaign c on c.id = r.campaign_id
     where lower(r.influencer_handle) in ('qni6f','yuichan___27','aik_ooooo')
     order by r.influencer_handle, r.created_at`;
  let last = '';
  for (const r of rows) {
    if (r.handle !== last) { console.log(`\n━━━━━ @${r.handle} ━━━━━`); last = r.handle as string; }
    console.log(`[${r.created}] ${r.external_id ?? '(미전송)'} | ${r.campaign}`);
    console.log(`    순액 ${r.amount_net} + 수수료 ${r.fee_amount} = ${r.amount_gross}${r.payout_currency} | ${r.fee ? JSON.stringify(r.fee) : '수수료없음'}`);
    console.log(`    우리:${r.status}${r.cancelled ? ` (${r.cancelled}, 이유: ${r.cancel_reason ?? '-'})` : ''} | 그쪽:${r.external_status ?? '(미확인)'}${r.external_note ? ` · ${r.external_note}` : ''}`);
    console.log(`    작업 ${String(r.task_id).slice(0, 8)}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
