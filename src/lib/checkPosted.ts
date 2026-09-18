// RT 게시 확인의 판정(스펙 §3) — DB·API 없음. 대상 트윗의 리포스터 목록에 작업 인플이 있으면 확인.
// 인용RT는 별개 게시물이라 리포스터 목록에 안 잡힌다 → 이 판정은 type='rt'에만 쓴다(호출부 checkPostedRun이 고른다).
import { parseTweetLink } from './tweetLink.ts';
import { targetUrlOf, targetStatus } from './campaignJudgment.ts';

export interface CheckTask { id: string; influencerHandle: string | null; postedAt: string | null; targetTweetId: string | null; targetPending: boolean }
export interface Hit { taskId: string; handle: string }
export type SkipReason = 'no_target' | 'target_not_posted' | 'no_handle';
export interface CheckPostedResult {
  confirmed: Hit[]; pending: Hit[]; skipped: Array<Hit & { reason: SkipReason }>; missing: Hit[];
  unreadable: Array<{ tweetId: string; reason: string }>; partial: string[];   // partial = 페이지 상한에 걸려 일부만 본 트윗
}
export const emptyResult = (): CheckPostedResult => ({ confirmed: [], pending: [], skipped: [], missing: [], unreadable: [], partial: [] });

export function taskToCheck(t: {
  id: string; influencerHandle: string | null; postedAt: string | null;
  targetTaskId: string | null; targetTweetUrl: string | null; target: { postUrl: string | null; cancelledAt: string | null } | null;
}): CheckTask {
  const input = { targetTaskId: t.targetTaskId, targetPostUrl: t.target?.postUrl ?? null, targetTweetUrl: t.targetTweetUrl };
  const url = targetUrlOf(input);
  const parsed = url ? parseTweetLink(url) : null;
  return {
    id: t.id, influencerHandle: t.influencerHandle, postedAt: t.postedAt,
    targetTweetId: parsed && parsed.ok ? parsed.tweetId : null,
    targetPending: targetStatus({ ...input, targetCancelledAt: t.target?.cancelledAt ?? null }) === 'pending',
  };
}

// 트윗당 1회 호출을 위해 묶는다. 이미 확인된 작업도 그룹에 넣는다 — 목록에서 사라졌는지(내려짐 가능성) 보고하기 위해.
export function planChecks(tasks: CheckTask[]): { byTweet: Map<string, CheckTask[]>; skipped: CheckPostedResult['skipped'] } {
  const byTweet = new Map<string, CheckTask[]>();
  const skipped: CheckPostedResult['skipped'] = [];
  for (const t of tasks) {
    if (!t.influencerHandle) { skipped.push({ taskId: t.id, handle: '', reason: 'no_handle' }); continue; }
    if (!t.targetTweetId) { skipped.push({ taskId: t.id, handle: t.influencerHandle, reason: t.targetPending ? 'target_not_posted' : 'no_target' }); continue; }
    const g = byTweet.get(t.targetTweetId) ?? [];
    g.push(t);
    byTweet.set(t.targetTweetId, g);
  }
  return { byTweet, skipped };
}

export function judgeRetweeters(tasks: CheckTask[], retweeterHandles: Iterable<string>): { confirmed: Hit[]; pending: Hit[]; missing: Hit[] } {
  const set = new Set<string>();
  for (const h of retweeterHandles) set.add(h.replace(/^@/, '').toLowerCase());
  const out = { confirmed: [] as Hit[], pending: [] as Hit[], missing: [] as Hit[] };
  for (const t of tasks) {
    if (!t.influencerHandle) continue;
    const has = set.has(t.influencerHandle.toLowerCase());
    const hit = { taskId: t.id, handle: t.influencerHandle };
    if (t.postedAt === null) (has ? out.confirmed : out.pending).push(hit);
    else if (!has) out.missing.push(hit);
  }
  return out;
}
