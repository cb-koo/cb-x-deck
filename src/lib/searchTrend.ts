// 검색 트렌드 판정 — 월별 검색량(키워드 플래너, 구간 반올림값)으로 수요의 크기·방향·계절을 정한다. 스펙 2026-10-13 §4
// 라벨은 이 파일의 파생값 하나에서만 나온다(UX 원칙 4) — 화면이 따로 계산하지 않는다.
//
// 태그 = 지금 방향(10-14 koo: "태그는 최근 추세"). 1년 전 대비는 늦게 따라와 오른 뒤 멈춘 시술(세르프)이 1년 내내 '상승'이었다.
// 그래서 태그는 **계절을 지운 최근 3개월 vs 직전 3개월**로 정하고, 1년 전 대비는 문장·열의 맥락으로만 쓴다.
// 백테스트(256개 × 15개월): 최근 6개월 그래프 모양과 일치 — 1년 전 대비 72% · 계절 보정 3v3 90% · 6개월 견고 기울기 76~89%.

export type TrendState = 'surge' | 'up' | 'flat' | 'down' | 'peaked' | 'spiked' | 'low' | 'nodata';

export const STATE_LABEL: Record<TrendState, string> = {
  surge: '급상승', up: '상승', flat: '보합', down: '하락', peaked: '하락 전환', spiked: '일시 급등', low: '소량', nodata: '데이터 없음',
};

export interface TrendSummary {
  state: TrendState;
  now: number | null;         // 최근 3개월 평균(원래 값)
  yearAgo: number | null;     // 1년 전 같은 3개월 평균
  change: number | null;      // 1년 전 대비 now / yearAgo − 1 — 맥락용(1년 전 소량이면 null = 신규)
  recent: number | null;      // 태그의 근거 — 최근 3개월 ÷ 직전 3개월 − 1(계절 보정·한 달 튐 제외)
  seasonal: boolean;          // 계절 보정을 했는지(계절 차이가 뚜렷할 때만)
  seasonMonth: number | null; // 매년 많이 찾는 달(1~12)
  lowMonth: number | null;    // 매년 적게 찾는 달(1~12)
  peak6: number | null;       // 최근 6개월 최고치(꺾임 문장의 고점)
  last: number | null;        // 지난달 값
  jump: number | null;        // 지난달 하나만 크게 움직임(앞 3개월 평균 대비 ±50% 이상) — 아직 추세로 볼 수 없어 태그는 두고 문장에 알린다
  steady: [number, number] | null;  // 최근 4개월이 고른 범위(최저·최고, 원래 값) — 이 이유로 보합이면 문장도 이 범위로
  spike: { month: string; value: number; base: number } | null;  // 일시 급등한 달 · 그 값 · 급등 전 평소(앞 6개월 중간값)
}

// 판정 문턱
const LOW = 100;          // 월 100 미만은 소량 — 반올림 한 칸이 수십 %
const MOVE = 0.2;         // 3개월 평균끼리 ±20% 안쪽은 보합(한 달 반올림 ±20%가 3개월 평균에선 약 ±12%)
const SURGE = 0.5;        // +50% 이상이고
const SURGE_MIN = 300;    // 월 300 이상이면 급상승
const GREW = 0.3;         // 1년 전보다 30% 이상 많은 채로 꺾이면 하락이 아니라 하락 전환
const NEW_RATIO = 20;     // 1년 새 20배 이상이면 변화율 대신 신규
const TURN_DROP = 0.6;    // 지난달이 최근 고점의 60% 이하면 꺾인 것
const SPIKE_RATIO = 2.5;  // 앞 6개월 중간값의 2.5배 이상인 달이 바로 다음 달 꺾이면 한 달 튐
const STABLE = 1.25;      // 최근 4개월 최고/최저가 이 안이면 지금은 제자리
const SEASON_STRENGTH = 1.5;  // 계절 지수 최고/최저가 1.5배 이상이고
const SEASON_HI = 1.2, SEASON_LO = 0.85;  // 그 달이 해마다(모든 해) 평소의 1.2배 이상·0.85배 이하일 때만 계절로 본다 — 한 해 우연을 계절로 착각하지 않게

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const monthOf = (ym: string) => Number(ym.slice(5, 7)) - 1;

// 계절 지수 — 고전적 분해: 각 달 값 ÷ 중심 12개월 이동평균, 달력 월별 중간값(해마다 2개 이상). 추세는 이동평균이 흡수한다.
// 많은 달·적은 달이 해마다 반복될 때만 계절로 인정한다(느슨하면 256개 중 117개가 '계절'이 돼 5월 많음·4월 적음 같은 잡음이 나왔다).
export function seasonalFactors(values: number[], months: string[]): { f: number[]; peak: number | null; low: number | null } | null {
  const ratios: number[][] = Array.from({ length: 12 }, () => []);
  for (let i = 6; i < values.length - 6; i++) {
    const cma = (avg(values.slice(i - 6, i + 6)) + avg(values.slice(i - 5, i + 7))) / 2;
    if (cma >= LOW) ratios[monthOf(months[i])].push(values[i] / cma);
  }
  if (ratios.some((r) => r.length < 2)) return null;
  const f = ratios.map(median);
  const mean = avg(f);
  const norm = f.map((x) => x / mean);
  const hi = norm.indexOf(Math.max(...norm)), lo = norm.indexOf(Math.min(...norm));
  const peak = Math.min(...ratios[hi]) / mean >= SEASON_HI ? hi : null;
  const low = Math.max(...ratios[lo]) / mean <= SEASON_LO ? lo : null;
  if (norm[hi] / Math.max(norm[lo], 1e-9) < SEASON_STRENGTH || (peak === null && low === null)) return null;
  return { f: norm, peak, low };
}

// 한 달만 튄 값 — 앞 6개월 중간값의 2.5배 이상이고 다음 달 60% 이하로 꺾인 달. 판정 계산에서만 눌러 쓴다(그래프는 원래 값).
function capSpikes(x: number[]): number[] {
  const y = [...x];
  for (let i = 6; i < y.length - 1; i++) {
    const before = median(y.slice(i - 6, i));
    if (before > 0 && y[i] >= before * SPIKE_RATIO && y[i + 1] <= y[i] * TURN_DROP) y[i] = Math.max(before, y[i + 1]);
  }
  return y;
}

// values = 오래된 달 → 최근 달. months = 같은 길이의 'YYYY-MM'.
export function summarize(values: number[] | null, months: string[]): TrendSummary {
  const empty: TrendSummary = { state: 'nodata', now: null, yearAgo: null, change: null, recent: null, seasonal: false, seasonMonth: null, lowMonth: null, peak6: null, last: null, jump: null, steady: null, spike: null };
  if (!values || values.length < 15) return empty;
  const n = values.length;
  const now = avg(values.slice(n - 3));
  const yearAgo = avg(values.slice(n - 15, n - 12));
  const last = values[n - 1];
  const peak6 = Math.max(...values.slice(n - 6));
  const sf = seasonalFactors(values, months);
  const f = sf?.f ?? null;
  // 1년 전이 소량(월 100 미만)이거나 지금이 20배 이상이면 변화율은 의미가 없다(리투오 137 → 12,473) — 신규(null)
  const change = yearAgo >= LOW && now / yearAgo < NEW_RATIO ? now / yearAgo - 1 : null;
  const prior3 = avg(values.slice(n - 4, n - 1));
  const jumpRaw = prior3 > 0 ? last / prior3 - 1 : 0;
  const jump = Math.abs(jumpRaw) >= 0.5 && !f ? jumpRaw : null;
  const base = { now, yearAgo, change, jump, seasonal: !!f, seasonMonth: sf?.peak != null ? sf.peak + 1 : null, lowMonth: sf?.low != null ? sf.low + 1 : null, peak6, last, steady: null, spike: null };
  if (now < LOW) return { ...base, state: 'low', recent: null };

  // 지금 방향 — 계절을 지우고(여름에 늘 줄어드는 홍조가 매년 여름 '하락'이 되지 않게), 한 달 튐을 누른 뒤 3개월끼리 비교
  const adj = capSpikes(f ? values.map((v, i) => v / f[monthOf(months[i])]) : values);
  const prev3 = avg(adj.slice(n - 6, n - 3));
  // 화면에 보이는 반올림 값으로 판정한다 — −19.9%가 '−20%'로 보이며 보합이 되지 않게(UX 원칙 4)
  const recent = prev3 > 0 ? Math.round((avg(adj.slice(n - 3)) / prev3 - 1) * 100) / 100 : null;

  // 한 달 튐 뒤 꺾임 — 최근 두 달 앞의 고점이 튄 달이고 지난달 60% 이하로 내려왔으면(10-14 네오빔: 150 → 1,320 → 470)
  const at = values[n - 3] >= values[n - 2] ? n - 3 : n - 2;
  const before = median(values.slice(at - 6, at));
  if (before > 0 && values[at] >= before * SPIKE_RATIO && last <= values[at] * TURN_DROP) {
    return { ...base, state: 'spiked', recent, spike: { month: months[at], value: values[at], base: before } };
  }
  // 최근 4개월이 고르면(최고/최저 1.25배 이내) 보합 — 5~6개월 전에 한 번 내려앉고 그 뒤 제자리인 시술(필러 5,490 → 3,200대)이
  // 3개월 평균 비교에선 '하락'으로 남지 않게. 백테스트에서 6개월 모양 일치는 그대로(89~90%), 최근 4개월 모양 일치 71 → 72%.
  const l4 = adj.slice(n - 4);
  if (Math.min(...l4) > 0 && Math.max(...l4) / Math.min(...l4) <= STABLE) {
    const raw4 = values.slice(n - 4);
    return { ...base, state: 'flat', recent, steady: [Math.min(...raw4), Math.max(...raw4)] };
  }
  // 태그는 지금 방향만으로 — 신규(1년 전 소량)도 태그가 아니라 문장·1년 열에서 알린다(리투오: 신규지만 최근 3개월은 +18%로 제자리)
  if (recent === null) return { ...base, state: 'flat', recent };
  // 3개월 평균은 올랐어도 지난달 최근 고점의 60% 이하로 꺾였으면 오름이 아니다(애교필러 330 → 680·690 → 350) — 오르다 꺾임
  if (recent >= MOVE && last <= values[at] * TURN_DROP) return { ...base, state: 'peaked', recent };
  if (recent >= MOVE) return { ...base, state: recent >= SURGE && now >= SURGE_MIN ? 'surge' : 'up', recent };
  if (recent <= -MOVE) return { ...base, state: change === null || change >= GREW ? 'peaked' : 'down', recent };
  return { ...base, state: 'flat', recent };
}

const NUM = new Intl.NumberFormat('ko-KR');
export const fmtVolume = (v: number | null) => (v === null ? '—' : NUM.format(Math.round(v)));
export const fmtChange = (c: number | null) => (c === null ? '신규' : `${c > 0 ? '+' : c < 0 ? '−' : ''}${NUM.format(Math.round(Math.abs(c) * 100))}%`);

// 숫자 뒤 조사 '로/으로' — 끝 발음이 받침(ㄹ 제외)이면 '으로': 0(십·백·천·만)·3(삼)·6(육)
const ro = (v: number | null) => { const d = Math.round(v ?? 0) % 10; return d === 0 || d === 3 || d === 6 ? '으로' : '로'; };

// 2배 이상은 %보다 '배'가 직관적이다(+1,162% → 12.6배)
const times = (c: number) => `${(1 + c).toFixed(1).replace(/\.0$/, '')}배`;
const yearText = (c: number | null) =>
  c === null ? '1년 전엔 거의 없던 새 검색' : c >= 1 ? `1년 전보다 ${times(c)}` : Math.abs(c) < 0.1 ? '1년 전과 비슷' : `1년 전보다 ${Math.round(Math.abs(c) * 100)}% ${c > 0 ? '많음' : '적음'}`;

// 추세 한 줄 — 상세 패널 '추세' 줄. 지금 방향(태그) 먼저, 근거 숫자는 괄호, 1년 흐름·계절은 뒤에 맥락으로.
export function describe(s: TrendSummary): string {
  const season = [s.seasonMonth && `매년 ${s.seasonMonth}월 검색 많음`, s.lowMonth && `${s.lowMonth}월 적음`].filter(Boolean).join(' · ');
  const jump = s.jump !== null && s.state !== 'spiked' && s.state !== 'peaked'
    ? `지난달 월 ${fmtVolume(s.last)}${ro(s.last)} ${s.jump > 0 ? '급증' : '급감'}, 다음 달 확인 필요` : '';
  const tail = (t: string) => [t, jump, season].filter(Boolean).join(' · ');
  const r = s.recent === null ? '' : `직전 3개월보다 ${fmtChange(s.recent)}${s.seasonal ? ', 계절 감안' : ''}`;
  switch (s.state) {
    case 'nodata': return '검색량 데이터 없음 — 검색어 표기 점검 필요';
    case 'low': return `검색 적음(월 ${fmtVolume(s.now)}) — 숫자가 작아 추세는 보지 않음`;
    case 'spiked': return s.spike
      ? tail(`${Number(s.spike.month.slice(5, 7))}월에 한 달만 급등 후 하락 중 (평소 월 ${fmtVolume(s.spike.base)} → ${fmtVolume(s.spike.value)} → 지난달 ${fmtVolume(s.last)}) · ${yearText(s.change)}`)
      : '한 달만 급등 후 하락 중';
    case 'surge': return tail(`최근 3개월 급증 (${r}) · ${yearText(s.change)}`);
    case 'up': return tail(`최근 3개월 증가 (${r}) · ${yearText(s.change)}`);
    case 'peaked': return tail(`오르다 최근 꺾임 (최근 6개월 고점 월 ${fmtVolume(s.peak6)} → 지난달 ${fmtVolume(s.last)}) · ${yearText(s.change)}`);
    case 'down': return tail(`최근 3개월 감소 (${r}) · ${yearText(s.change)}`);
    default: return tail(s.steady
      ? `최근 4개월 제자리 (${s.seasonal ? '계절 감안, ' : ''}월 ${fmtVolume(s.steady[0])}~${fmtVolume(s.steady[1])}) · ${yearText(s.change)}`
      : `최근 3개월 제자리 (${r}) · ${yearText(s.change)}`);
  }
}

// 정렬용 — '변화 큰 순'은 지금 늘어나는 쪽부터(태그와 같은 기준). 소량·데이터 없음은 늘 아래.
export function changeRank(s: TrendSummary): number {
  if (s.state === 'nodata') return -Infinity;
  if (s.state === 'low') return -1e9;
  return s.recent ?? 0;
}
