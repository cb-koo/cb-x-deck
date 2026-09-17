// 9월3주차 게시물의 지표를 X에서 다시 받아 스냅샷을 한 줄씩 덧붙인다(append-only, 덮어쓰지 않음).
// 앱의 /api/tracking/[id]/refresh 와 같은 함수(fetchPost → appendSnapshot/markUnavailable)를 쓴다.
//
// 🔴 조인 주의: tracked_post 는 작업(task_id)에 붙는 게 원칙이지만 원고(draft_id)로만 붙은 것도 있다.
//    task_id 로만 조인하면 그런 게시물이 조용히 갱신에서 빠진다(2026-09-15 @saachan0013 선례).
//    그래서 작업의 post_url 과 트윗 ID로도 이어 붙인다.
//
// 비용: 트윗당 약 $0.001. 실패한 건은 저장하지 않는다(틀린 기록보다 빈 기록).
// 실행: node --env-file=.env --import tsx scripts/refresh-week3-metrics.ts
import { getSql } from '../src/lib/db.ts';
import { fetchPost } from '../src/lib/postMetrics.ts';
import { appendSnapshot, markUnavailable } from '../src/lib/trackingStore.ts';

async function main(): Promise<void> {
  const sql = getSql();
  const posts = await sql<Array<{ id: string; tweet_id: string; h: string; camp: string }>>`
    select distinct tp.id, tp.tweet_id, coalesce(t.influencer_handle, tp.author_handle) as h, c.name as camp
      from tracked_post tp
      join campaign_task t
        on t.id = tp.task_id
        or (tp.task_id is null and t.post_url is not null and t.post_url like '%/' || tp.tweet_id)
      join campaign c on c.id = t.campaign_id
     where c.name like '%9월3주차'
     order by c.name, h`;

  if (!posts.length) { console.log('3주차에 트래킹된 게시물이 없습니다 — 먼저 scripts/load-week3-posts.ts 를 돌리세요.'); await sql.end(); return; }
  console.log(`3주차 게시물 ${posts.length}건 갱신 (약 $${(posts.length * 0.001).toFixed(3)})\n`);

  let ok = 0, gone = 0, err = 0;
  for (const p of posts) {
    const r = await fetchPost(p.tweet_id);
    if (r.kind === 'error') { err++; console.log(`✗ ${p.camp} @${p.h} — 조회 실패(저장 안 함)`); continue; }
    if (r.kind === 'unavailable') { gone++; await markUnavailable(sql, p.id); console.log(`⚠ ${p.camp} @${p.h} — 조회 불가(삭제·비공개?)`); continue; }
    await appendSnapshot(sql, p.id, r.post.metrics, r.post.raw); ok++;
    const m = r.post.metrics;
    console.log(`✓ ${p.camp.replace('_9월3주차', '').padEnd(8)} @${p.h.padEnd(17)} 조회 ${String(m.views ?? '-').padStart(7)} 좋아요 ${String(m.likes ?? '-').padStart(5)} 북마크 ${String(m.bookmarks ?? '-').padStart(5)}`);
  }
  console.log(`\n갱신 ${ok} · 조회불가 ${gone} · 실패 ${err} / ${posts.length}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
