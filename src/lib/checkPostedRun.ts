import type postgres from 'postgres';
import type { UsersPage } from './getxapi.ts';
import { mapRawUser } from './mappers.ts';
import { listTasksByCampaign, markPosted } from './campaignTaskStore.ts';
import { planChecks, judgeRetweeters, taskToCheck, emptyResult, type CheckPostedResult } from './checkPosted.ts';

// [게시 확인하기](스펙 §3-2) — 이 캠페인의 RT 작업을 대상 트윗별로 묶어 트윗당 1회(+페이지, 상한 maxPages) 조회하고
// 확인된 것만 posted_at을 채운다(auto). 사라진 것은 보고만 한다. 트윗 하나가 실패해도 나머지는 계속.
export interface RetweeterSource { getTweetRetweeters(tweetId: string, cursor?: string): Promise<UsersPage> }

export async function runCheckPosted(
  sql: postgres.Sql, campaignId: string, deps: { source: RetweeterSource; today: string; maxPages?: number },
): Promise<CheckPostedResult> {
  const maxPages = deps.maxPages ?? 5;
  const tasks = (await listTasksByCampaign(sql, campaignId)).filter((t) => t.type === 'rt').map(taskToCheck);
  const result = emptyResult();
  const { byTweet, skipped } = planChecks(tasks);
  result.skipped = skipped;
  for (const [tweetId, group] of byTweet) {
    const handles: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    try {
      do {
        const page = await deps.source.getTweetRetweeters(tweetId, cursor);
        pages += 1;
        for (const u of page.users) { const m = mapRawUser(u); if (m) handles.push(m.handle); }
        cursor = page.has_more && page.next_cursor ? page.next_cursor : undefined;
        if (cursor && pages >= maxPages) { result.partial.push(tweetId); break; }
      } while (cursor);
    } catch (e) {
      // 인증·잔액 오류는 전체 중단이 맞다(다음 트윗도 똑같이 실패) — 라우트가 401로. 그 외(삭제·비공개·일시 오류)는 이 트윗만 건너뛴다.
      if (e instanceof Error && e.name === 'GetxapiAuthError') throw e;
      result.unreadable.push({ tweetId, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }
    const j = judgeRetweeters(group, handles);
    result.confirmed.push(...j.confirmed);
    result.pending.push(...j.pending);
    // 목록을 끝까지 못 봤으면(partial) '없음'을 단정할 수 없다 — missing은 완전 조회한 트윗에서만
    if (!result.partial.includes(tweetId)) result.missing.push(...j.missing);
  }
  if (result.confirmed.length) await markPosted(sql, result.confirmed.map((h) => h.taskId), deps.today, 'auto');
  return result;
}
