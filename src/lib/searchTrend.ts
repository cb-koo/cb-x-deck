// 검색 트렌드 판정 — 월별 검색량(키워드 플래너, 구간 반올림값)으로 수요의 크기·방향·계절을 정한다. 스펙 2026-10-13 §4
// 라벨은 이 파일의 파생값 하나에서만 나온다(UX 원칙 4) — 화면이 따로 계산하지 않는다.

export type TrendState = 'surge' | 'up' | 'flat' | 'down' | 'peaked' | 'low' | 'nodata';

export const STATE_LABEL: Record<TrendState, string> = {
  surge: '급상승', up: '상승', flat: '보합', down: '하락', peaked: '하락 전환', low: '소량', nodata: '데이터 없음',
};

export interface TrendSummary {
  state: TrendState;
  now: number | null;         // 최근 3개월 평균
  yearAgo: number | null;     // 1년 전 같은 3개월 평균
  twoYearsAgo: number | null; // 2년 전 같은 3개월 평균
  change: number | null;      // now / yearAgo − 1 (수요 적음·1년 전 0이면 null)
  peak12: number | null;      // 지난 12개월 최고치
  seasonMonth: number | null; // 매년 많이 찾는 달(1~12)
}

// 판정 문턱 — 반올림 단계 하나가 약 20%라 ±30% 안쪽은 잡음으로 본다(스펙 §2-2)
const LOW = 100;
const MOVE = 0.3;
const SURGE = 1.0;
const SURGE_MIN = 1000;
const PEAKED_GROWTH = 0.5;
const PEAKED_DROP = 0.7;
const NEW_RATIO = 20;
const SEASON_RATIO = 1.5;

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// values = 오래된 달 → 최근 달. months = 같은 길이의 'YYYY-MM'.
export function summarize(values: number[] | null, months: string[]): TrendSummary {
  const empty: TrendSummary = { state: 'nodata', now: null, yearAgo: null, twoYearsAgo: null, change: null, peak12: null, seasonMonth: null };
  if (!values || values.length < 15) return empty;
  const n = values.length;
  const now = avg(values.slice(n - 3));
  const yearAgo = avg(values.slice(n - 15, n - 12));
  const twoYearsAgo = n >= 27 ? avg(values.slice(n - 27, n - 24)) : null;
  const last12 = values.slice(n - 12);
  const peak12 = Math.max(...last12);
  // 하락 전환의 고점은 3개월 평균의 최고치 — 단월 튐(울쎄라 25,780~46,880 출렁임)을 고점으로 삼지 않는다.
  // 그 고점이 지금(최근 3개월 창)보다 앞이어야 꺾인 것 — 지난달까지 오르는 중이면 아님(10-13 엠페이스 오판 수정).
  let peakRoll = 0, peakAt = -1;
  for (let i = n - 12; i < n; i++) { const r = avg(values.slice(i - 2, i + 1)); if (r >= peakRoll) { peakRoll = r; peakAt = i; } }
  const peakBeforeRecent = peakAt < n - 1;
  const seasonMonth = season(values, months);
  const base = { now, yearAgo, twoYearsAgo, peak12, seasonMonth };
  if (now < LOW) return { ...base, state: 'low', change: null };
  // 1년 전이 소량(월 100 미만)이거나 지금이 1년 전의 20배 이상이면 변화율은 의미가 없다(리투오 137 → 12,473 = +9,000%)
  // — '신규'로 본다(change = null)
  const change = yearAgo >= LOW && now / yearAgo < NEW_RATIO ? now / yearAgo - 1 : null;
  // 하락 전환은 지금 내려가는 중일 때만(최근 3개월 < 직전 3개월) — 출렁이는 시술(울쎄라)이 지난 고점 대비만으로 하락 전환이 되지 않게
  if (twoYearsAgo !== null && twoYearsAgo > 0 && now / twoYearsAgo - 1 >= PEAKED_GROWTH && peakBeforeRecent && now <= peakRoll * PEAKED_DROP && now < avg(values.slice(n - 6, n - 3))) {
    return { ...base, state: 'peaked', change };
  }
  if (change === null) return { ...base, state: now >= SURGE_MIN ? 'surge' : 'up', change };  // 1년 전 소량 → 신규 수요
  if (change >= SURGE && now >= SURGE_MIN) return { ...base, state: 'surge', change };
  if (change >= MOVE) return { ...base, state: 'up', change };
  if (change <= -MOVE) return { ...base, state: 'down', change };
  return { ...base, state: 'flat', change };
}

// 계절 — 최근 12개월 묶음 3개 중 2개 이상에서 같은 달(±1)이 정점이고, 정점이 그 해 평균의 1.5배 이상이면 그 달.
// 추세가 강한 해는 뺀다(꾸준히 오르는 시술은 매년 마지막 달이 정점이 되어 계절처럼 보인다).
export function season(values: number[], months: string[]): number | null {
  const peaks: number[] = [];
  for (let k = 0; k < 3; k++) {
    const end = values.length - 12 * k;
    const start = end - 12;
    if (start < 0) break;
    const win = values.slice(start, end);
    const a = avg(win);
    if (a < LOW) continue;
    // 그 해 평균이 전년 평균의 1.5배 초과·2/3 미만이면 추세가 강한 해 — 정점이 계절이 아니라 추세라 빼고 본다.
    // (해 안의 앞뒤 비교는 여름 시술의 여름 정점까지 추세로 오인해 쓰지 않는다)
    if (start >= 12) {
      const prevAvg = avg(values.slice(start - 12, start));
      if (prevAvg > 0 && (a / prevAvg > 1.5 || a / prevAvg < 2 / 3)) continue;
    }
    let best = 0;
    for (let i = 1; i < 12; i++) if (win[i] > win[best]) best = i;
    if (win[best] >= a * SEASON_RATIO) peaks.push(Number(months[start + best].slice(5, 7)));
  }
  const near = (a: number, b: number) => Math.min(Math.abs(a - b), 12 - Math.abs(a - b)) <= 1;
  for (const p of peaks) if (peaks.filter((q) => near(p, q)).length >= 2) return p;
  return null;
}

const NUM = new Intl.NumberFormat('ko-KR');
export const fmtVolume = (v: number | null) => (v === null ? '—' : NUM.format(Math.round(v)));
export const fmtChange = (c: number | null) => (c === null ? '신규' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${NUM.format(Math.round(Math.abs(c) * 100))}%`);

// 숫자 뒤 조사 '로/으로' — 끝 발음이 받침(ㄹ 제외)이면 '으로': 0(십·백·천·만)·3(삼)·6(육)
const ro = (v: number | null) => { const d = Math.round(v ?? 0) % 10; return d === 0 || d === 3 || d === 6 ? '으로' : '로'; };

// 판정 문장 — 숫자에 해석을 붙인다(UX 원칙 3). 화면의 상세 머리와 같은 말.
export function describe(s: TrendSummary): string {
  const seasonText = s.seasonMonth ? ` 해마다 ${s.seasonMonth}월 무렵에 많이 찾아요.` : '';
  switch (s.state) {
    case 'nodata': return '키워드 플래너가 이 검색어의 검색량을 주지 않아요. 검색어 표기를 바꿔 볼 만해요.';
    case 'low': return `한 달에 ${fmtVolume(s.now)}번 정도로 찾는 사람이 아직 적어요. 숫자가 작아 변화율은 보지 않아요.`;
    case 'peaked': return `2년 전 ${fmtVolume(s.twoYearsAgo)}에서 크게 올랐다가, 지금은 최근 1년 최고치(${fmtVolume(s.peak12)})보다 낮은 ${fmtVolume(s.now)}${ro(s.now)} 내려오는 중이에요.${seasonText}`;
  }
  const from = `1년 새 ${fmtVolume(s.yearAgo)} → ${fmtVolume(s.now)}`;
  switch (s.state) {
    case 'surge': return s.change === null ? `1년 전엔 거의 찾지 않던 검색어인데, 지금은 한 달에 ${fmtVolume(s.now)}번 찾아요.${seasonText}` : `${from}${ro(s.now)} 크게 늘었어요(${fmtChange(s.change)}).${seasonText}`;
    case 'up': return `${from}${ro(s.now)} 늘고 있어요(${fmtChange(s.change)}).${seasonText}`;
    case 'down': return `${from}${ro(s.now)} 줄고 있어요(${fmtChange(s.change)}).${seasonText}`;
    default: return `${from}, 큰 변화 없이 유지돼요(${fmtChange(s.change)}).${seasonText}`;
  }
}

// 정렬용 — '변화 큰 순'은 늘어난 쪽부터. 수요 적음·데이터 없음은 늘 아래.
export function changeRank(s: TrendSummary): number {
  if (s.state === 'nodata') return -Infinity;
  if (s.state === 'low') return -1e9;
  if (s.change === null) return 1e9;
  return s.change;
}
