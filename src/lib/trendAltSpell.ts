import type postgres from 'postgres';
import { norm } from './searchIntent';
import { addMonths, toSeries, matchRows, WINDOW, type KpClient, type KpRow } from './trendCollect';
import { alreadyCounted } from './trendDiscover';

// '값 없음' 시술의 다른 표기(스펙 2026-10-13 §12, koo 10-17) — 키워드 플래너가 시술명 검색량을 주지 않는 시술(エラボトックス·ほくろ除去 등 46개)에
// 같은 뜻인데 값이 나오는 다른 말을 찾아 후보로 올린다. 사람이 [더하기]하면 그 시술 묶음에 검색어로 들어간다(원래 표기는 그대로 — 나중에 값이 나오면 같이 센다).
// 10-17 시험: 띄어쓰기·가나만 바꾼 표기는 같은 묶음이라 똑같이 값 없음(ほくろ除去 = ホクロ除去), 같은 뜻의 다른 말은 값이 나온다
// (ホクロ取り 13,900 · にきび治療 8,100 · 咬筋ボトックス 2,067). 숨겨진 원래 검색량을 되살리는 건 아니라 합계는 여전히 최소치다.

// koo 10-17: 병명은 제외(시술 수요가 아니라 병 정보 검색 — 脂漏性角化症 월 4만이 검버섯을 부풀린다), 피부과가 아닌 수요는 제외(다른 진료과 3/20 이상, 타 진료과 혼재 시술은 아예 찾지 않음)
export const ALT = { perProcedure: 10, minVolume: 50, sameMin: 15, recheckDays: 90, medMax: 2 } as const;
// 병명 판정은 원래 이름과 견준다 — 원래 시술 이름부터 '증상+治療'(ニキビ治療·多汗症治療)면 같은 형태의 다른 표기(にきび治療)는 병명이 아니다.
// 병 이름만 있는 말(脂漏性角化症·扁平疣贅)이나 원래 이름에 치료 말이 없는데 병명이면 뺀다(10-17).
const TREAT = /治療|施術|除去|取り|切除|レーザー|注射|点滴/;
export function altRejected(m: SameMatch | null, alt = '', orig = ''): boolean {
  if (!m || m.same < ALT.sameMin || m.med > ALT.medMax) return true;
  if (m.disease && !(TREAT.test(alt) && TREAT.test(orig))) return true;
  return false;
}

export type AltGenerate = (procs: Array<{ jp: string; kr: string }>) => Promise<Record<string, string[]>>;
// 같은 시술 확인 — 일본 사이트 상위 결과 중 원래 시술 그 자체를 다루는 수(다른 시술·다른 진료과·셀프·무관과 구분)
// med = 다른 진료과(피부과·미용이 아닌 진료) · disease = 검색어가 시술이 아니라 병명·증상 이름(脂漏性角化症·扁平疣贅)
export type SameMatch = { same: number; other: number; med: number; self: number; unrelated: number; total: number; disease: boolean; note: string };
export type SameCheck = (alt: string, orig: string, ko: string) => Promise<SameMatch | null>;

export const ALT_GENERATE_SYSTEM = '일본 미용의료 검색어 전문가. 주어진 시술 검색어와 같은 시술을 가리키는, 일본 사람이 실제로 구글에 치는 다른 말을 만든다. '
  + '같은 뜻의 다른 단어(咬筋·小顔·取り·切除 등)와 한자/가나 바꾸기, 영문 표기, 흔한 별칭을 우선하고, 띄어쓰기만 바꾼 표기는 넣지 않는다. '
  + '다른 시술·더 넓은 말(ボトックス 단독 등)·병명·증상 이름(脂漏性角化症·疣贅·ざ瘡 등 의학 병명 포함)은 넣지 말 것.';

export const SAME_CHECK_SYSTEM = '일본 사이트 이미지 검색 상위 결과의 출처·제목을 보고 각 결과가 기준 시술과 같은 시술을 다루는지 분류한다. '
  + 'same = 피부과·미용의료에서 기준 시술 그 자체(같은 시술의 다른 이름 포함) · other_procedure = 다른 미용 시술 · '
  + 'other_department = 피부과·미용이 아닌 진료(치과 이갈이·암 치료·안과·내과 등, 같은 주사·같은 기법이라도 목적이 다르면 여기) · '
  + 'self = 화장품·셀프케어·가정용 · unrelated = 의료·미용과 무관 · unclear. '
  + '그리고 검색어 자체가 시술 이름인지(procedure), 병명·증상 이름인지(disease — 脂漏性角化症·扁平疣贅·尋常性ざ瘡처럼 병 이름이 중심이면 뒤에 治療·除去가 붙어도 disease)를 판정한다.';

const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;

// 대상 — 시술명 검색량이 값 없음이고 숨기지 않은 시술 중 90일 안에 안 찾아본 것(처음엔 전부)
export async function altTargets(sql: postgres.Sql, market: string, limit: number): Promise<Array<{ id: string; jp: string; kr: string; name: string }>> {
  return sql<Array<{ id: string; jp: string; kr: string; name: string }>>`
    select p.id, p.jp, p.kr, p.name from trend_procedure p
    join trend_keyword k on k.procedure_id = p.id and k.source = 'name' and k.series is null
    where p.market = ${market} and not p.hidden and (p.serp is null or coalesce((p.serp->>'unrelated')::int, 0) < 10)  -- 동음이의 시술은 찾지 않는다(타 진료과는 다른 표기마다 따로 거른다)
      and (p.alt_checked_at is null or p.alt_checked_at < now() - make_interval(days => ${ALT.recheckDays}))
    order by p.alt_checked_at nulls first, p.id limit ${limit}`;
}

export async function runAltSpell(sql: postgres.Sql, kp: KpClient, market: string, latest: string, generate: AltGenerate, sameCheck: SameCheck,
  opts: { limit?: number; left?: () => number } = {}): Promise<{ procedures: number; tried: number; withData: number; kept: number }> {
  const left = opts.left ?? (() => Infinity);
  const targets = await altTargets(sql, market, opts.limit ?? 50);
  if (!targets.length) return { procedures: 0, tried: 0, withData: 0, kept: 0 };
  const from = addMonths(latest, -(WINDOW - 1));
  const alts: Record<string, string[]> = {};
  for (let i = 0; i < targets.length; i += 15) Object.assign(alts, await generate(targets.slice(i, i + 15).map((t) => ({ jp: t.jp, kr: t.kr }))));
  const ours = await sql<Array<{ norm: string; series: number[] | null }>>`select norm, series from trend_keyword where market = ${market}`;
  const ourSet = { norms: new Set(ours.map((o) => o.norm)), seriesKeys: new Set(ours.flatMap((o) => (o.series ? [o.series.join(',')] : []))) };
  const pairs = targets.flatMap((t) => (alts[t.jp] ?? []).slice(0, ALT.perProcedure).filter((a) => norm(a) !== norm(t.jp)).map((a) => ({ t, a })));
  const words = [...new Set(pairs.map((p) => p.a))];
  const rows = new Map<string, KpRow>();
  for (let i = 0; i < words.length; i += 1000) for (const [k, v] of matchRows(words.slice(i, i + 1000), await kp.historical(words.slice(i, i + 1000), from, latest))) rows.set(k, v);
  let withData = 0, kept = 0;
  for (const t of targets) {
    if (left() < 30_000) break;
    for (const { a } of pairs.filter((p) => p.t.id === t.id)) {
      const r = rows.get(a);
      const v = toSeries(r, from, latest);
      if (!v || avg3(v, v.length) < ALT.minVolume) continue;
      if (alreadyCounted({ text: r?.text, closeVariants: r?.closeVariants, series: v }, ourSet)) continue;  // 이미 세는 검색
      withData++;
      const m = await sameCheck(a, t.jp, t.kr || t.name).catch(() => null);
      if (altRejected(m, a, t.jp)) continue;  // 같은 시술 15/20 미만·병명·다른 진료과 3개 이상이면 올리지 않는다
      const now = avg3(v, v.length), inc = now - avg3(v, v.length - 12);
      await sql`insert into trend_candidate (market, kind, term, norm, ko, of_procedure_id, texts, volume, increase, found_month, first_month, action, match)
        values (${market}, 'alt', ${a}, ${norm(a)}, ${t.name}, ${t.id}, ${[a]}, ${Math.round(now)}, ${Math.round(inc)}, ${latest}, ${latest}, 'add', ${sql.json(m)})
        on conflict (market, kind, norm) do update set volume = excluded.volume, increase = excluded.increase, match = excluded.match, found_month = excluded.found_month
        where trend_candidate.status = 'open'`;
      ourSet.norms.add(norm(a));  // 같은 표기가 다른 시술 후보로 또 오르지 않게
      kept++;
    }
    await sql`update trend_procedure set alt_checked_at = now() where id = ${t.id}`;
  }
  return { procedures: targets.length, tried: words.length, withData, kept };
}

// 기준이 바뀌면 열린 후보를 다시 확인한다 — 걸리는 것은 '무시'로 돌려 다시 오르지 않게(10-17 병명·피부과 아님 제외)
export async function recheckAltCandidates(sql: postgres.Sql, market: string, sameCheck: SameCheck): Promise<{ checked: number; rejected: string[] }> {
  const rows = await sql<Array<{ id: string; term: string; jp: string; name: string; kr: string }>>`
    select c.id, c.term, p.jp, p.name, p.kr from trend_candidate c join trend_procedure p on p.id = c.of_procedure_id
    where c.market = ${market} and c.kind = 'alt' and (c.status = 'open' or c.decided_by_name like '자동:%')`;  // 자동으로 뺀 것도 다시(기준이 바뀌면 되살린다)
  const rejected: string[] = [];
  for (const r of rows) {
    const m = await sameCheck(r.term, r.jp, r.kr || r.name).catch(() => null);
    if (altRejected(m, r.term, r.jp)) {
      await sql`update trend_candidate set status = 'ignored', decided_at = now(), decided_by_name = '자동: 병명·피부과 아닌 수요 제외', match = ${m ? sql.json(m) : null} where id = ${r.id}`;
      rejected.push(`${r.term}(${!m ? '확인 실패' : m.med > ALT.medMax ? `다른 진료과 ${m.med}` : m.same < ALT.sameMin ? `같은 시술 ${m.same}` : '병명'})`);
    } else await sql`update trend_candidate set status = 'open', decided_at = null, decided_by_name = null, match = ${sql.json(m!)} where id = ${r.id}`;
  }
  return { checked: rows.length, rejected };
}
