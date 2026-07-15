import type { RawTweet } from './getxapi.ts';
import type { DeckMedia, DeckQuoted, DeckTweet } from './types.ts';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function toIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v); // 레거시 "Mon Jul 06 ..." 포맷도 파싱됨
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function mapRawTweet(raw: RawTweet): DeckTweet | null {
  const id = str(raw.id);
  const author = raw.author as Record<string, unknown> | undefined;
  const handle = str(author?.userName);
  if (!id || !handle) return null;
  if (raw.retweeted_tweet) return null; // 순수 리트윗은 벤치마크 대상 아님

  const mediaRaw = Array.isArray(raw.media) ? (raw.media as Array<Record<string, unknown>>) : [];
  const media: DeckMedia[] = mediaRaw
    .filter((m) => str(m.url))
    .map((m) => ({ type: str(m.type) ?? 'photo', url: str(m.url)!, videoUrl: str(m.video_url) }));

  let quoted: DeckQuoted | null = null;
  const q = raw.quoted_tweet as Record<string, unknown> | undefined | null;
  if (q && str(q.id)) {
    const qUser = q.user as Record<string, unknown> | undefined;
    // 검색 응답 실키는 name/screen_name (userName은 과거 데이터·타 엔드포인트 폴백)
    quoted = {
      id: str(q.id)!, text: str(q.text) ?? '',
      userName: str(qUser?.name) ?? str(qUser?.userName),
      screenName: str(qUser?.screen_name),
    };
  }

  return {
    tweetId: id,
    authorHandle: handle,
    authorName: str(author?.name),
    authorAvatarUrl: str(author?.profilePicture),
    authorFollowers: num(author?.followers),
    text: str(raw.text) ?? '',
    media,
    quoted,
    metrics: {
      views: num(raw.viewCount), likes: num(raw.likeCount), retweets: num(raw.retweetCount),
      replies: num(raw.replyCount), quotes: num(raw.quoteCount), bookmarks: num(raw.bookmarkCount),
    },
    tweetUrl: str(raw.url) ?? (str(raw.twitterUrl) ?? `https://x.com/${handle}/status/${id}`),
    tweetCreatedAt: toIso(raw.createdAt),
  };
}

export interface ExpansionUser {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  followers: number | null;
}

export function mapRawUser(raw: Record<string, unknown>): ExpansionUser | null {
  const handle = str(raw.userName) ?? str(raw.screen_name);
  if (!handle) return null;
  return { handle, name: str(raw.name), avatarUrl: str(raw.profilePicture), followers: num(raw.followers) };
}
