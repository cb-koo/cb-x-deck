// 9월2주차 게시물 22건의 지표를 X에서 다시 받아 스냅샷을 한 줄씩 덧붙인다(append-only, 덮어쓰지 않음).
// 앱의 /api/tracking/[id]/refresh 와 같은 함수(fetchPost → appendSnapshot/markUnavailable)를 쓴다.
// 비용: 트윗당 약 $0.001 → 22건 ≈ $0.02. 실패한 건은 저장하지 않는다(틀린 기록보다 빈 기록).
// 실행: node --env-file=.env --import tsx scripts/refresh-week2-metrics.ts
import { getSql } from '../src/lib/db.ts';
import { fetchPost } from '../src/lib/postMetrics.ts';
import { appendSnapshot, markUnavailable } from '../src/lib/trackingStore.ts';

async function main(): Promise<void> {
  const sql = getSql();
  const posts = await sql<{ id: string; tweet_id: string; h: string; camp: string }[]>`
    select tp.id, tp.tweet_id, t.influencer_handle as h, c.name as camp
    from tracked_post tp join campaign_task t on t.id=tp.task_id join campaign c on c.id=t.campaign_id
    where c.name like '%9월2주차' order by c.name, t.influencer_handle`;
  let ok = 0, gone = 0, err = 0;
  for (const p of posts) {
    const r = await fetchPost(p.tweet_id);
    if (r.kind === 'error') { err++; console.log(`✗ ${p.camp} @${p.h} — 조회 실패(저장 안 함)`); continue; }
    if (r.kind === 'unavailable') { gone++; await markUnavailable(sql, p.id); console.log(`⚠ ${p.camp} @${p.h} — 조회 불가(삭제·비공개?)`); continue; }
    await appendSnapshot(sql, p.id, r.post.metrics, r.post.raw); ok++;
    console.log(`✓ ${p.camp.replace('_9월2주차','').padEnd(6)} @${p.h.padEnd(16)} 조회 ${String(r.post.metrics.views ?? '-').padStart(7)} 좋아요 ${String(r.post.metrics.likes ?? '-').padStart(5)}`);
  }
  console.log(`\n갱신 ${ok} · 조회불가 ${gone} · 실패 ${err} / ${posts.length}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
