// 한 원고에 게시물이 여럿일 때(스레드·링크 댓글) 어느 게시물이 무엇인지 매긴다 — 순수 함수.
// 저장하지 않고 읽기 시점에 판정한다: 등록 순서(링크보다 게시물이 먼저 등록된 경우)에 좌우되지 않고,
// 링크가 나중에 생겨도 다음 읽기에서 바로 맞는다. 사람이 고친 값(role)만 영구다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §역할 판정
import { parseTweetLink } from './tweetLink.ts';

export type PostRole = 'main' | 'thread' | 'link';
export const POST_ROLES: readonly PostRole[] = ['main', 'thread', 'link'];

export interface RolePostInput {
  tweetId: string;
  postedAt: string | null;   // ISO
  role: PostRole | null;     // 저장값(사람이 고친 것). null = 자동
  rawUrls: unknown;          // post_metric_snapshot.raw #> '{entities,urls}' — getxapi 트윗의 URL 엔티티 배열
  isReply: boolean | null;   // raw.isReply
}

// 비교용 정규형: 스킴·후행 슬래시·호스트 대소문자·쿼리스트링·해시 차이는 같은 링크다
// (X가 t.co를 풀어 준 expanded_url엔 ?ref= 등이 붙지만 우리 short_url엔 없다).
export function normalizeUrl(u: string): string {
  const s = u.trim().replace(/^https?:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  const slash = s.indexOf('/');
  return slash === -1 ? s.toLowerCase() : s.slice(0, slash).toLowerCase() + s.slice(slash);
}

export function urlsOf(rawUrls: unknown): string[] {
  if (!Array.isArray(rawUrls)) return [];
  const out: string[] = [];
  for (const e of rawUrls) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    const v = typeof o.expanded_url === 'string' ? o.expanded_url : typeof o.url === 'string' ? o.url : null;
    if (v) out.push(v);
  }
  return out;
}

function containsShortUrl(rawUrls: unknown, shortNorm: Set<string>): boolean {
  if (shortNorm.size === 0) return false;
  return urlsOf(rawUrls).some((u) => shortNorm.has(normalizeUrl(u)));
}

const ts = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY); // 시각 없음은 맨 뒤

// 작업의 게시물 링크(post_url)가 가리키는 트윗 — 그 원고의 게시물 중 하나면 그 tweetId(여럿이면 가장 이른 것), 아니면 null.
// assignRoles의 mainTweetId 재료: 캠페인 화면(pickTaskMainPost)과 같은 본 게시물을 고르게 한다(self-replies §5).
export function taskMainTweetIdOf(posts: Array<{ tweetId: string; postedAt: string | null; postUrl: string | null }>): string | null {
  const hits = posts.filter((p) => {
    if (!p.postUrl) return false;
    const parsed = parseTweetLink(p.postUrl);
    return parsed.ok && parsed.tweetId === p.tweetId;
  });
  return hits.sort((a, b) => ts(a.postedAt) - ts(b.postedAt))[0]?.tweetId ?? null;
}

// 출력 순서 = 화면의 스레드 읽기 흐름 순서: main → thread(게시 순) → link.
// mainTweetId(작업의 게시물 링크가 가리키는 트윗)를 주면 그 트윗이 링크를 담고 있어도 main이다 — 본 게시물에 트래킹 링크를
// 넣고 댓글엔 안 넣은 경우 댓글이 main이 되던 것을 막는다. 사람이 고친 값(role)은 여전히 이긴다.
export function assignRoles<T extends RolePostInput>(posts: T[], shortUrls: string[], mainTweetId: string | null = null): Array<T & { role: PostRole }> {
  if (posts.length === 0) return [];
  const shortNorm = new Set(shortUrls.map(normalizeUrl));
  const fixed = new Map<string, PostRole>();
  for (const p of posts) if (p.role) fixed.set(p.tweetId, p.role);

  // 1) 저장값 우선, 2) 작업의 본 게시물(mainTweetId) → main, 3) 링크 포함 → link
  const auto = posts.filter((p) => !fixed.has(p.tweetId));
  const pinned = mainTweetId ? auto.find((p) => p.tweetId === mainTweetId) : undefined;
  const links = auto.filter((p) => p !== pinned && containsShortUrl(p.rawUrls, shortNorm));
  const rest = auto.filter((p) => !links.includes(p));

  // 4) main = 고정된 본 게시물, 없으면 isReply=false 중 가장 이른 것, 없으면 가장 이른 것
  const sorted = [...rest].sort((a, b) => ts(a.postedAt) - ts(b.postedAt));
  const main = pinned ?? sorted.find((p) => p.isReply === false) ?? sorted[0];

  const roleOf = (p: T): PostRole => fixed.get(p.tweetId) ?? (links.includes(p) ? 'link' : p === main ? 'main' : 'thread');
  const roled = posts.map((p) => ({ ...p, role: roleOf(p) }));
  const order: Record<PostRole, number> = { main: 0, thread: 1, link: 2 };
  return roled.sort((a, b) => order[a.role] - order[b.role] || ts(a.postedAt) - ts(b.postedAt));
}
