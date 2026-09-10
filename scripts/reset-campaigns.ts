// 캠페인·작업 완전 초기화 (koo 확정 09-10: 지금까지의 캠페인·작업·정산 데이터는 전부 테스트용).
// 정산 요청 26건과 테스트 캠페인 4건은 이미 삭제했고, 이 스크립트가 남은 캠페인 5건·작업 13건을 지운다.
//
// cascade로 함께 지워지는 것: campaign_task · campaign_influencer_cost
// 남는 것: draft(원고 — 생성 비용이 든 자산이라 보존, 배정만 풀림) · tracked_post(task_id만 null)
//          external_api_log(그쪽과의 호출 기록)
//
// 안전장치: 실행 시점의 캠페인 수가 드라이런에서 본 수와 다르면 중단한다(다른 세션이 새로 만든 것을 지우지 않도록).
// 기본은 드라이런. 실제 삭제는 --apply. 되돌릴 수 없다.
// 실행: node --env-file=.env --import tsx scripts/reset-campaigns.ts [--apply] [--expect N]
import { getSql } from '../src/lib/db.ts';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const ei = argv.indexOf('--expect');
  const expect = ei >= 0 ? Number(argv[ei + 1]) : null;
  const sql = getSql();

  const camps = await sql`
    select c.id, c.name, c.client_name, c.note,
           to_char(c.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as made,
           (select count(*) from campaign_task t where t.campaign_id = c.id) as tasks,
           (select count(*) from campaign_influencer_cost x where x.campaign_id = c.id) as costs
      from campaign c order by c.created_at`;
  const [pre] = await sql`
    select (select count(*) from campaign_task) as tasks,
           (select count(*) from draft) as drafts,
           (select count(*) from payment_request) as reqs,
           (select count(*) from tracked_post where task_id is not null) as posts`;

  console.log(`삭제 대상: 캠페인 ${camps.length}건 · 작업 ${pre.tasks}건(cascade)`);
  console.log(`남는 것: 원고 ${pre.drafts}건(배정만 풀림) · 추적 게시물 연결 ${pre.posts}건(task_id → null)`);
  console.log(`참고: 정산 요청은 이미 ${pre.reqs}건\n`);

  for (const c of camps) {
    console.log(`━━ ${c.name} (${c.client_name}, 만든 ${c.made}) — 작업 ${c.tasks}건${Number(c.costs) ? ` · 추가비용 ${c.costs}건` : ''}`);
    if (c.note) console.log(`   메모: ${c.note}`);
  }

  if (expect !== null && camps.length !== expect) {
    console.error(`\n✗ 캠페인 수가 예상과 다릅니다 (예상 ${expect} · 실제 ${camps.length}) — 중단합니다.`);
    console.error('  다른 세션이 캠페인을 새로 만들었을 수 있습니다. 목록을 다시 확인하세요.');
    await sql.end(); process.exit(1);
  }

  if (!apply) {
    console.log(`\n드라이런입니다 — 실제로 지우려면: --apply --expect ${camps.length}`);
    console.log('⚠️ 되돌릴 수 없습니다. --expect 로 캠페인 수를 못박아 실행하세요.');
    await sql.end(); return;
  }
  if (expect === null) {
    console.error('\n✗ --apply 는 --expect N 과 함께 써야 합니다 (실수 방지).');
    await sql.end(); process.exit(2);
  }

  const del = await sql`delete from campaign returning id, name`;
  const [post] = await sql`
    select (select count(*) from campaign) as camps, (select count(*) from campaign_task) as tasks,
           (select count(*) from campaign_influencer_cost) as costs,
           (select count(*) from draft) as drafts,
           (select count(*) from draft d where not exists (select 1 from campaign_task t where t.draft_id = d.id)) as unassigned`;
  for (const d of del) console.log(`✓ ${d.name}`);
  console.log(`\n남은 건수 — 캠페인 ${post.camps} · 작업 ${post.tasks} · 추가비용 ${post.costs} · 원고 ${post.drafts}(전부 미배정 ${post.unassigned})`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
