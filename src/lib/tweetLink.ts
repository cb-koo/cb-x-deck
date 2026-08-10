// 카드에서 복사·전달하는 트윗 링크.
// 상위 API가 주는 tweetUrl을 쓰지 않는다 — null 가능(types.ts)이고 twitter.com 형태가 섞여 들어온다(mappers.ts).
// 핸들+ID는 항상 있으므로 조립형이 언제나 유효한 x.com 정규형이 된다. (설계 2026-07-30 §B)
// 예외로 핸들이 없을 수 있다 — 브리핑 인용은 트윗 스냅샷이 옵셔널이라(briefingTypes.ts) 핸들이 남아 있지 않다.
// 이때는 ID만으로 된 형식으로 떨어진다. X가 해석해 주는 형식이고, 브리핑의 기존 '원문 ↗' 링크가
// 이미 정확히 이 형식이라(api/briefings/route.ts:39) 앱 전체가 규칙 하나로 통일된다. (설계 §F)
export function tweetPermalink(authorHandle: string | null | undefined, tweetId: string): string {
  const handle = (authorHandle ?? '').replace(/^@+/, '');   // 표시용 '@handle'이 그대로 들어와도 안전하게
  if (!handle) return `https://x.com/i/status/${tweetId}`;
  return `https://x.com/${handle}/status/${tweetId}`;
}

// 역방향: 사용자가 붙여넣은 링크 → 트윗 ID. (조립·파싱 규칙을 이 파일 한 곳에 모은다 — xHandle.ts 관례)
// 클라이언트 인라인 검증과 서버 재검증이 같은 함수를 쓴다.
export type TweetLinkParseReason = 'empty' | 'notTweet' | 'invalid';
export type TweetLinkParse =
  | { ok: true; tweetId: string }
  | { ok: false; reason: TweetLinkParseReason };

const HOSTS = new Set(['x.com', 'twitter.com']);
const SUBDOMAINS = ['www.', 'mobile.', 'm.'];
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const ID_RE = /^\d+$/;

export function parseTweetLink(input: string): TweetLinkParse {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  let host = url.hostname.toLowerCase();
  for (const sub of SUBDOMAINS) if (host.startsWith(sub)) { host = host.slice(sub.length); break; }
  if (!HOSTS.has(host)) return { ok: false, reason: 'invalid' };

  const parts = url.pathname.split('/').filter(Boolean);
  // 표준형 x.com/<계정>/status/<ID> — /photo/1 같은 뒤 꼬리는 무시
  if (parts.length >= 3 && HANDLE_RE.test(parts[0]) && parts[1] === 'status' && ID_RE.test(parts[2]))
    return { ok: true, tweetId: parts[2] };
  // X 앱 "링크 복사"가 주는 형태 두 가지
  if (parts[0] === 'i' && parts[1] === 'status' && parts[2] && ID_RE.test(parts[2]))
    return { ok: true, tweetId: parts[2] };
  if (parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status' && parts[3] && ID_RE.test(parts[3]))
    return { ok: true, tweetId: parts[3] };
  // 레거시 영구링크 x.com/statuses/<ID>
  if (parts[0] === 'statuses' && parts[1] && ID_RE.test(parts[1]))
    return { ok: true, tweetId: parts[1] };
  return { ok: false, reason: 'notTweet' };
}

export function tweetLinkParseMessage(reason: TweetLinkParseReason): string {
  if (reason === 'empty') return '트윗 링크를 넣어주세요';
  if (reason === 'notTweet') return '트윗 주소가 아니에요 — X에서 공유 → 링크 복사한 주소를 붙여넣어주세요 (예: x.com/계정/status/숫자)';
  return 'X 트윗 주소가 아니에요 — x.com 또는 twitter.com 링크를 붙여넣어주세요';
}
