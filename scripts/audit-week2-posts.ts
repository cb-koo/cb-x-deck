// 읽기 전용 — 게시물 내용 적재 결과를 DB에서 다시 읽어 원본 응답과 대조한다.
// 실행: node --env-file=.env --import tsx scripts/audit-week2-posts.ts
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { tweetId } from './tweetDate.ts';

const RAWS = JSON.parse(readFileSync(new URL('../data-work/week2-posts-raw.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown> | null>;

async function main(): Promise<void> {
  const sql = getSql();
  const fails: string[] = [];
  const rows = await sql`
    select c.name as camp, t.id as task_id, t.influencer_handle as handle, t.type,
           t.post_url, t.target_task_id, t.target_tweet_url, t.draft_id,
           d.model, d.status, d.influencer_handle as draft_handle, d.content, d.title, d.client_name,
           tp.id as tp_id, tp.tweet_id, tp.author_handle, tp.text as tp_text, tp.task_id as tp_task, tp.draft_id as tp_draft,
           tp.source, tp.role, tp.unavailable_at,
           s.views, s.likes, s.retweets, s.replies, s.bookmarks, s.quotes, (s.raw is not null) as has_raw
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join draft d on d.id = t.draft_id
      left join tracked_post tp on tp.task_id = t.id
      left join lateral (select * from post_metric_snapshot where tracked_post_id = tp.id order by captured_at desc limit 1) s on true
     where c.name like '%_9월2주차' and t.post_url is not null
     order by c.name, t.influencer_handle`;

  console.log(`DB에서 읽음 — 게시 완료 작업 ${rows.length}건`);
  if (rows.length !== 16) fails.push(`게시 완료 작업 ${rows.length}건 (기대 16)`);

  for (const r of rows) {
    const id = tweetId(String(r.post_url));
    const raw = id ? RAWS[id] : null;
    const h = String(r.handle);
    if (!raw) { fails.push(`@${h}: 원본 응답 없음`); continue; }
    // 원고
    if (!r.draft_id) fails.push(`@${h}: 원고가 안 붙음`);
    if (r.model !== null) fails.push(`@${h}: model=${r.model} (직접작성이면 null이어야 함)`);
    if (r.status !== 'delivered') fails.push(`@${h}: 원고 상태 ${r.status} (기대 delivered)`);
    const posts = (r.content as { posts: Array<{ text: string; media: unknown[] }> }).posts;
    if (posts.length !== 1) fails.push(`@${h}: 원고 칸 ${posts.length}개 (기대 1)`);
    if (posts[0].text !== String(raw.text)) fails.push(`@${h}: 원고 본문이 원본과 다르다`);
    if (posts[0].media.length !== 0) fails.push(`🔴 @${h}: 원고 미디어가 비어 있지 않다 — X CDN URL 금지 규칙 위반`);
    if (String(r.draft_handle).toLowerCase() !== h.toLowerCase()) fails.push(`@${h}: 원고 핸들 ${r.draft_handle}`);
    // 인용 대상
    const q = raw.quoted_tweet as Record<string, unknown> | null;
    if (!q) { if (r.target_task_id || r.target_tweet_url) fails.push(`@${h}: 인용 대상이 없는데 값이 있다`); }
    else {
      const both = r.target_task_id && r.target_tweet_url;
      const neither = !r.target_task_id && !r.target_tweet_url;
      if (both) fails.push(`@${h}: target_task_id 와 target_tweet_url 이 동시에 있다`);
      if (neither) fails.push(`@${h}: 인용 대상이 있는데 둘 다 비어 있다`);
      if (r.target_task_id === r.task_id) fails.push(`@${h}: 자기 작업을 가리킨다`);
      if (r.target_tweet_url && !String(r.target_tweet_url).endsWith(`/status/${q.id}`)) {
        fails.push(`@${h}: target_tweet_url 이 인용 대상 ID와 안 맞는다 — ${r.target_tweet_url}`);
      }
    }
    // 게시물·지표
    if (!r.tp_id) fails.push(`@${h}: tracked_post 연결 없음`);
    if (r.tweet_id !== id) fails.push(`@${h}: tweet_id 불일치`);
    if (r.tp_text !== String(raw.text)) fails.push(`@${h}: tracked_post 본문이 원본과 다르다`);
    if (r.tp_draft !== r.draft_id) fails.push(`@${h}: tracked_post.draft_id 가 작업의 원고와 다르다`);
    if (r.unavailable_at !== null) fails.push(`@${h}: unavailable_at 이 채워져 있다`);
    if (!r.has_raw) fails.push(`@${h}: 지표 스냅샷에 raw 없음`);
    for (const [col, key] of [['views','viewCount'],['likes','likeCount'],['retweets','retweetCount'],['replies','replyCount'],['bookmarks','bookmarkCount'],['quotes','quoteCount']] as const) {
      if (Number(r[col]) !== Number(raw[key])) fails.push(`@${h}: ${col} DB ${r[col]} ≠ 원본 ${raw[key]}`);
    }
    const tgt = r.target_task_id ? '작업' : r.target_tweet_url ? 'URL' : '없음';
    console.log(`  @${h.padEnd(16)} 원고 ${String(posts[0].text.length).padStart(3)}자/미디어 ${posts[0].media.length} · 인용 ${tgt} · 지표 ${r.views}조회 · raw ${r.has_raw ? 'O' : 'X'}`);
  }

  console.log('\n=== 인플루언서 활동 로그(원고 배정·전달) ===');
  const logs = await sql`
    select event_type, count(*) as n from influencer_log
     where event_type in ('draft_assigned','draft_delivered') and created_at > now() - interval '1 hour'
     group by 1`;
  for (const l of logs) console.log(`  ${l.event_type}: ${l.n}건`);
  const assigned = Number(logs.find((l) => l.event_type === 'draft_assigned')?.n ?? 0);
  const delivered = Number(logs.find((l) => l.event_type === 'draft_delivered')?.n ?? 0);
  if (assigned !== 16) fails.push(`draft_assigned ${assigned}건 (기대 16)`);
  if (delivered !== 16) fails.push(`draft_delivered ${delivered}건 (기대 16)`);

  const [x] = await sql`select
    (select count(*) from payment_request) as req,
    (select count(*) from draft where model is null and status='delivered') as delivered_manual,
    (select count(*) from post_metric_snapshot) as snaps`;
  console.log(`\n정산 요청 ${x.req}건(건드리지 않음) · 직접작성+전달됨 원고 ${x.delivered_manual}건 · 지표 스냅샷 ${x.snaps}건`);
  if (Number(x.req) !== 0) fails.push(`정산 요청이 ${x.req}건 생겼다`);

  console.log('\n════════════');
  if (!fails.length) console.log('✓ 대조 통과 — 원본 응답과 완전히 일치');
  else { console.log(`✗ 불일치 ${fails.length}건`); for (const f of fails) console.log(`   ✗ ${f}`); }
  await sql.end();
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
