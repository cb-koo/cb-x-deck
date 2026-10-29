// 두드러진 관심사 — 그 시술을 검색하는 사람이 전체 시술 평균보다 유난히 많이 찾는 것(koo 10-15, '관심 단계'를 대신함).
// 모든 시술에 같은 수식어 세트를 조회하므로 평균과 견주면 수식어 개수 차이(검토 8개·결정 6개·탐색 2개)가 상쇄된다
// — 단계로 묶으면 절반 이상이 '검토'로 쏠렸다(106/199). 평균 대비 1.3배 이상인 것이 없으면 '고르게'.
// 결론이 곧 콘텐츠 방향이 되게 의도마다 맞는 콘텐츠를 붙인다(UX 원칙 3).
import type { ProfileIntent } from './searchIntent';

export const INTEREST_KEYS = ['info', 'effect', 'worry', 'cost', 'place'] as const;  // 부위·한국은 뺀다(어디에·어디서 받을지는 관심사가 아니라 대상). 횟수·용량은 평균이 3%대로 작아 배수가 쉽게 튀어 뺀다(10-29)
export type InterestKey = typeof INTEREST_KEYS[number];
export const STANDOUT = 1.3;

export const INTEREST_LABEL: Record<InterestKey, string> = { info: '개념·비교', effect: '효과·후기', worry: '부작용·통증', cost: '가격', place: '병원·지역' };
export const INTEREST_CONTENT: Record<InterestKey, string> = {
  info: '시술 설명·다른 시술과 비교', effect: '전후 사진·실제 후기', worry: '통증·다운타임 안심 정보', cost: '가격 안내·이벤트', place: '병원 고르는 기준·위치·예약 안내',
};

export type Shares = Record<InterestKey, number>;
export type Interest = { kind: 'standout'; key: InterestKey; ratio: number; shares: Shares } | { kind: 'even'; shares: Shares } | null;

// 의도 비중(부위·한국 포함)을 다섯 관심사로 다시 100% 나눈다. 수식어 검색이 적어 비중이 없으면(profile null) null.
export function interestShares(profile: Record<ProfileIntent, number> | null): Shares | null {
  if (!profile) return null;
  const t = INTEREST_KEYS.reduce((s, k) => s + (profile[k] ?? 0), 0);
  return t > 0 ? (Object.fromEntries(INTEREST_KEYS.map((k) => [k, profile[k] / t])) as Shares) : null;
}

// 기준 — 비중이 있는 시술들의 평균
export function interestBaseline(all: Array<Shares | null>): Shares {
  const xs = all.filter((s): s is Shares => !!s);
  return Object.fromEntries(INTEREST_KEYS.map((k) => [k, xs.length ? xs.reduce((s, x) => s + x[k], 0) / xs.length : 0])) as Shares;
}

export function interestOf(shares: Shares | null, base: Shares): Interest {
  if (!shares) return null;
  const [key, ratio] = INTEREST_KEYS.map((k) => [k, base[k] > 0 ? shares[k] / base[k] : 0] as const).sort((a, b) => b[1] - a[1])[0];
  return ratio >= STANDOUT ? { kind: 'standout', key, ratio, shares } : { kind: 'even', shares };
}
