// 읽기 전용 — 테스트 캠페인의 정산 요청 상태 확인. 삭제 가능 여부 판단용.
import { getSql } from '../src/lib/db.ts';

async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select c.name as campaign, r.influencer_handle, r.task_type,
           r.amount_gross, r.payout_currency, r.status,
           r.external_status, r.external_note,
           to_char(r.paid_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') as paid_at,
           r.paid_amount_krw,
           to_char(r.external_updated_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') as ext_at
      from payment_request r left join campaign c on c.id = r.campaign_id
     where c.name like '테스트%' or c.name like '(삭제)%'
     order by c.name, r.created_at
  `;
  let paid = 0, cancellable = 0;
  for (const r of rows) {
    const blocked = r.external_status === 'paid';
    if (blocked) paid++; else if (r.status !== 'cancelled') cancellable++;
    console.log(`${blocked ? '🔴' : '  '} ${r.campaign} | @${r.influencer_handle} ${r.task_type} | ${r.amount_gross}${r.payout_currency} | 우리:${r.status} 그쪽:${r.external_status ?? '(미확인)'} ${r.paid_at ? '지급 ' + r.paid_at : ''} ${r.external_note ? '· ' + r.external_note : ''}`);
  }
  console.log(`\n총 ${rows.length}건 — 그쪽 지급완료(취소 불가) ${paid}건 / 취소 가능 ${cancellable}건`);

  console.log('\n── 그쪽 상태값 분포(전체 요청) ──');
  const dist = await sql`
    select coalesce(external_status,'(미확인)') as st, status as ours, count(*) as n
      from payment_request group by 1,2 order by 3 desc`;
  for (const d of dist) console.log(`   그쪽 ${d.st} × 우리 ${d.ours}: ${d.n}건`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
