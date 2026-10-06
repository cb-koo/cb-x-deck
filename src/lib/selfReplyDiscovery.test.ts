// 인플 본인 댓글 찾기·붙이기 + 성과 [업데이트](↻) — 연습용 DB, getxapi는 대역(스펙 2026-10-06-self-replies-design.md §7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign, getCampaignDetail } from './campaignStore.ts';
import { createTasks, getTask } from './campaignTaskStore.ts';
import { findByTweetId, addTrackedPost, linkTrackedPost } from './trackingStore.ts';
import { listInfluencerPerformance } from './influencerPerformanceStore.ts';
import { attachPostToTask } from './postAttach.ts';
import { postFromRaw, type FetchPostResult } from './postMetrics.ts';
import { insertDraft } from './draftStore.ts';
import { insertLink } from './linkStore.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';
import { discoverSelfReplies, refreshCampaignPerf, type ThreadDeps } from './selfReplyDiscovery.ts';
import { listContentRows } from './performanceStore.ts';

const sql = getSql();
const P = 'tsrd' + process.pid;
const M0 = { views: 10, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 };

// 트윗 id는 진짜 스노플레이크여야 한다(링크 해석·게시일 파생) — 만든 id를 모아 지운다(postAttach.test 관례)
const TWITTER_EPOCH = BigInt(1288834974657);
const BASE = (BigInt(Date.parse('2026-10-06T03:00:00Z')) - TWITTER_EPOCH) << BigInt(22);
const made: string[] = [];
let seq = 0;
const newTweetId = () => {
  const id = (BASE + BigInt(process.pid) * BigInt(1000) + BigInt(seq++)).toString();
  made.push(id);
  return id;
};
const link = (handle: string, id: string) => `https://x.com/${handle}/status/${id}`;

after(async () => {
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from tracked_post where tweet_id = any(${made}::text[])`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

// 스레드 응답의 트윗 하나(10-06 실제 응답 모양)
// inReplyTo: 답글이 달린 트윗(본인 댓글 사슬 판정 — pickSelfReplies)
const tw = (id: string, a: { handle: string; uid: string }, createdAt: string, views: number, isReply: boolean, text = '본문', inReplyTo: string | null = null): RawTweet => ({
  id, text, createdAt, isReply, inReplyToId: inReplyTo, author: { userName: a.handle, id: a.uid },
  viewCount: views, likeCount: 1, retweetCount: 0, replyCount: 0, bookmarkCount: 0, quoteCount: 0, media: [],
});

// 상세 조회 응답 — 스레드 응답과 달리 링크 정보 칸(entities.urls)이 있다(실제 getxapi 상세 응답 모양). 본문 속 URL로 채운다.
const detailOf = (t: RawTweet): RawTweet => ({
  ...t, entities: { urls: (String(t.text ?? '').match(/https?:\/\/\S+/g) ?? []).map((u) => ({ expanded_url: u })) },
});

// 대역 — 스레드는 main id별 응답(또는 'throw'), 상세 조회는 tweetId별(posts가 없으면 스레드 응답 속 같은 트윗의
// 상세 모양 detailOf). 부른 횟수를 센다.
function fakeDeps(opts: {
  threads?: Record<string, RawTweet[] | 'throw'>;
  posts?: Record<string, { handle: string; uid: string; views?: number; text?: string } | 'unavailable' | 'error'>;
}) {
  const threadCalls: string[] = [];
  const fetchCalls: string[] = [];
  const deps: ThreadDeps = {
    getTweetThread: async (id: string): Promise<SearchPage> => {
      threadCalls.push(id);
      const v = opts.threads?.[id];
      if (v === undefined || v === 'throw') throw new Error(`404 from /twitter/tweet/thread?id=${id}`);
      return { tweets: v, has_more: false, next_cursor: null };
    },
    fetchPost: async (id: string): Promise<FetchPostResult> => {
      fetchCalls.push(id);
      const v = opts.posts?.[id];
      if (v === undefined) {
        const t = Object.values(opts.threads ?? {}).flatMap((x) => (x === 'throw' ? [] : x)).find((x) => x.id === id);
        const post = t ? postFromRaw(detailOf(t)) : null;
        return post ? { kind: 'ok', post } : { kind: 'error' };
      }
      if (v === 'error') return { kind: 'error' };
      if (v === 'unavailable') return { kind: 'unavailable' };
      return { kind: 'ok', post: {
        tweetId: id, authorHandle: v.handle, authorUserId: v.uid, text: v.text ?? '본문', postedAt: '2026-10-06T03:00:00.000Z',
        metrics: { ...M0, views: v.views ?? M0.views }, raw: { id, isReply: false },
      } };
    },
  };
  return { deps, threadCalls, fetchCalls };
}

let n = 0;
// 배정 인플(명부에 고유번호) + 작업 하나. 링크로 게시 확인까지(attachPostToTask — 실제 입구)
async function postedTask(type: 'post' | 'quoteRt' | 'rt' = 'post') {
  const handle = `${P}i${n}`;
  const uid = `${process.pid}0${n}`;
  await sql`insert into influencer (handle, x_user_id) values (${handle}, ${uid})`;
  const c = await createClient(sql, P + '클라' + n);
  const camp = await createCampaign(sql, {
    clientId: c.id, clientName: c.name, name: P + '캠' + n, nameEn: `${P}-c${n}`,
    startsOn: '2026-10-05', endsOn: '2026-10-11', kind: null, note: '', createdBy: null,
  });
  n++;
  const [task] = await createTasks(sql, camp.id, {
    type, targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null,
    items: [{ handle, cost: null }],
  });
  const a = { handle, uid };
  if (type === 'rt') return { campaignId: camp.id, task, a, mainId: null };
  const mainId = newTweetId();
  const { deps } = fakeDeps({ posts: { [mainId]: { handle, uid, views: 1000 } } });
  const r = await attachPostToTask(sql, task.id, link(handle, mainId), deps);
  assert.equal(r.ok, true);
  return { campaignId: camp.id, task, a, mainId };
}
const latestViews = async (tweetId: string) => (await findByTweetId(sql, tweetId))?.metrics?.views ?? null;

test('게시 확인 뒤 — 같은 작성자 고유번호의 댓글만 작업에 붙는다(첫 스냅샷 = 상세 조회)·게시물 링크는 그대로', async () => {
  const { task, a, mainId } = await postedTask('quoteRt');
  const reply = newTweetId(); const stranger = newTweetId(); const imposter = newTweetId();
  const { deps, threadCalls, fetchCalls } = fakeDeps({ threads: { [mainId!]: [
    tw(mainId!, a, 'Tue Oct 06 08:40:28 +0000 2026', 1027, false),
    tw(reply, a, 'Tue Oct 06 10:04:54 +0000 2026', 42, true, '相談会 🦷https://pages.s.gy/thesquaredc_jp', mainId),
    tw(stranger, { handle: 'someone', uid: '1' }, 'Tue Oct 06 10:10:00 +0000 2026', 5, true, '본문', mainId),
    tw(imposter, { handle: a.handle, uid: '999' }, 'Tue Oct 06 10:20:00 +0000 2026', 5, true, '본문', mainId),   // 핸들만 같은 남
  ] } });
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 1);
  assert.deepEqual(threadCalls, [mainId]);
  assert.deepEqual(fetchCalls, [reply]);   // 남의 트윗은 스레드의 고유번호로 걸러 상세 조회도 안 한다
  const tp = await findByTweetId(sql, reply);
  assert.equal(tp?.taskId, task.id);
  assert.equal(tp?.metrics?.views, 42);
  assert.equal(tp?.role, null);   // 역할은 저장하지 않는다 — 읽을 때 판정
  assert.equal(await findByTweetId(sql, stranger), null);
  assert.equal(await findByTweetId(sql, imposter), null);
  assert.equal((await getTask(sql, task.id))!.postUrl, link(a.handle, mainId!));
  // 다시 찾아도 중복으로 붙지 않는다
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 0);

  // 패널·성과: 작업 지표는 본 게시물만, 댓글은 replies로 따로
  const d = (await getCampaignDetail(sql, task.campaignId))!;
  const item = d.tasks.find((t) => t.id === task.id)!;
  assert.deepEqual(item.perf, { postCount: 2, views: 1000, likes: 1, bookmarks: 0 });
  assert.equal(item.replies.length, 1);
  assert.equal(item.replies[0].tweetId, reply);
  assert.equal(item.replies[0].views, 42);
  assert.equal(item.replies[0].link, 'https://pages.s.gy/thesquaredc_jp');
  assert.equal(item.replies[0].url, link(a.handle, reply));
  const perf = (await listInfluencerPerformance(sql)).find((r) => r.handle === a.handle)!;
  assert.equal(perf.tasks[0].metrics?.views, 1000);
  assert.equal(perf.tasks[0].metrics?.postCount, 2);
});

test('깨진 글자 — 상세 조회 본문이 깨졌고(�) 스레드 응답 본문이 정상이면 스레드 본문으로 등록한다(스펙 §10)', async () => {
  const { task, a, mainId } = await postedTask('post');
  const clean = newTweetId(); const bothBad = newTweetId();
  const { deps } = fakeDeps({
    threads: { [mainId!]: [
      tw(mainId!, a, 'Tue Oct 06 08:40:28 +0000 2026', 1000, false),
      tw(clean, a, 'Tue Oct 06 10:04:54 +0000 2026', 42, true, '見積もりだけでも', mainId),
      tw(bothBad, a, 'Tue Oct 06 10:30:00 +0000 2026', 9, true, '見\uFFFDもり', clean),
    ] },
    posts: {
      [clean]: { handle: a.handle, uid: a.uid, views: 42, text: '見\uFFFD\uFFFDもりだけでも' },
      [bothBad]: { handle: a.handle, uid: a.uid, views: 9, text: '見\uFFFDもり' },
    },
  });
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 2);
  assert.equal((await findByTweetId(sql, clean))?.text, '見積もりだけでも');
  assert.equal((await findByTweetId(sql, clean))?.metrics?.views, 42);   // 지표는 상세 조회 값 그대로
  assert.equal((await findByTweetId(sql, bothBad))?.text, '見\uFFFDもり');   // 둘 다 깨졌으면 그대로 붙인다
});

test('게시 확인 뒤 — 스레드 조회 실패는 조용히 0(게시 확인은 이미 끝났다)', async () => {
  const { task } = await postedTask('post');
  const { deps } = fakeDeps({ threads: {} });
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 0);
});

test('RT·없는 작업은 스레드를 보지 않는다', async () => {
  const { task } = await postedTask('rt');
  const { deps, threadCalls } = fakeDeps({});
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 0);
  assert.equal(await discoverSelfReplies(sql, '00000000-0000-0000-0000-000000000000', deps), 0);
  assert.deepEqual(threadCalls, []);
});

test('↻ — 지표는 게시물별 상세 조회로, 스레드 1회로는 새 댓글만 찾아 붙인다', async () => {
  const { campaignId, task, a, mainId } = await postedTask('post');
  const r1 = newTweetId(); const r2 = newTweetId();
  const t0 = 'Tue Oct 06 03:00:00 +0000 2026';   // 본 게시물 게시 시각 = 등록 때 값(대역 fetchPost의 postedAt)
  await discoverSelfReplies(sql, task.id, fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(r1, a, 'Tue Oct 06 04:00:00 +0000 2026', 30, true, '본문', mainId)] } }).deps);
  const { deps, threadCalls, fetchCalls } = fakeDeps({ threads: { [mainId!]: [
    tw(mainId!, a, t0, 2000, false), tw(r1, a, 'Tue Oct 06 04:00:00 +0000 2026', 50, true, '본문', mainId), tw(r2, a, 'Tue Oct 06 07:00:00 +0000 2026', 7, true, '본문', r1),   // r2는 r1에 이어 단 댓글
  ] } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 2, refreshed: 2, unavailable: 0, failed: 0, newReplies: 1 });
  assert.deepEqual(threadCalls, [mainId]);
  assert.deepEqual(fetchCalls, [mainId, r1, r2]);
  assert.equal(await latestViews(mainId!), 2000);
  assert.equal(await latestViews(r1), 50);
  assert.equal(await latestViews(r2), 7);
  assert.equal((await findByTweetId(sql, r2))?.taskId, task.id);
  const item = (await getCampaignDetail(sql, campaignId))!.tasks.find((t) => t.id === task.id)!;
  assert.equal(item.perf?.views, 2000);   // 댓글 지표(50·7)는 더하지 않는다
  assert.deepEqual(item.replies.map((x) => [x.tweetId, x.views]), [[r1, 50], [r2, 7]]);   // 게시 순, 댓글마다 자기 지표
});

test('↻ — 본 게시물이 없어지면 스레드는 보지 않고 상세 조회의 삭제 판정만(복귀도 그대로)', async () => {
  const { campaignId, a, mainId } = await postedTask('post');
  const { deps, fetchCalls, threadCalls } = fakeDeps({ threads: {}, posts: { [mainId!]: 'unavailable' } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 1, refreshed: 0, unavailable: 1, failed: 0, newReplies: 0 });
  assert.deepEqual(fetchCalls, [mainId]);
  assert.deepEqual(threadCalls, []);   // 본 게시물이 방금 '없음'이면 스레드는 보지 않는다(헛조회 비용)
  assert.ok((await findByTweetId(sql, mainId!))?.unavailableAt);
  // 복귀: 다음 ↻에서 다시 측정되면 unavailable이 풀린다(appendSnapshot 규칙)
  await refreshCampaignPerf(sql, campaignId, fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, 'Tue Oct 06 08:00:00 +0000 2026', 3000, false)] } }).deps);
  assert.equal((await findByTweetId(sql, mainId!))?.unavailableAt, null);
  assert.equal(await latestViews(mainId!), 3000);
});

test('↻ — 지운 댓글은 상세 조회가 삭제로 판정한다', async () => {
  const { campaignId, task, a, mainId } = await postedTask('post');
  const r1 = newTweetId();
  const t0 = 'Tue Oct 06 08:00:00 +0000 2026';
  await discoverSelfReplies(sql, task.id, fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(r1, a, t0, 30, true, '본문', mainId)] } }).deps);
  const { deps, fetchCalls } = fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1100, false)] }, posts: { [r1]: 'unavailable' } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 2, refreshed: 1, unavailable: 1, failed: 0, newReplies: 0 });
  assert.deepEqual(fetchCalls, [mainId, r1]);
  assert.ok((await findByTweetId(sql, r1))?.unavailableAt);
});

test('다른 작업에 붙은 트윗은 건드리지 않는다 · 작업 없이 트래킹 중인 트윗은 연결만', async () => {
  const one = await postedTask('post');
  const two = await postedTask('post');
  const taken = newTweetId(); const loose = newTweetId();
  // taken: 같은 인플의 트윗이지만 다른 작업(two)에 이미 붙어 있다. loose: 트래킹만 되고 작업 없음
  const { row: tk } = await addTrackedPost(sql, { tweetId: taken, authorHandle: one.a.handle, text: '', postedAt: null, createdBy: null, metrics: { ...M0, views: 5 }, raw: null });
  await sql.begin(async (tx) => { await linkTrackedPost(tx as unknown as typeof sql, tk.id, { taskId: two.task.id }); });
  await addTrackedPost(sql, { tweetId: loose, authorHandle: one.a.handle, text: '', postedAt: null, createdBy: null, metrics: { ...M0, views: 6 }, raw: null });
  const t0 = 'Tue Oct 06 08:00:00 +0000 2026';
  const { deps } = fakeDeps({ threads: { [one.mainId!]: [
    tw(one.mainId!, one.a, t0, 1000, false), tw(taken, one.a, t0, 99, true, '본문', one.mainId), tw(loose, one.a, t0, 77, true, '본문', one.mainId),
  ] } });
  const res = await refreshCampaignPerf(sql, one.campaignId, deps);
  assert.equal(res.newReplies, 1);
  const tkAfter = await findByTweetId(sql, taken);
  assert.equal(tkAfter?.taskId, two.task.id);
  assert.equal(tkAfter?.metrics?.views, 5);   // 스냅샷도 쌓지 않는다
  const lAfter = await findByTweetId(sql, loose);
  assert.equal(lAfter?.taskId, one.task.id);
  assert.equal(lAfter?.metrics?.views, 6);    // 연결만 — 이미 있는 행에 새 스냅샷은 다음 ↻부터
});

test('↻ — RT 작업의 옛 게시물은 스레드 없이 상세 조회로', async () => {
  const { campaignId, task } = await postedTask('rt');
  const id = newTweetId();
  await sql`update campaign_task set posted_at = '2026-10-06' where id = ${task.id}`;
  await sql`insert into tracked_post (tweet_id, author_handle, text, task_id) values (${id}, 'x', '', ${task.id})`;
  const { deps, threadCalls, fetchCalls } = fakeDeps({ posts: { [id]: { handle: 'x', uid: '1', views: 9 } } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 1, refreshed: 1, unavailable: 0, failed: 0, newReplies: 0 });
  assert.deepEqual(threadCalls, []);
  assert.deepEqual(fetchCalls, [id]);
});

// 회귀(10-06): 스레드 응답엔 entities가 없다 — 그 raw로 스냅샷하면 트래킹 링크 댓글의 자동 역할이 link → thread로 바뀌어
// 콘텐츠 성과·랜딩 퍼널 귀속이 깨진다. 붙일 때도 ↻ 뒤에도 최신 스냅샷은 상세 조회 raw(entities 포함)여야 한다.
test('↻ 뒤에도 트래킹 링크가 든 댓글은 link 역할 그대로(스냅샷 raw = 상세 조회)', async () => {
  const { campaignId, task, a, mainId } = await postedTask('post');
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'role', format: 'single',
    referenceMode: 'off', refs: [], content: { posts: [{ text: '본문', media: [] }] }, model: null, memberId: null,
  });
  const short = `https://cb.link/${P}rl`;
  await insertLink(sql, {
    code: P + 'rl', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=x',
    shortUrl: short, shortioLinkId: 'lnk_' + P, utmCampaign: P + 'camp',
    influencerHandle: a.handle, utmContent: `${a.handle}-${P}`, draftId: d, clientId: null, clientName: null, createdBy: null,
  });
  await sql`update campaign_task set draft_id = ${d} where id = ${task.id}`;
  await sql`update tracked_post set draft_id = ${d} where tweet_id = ${mainId!}`;
  const reply = newTweetId();
  const t0 = 'Tue Oct 06 03:00:00 +0000 2026';
  const thread = { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(reply, a, 'Tue Oct 06 05:00:00 +0000 2026', 40, true, `相談会 ${short}`, mainId)] };
  assert.equal(await discoverSelfReplies(sql, task.id, fakeDeps({ threads: thread }).deps), 1);
  assert.equal((await findByTweetId(sql, reply))?.derivedRole, 'link');
  assert.equal((await findByTweetId(sql, mainId!))?.derivedRole, 'main');

  const res = await refreshCampaignPerf(sql, campaignId, fakeDeps({ threads: thread }).deps);
  assert.deepEqual(res, { total: 2, refreshed: 2, unavailable: 0, failed: 0, newReplies: 0 });
  assert.equal((await findByTweetId(sql, reply))?.derivedRole, 'link');
  assert.equal((await findByTweetId(sql, mainId!))?.derivedRole, 'main');
  const [snap] = await sql<Array<{ urls: unknown }>>`
    select s.raw #> '{entities,urls}' as urls from post_metric_snapshot s join tracked_post tp on tp.id = s.tracked_post_id
     where tp.tweet_id = ${reply} order by s.captured_at desc limit 1`;
  assert.deepEqual(snap.urls, [{ expanded_url: short }]);
  // 패널 링크 칩도 그대로
  const item = (await getCampaignDetail(sql, campaignId))!.tasks.find((t) => t.id === task.id)!;
  assert.equal(item.replies[0].link, short);
});

test('작업 없이 원고에만 붙은 트윗은 건드리지 않는다(원고 연결을 덮어쓰지 않는다)', async () => {
  const { task, a, mainId } = await postedTask('post');
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'dr', format: 'single',
    referenceMode: 'off', refs: [], content: { posts: [{ text: '본문', media: [] }] }, model: null, memberId: null,
  });
  const onDraft = newTweetId();
  const { row } = await addTrackedPost(sql, { tweetId: onDraft, authorHandle: a.handle, text: '', postedAt: null, createdBy: null, metrics: { ...M0, views: 4 }, raw: null });
  await sql.begin(async (tx) => { await linkTrackedPost(tx as unknown as typeof sql, row.id, { draftId: d }); });
  const t0 = 'Tue Oct 06 03:00:00 +0000 2026';
  const { deps, fetchCalls } = fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(onDraft, a, 'Tue Oct 06 04:00:00 +0000 2026', 9, true, '본문', mainId)] } });
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 0);
  assert.deepEqual(fetchCalls, []);
  const after = await findByTweetId(sql, onDraft);
  assert.equal(after?.taskId, null);
  assert.equal(after?.draftId, d);
});

test('↻ — 댓글 찾기는 discoveryDeps로(지표 조회와 따로)', async () => {
  const { campaignId, task, a, mainId } = await postedTask('post');
  const r1 = newTweetId();
  const t0 = 'Tue Oct 06 03:00:00 +0000 2026';
  const metrics = fakeDeps({ posts: { [mainId!]: { handle: a.handle, uid: a.uid, views: 1500 } } });
  const disc = fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(r1, a, 'Tue Oct 06 04:00:00 +0000 2026', 30, true, '본문', mainId)] } });
  const res = await refreshCampaignPerf(sql, campaignId, metrics.deps, null, disc.deps);
  assert.deepEqual(res, { total: 1, refreshed: 1, unavailable: 0, failed: 0, newReplies: 1 });
  assert.deepEqual(metrics.threadCalls, []);
  assert.deepEqual(metrics.fetchCalls, [mainId]);
  assert.deepEqual(disc.threadCalls, [mainId]);
  assert.deepEqual(disc.fetchCalls, [r1]);
  assert.equal((await findByTweetId(sql, r1))?.taskId, task.id);
});

// 최종 리뷰: 본 게시물에 트래킹 링크를 넣고 댓글엔 안 넣은 경우 — 콘텐츠 성과도 캠페인 화면처럼 게시물 링크의 트윗이 main
test('콘텐츠 성과 — 링크 든 본 게시물 + 링크 없는 본인 댓글이면 본 게시물이 main(게시물 링크 기준)', async () => {
  const { task, a, mainId } = await postedTask('post');
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'pm', format: 'single',
    referenceMode: 'off', refs: [], content: { posts: [{ text: '본문', media: [] }] }, model: null, memberId: null,
  });
  const short = `https://cb.link/${P}pm`;
  const camp = P + 'pmcamp';
  await insertLink(sql, {
    code: P + 'pm', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=y',
    shortUrl: short, shortioLinkId: 'lnk_pm' + P, utmCampaign: camp,
    influencerHandle: a.handle, utmContent: `${a.handle}-pm${P}`, draftId: d, clientId: null, clientName: null, createdBy: null,
  });
  await sql`update campaign_task set draft_id = ${d} where id = ${task.id}`;
  await sql`update tracked_post set draft_id = ${d} where tweet_id = ${mainId!}`;
  const reply = newTweetId();
  const t0 = 'Tue Oct 06 03:00:00 +0000 2026';
  const thread = { [mainId!]: [tw(mainId!, a, t0, 1000, false, `本文 ${short}`), tw(reply, a, 'Tue Oct 06 05:00:00 +0000 2026', 40, true, '相談会', mainId)] };
  assert.equal(await discoverSelfReplies(sql, task.id, fakeDeps({ threads: thread }).deps), 1);
  // 본 게시물 최신 스냅샷을 링크가 든 상세 조회 모양으로(↻ 한 번)
  await refreshCampaignPerf(sql, task.campaignId, fakeDeps({ threads: thread }).deps);
  const [row] = await listContentRows(sql, camp, { since: null, until: null });
  assert.equal(row.views, 1000);
  assert.deepEqual(row.posts.map((x) => [x.tweetId, x.role]), [[mainId, 'main'], [reply, 'thread']]);
  assert.equal((await findByTweetId(sql, mainId!))?.derivedRole, 'main');
});
