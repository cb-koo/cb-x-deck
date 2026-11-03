// 정산 메뉴 검색(koo 11-02) — 인플루언서 핸들·캠페인 이름·클라이언트 이름을 한 칸에서 찾는다. 순수.
// 정산 요청 대기·요청 내역 두 탭이 같은 판정을 써서, 검색줄의 "다른 탭 N건"과 그 탭에 가서 보이는 건수가 같다(UX 원칙 4).
// 띄어쓰기로 나눈 낱말이 모두 들어 있어야 맞는다 — "백수약국 4주차"가 '백수약국_10월4주차'에 맞는다. 대소문자·앞의 @는 무시.
export interface SearchFields { influencerHandle: string | null; campaignName: string | null; clientName: string | null }

const norm = (s: string) => s.normalize('NFC').toLowerCase();

export function searchTokens(q: string): string[] {
  return norm(q).split(/\s+/).map((t) => t.replace(/^@+/, '')).filter(Boolean);
}

export function matchesSearch(r: SearchFields, tokens: readonly string[]): boolean {
  if (!tokens.length) return true;
  const hay = norm([r.influencerHandle ?? '', r.campaignName ?? '', r.clientName ?? ''].join('\n'));
  return tokens.every((t) => hay.includes(t));
}
