// 읽기 전용 — 전체 정산 요청 정리 가능 여부 판정.
import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select c.name as campaign, r.external_id, r.influencer_handle as handle, r.task_type,
           r.amount_gross, r.payout_currency, r.status, r.external_status,
           (c.name like '테스트%' or c.name like '(삭제)%') as is_test
      from payment_request r left join campaign c on c.id = r.campaign_id
     order by is_test, c.name, r.created_at`;

  const bucket = (r: Record<string, unknown>) =>
    r.status === 'cancelled' ? '이미 취소됨'
    : r.external_status === 'paid' ? '🔴 취소 불가(그쪽 지급완료)'
    : '취소 가능';

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.is_test ? '[테스트캠페인] ' : '[실제캠페인] '}${r.campaign}`;
    if (!groups.has(k)) groups.set(k, [] as never);
    (groups.get(k) as unknown[]).push(r);
  }
  for (const [k, list] of groups) {
    console.log(`\n━━ ${k} (${list.length}건) ━━`);
    for (const r of list) {
      console.log(`  ${bucket(r as never).padEnd(22)} ${r.external_id ?? '(미전송)'} @${r.handle} ${r.task_type} ${r.amount_gross}${r.payout_currency} | 우리:${r.status} 그쪽:${r.external_status ?? '(미확인)'}`);
    }
  }
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(bucket(r as never), (counts.get(bucket(r as never)) ?? 0) + 1);
  console.log(`\n\n══ 합계 ${rows.length}건 ══`);
  for (const [k, v] of counts) console.log(`   ${k}: ${v}건`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
