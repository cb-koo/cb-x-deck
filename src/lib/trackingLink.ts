// 트래킹 링크의 순수 로직 — 코드 생성·랜딩 URL 검사·UTM 조립·캠페인 제안.
// 서버(라우트)와 브라우저(생성 모달 미리보기)가 같은 함수를 쓴다 — node 전용 API 금지(Web Crypto만).
// (스펙: docs/superpowers/specs/2026-08-24-tracking-link-design.md §UTM 조립 규칙)

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const CODE_LEN = 6;

// 6자 = 36^6 ≈ 21억 조합. 충돌은 DB unique + short.io 409가 잡고 호출부가 재생성한다.
export function generateLinkCode(): string {
  const buf = new Uint32Array(CODE_LEN);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (const n of buf) out += ALPHABET[n % ALPHABET.length];
  return out;
}

export type LandingUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'not-https' | 'invalid' };

// 잘못된 링크가 인플루언서에게 나가는 사고를 막는 관문 — 클라이언트(즉시 피드백)와
// 서버(저장 근거)가 같은 함수를 쓴다(parseTweetLink 재검증 관례).
export function checkLandingUrl(input: string): LandingUrlCheck {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
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
  landingUrl: string; campaign: string; handle: string; code: string;
}): string {
  const u = new URL(args.landingUrl);
  for (const k of [...u.searchParams.keys()]) {
    if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  }
  u.searchParams.set('utm_source', 'x');
  u.searchParams.set('utm_medium', 'influencer');
  u.searchParams.set('utm_campaign', args.campaign);
  u.searchParams.set('utm_content', `${args.handle}-${args.code}`);
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
