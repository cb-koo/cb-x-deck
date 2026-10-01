# 다른 인플의 게시물 등록 차단 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 게시물을 작업에 붙이는 모든 입구에서 "X 실제 작성자 = 배정 인플"을 서버가 판정해, 다르거나 확인 불가면 막는다.

**Architecture:** 순수 판정 함수(`postAuthor.ts`) + DB·주입 fetch를 쓰는 연결 함수(`postAttach.ts`)에 로직을 모으고, 라우트는 얇게 호출만 한다. 화면은 붙여 넣는 순간 미리보기 작성자로 먼저 알린다(편의), 서버가 최종 권위.

**Spec:** `docs/superpowers/specs/2026-09-30-post-author-guard-design.md` — 모든 태스크는 이 스펙이 우선.

## Global Constraints

- 작업 폴더 `/Users/koo_clinicbridge/cb-x-deck/.worktrees/post-author-guard`(브랜치 `cb-koo/post-author-guard`). 원 저장소 루트로 cd 금지.
- 경로 명시 스테이징(`git add -A` 금지). push·머지·배포 금지. 마이그레이션 금지.
- 순수 테스트 `node --import tsx --test <파일>`; DB 테스트 `node --import tsx --env-file-if-exists=.env.staging --import ./scripts/testGuard.ts --test <파일>`(연습용 DB만, `.env` 금지, testGuard가 막으면 중단·보고).
- `npx tsc --noEmit -p .` 0, 변경 파일 eslint 0, `npx next build`(NOT `npm run build`) 성공.
- 거절 문구·코드는 스펙 §4 그대로. 커밋 끝줄 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- 테스트에서 X API를 실제로 부르지 않는다 — `fetchPost`를 주입받아 대역으로.

## Task 1: 판정 함수 + fetchPost 작성자 고유번호

**Files:** Create `src/lib/postAuthor.ts`, `src/lib/postAuthor.test.ts`; Modify `src/lib/postMetrics.ts` (+ its test if present).

**Produces:**
```ts
export type AuthorVerdict =
  | { kind: 'ok' }
  | { kind: 'mismatch'; authorHandle: string; assignedHandle: string }
  | { kind: 'unverified' }
  | { kind: 'unassigned' };
export type AuthorCode = 'author-mismatch' | 'author-unverified' | 'task-unassigned';
export function judgePostAuthor(input: {
  author: { handle: string | null; userId: string | null } | null;   // null = 조회 실패
  assigned: { handle: string | null; xUserId: string | null };        // handle null = 미배정
}): AuthorVerdict;
export function authorVerdictMessage(v: Exclude<AuthorVerdict, { kind: 'ok' }>): { error: string; code: AuthorCode };
export function firstAssignMismatchMessage(authorHandle: string): string; // §4 ⑤ 문구
```
Rules (spec §2): unassigned first; author null → unverified; both userIds → compare ids; else handle case-insensitive (strip leading @); author handle null and no id → unverified.
`FetchPostResult` ok.post gains `authorUserId: string | null` from `author.id`.

- [ ] TDD tests (spec §7 판정 cases incl. coco: ids equal, handles differ → ok; ids differ, handles equal → mismatch), then implement, commit `feat(post-author): 게시물 작성자 판정 함수`.

## Task 2: 서버 입구 연결

**Files:** Create `src/lib/postAttach.ts` + `src/lib/postAttach.test.ts` (DB); Modify `src/app/api/campaigns/[id]/tasks/[taskId]/route.ts`, `src/app/api/tracking/route.ts`, `src/app/api/tracking/[id]/route.ts`, `src/app/campaigns/useCampaignTaskActions.ts`.

**Produces:**
```ts
export type Deps = { fetchPost: (tweetId: string) => Promise<FetchPostResult> };
// ① 게시 확인: 조회→판정→(통과) post_url·posted_at 저장 + 트래킹 등록·연결을 한 트랜잭션. 실패 시 아무것도 안 바뀜.
export async function attachPostToTask(sql, taskId, postUrl, deps): Promise<{ ok: true } | { ok: false; error: string; code: AuthorCode | string }>;
// ②~④: 이미 등록된 tracked_post를 작업에 연결하기 전 판정(작업·명부 조회, 필요 시 fetch로 고유번호 확인)
export async function guardTaskLink(sql, taskId, trackedPost: { tweetId: string; authorHandle: string | null }, deps): Promise<AuthorVerdict>;
// ⑤: 게시된 미배정 작업 최초 배정 시 — 붙은 tracked_post가 있으면 새 인플과 판정
export async function guardFirstAssign(sql, taskId, newHandle, deps): Promise<AuthorVerdict>;
```
- Read the current PATCH route fully first: it already handles `postUrl` validation (`normalizeTargetTweetUrl`), `postedAtFromLinkGate`, RT proof, transactions, influencer guards. Integrate without breaking those (RT tasks: unchanged — no post link). Where `postUrl` is present for non-RT, route calls `attachPostToTask` inside/with its existing transaction (keep one consistent transaction; posted_at rule from link stays as today).
- Tracking routes: before `linkTrackedPost` with a task (taskId, or draftId whose draft belongs to a task), call `guardTaskLink`; on non-ok return 400 `authorVerdictMessage`. Tracking registration without a task stays as is.
- Client: remove the post-save `registerTrackedPostApi` call in `markPosted` (server now registers); keep error toasts showing server `error` text.
- DB tests with fake `fetchPost`: ① mismatch → task post_url null & no tracked_post; ok → both set and linked; unverified → nothing; unassigned → rejected. ②④ guard rejects mismatch; draft with no task → ok. ⑤ first assign mismatch rejected, match ok. Prefix/cleanup per `src/lib/campaignTaskStore.test.ts` pattern.
- Commit `feat(post-author): 게시물 작성자 확인 — 게시 확인·게시물 연결·원고 연결 입구`.

## Task 3: 화면 즉시 알림 + 업데이트 소식

**Files:** Modify `src/app/campaigns/flow/panel/PostedBox.tsx` (and `useTweetPreview`/`TargetPreview` only if needed), `src/content/updates.ts`.
- Preview shows author `@handle`; if it differs (case-insensitive, strip @) from the task's assigned handle → red inline message (spec §4 mismatch text) + disable 게시 확인. Preview failure → button stays enabled (server decides). Unassigned task → show unassigned message and disable.
- Server rejection text shown as today's error pattern.
- updates.ts top entry per spec §8 (`개선`, date 2026-09-30); `src/lib/updates.test.ts` passes.
- Commit `feat(post-author): 게시 확인 칸 작성자 표시·불일치 안내 + 업데이트 소식`.
