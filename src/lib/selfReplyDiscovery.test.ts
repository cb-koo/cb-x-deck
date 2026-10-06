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
import type { FetchPostResult } from './postMetrics.ts';
import type { RawTweet, SearchPage } from './getxapi.ts';
import { discoverSelfReplies, refreshCampaignPerf, type ThreadDeps } from './selfReplyDiscovery.ts';

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
  await sql`delete from tracked_post where tweet_id = any(${made}::text[])`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql.end();
});

// 스레드 응답의 트윗 하나(10-06 실제 응답 모양)
const tw = (id: string, a: { handle: string; uid: string }, createdAt: string, views: number, isReply: boolean, text = '본문'): RawTweet => ({
  id, text, createdAt, isReply, inReplyToId: null, author: { userName: a.handle, id: a.uid },
  viewCount: views, likeCount: 1, retweetCount: 0, replyCount: 0, bookmarkCount: 0, quoteCount: 0, media: [],
});

// 대역 — 스레드는 main id별 응답(또는 'throw'), 상세 조회는 tweetId별. 부른 횟수를 센다.
function fakeDeps(opts: {
  threads?: Record<string, RawTweet[] | 'throw'>;
  posts?: Record<string, { handle: string; uid: string; views?: number } | 'unavailable' | 'error'>;
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
      if (v === undefined || v === 'error') return { kind: 'error' };
      if (v === 'unavailable') return { kind: 'unavailable' };
      return { kind: 'ok', post: {
        tweetId: id, authorHandle: v.handle, authorUserId: v.uid, text: '본문', postedAt: '2026-10-06T03:00:00.000Z',
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

test('게시 확인 뒤 — 같은 작성자 고유번호의 댓글만 작업에 붙는다(첫 스냅샷 = 스레드 지표)·게시물 링크는 그대로', async () => {
  const { task, a, mainId } = await postedTask('quoteRt');
  const reply = newTweetId(); const stranger = newTweetId(); const imposter = newTweetId();
  const { deps, threadCalls, fetchCalls } = fakeDeps({ threads: { [mainId!]: [
    tw(mainId!, a, 'Tue Oct 06 08:40:28 +0000 2026', 1027, false),
    tw(reply, a, 'Tue Oct 06 10:04:54 +0000 2026', 42, true, '相談会 🦷https://pages.s.gy/thesquaredc_jp'),
    tw(stranger, { handle: 'someone', uid: '1' }, 'Tue Oct 06 10:10:00 +0000 2026', 5, true),
    tw(imposter, { handle: a.handle, uid: '999' }, 'Tue Oct 06 10:20:00 +0000 2026', 5, true),   // 핸들만 같은 남
  ] } });
  assert.equal(await discoverSelfReplies(sql, task.id, deps), 1);
  assert.deepEqual(threadCalls, [mainId]);
  assert.deepEqual(fetchCalls, []);   // 작성자 판정은 스레드의 고유번호로(추가 조회 없음)
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

test('↻ — 작업당 스레드 1회로 본 게시물·아는 댓글을 스냅샷하고 새 댓글을 붙인다(상세 조회 0회)', async () => {
  const { campaignId, task, a, mainId } = await postedTask('post');
  const r1 = newTweetId(); const r2 = newTweetId();
  const t0 = 'Tue Oct 06 03:00:00 +0000 2026';   // 본 게시물 게시 시각 = 등록 때 값(대역 fetchPost의 postedAt)
  await discoverSelfReplies(sql, task.id, fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(r1, a, 'Tue Oct 06 04:00:00 +0000 2026', 30, true)] } }).deps);
  const { deps, threadCalls, fetchCalls } = fakeDeps({ threads: { [mainId!]: [
    tw(mainId!, a, t0, 2000, false), tw(r1, a, 'Tue Oct 06 04:00:00 +0000 2026', 50, true), tw(r2, a, 'Tue Oct 06 07:00:00 +0000 2026', 7, true),
  ] } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 2, refreshed: 2, unavailable: 0, failed: 0, newReplies: 1 });
  assert.deepEqual(threadCalls, [mainId]);
  assert.deepEqual(fetchCalls, []);
  assert.equal(await latestViews(mainId!), 2000);
  assert.equal(await latestViews(r1), 50);
  assert.equal(await latestViews(r2), 7);
  assert.equal((await findByTweetId(sql, r2))?.taskId, task.id);
  const item = (await getCampaignDetail(sql, campaignId))!.tasks.find((t) => t.id === task.id)!;
  assert.equal(item.perf?.views, 2000);   // 댓글 지표(50·7)는 더하지 않는다
  assert.deepEqual(item.replies.map((x) => [x.tweetId, x.afterMain]), [[r1, '1시간'], [r2, '4시간']]);
});

test('↻ — 스레드 조회가 실패하면 그 작업은 게시물별 상세 조회로(삭제 판정 유지)', async () => {
  const { campaignId, a, mainId } = await postedTask('post');
  const { deps, fetchCalls } = fakeDeps({ threads: {}, posts: { [mainId!]: 'unavailable' } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 1, refreshed: 0, unavailable: 1, failed: 0, newReplies: 0 });
  assert.deepEqual(fetchCalls, [mainId]);
  assert.ok((await findByTweetId(sql, mainId!))?.unavailableAt);
  // 복귀: 다음 ↻에서 스레드로 측정되면 unavailable이 풀린다(appendSnapshot 규칙)
  await refreshCampaignPerf(sql, campaignId, fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, 'Tue Oct 06 08:00:00 +0000 2026', 3000, false)] } }).deps);
  assert.equal((await findByTweetId(sql, mainId!))?.unavailableAt, null);
  assert.equal(await latestViews(mainId!), 3000);
});

test('↻ — 스레드에 없는 아는 댓글(지운 댓글)은 상세 조회로 확인한다', async () => {
  const { campaignId, task, a, mainId } = await postedTask('post');
  const r1 = newTweetId();
  const t0 = 'Tue Oct 06 08:00:00 +0000 2026';
  await discoverSelfReplies(sql, task.id, fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1000, false), tw(r1, a, t0, 30, true)] } }).deps);
  const { deps, fetchCalls } = fakeDeps({ threads: { [mainId!]: [tw(mainId!, a, t0, 1100, false)] }, posts: { [r1]: 'unavailable' } });
  const res = await refreshCampaignPerf(sql, campaignId, deps);
  assert.deepEqual(res, { total: 2, refreshed: 1, unavailable: 1, failed: 0, newReplies: 0 });
  assert.deepEqual(fetchCalls, [r1]);
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
    tw(one.mainId!, one.a, t0, 1000, false), tw(taken, one.a, t0, 99, true), tw(loose, one.a, t0, 77, true),
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
