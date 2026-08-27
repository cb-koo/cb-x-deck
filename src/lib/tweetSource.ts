// 계정 분석용 수집 경계(스펙 §1). 활동은 activitySince(28일)까지, 내용은 직접 글 directTarget건까지 —
// 두 조건이 모두 차거나 lookbackSince(6개월)를 넘으면 정상 종료. 페이지/총량/데드라인은 "상한 종료"(truncated)로
// 따로 표시한다 — 계정 트윗이 소진돼 끝난 것은 상한이 아니다(캡션은 상한일 때만, 라벨-값 일치).
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { num, str, toIso } from './mappers.ts';
import type { AnalysisTweet } from './analysisStats.ts';

export interface FetchOpts {
  activitySince: string; directTarget: number; lookbackSince: string;
  maxPages: number; maxTweets: number; deadlineAt?: number;
}
export interface FetchResult {
  tweets: AnalysisTweet[]; truncated: boolean; reachedActivitySince: boolean; directCount: number; pagesUsed: number;
}
export interface TweetSource { fetchRecent(userId: string, opts: FetchOpts): Promise<FetchResult> }

export function mapRawAnalysisTweet(raw: RawTweet): AnalysisTweet | null {
  const id = str(raw.id);
  const createdAt = toIso(raw.createdAt);
  if (!id || !createdAt) return null;
  const rt = raw.retweeted_tweet as Record<string, unknown> | undefined;
  const kind = rt ? 'retweet' : raw.quoted_tweet ? 'quote' : 'original';
  const media = Array.isArray(raw.media) ? raw.media : [];
  return {
    id, createdAt, kind,
    text: str(raw.text) ?? '',
    // 퍼나르는 주제 분류용 — RT 원문. raw.text는 "RT @x: …"로 잘려 있을 수 있어 원본을 우선한다.
    ...(kind === 'retweet' ? { rtText: str(rt?.text) ?? str(raw.text) ?? '' } : {}),
    views: num(raw.viewCount), likes: num(raw.likeCount),
    hasMedia: media.length > 0,
  };
}

export function makeGetxapiTweetSource(
  client: Pick<GetxapiClient, 'getUserTweets'>, now: () => number = Date.now,
): TweetSource {
  return {
    async fetchRecent(userId, opts) {
      const out: AnalysisTweet[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      let oldest: string | null = null;   // 고정글 제외한 시간순 최고령
      let directCount = 0;
      let pagesUsed = 0;
      let truncated = false;
      let exhausted = false;   // 계정 트윗이 소진돼 정상 종료(상한과 구분 — 라벨-값 일치)

      const done = () =>
        oldest !== null && oldest < opts.activitySince &&
        (directCount >= opts.directTarget || oldest < opts.lookbackSince);

      while (pagesUsed < opts.maxPages) {
        const page = await client.getUserTweets(userId, cursor);
        pagesUsed += 1;
        for (let i = 0; i < page.tweets.length; i++) {
          const raw = page.tweets[i];
          const t = mapRawAnalysisTweet(raw);
          if (!t || seen.has(t.id)) continue;
          // 고정글은 1페이지 맨 앞에 시간순과 무관하게 실려 온다(실호출 확인) — 시간순 신호로 쓰지 않되 수집엔 포함.
          if (raw.isPinned !== true && (oldest === null || t.createdAt < oldest)) oldest = t.createdAt;
          // 6개월 밖은 담지 않는다 — 고정글도 예외 없음(시간순 신호에서만 빼는 것과는 별개, 의도된 동작).
          if (t.createdAt < opts.lookbackSince) continue;
          seen.add(t.id);
          out.push(t);
          if (t.kind !== 'retweet') directCount += 1;
          if (out.length >= opts.maxTweets) {
            // 이 트윗이 페이지의 마지막이고 더 없으면 상한이 아니라 소진이다.
            if (i === page.tweets.length - 1 && !page.has_more) exhausted = true;
            else truncated = true;
            break;
          }
        }
        if (truncated || exhausted) break;
        if (done()) break;
        if (!page.has_more || !page.next_cursor) { exhausted = true; break; }
        if (opts.deadlineAt !== undefined && now() >= opts.deadlineAt) { truncated = true; break; }
        cursor = page.next_cursor;
      }
      if (!truncated && !exhausted && pagesUsed >= opts.maxPages && !done()) truncated = true;
      const reachedActivitySince = oldest !== null && oldest < opts.activitySince;
      return { tweets: out, truncated, reachedActivitySince, directCount, pagesUsed };
    },
  };
}
