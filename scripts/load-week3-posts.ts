// 9월3주차 인용RT 게시물 6건을 트래킹에 등록하고 첫 지표(조회수 등)를 받는다.
//
// 왜: 작업에는 게시물 링크가 들어갔지만 tracked_post 가 없어 성과를 볼 수 없다(2주차는 있다).
// 등록해 두면 이후 scripts/refresh-week3-metrics.ts 로 같은 게시물의 지표를 이어서 쌓을 수 있다.
//
// 앱과 같은 함수를 쓴다: addTrackedPost(등록 + 첫 스냅샷을 한 트랜잭션) → linkTrackedPost(작업에 연결).
// linkTrackedPost 는 작업의 post_url·posted_at 이 비어 있을 때만 채운다(coalesce) — 우리 6건은 이미 둘 다
// 있으므로 건드리지 않는다. RT 작업에 연결하면 함수가 스스로 거절한다(RT 증빙 스펙 §5) — 그래서 인용RT만 대상이다.
//
// 비용: 트윗 조회 6회(건당 약 $0.001). 조회 실패한 건은 저장하지 않는다 — 틀린 기록보다 빈 기록.
// 멱등: 이미 등록된 트윗(tweet_id unique)은 건너뛴다.
//
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/load-week3-posts.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { fetchPost } from '../src/lib/postMetrics.ts';
import { addTrackedPost, linkTrackedPost, findByTweetId } from '../src/lib/trackingStore.ts';
import { tweetId } from './tweetDate.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313'; // 박구건

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const tasks = await sql<Array<{ id: string; camp: string; h: string; type: string; url: string; amt: number }>>`
    select t.id, c.name as camp, t.influencer_handle as h, t.type, t.post_url as url, (t.cost->>'amount')::int as amt
      from campaign_task t join campaign c on c.id = t.campaign_id
     where c.name like '%9월3주차' and t.post_url is not null
     order by c.name, t.influencer_handle`;

  console.log(`게시물 링크가 있는 3주차 작업 ${tasks.length}건\n`);

  const todo: typeof tasks = [];
  for (const t of tasks) {
    if (t.type === 'rt') { console.log(`   · @${t.h}: RT 작업 — 연결하지 않습니다(RT 증빙 스펙 §5)`); continue; }
    const id = tweetId(t.url);
    if (!id) { console.log(`   ✗ @${t.h}: URL 정규형이 아닙니다 — ${t.url}`); continue; }
    const already = await findByTweetId(sql, id);
    if (already) { console.log(`   · @${t.h}: 이미 트래킹에 있음(${already.id.slice(0, 8)}…) — 건너뜁니다`); continue; }
    todo.push(t);
    console.log(`   @${t.h.padEnd(17)} ${t.camp.replace('_9월3주차', '').padEnd(8)} ${String(t.amt / 10000).padStart(4)}만  ${t.url}`);
  }

  if (!todo.length) { console.log('\n등록할 것이 없습니다.'); await sql.end(); return; }
  console.log(`\n등록 대상 ${todo.length}건 · 트윗 조회 ${todo.length}회(약 $${(todo.length * 0.001).toFixed(3)})`);
  if (!apply) { console.log('\n드라이런입니다 — 실제로 받으려면 --apply'); await sql.end(); return; }

  console.log('');
  let ok = 0, gone = 0, err = 0;
  for (const t of todo) {
    const id = tweetId(t.url) as string;
    const r = await fetchPost(id);
    if (r.kind === 'error') { err++; console.log(`✗ @${t.h} 조회 실패 — 저장하지 않습니다`); continue; }
    if (r.kind === 'unavailable') { gone++; console.log(`⚠ @${t.h} 조회 불가(삭제·비공개?) — 저장하지 않습니다`); continue; }
    const p = r.post;
    const add = await addTrackedPost(sql, {
      tweetId: id, authorHandle: p.authorHandle, text: p.text, postedAt: p.postedAt,
      createdBy: KOO, metrics: p.metrics, raw: p.raw,
    });
    await linkTrackedPost(sql, add.row.id, { taskId: t.id });
    ok++;
    const m = p.metrics;
    console.log(`✓ ${t.camp.replace('_9월3주차', '').padEnd(8)} @${t.h.padEnd(17)} 조회 ${String(m.views ?? '-').padStart(7)} 좋아요 ${String(m.likes ?? '-').padStart(5)} 북마크 ${String(m.bookmarks ?? '-').padStart(5)}`);
  }
  console.log(`\n등록 ${ok} · 조회불가 ${gone} · 실패 ${err} / ${todo.length}`);

  const [after] = await sql<Array<{ n: number }>>`
    select count(*)::int as n from tracked_post tp join campaign_task t on t.id = tp.task_id
      join campaign c on c.id = t.campaign_id where c.name like '%9월3주차'`;
  console.log(`확인 — 3주차 작업에 붙은 트래킹 게시물 ${after.n}건`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
