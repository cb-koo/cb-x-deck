// 게시물 링크 → 게시일(한국 날짜) — 순수(DB 없음). 투고·인용RT·방문협찬의 게시일은 사람이 적지 않고 링크에서
// 정한다(koo 09-26 결정 1). 화면의 미리보기('게시일 9월 24일 (수) · 링크에서 확인')와 서버의 판정
// (campaignTaskInput.postedAtFromLinkGate)이 이 함수 하나를 쓴다 — 두 벌이면 한쪽만 하루 밀릴 수 있다.
//
// X 트윗 id는 스노플레이크다: 상위 비트가 생성 시각(ms, 트위터 기준점 1288834974657 = 2010-11-04T01:42:54.657Z부터).
// X API를 부르지 않고도 링크만으로 날짜가 나온다. 한국 날짜는 datetime.ts와 같은 고정 +9(서머타임 없음)로 자른다.
import { parseTweetLink } from './tweetLink.ts';

const TWITTER_EPOCH_MS = BigInt(1288834974657);
const TIMESTAMP_SHIFT = BigInt(22);
const MAX_ID = BigInt('9223372036854775807');   // 부호 있는 64비트 — X id의 상한
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 트윗 id → 'YYYY-MM-DD'(한국). 숫자가 아니거나, 64비트를 넘거나, 시각 성분이 없는(스노플레이크 이전) id는 null. */
export function postedOnFromTweetId(id: string): string | null {
  if (!/^\d{1,20}$/.test(id)) return null;
  const n = BigInt(id);
  if (n > MAX_ID) return null;
  const offset = n >> TIMESTAMP_SHIFT;
  // 2010년 11월 전 트윗은 순번 id라 시각이 안 들어 있다 — 기준점 날짜를 게시일이라고 말하지 않는다
  if (offset === BigInt(0)) return null;
  const ms = Number(offset + TWITTER_EPOCH_MS);
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 게시물 링크 → 'YYYY-MM-DD'(한국). 링크 해석은 tweetLink.parseTweetLink(앱 전체 규칙 하나)를 쓴다. */
export function postedOnFromTweetLink(url: string): string | null {
  const p = parseTweetLink(url);
  return p.ok ? postedOnFromTweetId(p.tweetId) : null;
}
