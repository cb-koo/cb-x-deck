// 검색 트렌드 완성본 만들기 — 시술·검색어(월별 검색량)를 받아 화면이 읽는 문서를 만든다. 스펙 2026-10-13 §0·§7
// 순수 함수(DB 없음): 수집이 끝날 때·시술을 고칠 때 trendStore가 불러 trend_view에 저장한다.
// 태그·묶음·성격 계산은 searchIntent, 분류는 procedureTaxonomy가 정한다 — 여기선 엮기만 한다.
import { classify } from './procedureTaxonomy';
import { tagKeyword, ambiguous, aggregate, profile, stage, norm, type KeywordSeries, type Intent, type ProfileIntent, type Stage } from './searchIntent';

export interface TrendSerp { derm: number; med: number; self: number; unrelated: number; note: string }

export interface TrendProcedureInput {
  id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string;
  hidden?: boolean; serp?: TrendSerp | null;
}

export interface TrendKeywordInput {
  text: string;
  procedureId: string | null;
  source: 'name' | 'template' | 'idea' | 'korea';
  ko?: string | null;
  intentOverride?: Intent | null;
  series: number[] | null;  // months와 같은 길이(맞지 않거나 null이면 값 없음)
}

export interface TrendIntentInfo {
  total: number[]; korea: number[]; noName: number[];
  profile: Record<ProfileIntent, number> | null; prev: Record<ProfileIntent, number> | null;
  stage: Stage | null; prevStage: Stage | null; ambiguous: boolean; keywords: number;
  top: Partial<Record<ProfileIntent, Array<[string, number, string]>>>;
  adjacent?: number[];                                  // 시술 밖 관심(화장품·홈케어·영양제) 월별 합 — 시술 수요와 따로
  adjacentTop?: Array<[string, number, string]>;        // 그 상위 검색어 3개
  members?: Array<{ id: string; kr: string; jp: string; total: number[] }>;
  serp?: TrendSerp;
}

export interface TrendViewDoc {
  market: string;
  fetchedAt: string;     // 마지막 수집(YYYY-MM-DD)
  months: string[];      // 'YYYY-MM', 오래된 달 → 최근 달
  procedures: Array<{ id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string; volumes: number[] | null }>;
  intent: Record<string, TrendIntentInfo>;  // 묶음 첫 행 id → 묶음 값
}

// 무관한 뜻이 상위 20개 중 이만큼이면 시술명 단독 검색은 동음이의(10-14 검색 결과 확인)
export const SERP_HOMONYM = 10;

// 같은 검색어의 출처 우선순위 — 연관 검색어로 먼저 들어온 것이 주인(수집 순서와 같다)
const SOURCE_ORDER: Record<TrendKeywordInput['source'], number> = { idea: 0, name: 1, korea: 2, template: 3 };

// 화면 표기 — 키워드 플래너가 일본어 사이에 넣은 띄어쓰기를 지운다(リジュラン 効果 → リジュラン効果)
export const showKeyword = (t: string) =>
  t.replace(/(?<=[^\x00-\x7f]) (?=[^\x00-\x7f])/g, '').replace(/(?<=[^\x00-\x7f]) (?=[0-9])|(?<=[0-9]) (?=[^\x00-\x7f])/g, '');

const last12 = (v: number[]) => v.slice(-12).reduce((s, x) => s + x, 0) / 12;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const round = (p: Record<ProfileIntent, number> | null) => p && (Object.fromEntries(Object.entries(p).map(([k, v]) => [k, r3(v)])) as Record<ProfileIntent, number>);

export function buildTrendView(input: {
  market: string; fetchedAt: string; months: string[];
  procedures: TrendProcedureInput[]; keywords: TrendKeywordInput[];
}): TrendViewDoc {
  const { months } = input;
  const n = months.length;
  // 같은 대표 검색어는 한 줄만(시트 중복 행)
  const seenJp = new Set<string>();
  const procs = input.procedures.filter((p) => {
    if (p.hidden) return false;
    const k = norm(p.jp);
    if (seenJp.has(k)) return false;
    seenJp.add(k);
    return true;
  });
  const homonyms = new Set(procs.filter((p) => (p.serp?.unrelated ?? 0) >= SERP_HOMONYM).map((p) => norm(p.jp)));

  // 시술별 검색어 묶음
  const byProc = new Map<string, TrendKeywordInput[]>();
  for (const k of [...input.keywords].sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source])) {
    if (!k.procedureId) continue;
    byProc.set(k.procedureId, [...(byProc.get(k.procedureId) ?? []), k]);
  }
  const lists = new Map<string, Array<KeywordSeries & { ko: string }>>();
  const nameSeries = new Map<string, number[] | null>();
  for (const p of procs) {
    const list: Array<KeywordSeries & { ko: string }> = [];
    for (const k of byProc.get(p.id) ?? []) {
      if (k.source === 'name') nameSeries.set(norm(p.jp), k.series && k.series.length === n ? k.series : null);
      if (!k.series || k.series.length !== n) continue;
      const intent: Intent = k.intentOverride ?? (k.source === 'korea' ? 'korea' : tagKeyword(k.text, [p.jp], homonyms));
      list.push({ text: k.text, intent, values: k.series, ko: k.ko ?? '' });
    }
    lists.set(p.id, list);
  }

  // 묶음 — 같은 분류·같은 시술명(시트의 제품·표기 변형 행: 울쎄라/울쎄라프라임/울쎄라리프트)
  const fams = new Map<string, TrendProcedureInput[]>();
  for (const p of procs) {
    const key = `${classify(p).category}|${p.name}`;
    fams.set(key, [...(fams.get(key) ?? []), p]);
  }
  const intent: Record<string, TrendIntentInfo> = {};
  for (const ms of fams.values()) {
    const list = ms.flatMap((p) => lists.get(p.id) ?? []);
    const a = aggregate(list, n);
    const prof = profile(a);
    const prev = profile(a, 12, n - 12);
    const top: TrendIntentInfo['top'] = {};
    for (const k of [...list].sort((x, y) => last12(y.values) - last12(x.values))) {
      if (k.intent === 'name' || k.intent === 'exclude' || k.intent === 'noise' || k.intent === 'other' || k.intent === 'adjacent') continue;
      const arr = (top[k.intent as ProfileIntent] ??= []);
      const t = showKeyword(k.text);
      if (arr.length < 3 && !arr.some(([x]) => x === t) && last12(k.values) >= 10) arr.push([t, Math.round(last12(k.values)), k.ko]);
    }
    const adjacentTop: Array<[string, number, string]> = [];
    for (const k of [...list].filter((x) => x.intent === 'adjacent').sort((x, y) => last12(y.values) - last12(x.values))) {
      const t = showKeyword(k.text);
      if (adjacentTop.length < 3 && !adjacentTop.some(([x]) => x === t) && last12(k.values) >= 10) adjacentTop.push([t, Math.round(last12(k.values)), k.ko]);
    }
    const first = ms[0];
    const s = first.serp;
    intent[first.id] = {
      total: a.total, korea: a.korea, noName: aggregate(list.filter((k) => k.intent !== 'name'), n).total,
      profile: round(prof), prev: round(prev), stage: stage(prof), prevStage: stage(prev), ambiguous: ambiguous(a),
      keywords: list.length, top, adjacent: a.byIntent.adjacent, adjacentTop,
      members: ms.length > 1 ? ms.map((p) => ({ id: p.id, kr: p.kr, jp: p.jp, total: aggregate(lists.get(p.id) ?? [], n).total })) : undefined,
      serp: s ? { derm: s.derm, med: s.med, self: s.self, unrelated: s.unrelated, note: s.note } : undefined,
    };
  }
  return {
    market: input.market, fetchedAt: input.fetchedAt, months,
    procedures: input.procedures.filter((p) => !p.hidden).map((p) => ({
      id: p.id, major: p.major, majorOrder: p.majorOrder, middle: p.middle, name: p.name, kr: p.kr, jp: p.jp, en: p.en,
      volumes: nameSeries.get(norm(p.jp)) ?? null,  // 시트 중복 행(같은 대표 검색어)도 같은 값
    })),
    intent,
  };
}
