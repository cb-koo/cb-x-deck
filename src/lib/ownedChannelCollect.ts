// X 업로드 현황 수집 — 계정 하나의 팔로워·글을 X에서 읽어 저장한다. 스펙 2026-10-20 §4
// X 호출은 인자로 받는다(watchlistAccount와 같은 이유 — 라우트 테스트 하네스가 없어 호출 규칙을 여기서 단정한다).
import type postgres from 'postgres';
import { GetxapiAuthError, type GetxapiClient, type UserInfo } from './getxapi.ts';
import { parsePost, weekStartOf, addWeeks, kstMidnight, HISTORY_WEEKS, type ParsedPost, type CollectError } from './ownedChannels.ts';
import { postsSince, recordCollected, recordCollectError, listChannelsToCollect, type OwnedChannel } from './ownedChannelStore.ts';

export type XReader = Pick<GetxapiClient, 'getUserInfo' | 'getUserTweets' | 'getTweetDetail'>;

const MAX_PAGES = 10;

/** 계정을 찾을 수 없는 응답 — 4xx이거나 id가 비었다. 그 밖의 오류(5xx·네트워크)는 일시 오류로 본다. */
const isMissing = (e: unknown) => /^(400|404) from /.test((e as Error)?.message ?? '');

export type LookupResult = { ok: true; info: UserInfo } | { ok: false; error: CollectError };

/** 핸들로 계정 조회. 인증·잔액 오류(GetxapiAuthError)는 그대로 던진다 — 실행 전체를 멈춰야 하므로. */
export async function lookupAccount(reader: Pick<XReader, 'getUserInfo'>, handle: string): Promise<LookupResult> {
  try {
    const info = await reader.getUserInfo(handle);
    if (!info.id) return { ok: false, error: 'notFound' };
    return { ok: true, info };
  } catch (e) {
    if (e instanceof GetxapiAuthError) throw e;
    return { ok: false, error: isMissing(e) ? 'notFound' : 'fetchFailed' };
  }
}

export interface CollectOutcome { ok: boolean; error?: CollectError; posts: number; deleted: number; restored: number; complete: boolean }

/**
 * 계정 하나 수집.
 * 1. 계정 조회 → 팔로워·개설일. 숫자 id가 저장값과 다르면(핸들 주인이 바뀜) 아무것도 쓰지 않는다.
 * 2. 글 목록을 since(평소엔 지난주 월요일, 첫 수집은 8주 전 월요일)보다 오래된 글이 나올 때까지 넘긴다.
 * 3. 목록을 끝까지 읽었을 때만 '지워짐'을 확인한다 — 덜 읽은 목록으로 잘못 표시하지 않게(스펙 §4-3). 판정에는 영향 없다.
 */
export async function collectChannel(
  sql: postgres.Sql, reader: XReader, ch: OwnedChannel,
  opts: { now?: number; deadlineAt?: number; firstCollect?: boolean } = {},
): Promise<CollectOutcome> {
  const now = opts.now ?? Date.now();
  const fail = async (error: CollectError): Promise<CollectOutcome> => {
    await recordCollectError(sql, ch.id, error);
    return { ok: false, error, posts: 0, deleted: 0, restored: 0, complete: false };
  };

  const looked = await lookupAccount(reader, ch.handle);
  if (!looked.ok) return fail(looked.error);
  if (looked.info.id !== ch.accountId) return fail('accountChanged');

  // 평소엔 지난주 월요일부터. 마지막 성공이 그보다 오래됐으면(잔액 소진·약속 쉼 등으로 끊긴 기간) 그 주 월요일부터 다시 채운다 —
  // 안 읽은 주를 0회로 판정하지 않게(리뷰 10-20). 어느 쪽이든 8주 전 월요일보다 앞으로는 가지 않는다.
  const cur = weekStartOf(now);
  const floor = addWeeks(cur, -HISTORY_WEEKS);
  const firstCollect = opts.firstCollect ?? ch.lastCollectedAt === null;
  let fromWeek = addWeeks(cur, -1);
  if (firstCollect) fromWeek = floor;
  else if (ch.lastCollectedAt && weekStartOf(ch.lastCollectedAt) < fromWeek) fromWeek = weekStartOf(ch.lastCollectedAt);
  if (fromWeek < floor) fromWeek = floor;
  const since = kstMidnight(fromWeek);
  const sinceIso = since.toISOString();

  const posts: ParsedPost[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let complete = false;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await reader.getUserTweets(ch.accountId, cursor);
      let reachedOlder = false;
      for (const raw of res.tweets) {
        const p = parsePost(raw);
        if (!p || seen.has(p.postId)) continue;
        seen.add(p.postId);
        // 고정 글은 시간순과 무관하게 맨 앞에 온다 — 오래된 글이 나왔다는 신호로 쓰지 않는다
        if (p.postedAt < sinceIso) { if (!p.pinned) reachedOlder = true; continue; }
        posts.push(p);
      }
      if (reachedOlder || !res.has_more || !res.next_cursor) { complete = true; break; }
      if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) break;
      cursor = res.next_cursor;
    }
  } catch (e) {
    if (e instanceof GetxapiAuthError) throw e;
    return fail('fetchFailed');
  }

  // 지워짐 확인 — 기록엔 있는데 목록에 없는 글만 상세로 한 번 더 본다. 고정 글은 목록에 있는 것으로 친다.
  const deleted: string[] = [];
  const restored: string[] = [];
  if (complete) {
    const pinned = new Set(looked.info.pinnedTweetIds ?? []);
    for (const k of await postsSince(sql, ch.id, since)) {
      const listed = seen.has(k.postId) || pinned.has(k.postId);
      if (listed) { if (k.deleted) restored.push(k.postId); continue; }
      if (k.deleted) continue;
      try {
        const detail = await reader.getTweetDetail(k.postId);
        if (detail === null) deleted.push(k.postId);
      } catch (e) {
        if (e instanceof GetxapiAuthError) throw e;
        // 확인 실패는 다음 날 다시 본다(표시용이라 틀린 표시보다 빈 표시)
      }
    }
  }

  await recordCollected(sql, ch, {
    posts, followers: looked.info.followers, accountCreatedAt: looked.info.createdAt ?? null, deleted, restored,
  }, now);
  return { ok: true, posts: posts.length, deleted: deleted.length, restored: restored.length, complete };
}

export interface CollectAllResult { channels: number; ok: number; failed: number; skipped: number; stoppedByDeadline: boolean }

/**
 * 약속이 있는 계정 전부. skipRecentMs 안에 이미 받은 계정은 건너뛴다(↻ 연타 방지).
 * 개별 실패는 그 계정에만 기록하고 다음 계정으로 간다 — 저장 오류(이상한 글자, 수집 중 계정 교체 등)도 같다.
 * 그러지 않으면 실패한 계정이 늘 목록 맨 앞(오래 안 받은 순)에 남아 뒤 계정들이 영영 안 받힌다(리뷰 10-20). 인증·잔액 오류만 던진다.
 */
export async function collectAll(
  sql: postgres.Sql, reader: XReader,
  opts: { now?: number; deadlineAt?: number; skipRecentMs?: number; onlyClientIds?: string[] } = {},
): Promise<CollectAllResult> {
  const now = opts.now ?? Date.now();
  const channels = await listChannelsToCollect(sql, opts.onlyClientIds);
  const out: CollectAllResult = { channels: channels.length, ok: 0, failed: 0, skipped: 0, stoppedByDeadline: false };
  for (const ch of channels) {
    if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) { out.stoppedByDeadline = true; break; }
    if (opts.skipRecentMs && ch.lastCollectedAt && now - Date.parse(ch.lastCollectedAt) < opts.skipRecentMs) { out.skipped++; continue; }
    try {
      const r = await collectChannel(sql, reader, ch, { now, deadlineAt: opts.deadlineAt });
      if (r.ok) out.ok++; else out.failed++;
    } catch (e) {
      if (e instanceof GetxapiAuthError) throw e;
      console.error(`[channels] ${ch.handle} 수집 실패`, e);
      await recordCollectError(sql, ch.id, 'fetchFailed').catch(() => {});
      out.failed++;
    }
  }
  return out;
}
