// 테스트 캠페인과 그 작업 삭제 (koo 확인 09-10: 테스트 데이터는 그쪽과 양쪽에서 지우기로 합의,
// 정산 요청 26건은 이미 삭제 완료). 이름·메모에 본인이 테스트라고 적어둔 4건만 지운다.
//
// cascade로 함께 지워지는 것: campaign_task · campaign_influencer_cost (033·038의 on delete cascade)
// 남는 것(연결만 풀림): draft(원고 — 별도 테이블, campaign_task.draft_id 쪽이 사라질 뿐)
//                      tracked_post.task_id → null (on delete set null)
//
// 기본은 드라이런. 실제 삭제는 --apply. 되돌릴 수 없다.
// 실행: node --env-file=.env --import tsx scripts/delete-test-campaigns.ts [--apply]
import { getSql } from '../src/lib/db.ts';

// 이름으로 특정한다 — 실수로 실제 캠페인을 지우지 않도록 정확한 전체 이름만 쓴다.
const NAMES = [
  '(삭제)마인드스킨클리닉 9월 1주',
  '테스트 — 제자리 수정 확인 0908',
  '테스트A — 정산 연동 유형별 확인 0908',
  '테스트B — 정산 관문 확인 0908',
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const camps = await sql`
    select c.id, c.name, c.client_name, c.note,
           to_char(c.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as created,
           (select count(*) from campaign_task t where t.campaign_id = c.id) as tasks,
           (select count(*) from campaign_influencer_cost x where x.campaign_id = c.id) as costs
      from campaign c where c.name in ${sql(NAMES)} order by c.created_at`;

  if (camps.length !== NAMES.length) {
    const found = new Set(camps.map((c) => c.name));
    for (const n of NAMES) if (!found.has(n)) console.error(`✗ 못 찾음: "${n}"`);
    console.error('\n이름이 정확히 맞지 않으면 아무것도 지우지 않습니다.');
    await sql.end(); process.exit(1);
  }

  const ids = camps.map((c) => c.id as string);
  const tasks = await sql`
    select t.id, c.name as campaign, t.influencer_handle as handle, t.type, t.cost,
           t.draft_id, t.post_url, to_char(t.posted_at,'YYYY-MM-DD') as posted
      from campaign_task t join campaign c on c.id = t.campaign_id
     where t.campaign_id in ${sql(ids)} order by c.name, t.created_at`;
  const drafts = await sql`
    select d.id, d.ko_title, d.influencer_handle
      from draft d where d.id in (select draft_id from campaign_task where campaign_id in ${sql(ids)} and draft_id is not null)`;
  const posts = await sql`
    select count(*) as n from tracked_post
     where task_id in (select id from campaign_task where campaign_id in ${sql(ids)})`;

  console.log(`삭제 대상: 캠페인 ${camps.length}건 · 작업 ${tasks.length}건 (cascade)`);
  console.log(`연결만 풀리는 것: 원고 ${drafts.length}건(남음) · 추적 게시물 ${posts[0].n}건(task 연결만 null)\n`);

  for (const c of camps) {
    console.log(`━━ ${c.name}`);
    console.log(`   클라 ${c.client_name} · 만든 ${c.created} · 작업 ${c.tasks}건 · 추가비용 ${c.costs}건`);
    if (c.note) console.log(`   메모: ${String(c.note).slice(0, 110)}`);
    for (const t of tasks.filter((x) => x.campaign === c.name))
      console.log(`      @${t.handle ?? '(미배정)'} ${t.type} ${t.cost ? JSON.stringify(t.cost) : '-'}${t.posted ? ' 게시 ' + t.posted : ''}${t.draft_id ? ' 원고있음' : ''}${t.post_url ? ' 링크있음' : ''}`);
  }

  if (drafts.length) {
    console.log('\n── 배정이 풀리는 원고(삭제되지 않음) ──');
    for (const d of drafts) console.log(`   @${d.influencer_handle ?? '-'} "${String(d.ko_title ?? '(제목없음)').slice(0, 40)}"`);
  }

  if (!apply) {
    console.log('\n드라이런입니다 — 실제로 지우려면 --apply를 붙여 다시 실행하세요.');
    console.log('⚠️ 되돌릴 수 없습니다.');
    await sql.end(); return;
  }

  const del = await sql`delete from campaign where id in ${sql(ids)} returning id, name`;
  const [after] = await sql`
    select (select count(*) from campaign) as camps, (select count(*) from campaign_task) as tasks,
           (select count(*) from draft) as drafts`;
  for (const d of del) console.log(`✓ ${d.name} 삭제`);
  console.log(`\n남은 건수 — 캠페인 ${after.camps} · 작업 ${after.tasks} · 원고 ${after.drafts}(보존)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
