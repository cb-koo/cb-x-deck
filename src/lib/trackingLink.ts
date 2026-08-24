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

// 제안 = {캠페인}-{핸들} 소문자. 허용 밖 글자(한글 등)는 지우고 하이픈·점 잔여물을 정리한다.
export function suggestSlug(campaign: string, handle: string): string {
  return [campaign, handle].filter(Boolean).join('-')
    .trim().replace(/\s+/g, '-').toLowerCase()
    .replace(/[^a-z0-9._-]/g, '').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
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
