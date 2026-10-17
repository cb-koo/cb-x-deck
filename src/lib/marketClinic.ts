// 클리닉 지도 — 계산(DB·네트워크 없음). 스펙 docs/superpowers/specs/2026-10-17-clinic-map-design.md §3·§5
// 수집한 병원·달별 매출에서 파생 지표(구 안 순위·매출 백분위·시그널·기회 점수)를 만들고, 화면이 받을 완성본을 줄여 담는다.
// 규칙은 프로토타입(~/orca/projects/clinic-map scripts/build-data.mjs)과 같다.

export const DEPARTMENTS = ['피부과', '치과', '성형외과'] as const;
export type Department = (typeof DEPARTMENTS)[number];

// 병원 기본 정보(market_clinic 한 줄) — 수집이 덮어쓴다
export interface MarketClinicBase {
  id: string; dept: string; name: string; address: string; sido: string; gu: string;
  sggCode: string | null; dongCode: string | null; dong: string | null;
  lat: number | null; lng: number | null; areaM2: number | null; openedOn: string | null;
  doctors: number; specialists: number; departments: string | null;
  brand: string; branches: number; isChain: boolean; registered: boolean; countries: string[];
}

// 한 달 매출(market_clinic_month 한 줄)
export interface MarketMonth {
  month: string; sales: number | null; salesDomestic: number | null; salesForeign: number | null;
  foreignPct: number | null; visits: number | null; visitsForeign: number | null; foreignArpu: number | null;
  salesPerDoctor: number | null; salesPerArea: number | null; estimateType: string | null;
}

export interface Derived {
  growth: number | null;          // 전월 대비 %(소수 1자리)
  guRank: number | null; guCount: number | null;
  salesPctl: number | null;       // 진료과 안 매출 백분위 0~1
  effGap: number | null;          // ㎡당 매출 ÷ 같은 구 중앙값
  sigUnderused: boolean;          // 유치기관 등록 · 외국인 비중 15% 미만 · 매출 백분위 30% 이상
  sigDomesticStrong: boolean;     // 매출 상위 20% · 외국인 비중 15% 미만
  score: number | null;           // 기회 점수 0~100
  isNew: boolean;                 // 개원 1년 이내
}

const round = (v: number | null | undefined, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
export function percentileRank(sorted: number[], v: number | null): number | null {
  if (v == null || !sorted.length) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return lo / sorted.length;
}
function median(arr: Array<number | null>): number | null {
  const s = arr.filter((v): v is number => v != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
}

// 외국인 비중 기준 — 시그널과 화면 설명이 같은 숫자를 쓴다
export const FOREIGN_LOW_PCT = 15;
export const SCORE_WEIGHTS = { size: 0.4, room: 0.25, growth: 0.2, registered: 0.15 } as const;

/**
 * 한 진료과의 병원들로 파생 지표를 만든다(진료과 안에서 비교). latest = 병원별 마지막 달 매출, prev = 그 전 달.
 * today는 신규 개원(1년) 판정 기준일.
 */
export function deriveDepartment(
  rows: Array<{ base: MarketClinicBase; latest: MarketMonth | null; prev: MarketMonth | null }>,
  today: Date,
): Map<string, Derived> {
  const growthOf = (r: (typeof rows)[number]) =>
    r.latest?.sales != null && r.prev?.sales ? round((r.latest.sales / r.prev.sales - 1) * 100, 1) : null;
  const withSales = rows.filter((r) => r.latest?.sales);
  const groupKey = (b: MarketClinicBase) => b.sggCode ?? `${b.sido} ${b.gu}`;

  // 같은 구 안 매출 순위 · ㎡당 매출 중앙값
  const rank = new Map<string, { rank: number; count: number }>();
  const groupMedianSpa = new Map<string, number | null>();
  const groups = new Map<string, typeof withSales>();
  for (const r of withSales) {
    const k = groupKey(r.base);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  for (const [k, list] of groups) {
    list.sort((a, b) => b.latest!.sales! - a.latest!.sales!);
    list.forEach((r, i) => rank.set(r.base.id, { rank: i + 1, count: list.length }));
    groupMedianSpa.set(k, median(list.map((r) => r.latest!.salesPerArea)));
  }

  const salesSorted = withSales.map((r) => r.latest!.sales!).sort((a, b) => a - b);
  const growths = new Map(rows.map((r) => [r.base.id, growthOf(r)]));
  const growthSorted = [...growths.values()].filter((v): v is number => v != null).sort((a, b) => a - b);
  // 외국인 매출 구분이 하나도 없는 진료과(치과 일부 등)는 외국인 시그널을 내지 않는다
  const hasForeign = rows.some((r) => r.latest?.foreignPct != null);

  const out = new Map<string, Derived>();
  for (const r of rows) {
    const L = r.latest;
    const salesPctl = round(percentileRank(salesSorted, L?.sales ?? null), 3);
    const spaMedian = groupMedianSpa.get(groupKey(r.base)) ?? null;
    const fp = L?.foreignPct ?? null;
    const growth = growths.get(r.base.id) ?? null;
    const opened = r.base.openedOn ? new Date(r.base.openedOn) : null;
    let score: number | null = null;
    if (L?.sales) {
      const room = fp == null ? 0.5 : 1 - Math.min(fp, 100) / 100;
      const grow = growth == null ? 0.5 : percentileRank(growthSorted, growth)!;
      score = Math.round(100 * (SCORE_WEIGHTS.size * (salesPctl ?? 0) + SCORE_WEIGHTS.room * room
        + SCORE_WEIGHTS.registered * (r.base.registered ? 1 : 0) + SCORE_WEIGHTS.growth * grow));
    }
    out.set(r.base.id, {
      growth,
      guRank: rank.get(r.base.id)?.rank ?? null,
      guCount: rank.get(r.base.id)?.count ?? null,
      salesPctl,
      effGap: spaMedian && L?.salesPerArea ? round(L.salesPerArea / spaMedian, 2) : null,
      sigUnderused: hasForeign && r.base.registered && fp != null && fp < FOREIGN_LOW_PCT && (salesPctl ?? 0) >= 0.3,
      sigDomesticStrong: hasForeign && (salesPctl ?? 0) >= 0.8 && fp != null && fp < FOREIGN_LOW_PCT,
      score,
      isNew: opened ? (today.getTime() - opened.getTime()) / 86_400_000 <= 365 : false,
    });
  }
  return out;
}

// ── 화면이 받는 완성본 — 진료과마다 한 문서(피부과 약 2.3MB, 압축하면 0.7MB). 칸 이름을 줄마다 반복하지 않게 열로 담는다.
// 함수 응답 크기 한도(4.5MB) 안에 들도록 화면에 안 쓰는 칸(진료과목 원문·추정 방식 원문)은 뺐다.
export const VIEW_COLS = [
  'id', 'name', 'address', 'sido', 'gu', 'sgg', 'dong', 'dongCode', 'lat', 'lng', 'area', 'openedAt', 'isNew',
  'doctors', 'specialists', 'brand', 'branches', 'chain', 'registered', 'countries', 'month',
  'sales', 'salesDomestic', 'salesForeign', 'foreignPct', 'visits', 'visitsForeign', 'foreignArpu', 'salesPerDoctor', 'salesPerArea',
  'exact', 'growth', 'guRank', 'guCount', 'salesPctl', 'effGap', 'sigUnderused', 'sigDomesticStrong', 'score', 'series',
] as const;
export type ViewCol = (typeof VIEW_COLS)[number];

export interface SeriesPoint { m: string; sales: number | null; domestic: number | null; foreign: number | null }
// 화면 쪽 병원 한 곳(열을 풀어 놓은 모양)
export interface ViewClinic {
  id: string; name: string; address: string; sido: string; gu: string; sgg: string | null; dong: string | null; dongCode: string | null;
  lat: number | null; lng: number | null; area: number | null; openedAt: string | null; isNew: boolean;
  doctors: number; specialists: number; brand: string; branches: number; chain: boolean; registered: boolean; countries: string[];
  month: string | null; sales: number | null; salesDomestic: number | null; salesForeign: number | null; foreignPct: number | null;
  visits: number | null; visitsForeign: number | null; foreignArpu: number | null; salesPerDoctor: number | null; salesPerArea: number | null;
  exact: boolean; growth: number | null; guRank: number | null; guCount: number | null; salesPctl: number | null; effGap: number | null;
  sigUnderused: boolean; sigDomesticStrong: boolean; score: number | null; series: SeriesPoint[];
}
export interface ViewDoc { dept: string; months: string[]; generatedAt: string; cols: readonly string[]; rows: unknown[][] }

const shortAddress = (a: string) => a.replace(/\s*\(.*$/, ''); // "(서초동)" 같은 괄호 꼬리
const r5 = (v: number | null) => (v == null ? null : Math.round(v * 1e5) / 1e5);

export function buildViewDoc(
  dept: string, months: string[], generatedAt: string,
  rows: Array<{ base: MarketClinicBase; series: MarketMonth[]; derived: Derived }>,
): ViewDoc {
  const out: unknown[][] = [];
  for (const { base: b, series, derived: d } of rows) {
    const byMonth = new Map(series.map((s) => [s.month, s]));
    const have = months.filter((m) => byMonth.get(m)?.sales);
    const L = have.length ? byMonth.get(have.at(-1)!)! : null;
    const v: Record<ViewCol, unknown> = {
      id: b.id, name: b.name, address: shortAddress(b.address), sido: b.sido, gu: b.gu, sgg: b.sggCode, dong: b.dong, dongCode: b.dongCode,
      lat: r5(b.lat), lng: r5(b.lng), area: b.areaM2, openedAt: b.openedOn, isNew: d.isNew,
      doctors: b.doctors, specialists: b.specialists, brand: b.brand, branches: b.branches, chain: b.isChain, registered: b.registered, countries: b.countries,
      month: L?.month ?? null, sales: L?.sales ?? null, salesDomestic: L?.salesDomestic ?? null, salesForeign: L?.salesForeign ?? null,
      foreignPct: L?.foreignPct ?? null, visits: L?.visits ?? null, visitsForeign: L?.visitsForeign ?? null,
      // 외국인 방문 30건 미만이면 객단가가 들쭉날쭉해서 숨긴다
      foreignArpu: (L?.visitsForeign ?? 0) >= 30 ? L!.foreignArpu : null,
      salesPerDoctor: L?.salesPerDoctor ?? null, salesPerArea: L?.salesPerArea ?? null,
      exact: (L?.estimateType ?? '').startsWith('정확값'),
      growth: d.growth, guRank: d.guRank, guCount: d.guCount, salesPctl: d.salesPctl, effGap: d.effGap,
      sigUnderused: d.sigUnderused, sigDomesticStrong: d.sigDomesticStrong, score: d.score,
      series: months.map((m) => { const s = byMonth.get(m); return [s?.sales ?? null, s?.salesDomestic ?? null, s?.salesForeign ?? null]; }),
    };
    out.push(VIEW_COLS.map((c) => v[c]));
  }
  return { dept, months, generatedAt, cols: VIEW_COLS, rows: out };
}

export function decodeViewDoc(doc: ViewDoc): ViewClinic[] {
  const idx = Object.fromEntries(doc.cols.map((c, i) => [c, i])) as Record<ViewCol, number>;
  return doc.rows.map((r) => {
    const o = {} as Record<string, unknown>;
    for (const c of VIEW_COLS) o[c] = r[idx[c]];
    o.series = (r[idx.series] as Array<[number | null, number | null, number | null]>).map(([sales, domestic, foreign], i) => ({ m: doc.months[i], sales, domestic, foreign }));
    return o as unknown as ViewClinic;
  });
}

// ── 영업 상태(monthly-report) — 서비스 중 = 월간 리포트가 있는 고객 · 리포트 준비 = 고객 등록만 · 제안서 발송 = 제안서가 있는 리드
export type CrmStatus = 'client' | 'onboarding' | 'lead';
export interface CrmInfo {
  status: CrmStatus; crmName: string; branch: string | null;
  reports?: number; lastMonth?: string | null;
  proposals?: number; views?: number;
}
export function crmStatusOf(x: { kind: 'clinic'; reports: number } | { kind: 'lead'; proposals: number; converted: boolean }): CrmStatus | null {
  if (x.kind === 'clinic') return x.reports > 0 ? 'client' : 'onboarding';
  if (x.converted) return null; // 계약으로 넘어간 리드는 고객 쪽에서 센다
  return x.proposals > 0 ? 'lead' : null;
}
