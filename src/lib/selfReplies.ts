// 인플 본인 댓글(추가 콘텐츠) — 순수 함수 모음(스펙 2026-10-06-self-replies-design.md).
//  · pickSelfReplies: 스레드 응답에서 "그 작업에 붙일 본인 댓글"을 고른다(§3).
//  · pickTaskMainPost: 작업 지표를 낼 게시물 하나 — 게시물 링크(post_url)가 가리키는 트윗(§5).
//  · firstLinkOf: 댓글에 든 링크 하나.
import type { RawTweet } from './getxapi.ts';
import { postFromRaw, type FetchedPost } from './postMetrics.ts';
import { parseTweetLink } from './tweetLink.ts';
import { urlsOf } from './postRole.ts';

const idOf = (v: unknown): string | null => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null);
const authorIdOf = (t: RawTweet): string | null => idOf((t.author as Record<string, unknown> | undefined)?.id);
const ts = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);   // 시각 없음은 맨 뒤(postRole과 같은 관례)

// 스레드에서 본 게시물의 작성자 고유번호 — 본 게시물이 응답에 없거나 번호가 없으면 null(그땐 아무것도 붙이지 않는다).
export function mainAuthorIdOf(tweets: RawTweet[], mainTweetId: string): string | null {
  const main = tweets.find((t) => idOf(t.id) === mainTweetId);
  return main ? authorIdOf(main) : null;
}

// 붙일 본인 댓글 — 작성자 고유번호가 본 게시물 작성자와 같고(핸들은 보지 않는다 — 바뀔 수 있다), 본 게시물이 아니며,
// 본 게시물보다 앞서 쓴 글이 아니고, 본 게시물에서 이어지는 본인 댓글 사슬 위에 있으며(inReplyToId가 본 게시물이거나
// 이미 사슬에 든 본인 댓글 — 아래쪽 팬 댓글에 단 답글은 추가 콘텐츠가 아니다), 아직 트래킹에 없는 트윗. 게시 순.
// (후보 고르기만 — 등록·스냅샷은 상세 조회 값으로, selfReplyDiscovery)
export function pickSelfReplies(args: {
  tweets: RawTweet[]; mainTweetId: string; mainAuthorId: string | null; trackedIds: ReadonlySet<string>;
}): FetchedPost[] {
  const { tweets, mainTweetId, mainAuthorId, trackedIds } = args;
  if (!mainAuthorId) return [];
  // 스레드 조회는 본 게시물이 낀 스레드 전체를 준다 — 본 게시물이 인플의 앞선 스레드에 단 답글이면 그 앞 글들도 온다.
  // 본 게시물보다 먼저 쓴 글은 "추가 콘텐츠"가 아니다(시각을 모르면 거르지 않는다).
  const mainRaw = tweets.find((t) => idOf(t.id) === mainTweetId);
  const mainAt = mainRaw ? postFromRaw(mainRaw)?.postedAt ?? null : null;
  const own: Array<{ p: FetchedPost; parent: string | null }> = [];
  for (const t of tweets) {
    const p = postFromRaw(t);
    if (!p || p.tweetId === mainTweetId) continue;
    if (authorIdOf(t) !== mainAuthorId) continue;
    if (mainAt && p.postedAt && Date.parse(p.postedAt) < Date.parse(mainAt)) continue;
    if (own.some((o) => o.p.tweetId === p.tweetId)) continue;
    own.push({ p, parent: idOf(t.inReplyToId) });
  }
  // 사슬: 본 게시물에서 출발해 본인 댓글로만 이어 간다(이미 트래킹 중인 댓글도 사슬은 잇는다). 응답 순서와 무관하게 더 못 늘 때까지.
  const chain = new Set<string>([mainTweetId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const o of own) {
      if (!chain.has(o.p.tweetId) && o.parent && chain.has(o.parent)) { chain.add(o.p.tweetId); grew = true; }
    }
  }
  const out = own.filter((o) => chain.has(o.p.tweetId) && !trackedIds.has(o.p.tweetId)).map((o) => o.p);
  return out.sort((a, b) => ts(a.postedAt) - ts(b.postedAt));
}

export interface MainCandidate { tweetId: string; postedAt: string | null; isReply: boolean | null }

// 작업 지표 = 이 게시물 하나. post_url의 트윗이 붙어 있으면 그것, 아니면 가장 이른 본 게시물
// (isReply=false 중 가장 이른 것, 없으면 가장 이른 것 — assignRoles의 main 규칙과 같다). 시각이 같거나 없으면 들어온 순서.
export function pickTaskMainPost<T extends MainCandidate>(postUrl: string | null, posts: T[]): T | null {
  if (posts.length === 0) return null;
  const parsed = postUrl ? parseTweetLink(postUrl) : null;
  if (parsed?.ok) {
    const hit = posts.find((p) => p.tweetId === parsed.tweetId);
    if (hit) return hit;
  }
  const sorted = posts.map((p, i) => ({ p, i })).sort((a, b) => ts(a.p.postedAt) - ts(b.p.postedAt) || a.i - b.i).map((x) => x.p);
  return sorted.find((p) => p.isReply === false) ?? sorted[0];
}

// 댓글에 든 링크 하나 — URL 엔티티(풀린 주소) 먼저, 없으면 본문에서. 실제 스레드 응답엔 엔티티가 없고 본문에
// 주소가 그대로 있다(10-06 확인). t.co는 사진·인용이 붙으면 X가 끝에 다는 링크라 뺀다.
export function firstLinkOf(text: string, rawUrls: unknown): string | null {
  const fromEntities = urlsOf(rawUrls).find((u) => /^https?:\/\//i.test(u) && !/^https?:\/\/t\.co\//i.test(u));   // 화면이 href로 쓰니 http(s)만
  if (fromEntities) return fromEntities;
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'）)]+/gi)) {
    const u = m[0].replace(/[.,!?。、]+$/, '');
    if (!/^https?:\/\/t\.co\//i.test(u)) return u;
  }
  return null;
}
