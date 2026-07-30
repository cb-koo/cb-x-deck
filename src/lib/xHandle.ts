// 인플루언서 컬럼 입력 정규화 — 사용자가 손에 쥔 것(프로필/트윗 링크)을 그대로 받아 핸들로 만든다.
// 클라이언트 피드백과 서버 저장값이 어긋나지 않도록 규칙을 이 파일 한 곳에만 둔다.
export type HandleParseReason = 'empty' | 'notProfile' | 'invalid';
export type HandleParse =
  | { ok: true; handle: string }
  | { ok: false; reason: HandleParseReason };

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const HOSTS = new Set(['x.com', 'twitter.com']);
const SUBDOMAINS = ['www.', 'mobile.', 'm.'];

// 계정이 아닌 X 내부 경로. 'i'가 핵심 — x.com/i/status/… 와 x.com/i/user/<id>는
// 경로만으로 작성자를 알 수 없다(숫자 ID 역조회는 범위 밖).
const RESERVED = new Set([
  'i', 'home', 'explore', 'search', 'notifications', 'messages', 'settings',
  'compose', 'intent', 'share', 'hashtag', 'login', 'logout', 'signup',
  'account', 'tos', 'privacy', 'about', 'download',
  // statuses = 옛 트윗 영구링크(x.com/statuses/…)가 지금도 돌아다님, communities = 커뮤니티 링크.
  // 둘 다 핸들 형식과 겹쳐 그대로 두면 getUserInfo를 낭비하고 혼란스러운 "계정 없음"만 돌려준다.
  'statuses', 'communities',
]);

export function parseXHandle(input: string): HandleParse {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  // 핸들 먼저 — 핸들에는 '.'도 '/'도 못 쓰므로 URL과 혼동될 수 없다.
  const bare = raw.replace(/^@/, '');
  if (HANDLE_RE.test(bare)) return { ok: true, handle: bare };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  let host = url.hostname.toLowerCase();  // URL 파서가 이미 소문자화하지만 의도를 명시
  for (const sub of SUBDOMAINS) if (host.startsWith(sub)) { host = host.slice(sub.length); break; }
  if (!HOSTS.has(host)) return { ok: false, reason: 'invalid' };

  // 첫 조각이 계정. 뒤 조각(/status/123, /with_replies, 앞으로 생길 탭)은 모두 하위 페이지다.
  const first = url.pathname.split('/').filter(Boolean)[0];
  if (!first) return { ok: false, reason: 'notProfile' };
  if (RESERVED.has(first.toLowerCase())) return { ok: false, reason: 'notProfile' };
  if (!HANDLE_RE.test(first)) return { ok: false, reason: 'invalid' };
  return { ok: true, handle: first };
}

export function handleParseMessage(reason: HandleParseReason): string {
  if (reason === 'empty') return '계정 핸들이나 프로필 링크를 넣어주세요';
  if (reason === 'notProfile') return '계정을 알 수 없는 주소예요 — x.com/계정명 형태의 링크나 @핸들을 넣어주세요';
  return 'X 계정 주소나 @핸들이 아니에요 — 예: x.com/hadakan__ 또는 @hadakan__';
}
