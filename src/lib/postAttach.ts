// 게시물을 작업에 붙이는 입구의 작성자 확인(스펙 2026-09-30-post-author-guard-design.md §3·§6).
// 09-30 사고(다른 인플의 게시물이 증빙으로 붙어 지급완료까지 감)의 재발 방지 — "게시물 작성자 = 배정 인플"을 서버가 본다.
// 판정 자체는 순수 함수(postAuthor.judgePostAuthor), 여기는 작업·명부를 읽고 필요하면 X를 조회하는 자리.
// fetchPost는 주입한다(deps) — 라우트는 진짜 postMetrics.fetchPost, 테스트는 대역.
import type postgres from 'postgres';
import type { FetchPostResult } from './postMetrics.ts';
import { judgePostAuthor, authorVerdictMessage, type AuthorVerdict, type AuthorCode } from './postAuthor.ts';
import { parseTweetLink } from './tweetLink.ts';
import { postedOnFromTweetLink } from './tweetPostedOn.ts';
import { updateTask } from './campaignTaskStore.ts';
import { insertTrackedPost, linkTrackedPost } from './trackingStore.ts';
import { POST_URL_MESSAGE } from './campaignTaskInput.ts';

export type Deps = { fetchPost: (tweetId: string) => Promise<FetchPostResult> };

// 빈 문자열은 없는 값으로 — 명부의 x_user_id·X 응답의 핸들이 ''로 오면 '같다/다르다'를 잘못 말한다.
const nz = (v: string | null | undefined): string | null => (v ? v : null);

type Assigned = { handle: string | null; xUserId: string | null };
const OK: AuthorVerdict = { kind: 'ok' };

// ── ① 게시 확인 ──

// 판정 거절을 트랜잭션 밖으로 알리는 신호 — postgres.js는 콜백이 정상 return하면 커밋하므로 throw로 끊는다.
class AuthorRejected extends Error {
  constructor(public verdict: Exclude<AuthorVerdict, { kind: 'ok' }>) { super(verdict.kind); }
}

export type AttachResult = { ok: true } | { ok: false; error: string; code: AuthorCode | 'post-url' };

// 게시 확인: X 조회 → (트랜잭션) 작업 저장 → 판정 → 통과 시 트래킹 등록·연결. 거절이면 아무것도 안 바뀐다.
// - 조회는 트랜잭션을 열기 전에 한다(네트워크 호출 동안 DB 트랜잭션을 붙잡지 않는다).
// - 조회는 이미 등록된 게시물이어도 늘 한다 — 저장된 author_handle은 옛 핸들일 수 있고, 고유번호 비교엔 author.id가
//   필요한데 그건 저장하지 않는다(DB 변경 없음). 게시 확인은 사람이 누르는 한 번짜리라 비용이 작다.
// - 판정은 apply(작업 저장) 뒤, 잠근 행으로 한다 — 같은 요청이 인플을 넣으면서 링크를 붙이면 새 인플 기준이다.
// - apply: 라우트가 자기 트랜잭션 몸통(updateTask·흔적 정리·원고 동기화)을 넘긴다. 없으면 링크·게시일만 저장.
//   apply가 던진 오류(취소 경합 등)는 그대로 올라간다 — 라우트의 기존 매핑이 받는다.
export async function attachPostToTask(
  sql: postgres.Sql, taskId: string, postUrl: string, deps: Deps,
  opts: { createdBy?: string | null; apply?: (tx: postgres.Sql) => Promise<void> } = {},
): Promise<AttachResult> {
  const parsed = parseTweetLink(postUrl);
  if (!parsed.ok) return { ok: false, error: POST_URL_MESSAGE, code: 'post-url' };
  const fetched = await deps.fetchPost(parsed.tweetId);
  try {
    await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      if (opts.apply) await opts.apply(tx);
      else {
        const postedOn = postedOnFromTweetLink(postUrl);
        await updateTask(tx, taskId, { postUrl, ...(postedOn ? { postedAt: postedOn, postedSource: 'manual' as const } : {}) });
      }
      const assigned = await assignedOf(tx, taskId, true);
      if (!assigned) return;   // 그 사이 작업이 지워졌다 — 라우트가 404로(여기서 말할 것이 없다)
      const verdict = judgePostAuthor({
        author: fetched.kind === 'ok' ? { handle: nz(fetched.post.authorHandle), userId: nz(fetched.post.authorUserId) } : null,
        assigned,
      });
      if (verdict.kind !== 'ok') throw new AuthorRejected(verdict);
      if (fetched.kind !== 'ok') return;   // 타입 좁히기 — 판정이 ok면 조회는 성공이다
      // 리포스트 링크면 fetchPost가 원본으로 갈아탄다 — 등록은 실제 지표를 낸 트윗(POST /api/tracking과 같은 규칙)
      const p = fetched.post;
      const { row } = await insertTrackedPost(tx, {
        tweetId: p.tweetId, authorHandle: p.authorHandle, text: p.text, postedAt: p.postedAt,
        createdBy: opts.createdBy ?? null, metrics: p.metrics, raw: p.raw,
      });
      // 작업 저장이 먼저라 linkTrackedPost의 보충(coalesce)은 방금 저장한 링크·게시일을 덮지 않는다
      await linkTrackedPost(tx, row.id, { taskId });
    });
  } catch (e) {
    if (e instanceof AuthorRejected) return { ok: false, ...authorVerdictMessage(e.verdict) };
    throw e;
  }
  return { ok: true };
}

// 작업의 배정 인플 + 명부 고유번호. 작업이 없으면 null. lock=true면 작업 행을 잠근다(트랜잭션 안에서만 의미).
async function assignedOf(sql: postgres.Sql, taskId: string, lock: boolean): Promise<(Assigned & { type: string; cancelled: boolean }) | null> {
  const rows = lock
    ? await sql<Array<{ influencer_handle: string | null; x_user_id: string | null; type: string; cancelled_at: Date | null }>>`
        select t.influencer_handle, i.x_user_id, t.type, t.cancelled_at from campaign_task t
          left join influencer i on lower(i.handle) = lower(t.influencer_handle)
         where t.id = ${taskId} for update of t`
    : await sql<Array<{ influencer_handle: string | null; x_user_id: string | null; type: string; cancelled_at: Date | null }>>`
        select t.influencer_handle, i.x_user_id, t.type, t.cancelled_at from campaign_task t
          left join influencer i on lower(i.handle) = lower(t.influencer_handle)
         where t.id = ${taskId}`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return { handle: nz(r.influencer_handle), xUserId: nz(r.x_user_id), type: r.type, cancelled: r.cancelled_at !== null };
}

// ── ②~⑤ 이미 등록된 게시물(tracked_post)의 판정 ──

export type TrackedAuthor = {
  tweetId: string;
  authorHandle: string | null;   // tracked_post.author_handle(등록 시점 값 — 옛 핸들일 수 있다)
  authorUserId?: string | null;  // 방금 조회한 값이면 넣는다(undefined = 모름 → 필요하면 조회)
};

// 조회 정책: 방금 조회한 값이 있으면 그대로. 명부에 고유번호가 있으면 조회해서 번호로(저장 안 하므로).
// 고유번호가 없으면 저장된 핸들로 먼저 보고, 같으면 조회 없이 ok. 다르면 옛 핸들일 수 있어 한 번 조회해 실제 작성자로
// 다시 본다(조회 실패면 저장값의 판정 — 다르다는 근거는 이미 있다). 저장된 핸들도 없으면 조회, 실패면 unverified.
async function judgeTracked(assigned: Assigned, tp: TrackedAuthor, deps: Deps): Promise<AuthorVerdict> {
  if (assigned.handle === null) return { kind: 'unassigned' };
  if (tp.authorUserId !== undefined) {
    return judgePostAuthor({ author: { handle: nz(tp.authorHandle), userId: nz(tp.authorUserId) }, assigned });
  }
  const stored = nz(tp.authorHandle);
  let fallback: AuthorVerdict = { kind: 'unverified' };
  if (assigned.xUserId === null && stored !== null) {
    fallback = judgePostAuthor({ author: { handle: stored, userId: null }, assigned });
    if (fallback.kind === 'ok') return fallback;
  }
  const live = await deps.fetchPost(tp.tweetId);
  if (live.kind !== 'ok') return fallback;
  return judgePostAuthor({ author: { handle: nz(live.post.authorHandle), userId: nz(live.post.authorUserId) }, assigned });
}

// ②③ 게시물을 작업에 연결하기 전. RT·취소·없는 작업은 ok — 기존 규칙(RT 거절·취소 거절·없음 400)이 제 문구로 답한다.
// 판정은 연결 트랜잭션 밖이다(조회가 네트워크라) — 판정과 연결 사이의 인플 변경 경합은 이론상 남는다.
export async function guardTaskLink(sql: postgres.Sql, taskId: string, trackedPost: TrackedAuthor, deps: Deps): Promise<AuthorVerdict> {
  const a = await assignedOf(sql, taskId, false);
  if (!a || a.type === 'rt' || a.cancelled) return OK;
  return judgeTracked(a, trackedPost, deps);
}

// ④ 원고로 연결 — 그 원고가 작업에 붙어 있으면 그 작업 기준. 작업 없는 원고 연결은 그대로 허용.
export async function guardDraftLink(sql: postgres.Sql, draftId: string, trackedPost: TrackedAuthor, deps: Deps): Promise<AuthorVerdict> {
  const rows = await sql<Array<{ id: string }>>`select id from campaign_task where draft_id = ${draftId} limit 1`;
  if (rows.length === 0) return OK;
  return guardTaskLink(sql, rows[0].id, trackedPost, deps);
}

// ⑤ 게시된 미배정 작업의 최초 배정 — 붙은 게시물이 있으면 새 인플이 그 작성자여야 한다(옛 데이터 방어).
// 라우트는 mismatch를 firstAssignMismatchMessage로 바꿔 말한다(이미 링크가 붙어 있는 맥락).
export async function guardFirstAssign(sql: postgres.Sql, taskId: string, newHandle: string, deps: Deps): Promise<AuthorVerdict> {
  const posts = await sql<Array<{ tweet_id: string; author_handle: string | null }>>`
    select tweet_id, author_handle from tracked_post where task_id = ${taskId} order by created_at asc`;
  if (posts.length === 0) return OK;
  const r = await sql<Array<{ x_user_id: string | null }>>`select x_user_id from influencer where lower(handle) = lower(${newHandle}) limit 1`;
  const assigned: Assigned = { handle: newHandle, xUserId: nz(r[0]?.x_user_id) };
  for (const p of posts) {
    const v = await judgeTracked(assigned, { tweetId: p.tweet_id, authorHandle: p.author_handle }, deps);
    if (v.kind !== 'ok') return v;
  }
  return OK;
}
