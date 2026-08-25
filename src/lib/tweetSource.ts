// 계정 분석용 수집 경계(스펙 §4) — 다른 서비스 API로 교체할 수 있게 인터페이스 뒤에 둔다.
// mapRawTweet을 재사용하지 않는 이유: 그쪽은 순수 RT를 버린다(벤치마크 대상 아님) — 분석은
// RT 비중 자체가 판단 재료라 kind로 구분해 남긴다. RT의 본문·지표는 쓰지 않는다(원작자 것).
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { num, str, toIso } from './mappers.ts';
import type { AnalysisTweet } from './analysisStats.ts';

export interface FetchRecentResult { tweets: AnalysisTweet[]; truncatedByCount: boolean }

export interface TweetSource {
  fetchRecent(userId: string, opts: { maxCount: number; since: string }): Promise<FetchRecentResult>;
}

export function mapRawAnalysisTweet(raw: RawTweet): AnalysisTweet | null {
  const id = str(raw.id);
  const createdAt = toIso(raw.createdAt);
  if (!id || !createdAt) return null;
  const kind = raw.retweeted_tweet ? 'retweet' : raw.quoted_tweet ? 'quote' : 'original';
  const media = Array.isArray(raw.media) ? raw.media : [];
  return {
    id, createdAt, kind,
    text: str(raw.text) ?? '',
    views: num(raw.viewCount), likes: num(raw.likeCount),
    hasMedia: media.length > 0,
  };
}

const MAX_PAGES = 10; // 무한 커서 가드 — 100건이면 5~6페이지에서 끝난다

export function makeGetxapiTweetSource(client: Pick<GetxapiClient, 'getUserTweets'>): TweetSource {
  return {
    async fetchRecent(userId, { maxCount, since }) {
      const out: AnalysisTweet[] = [];
      let cursor: string | undefined;
      for (let p = 0; p < MAX_PAGES; p++) {
        const page = await client.getUserTweets(userId, cursor);
        let sawOld = false;
        for (const raw of page.tweets) {
          // 고정글은 최신순과 무관하게 1페이지 맨 앞에 실려 온다 — 실호출로 확인(2026-08-25, elonmusk:
          // idx0 = isPinned:true / Aug 22, idx1 = Aug 24). 그대로 두면 3개월보다 오래된 고정글 하나가
          // sawOld를 켜 1페이지에서 수집이 끊긴다(빈도 과소평가). 시간순 신호가 아니므로 아예 건너뛴다
          // — 창 안의 고정글 1건을 표본에서 잃을 수 있지만, 앞머리 중복 계수도 함께 막는다.
          if (raw.isPinned === true) continue;
          const t = mapRawAnalysisTweet(raw);
          if (!t) continue;
          if (t.createdAt < since) { sawOld = true; continue; } // 페이지가 최신순이라 이후는 전부 과거
          out.push(t);
          if (out.length >= maxCount) return { tweets: out, truncatedByCount: true };
        }
        if (sawOld || !page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
      return { tweets: out, truncatedByCount: false };
    },
  };
}
