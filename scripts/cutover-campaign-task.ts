// 캠페인 작업 전환 이관(스펙 2026-08-28 §2-2 ②) — draft.campaign_id가 있는 원고를 작업 1행으로, 연결된 게시물을 작업으로.
// 사용: npx tsx --env-file=.env scripts/cutover-campaign-task.ts [--dry-run]
// 순서: 037 적용 → (새 코드 배포 직전) 이 스크립트 → 새 코드 배포 → 038 적용(draft 3컬럼 drop). 재실행 안전.
import { getSql } from '../src/lib/db.ts';
import { cutoverDraftsToTasks } from '../src/lib/campaignTaskStore.ts';

(async () => {
  const dry = process.argv.includes('--dry-run');
  const sql = getSql();
  try {
    const pending = await sql<Array<{ n: string | number }>>`
      select count(*) as n from draft d where d.campaign_id is not null and not exists (select 1 from campaign_task t where t.draft_id = d.id)`;
    console.log(`이관 대상 원고: ${pending[0].n}건`);
    if (dry) {
      console.log('(dry-run — 변경 없음)');
    } else {
      const r = await cutoverDraftsToTasks(sql);
      console.log(`작업 생성 ${r.tasks}건 · 게시물 연결 이전 ${r.trackedPosts}건`);
      // 확인용 — 테스트 픽스처를 걸러내려는 이름 패턴 대신, 캠페인명 그대로 보여 사람이 눈으로 판단한다.
      const check = await sql<Array<{
        campaign_name: string; type: string; influencer_handle: string | null; cost: unknown; posted_at: string | null;
      }>>`
        select c.name as campaign_name, t.type, t.influencer_handle, t.cost, to_char(t.posted_at, 'YYYY-MM-DD') as posted_at
          from campaign_task t
          join campaign c on c.id = t.campaign_id
         order by t.created_at`;
      console.table(check);
    }
  } finally {
    await sql.end();
  }
})();
