// 정산 요청 전량 삭제 (koo 확인 09-10: 테스트 데이터는 그쪽과 양쪽에서 지우기로 합의했고,
// 지금까지 정산 데이터는 전부 테스트용이라 삭제해도 문제 없음).
//
// 삭제 대상: payment_request 전량. payment_request_revision은 on delete cascade로 함께 지워진다.
// 남기는 것: external_api_log — 042에서 FK를 일부러 떼어 참조 행이 지워져도 값이 남게 설계했다(§4-8-a).
//            그쪽과 주고받은 호출 기록이자 유일한 사후 대조 근거이므로 건드리지 않는다.
//
// paid-locked 트리거(041)는 before update에만 걸려 있어 delete를 막지 않는다 — 우회가 아니라
// 애초에 삭제는 잠금 대상이 아니었다. 그래도 지우기 전에 무엇이 사라지는지 전부 출력한다.
//
// 기본은 드라이런. 실제 삭제는 --apply. 되돌릴 수 없다.
// 실행: node --env-file=.env --import tsx scripts/delete-test-payment-requests.ts [--apply]
import { getSql } from '../src/lib/db.ts';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const rows = await sql`
    select r.id, r.external_id, c.name as campaign, r.influencer_handle as handle, r.task_type,
           r.amount_gross, r.payout_currency, r.status, r.external_status,
           to_char(r.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as created,
           (select count(*) from payment_request_revision v where v.request_id = r.id) as revs
      from payment_request r left join campaign c on c.id = r.campaign_id
     order by r.created_at`;
  const [pre] = await sql`
    select (select count(*) from payment_request) as reqs,
           (select count(*) from payment_request_revision) as revs,
           (select count(*) from external_api_log) as logs`;

  console.log(`삭제 대상: 정산 요청 ${rows.length}건 · 수정 이력 ${pre.revs}건(cascade)`);
  console.log(`남기는 것: 외부 호출 기록 ${pre.logs}건 (external_api_log — 대조 근거)\n`);

  const byState = new Map<string, number>();
  for (const r of rows) {
    const k = `우리:${r.status} / 그쪽:${r.external_status ?? '미확인'}`;
    byState.set(k, (byState.get(k) ?? 0) + 1);
  }
  console.log('── 상태별 ──');
  for (const [k, v] of [...byState].sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}건`);

  console.log('\n── 전량 ──');
  for (const r of rows)
    console.log(`   ${r.external_id ?? '(전송기록없음)'} | ${r.created} | ${r.campaign ?? '(캠페인없음)'} | @${r.handle} ${r.task_type} | ${r.amount_gross}${r.payout_currency} | 우리:${r.status} 그쪽:${r.external_status ?? '미확인'}${Number(r.revs) ? ` | 수정이력 ${r.revs}건` : ''}`);

  if (!apply) {
    console.log('\n드라이런입니다 — 실제로 지우려면 --apply를 붙여 다시 실행하세요.');
    console.log('⚠️ 되돌릴 수 없습니다. 그쪽도 함께 지운다는 합의가 확인된 뒤에만 실행하세요.');
    await sql.end(); return;
  }

  const del = await sql`delete from payment_request returning id`;
  const [post] = await sql`
    select (select count(*) from payment_request) as reqs,
           (select count(*) from payment_request_revision) as revs,
           (select count(*) from external_api_log) as logs`;
  console.log(`\n✓ 정산 요청 ${del.length}건 삭제`);
  console.log(`남은 건수 — 요청 ${post.reqs} · 수정이력 ${post.revs} · 외부 호출 기록 ${post.logs}(보존됨)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
