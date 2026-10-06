// 인플 본인 댓글(추가 콘텐츠)을 찾아 작업에 붙이기 + 캠페인 성과 [업데이트](↻)
// (스펙 2026-10-06-self-replies-design.md §3·§4). 네트워크(X 조회)는 전부 트랜잭션 밖에서 한다.
// X 조회는 주입한다(deps) — 라우트는 진짜 getxapi, 테스트는 대역.
import type postgres from 'postgres';
import type { SearchPage } from './getxapi.ts';
import type { FetchPostResult } from './postMetrics.ts';
import { pickSelfReplies, mainAuthorIdOf } from './selfReplies.ts';
import { parseTweetLink } from './tweetLink.ts';
import { appendSnapshot, insertTrackedPost, linkTrackedPost, markUnavailable, TrackingLinkError } from './trackingStore.ts';
import { judgeTaskLink, assertTaskUnchanged, TaskChangedError } from './postAttach.ts';
import { isUuidLike } from './uuid.ts';

export type ThreadDeps = {
  fetchPost: (tweetId: string) => Promise<FetchPostResult>;
  getTweetThread: (tweetId: string) => Promise<SearchPage>;
};

type TaskPost = { id: string; tweetId: string };
type TaskWithPosts = { id: string; type: string; cancelled: boolean; postUrl: string | null; posts: TaskPost[] };

// 스레드를 볼 본 게시물 — 게시물 링크(post_url)의 트윗이 이 작업에 트래킹돼 있을 때만(§3 "게시물 링크가 있는 작업").
// 링크가 없는 작업을 대상으로 하면 linkTrackedPost의 보충(coalesce)이 첫 댓글을 작업의 게시물 링크로 박는다.
function discoveryMainOf(t: TaskWithPosts): string | null {
  if (t.type === 'rt' || t.cancelled || !t.postUrl) return null;
  const p = parseTweetLink(t.postUrl);
  return p.ok && t.posts.some((x) => x.tweetId === p.tweetId) ? p.tweetId : null;
}

async function loadTask(sql: postgres.Sql, taskId: string): Promise<TaskWithPosts | null> {
  if (!isUuidLike(taskId)) return null;
  const t = await sql<Array<{ id: string; type: string; cancelled_at: Date | null; post_url: string | null }>>`
    select id, type, cancelled_at, post_url from campaign_task where id = ${taskId}`;
  if (t.length === 0) return null;
  const posts = await sql<Array<{ id: string; tweet_id: string }>>`
    select id, tweet_id from tracked_post where task_id = ${taskId} order by created_at asc`;
  return { id: t[0].id, type: t[0].type, cancelled: t[0].cancelled_at !== null, postUrl: t[0].post_url, posts: posts.map((p) => ({ id: p.id, tweetId: p.tweet_id })) };
}

// 댓글 하나를 작업에 붙인다 — 스레드는 "찾기"에만 쓰고, 등록·첫 스냅샷은 게시물별 상세 조회(fetchPost)의 값으로 한다
// (§4: 스레드 응답엔 링크 정보 칸 entities가 없어, 그 raw로 스냅샷하면 링크 댓글이 link가 아닌 thread로 판정된다).
// 상세 조회가 실패·없음이면 이번엔 건너뛴다(다음 ↻에서 다시 찾는다). 작성자 판정은 기존 가드(judgeTaskLink, 상세 조회의
// 고유번호로 — 추가 조회 없이) → 한 트랜잭션에서 작업 행 잠금·모습 확인(assertTaskUnchanged) → 등록 → 연결.
// 잠금 순서 작업 → 게시물(postAttach와 같음). 이미 트래킹 중인 트윗: 작업·원고 어디에도 안 붙어 있으면 연결만, 어느 작업이나
// 원고에 붙어 있으면 건드리지 않는다(작업 없이 원고에만 붙은 게시물의 원고 연결을 덮어쓰지 않는다).
// 붙였으면 true.
async function attachSelfReply(sql: postgres.Sql, taskId: string, tweetId: string, deps: ThreadDeps, createdBy: string | null): Promise<boolean> {
  const r = await deps.fetchPost(tweetId);
  if (r.kind !== 'ok' || r.post.tweetId !== tweetId) return false;   // 리포스트 래퍼로 풀린 경우 등 — 댓글이 아니다
  const p = r.post;
  const { verdict, seen } = await judgeTaskLink(sql, taskId, { tweetId: p.tweetId, authorHandle: p.authorHandle, authorUserId: p.authorUserId }, deps);
  if (verdict.kind !== 'ok') return false;
  try {
    return await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      await assertTaskUnchanged(tx, { taskId }, seen);
      const { created, row } = await insertTrackedPost(tx, {
        tweetId: p.tweetId, authorHandle: p.authorHandle, text: p.text, postedAt: p.postedAt,
        createdBy, metrics: p.metrics, raw: p.raw,
      });
      if (!created && (row.taskId || row.draftId)) return false;
      await linkTrackedPost(tx, row.id, { taskId });
      return true;
    }) as unknown as boolean;
  } catch (e) {
    // 그사이 인플이 바뀌었거나 취소됐다 — 이번엔 건너뛰고 다음 ↻에서 다시 본다
    if (e instanceof TaskChangedError || e instanceof TrackingLinkError) return false;
    throw e;
  }
}

// 스레드 응답에서 새 본인 댓글을 골라 붙인다. 붙인 수.
async function attachFromThread(sql: postgres.Sql, task: TaskWithPosts, mainTweetId: string, tweets: SearchPage['tweets'], deps: ThreadDeps, createdBy: string | null): Promise<number> {
  const candidates = pickSelfReplies({
    tweets, mainTweetId, mainAuthorId: mainAuthorIdOf(tweets, mainTweetId), trackedIds: new Set(task.posts.map((p) => p.tweetId)),
  });
  if (candidates.length === 0) return 0;
  // 다른 작업·원고에 붙어 있는 트윗은 상세 조회조차 하지 않는다(attachSelfReply 안에서도 막지만 미리 거른다)
  const elsewhere = await sql<Array<{ tweet_id: string }>>`
    select tweet_id from tracked_post where tweet_id = any(${candidates.map((c) => c.tweetId)}::text[]) and (task_id is not null or draft_id is not null)`;
  const skip = new Set(elsewhere.map((r) => r.tweet_id));
  let added = 0;
  for (const c of candidates) {
    if (skip.has(c.tweetId)) continue;
    if (await attachSelfReply(sql, task.id, c.tweetId, deps, createdBy)) added += 1;
  }
  return added;
}

// 게시 확인 직후(best-effort) — 본 게시물의 스레드를 한 번 보고 새 본인 댓글을 붙인다. 본 게시물은 방금 측정했으니
// 다시 스냅샷하지 않는다. 실패는 0으로 삼키고 기록만(게시 확인을 막지 않는다 — 다음 ↻에서 다시 찾는다).
export async function discoverSelfReplies(sql: postgres.Sql, taskId: string, deps: ThreadDeps, createdBy: string | null = null): Promise<number> {
  try {
    const task = await loadTask(sql, taskId);
    const main = task ? discoveryMainOf(task) : null;
    if (!task || !main) return 0;
    const page = await deps.getTweetThread(main);
    return await attachFromThread(sql, task, main, page.tweets, deps, createdBy);
  } catch (e) {
    console.error(`discoverSelfReplies(${taskId}) failed:`, e);
    return 0;
  }
}

export interface PerfRefreshResult { total: number; refreshed: number; unavailable: number; failed: number; newReplies: number }

// 성과 [업데이트](↻) — 이 캠페인의 게시 확인된·취소 아닌 작업에 붙은 게시물(listTrackedPostIdsForCampaign과 같은 모집단).
// 지표 기록은 기존과 똑같이 게시물별 상세 조회(fetchPost)로 한다 — 삭제·비공개 판정(markUnavailable)도 그쪽이 그대로.
// 스레드 조회는 작업당 1회, 새 본인 댓글을 찾는 데만 쓴다(§4 — 스레드 응답엔 링크 정보 칸이 없어 스냅샷 raw로 쓰면
// 링크 댓글 판정이 깨진다). 스레드 실패는 ↻를 막지 않는다. total·refreshed 등은 원래 붙어 있던 게시물 기준, 새 댓글은 newReplies.
// 본 게시물이 방금 '없음'(삭제·비공개)으로 나온 작업은 스레드를 보지 않는다(헛조회 비용). discoveryDeps: 댓글 찾기에 쓸
// 조회(라우트는 재시도를 줄인 클라이언트를 넘긴다 — 429 재시도로 ↻가 오래 걸리지 않게). 없으면 deps.
export async function refreshCampaignPerf(
  sql: postgres.Sql, campaignId: string, deps: ThreadDeps, createdBy: string | null = null, discoveryDeps: ThreadDeps = deps,
): Promise<PerfRefreshResult> {
  const res: PerfRefreshResult = { total: 0, refreshed: 0, unavailable: 0, failed: 0, newReplies: 0 };
  if (!isUuidLike(campaignId)) return res;
  const rows = await sql<Array<{ task_id: string; type: string; post_url: string | null; id: string; tweet_id: string }>>`
    select t.id as task_id, t.type, t.post_url, tp.id, tp.tweet_id from tracked_post tp
      join campaign_task t on t.id = tp.task_id
     where t.campaign_id = ${campaignId} and t.posted_at is not null and t.cancelled_at is null
     order by t.created_at asc, tp.created_at asc`;
  const tasks = new Map<string, TaskWithPosts>();
  for (const r of rows) {
    let t = tasks.get(r.task_id);
    if (!t) { t = { id: r.task_id, type: r.type, cancelled: false, postUrl: r.post_url, posts: [] }; tasks.set(r.task_id, t); }
    t.posts.push({ id: r.id, tweetId: r.tweet_id });
  }
  res.total = rows.length;

  for (const task of tasks.values()) {
    const goneNow = new Set<string>();
    for (const p of task.posts) {
      const r = await deps.fetchPost(p.tweetId);
      if (r.kind === 'error') { res.failed += 1; continue; }
      if (r.kind === 'unavailable') { await markUnavailable(sql, p.id); res.unavailable += 1; goneNow.add(p.tweetId); continue; }
      await appendSnapshot(sql, p.id, r.post.metrics, r.post.raw);
      res.refreshed += 1;
    }
    const main = discoveryMainOf(task);
    if (!main || goneNow.has(main)) continue;
    try {
      const { tweets } = await discoveryDeps.getTweetThread(main);
      res.newReplies += await attachFromThread(sql, task, main, tweets, discoveryDeps, createdBy);
    } catch (e) {
      console.error(`refreshCampaignPerf discover(${task.id}) failed:`, e);
    }
  }
  return res;
}
