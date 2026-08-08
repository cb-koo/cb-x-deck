// 앱 전체의 날짜·시각 표기. 두 계열로 갈라져 있고 섞으면 하루가 밀린다(설계 §A).
//
//  · instant 계열  — 입력은 timestamptz에서 온 ISO(시각 성분이 있다). 한국 시간으로 옮겨 찍는다.
//  · date-only 계열 — 입력은 'YYYY-MM-DD'. 시간대 시프트를 절대 하지 않는다. 그게 계약이다.
//
// 고정 +9인 이유: 한국은 1988년 이후 서머타임이 없어 Asia/Seoul은 항상 UTC+9다.
// Intl에 맡기면 런타임 시간대 데이터에 의존해 테스트가 환경에 흔들린다.
// (이 판단과 toKstIso 구현은 tableColumns.ts에 있던 것을 그대로 승격했다.)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 파싱 불가한 값에는 빈 문자열을 돌려준다. 표의 셀마다 불리므로 던지면 표 전체 렌더가 죽는다 —
// 셀 하나가 비는 것보다 나쁘다.
function toKstIso(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  return new Date(ms + KST_OFFSET_MS).toISOString();
}

// 'YYYY-MM-DD' 자정(한국)이 실제로 가리키는 순간. UTC 자정보다 9시간 이르다.
function kstMidnightInstant(kstYmd: string): Date {
  return new Date(Date.parse(kstYmd + 'T00:00:00Z') - KST_OFFSET_MS);
}

// ─────────────────────────── instant 계열 ───────────────────────────

/** YYYY-MM-DD (한국). 표의 날짜 칸이 쓴다. */
export function kstDate(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 10);
}

/** YYYY-MM-DD HH:MM (한국). 같은 날 09시와 22시를 구분해야 하는 '최종 수집 시간'이 쓴다. */
export function kstDateTime(iso: string | null): string {
  if (!iso) return '';
  return toKstIso(iso).slice(0, 16).replace('T', ' ');
}

/** '26.07.07 (한국). 값이 없으면 '–' — 카드가 '모름'을 그렇게 표시해 왔다. */
export function kstShort(iso: string | null): string {
  if (!iso) return '–';
  const k = toKstIso(iso);
  if (!k) return '–';
  return `'${k.slice(2, 4)}.${k.slice(5, 7)}.${k.slice(8, 10)}`;
}

/** M/D (한국). */
export function kstMonthDay(iso: string | null): string {
  if (!iso) return '';
  const k = toKstIso(iso);
  if (!k) return '';
  return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
}

/** M월 D일 (한국). */
export function kstMonthDayKo(iso: string | null): string {
  if (!iso) return '';
  const k = toKstIso(iso);
  if (!k) return '';
  return `${Number(k.slice(5, 7))}월 ${Number(k.slice(8, 10))}일`;
}

/**
 * 오늘(한국) YYYY-MM-DD. '오늘'을 UTC로 자르면 한국 새벽 0~9시에 어제가 된다.
 * now는 시계 주입 지점 — 실제 호출부는 인자를 넘기지 않아 기본값(실제 시계)으로 지금까지와 동일하게 동작한다.
 * 테스트만 고정된 시각을 넘겨 그 경계 버그(월말 UTC 15시 등)를 재현한다.
 */
export function kstToday(now: () => number = Date.now): string {
  return toKstIso(new Date(now()).toISOString()).slice(0, 10);
}

/** n일 전(한국) YYYY-MM-DD. */
export function kstDaysAgo(n: number, now: () => number = Date.now): string {
  return toKstIso(new Date(now() - n * 86_400_000).toISOString()).slice(0, 10);
}

/** 오늘 00:00(한국)이 가리키는 순간. SQL 경계로 넘길 때 쓴다. */
export function kstTodayStart(now: () => number = Date.now): Date {
  return kstMidnightInstant(kstToday(now));
}

/** n일 전 00:00(한국)이 가리키는 순간. */
export function kstDaysAgoStart(n: number, now: () => number = Date.now): Date {
  return kstMidnightInstant(kstDaysAgo(n, now));
}

/** 이번 달 1일 00:00(한국)이 가리키는 순간. */
export function kstMonthStart(now: () => number = Date.now): Date {
  return kstMidnightInstant(`${kstToday(now).slice(0, 7)}-01`);
}

/**
 * from~to(둘 다 순간)가 걸치는 한국 달력일을 'YYYY-MM-DD' 오름차순으로 나열한다.
 * usage 일별 차트의 빈칸 채우기(zero-fill)가 쓴다 — "최근 7일"인데 기록 없는 날은
 * 막대가 통째로 빠져 라벨과 막대 수가 어긋나던 문제를, 그 날짜가 무엇인지부터
 * 알아야 고칠 수 있다.
 */
export function kstDayRange(from: Date, to: Date): string[] {
  const start = kstDate(from.toISOString());
  const end = kstDate(to.toISOString());
  const days: string[] = [];
  let cur = start;
  while (cur <= end) {
    days.push(cur);
    // 달력일 문자열의 산술이다 — 시간대 시프트가 아니라 다음 날짜 문자열을 구할 뿐이다.
    const next = new Date(cur + 'T00:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    cur = next.toISOString().slice(0, 10);
  }
  return days;
}

// ─────────────────────────── date-only 계열 ───────────────────────────

// 브랜딩 타입 — instant를 실수로 넘기면 컴파일이 막힌다. 이 작업에서 (C) 사고를 막는
// 유일한 기계적 장치다(나머지는 사람의 주의력에 의존한다).
export type DateOnly = string & { readonly __dateOnly: unique symbol };

/**
 * 'YYYY-MM-DD'임이 확실한 값에만 쓴다 — date 컬럼, 주 시작일, <input type="date">.
 * 브랜딩 타입은 컴파일 타임에만 막는다 — 잘못된 문자열이 런타임에 들어오면 조용히 NaN 섞인
 * 라벨을 만든다. 개발 중에만 경고하고 던지지 않는다 — 잘못된 값 하나가 화면 전체를 죽이면 안 된다.
 */
export function asDateOnly(s: string): DateOnly {
  if (process.env.NODE_ENV !== 'production' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    console.warn(`asDateOnly: 'YYYY-MM-DD'가 아닌 값 — ${s}`);
  }
  return s as DateOnly;
}

/** M/D. 시간대 시프트 없음 — 넣으면 1/1이 12/31이 된다. */
export function dateOnlyMonthDay(d: DateOnly): string {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

/** 주 시작일 → '6/15~21' (월이 바뀌면 '6/29~7/5'). 시간대 시프트 없음. */
export function weekRangeLabel(weekStart: DateOnly): string {
  const s = new Date(weekStart + 'T00:00:00Z');
  const e = new Date(s.getTime() + 6 * 86_400_000);
  const end = s.getUTCMonth() === e.getUTCMonth()
    ? `${e.getUTCDate()}`
    : `${e.getUTCMonth() + 1}/${e.getUTCDate()}`;
  return `${s.getUTCMonth() + 1}/${s.getUTCDate()}~${end}`;
}
