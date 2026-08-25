// 트래킹 링크의 순수 로직 — 링크 주소(slug)·랜딩 URL 검사·UTM 조립·캠페인 제안.
// 서버(라우트)와 브라우저(생성 모달 미리보기)가 같은 함수를 쓴다 — node 전용 API 금지.
// (스펙: docs/superpowers/specs/2026-08-24-tracking-link-design.md §UTM 조립 규칙)

// 링크 주소(slug)에는 무작위 문자를 쓰지 않는다(koo QA 08-25) — 랜덤 꾸미가 스팸 단축링크처럼
// 보인다. 사람이 지은 것처럼 읽히는 조합({캠페인}-{핸들})만 쓰고, 충돌은 -2, -3 순번으로 푼다.
// 맞바꾼 것: 규칙이 읽히므로 주소 추측이 가능해졌다 — 내부 성과 추적 용도라 수용(GA 교차 확인 가능).
export type SlugCheck =
  | { ok: true; slug: string }
  | { ok: false; reason: 'empty' | 'invalid' };

export function checkSlug(input: string): SlugCheck {
  const raw = (input ?? '').trim().replace(/\s+/g, '-').toLowerCase(); // 경로 표기 통일 — 대소문자 혼동 방지
  if (!raw) return { ok: false, reason: 'empty' };
  if (!/^[a-z0-9._-]+$/.test(raw)) return { ok: false, reason: 'invalid' };
  return { ok: true, slug: raw };
}

export function slugMessage(reason: 'empty' | 'invalid'): string {
  if (reason === 'empty') return '링크 주소를 입력해 주세요';
  return '링크 주소는 영어·숫자·하이픈으로 입력해 주세요 (예: yonsei-clinic-202608-hana_kim)';
}

// 자동 제안 = 단어처럼 읽히는 무의미 코드(koo QA 08-25 2차) — 자음·모음을 교대로 배열해
// 발음이 되면 이름처럼 보이고(스팸 인상 없음), 뜻이 없어 규칙·추측 여지도 없다.
// 3음절 6자 = 12*5 조합^3 ≈ 21.6만 — 이 규모(수백 링크)에 충분, 충돌은 라우트의 순번 폴백이 처리.
const WORD_CONSONANTS = 'bdgkmnprstvz'; // 발음 애매하거나(c,q,x) 혼동되는(l↔1) 자음 제외
const WORD_VOWELS = 'aeiou';
export function generateWordCode(): string {
  const buf = new Uint32Array(6);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < 6; i += 2) {
    out += WORD_CONSONANTS[buf[i] % WORD_CONSONANTS.length];
    out += WORD_VOWELS[buf[i + 1] % WORD_VOWELS.length];
  }
  return out;
}

export type LandingUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'not-https' | 'invalid' };

// 잘못된 링크가 인플루언서에게 나가는 사고를 막는 관문 — 클라이언트(즉시 피드백)와
// 서버(저장 근거)가 같은 함수를 쓴다(parseTweetLink 재검증 관례).
export function checkLandingUrl(input: string): LandingUrlCheck {
  let raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  // 스킴 없이 붙여넣는 게 자연스러운 입력(koo QA 08-25) — https://를 자동으로 붙여 해석한다.
  // http://를 명시한 경우는 보정하지 않고 거부한다: http 전용 사이트를 https로 바꿔치기하면 죽은 링크가 나간다.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'invalid' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (!u.hostname.includes('.')) return { ok: false, reason: 'invalid' }; // localhost 등 — 인플에게 줄 주소가 아니다
  return { ok: true, url: u.toString() };
}

export function landingUrlMessage(reason: 'empty' | 'not-https' | 'invalid'): string {
  if (reason === 'empty') return '랜딩페이지 주소를 입력해 주세요';
  if (reason === 'not-https') return '주소는 https:// 로 시작해야 해요';
  return '주소 형식이 올바르지 않아요 — 브라우저 주소창의 전체 주소를 붙여넣어 주세요';
}

// 표준형 UTM(스펙 확정): source=x · medium=influencer · campaign=입력값 · content={핸들}-{code}.
// 기존 utm_*는 대소문자 무관 제거 후 교체 — 이중 UTM은 랜딩 쪽 분석을 오염시킨다.
export function buildTrackedUrl(args: {
  landingUrl: string; campaign: string; content: string; // content = 링크 주소(slug) — 경로와 utm_content가 같은 값
}): string {
  const u = new URL(args.landingUrl);
  for (const k of [...u.searchParams.keys()]) {
    if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  }
  u.searchParams.set('utm_source', 'x');
  u.searchParams.set('utm_medium', 'influencer');
  u.searchParams.set('utm_campaign', args.campaign);
  u.searchParams.set('utm_content', args.content);
  return u.toString();
}

// 캠페인명은 영어·숫자·하이픈(및 ._)만 — 팀 표기 규칙(koo QA 2026-08-24). GA가 한글을 못 다뤄서가
// 아니라, 캠페인 표기를 영문으로 통일하기 위한 규칙이다. 공백은 제안 규칙과 같게 하이픈으로 정규화.
export type CampaignCheck =
  | { ok: true; campaign: string }
  | { ok: false; reason: 'empty' | 'not-ascii' };

export function checkCampaign(input: string): CampaignCheck {
  const raw = (input ?? '').trim().replace(/\s+/g, '-');
  if (!raw) return { ok: false, reason: 'empty' };
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return { ok: false, reason: 'not-ascii' };
  return { ok: true, campaign: raw };
}

export function campaignMessage(reason: 'empty' | 'not-ascii'): string {
  if (reason === 'empty') return '캠페인명을 입력해 주세요';
  return '캠페인명은 영어·숫자·하이픈으로 입력해 주세요 (예: clinic-a-202608)';
}

// 콘텐츠 구분 — utm_content의 뒷부분(koo 확정 08-25): 링크 주소(짧고 무의미)와 달리 분석하는 사람이 읽는 값이라
// 의미가 우선. 기본값은 만든 날 MMDD(월은 캠페인에 이미 있음), 모달에서 lifting처럼 영문으로 고쳐 쓸 수 있다.
export type ContentLabelCheck =
  | { ok: true; label: string }
  | { ok: false; reason: 'empty' | 'not-ascii' };

export function checkContentLabel(input: string): ContentLabelCheck {
  const raw = (input ?? '').trim().replace(/\s+/g, '-');
  if (!raw) return { ok: false, reason: 'empty' };
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return { ok: false, reason: 'not-ascii' };
  return { ok: true, label: raw };
}

export function contentLabelMessage(reason: 'empty' | 'not-ascii'): string {
  if (reason === 'empty') return '콘텐츠 구분을 입력해 주세요';
  return '콘텐츠 구분은 영어·숫자·하이픈으로 입력해 주세요 (예: lifting, before-after)';
}

export function suggestContentLabel(now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3600 * 1000);
  return `${String(kst.getUTCMonth() + 1).padStart(2, '0')}${String(kst.getUTCDate()).padStart(2, '0')}`;
}

// utm_content = {핸들}-{콘텐츠 구분} — GA에서 '누가 · 무엇/언제'가 한 값에 읽힌다
export function utmContentOf(handle: string, label: string): string {
  return `${handle}-${label}`;
}

// 제안값일 뿐 확정이 아니다 — 입력란에서 수정 가능(반자동의 '반').
// 클라명에서 영문 규칙에 맞는 글자만 남긴다(한글 클라는 YYYYMM만 제안 — 영문 접두는 사람이 붙인다).
// 월은 KST 기준(리포 시간대 관례).
export function suggestCampaign(clientName: string | null, now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3600 * 1000);
  const ym = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = (clientName ?? '').trim().replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  return name ? `${name}-${ym}` : ym;
}
