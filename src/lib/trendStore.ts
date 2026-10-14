import type postgres from 'postgres';
import { buildTrendView, type TrendProcedureInput, type TrendKeywordInput, type TrendSerp, type TrendViewDoc } from './trendBuild';
import { norm, ownerOf, tagKeyword, type Intent } from './searchIntent';
import { SERP_HOMONYM } from './trendBuild';

// 검색 트렌드 저장(074) — 시술·검색어를 쓰고, 화면이 읽는 완성본(trend_view)을 다시 만든다.
// 계산은 trendBuild(순수 함수)가 하고 이 모듈은 읽고 쓰기만 한다.

export interface ProcedureWrite extends TrendProcedureInput {
  market?: string;
  sheet?: Record<string, unknown> | null;
  note?: string | null;
}

export interface KeywordWrite {
  text: string;
  source: TrendKeywordInput['source'];
  series: number[] | null;
  seriesStart: string;   // 'YYYY-MM-01'
  ko?: string | null;
  procedureId?: string | null;  // 주지 않으면 대표 검색어가 가장 길게 들어 있는 시술로 정한다
}

export async function upsertProcedures(sql: postgres.Sql, rows: ProcedureWrite[]): Promise<void> {
  for (const p of rows) {
    await sql`insert into trend_procedure (id, market, major, major_order, middle, name, kr, jp, en, hidden, sheet, serp, note)
      values (${p.id}, ${p.market ?? 'jp'}, ${p.major}, ${p.majorOrder}, ${p.middle}, ${p.name}, ${p.kr}, ${p.jp}, ${p.en}, ${p.hidden ?? false},
              ${p.sheet ? sql.json(p.sheet as postgres.JSONValue) : null}, ${p.serp ? sql.json(p.serp as unknown as postgres.JSONValue) : null}, ${p.note ?? null})
      on conflict (id) do update set major = excluded.major, major_order = excluded.major_order, middle = excluded.middle,
        name = excluded.name, kr = excluded.kr, jp = excluded.jp, en = excluded.en, hidden = excluded.hidden,
        sheet = coalesce(excluded.sheet, trend_procedure.sheet), serp = coalesce(excluded.serp, trend_procedure.serp),
        note = coalesce(excluded.note, trend_procedure.note), updated_at = now()`;
  }
}

// 같은 검색어(띄어쓰기·대소문자 무시)는 한 행 — 처음 들어온 출처가 남고, 검색량·번역은 새 값으로 갈아 끼운다
export async function upsertKeywords(sql: postgres.Sql, market: string, rows: KeywordWrite[]): Promise<number> {
  const procs = await sql<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where market = ${market} and not hidden`;
  const owner = ownerResolver(procs);
  const seen = new Set<string>();
  const items = rows.filter((r) => { const k = norm(r.text); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((r) => ({
      market, text: r.text, norm: norm(r.text), procedure_id: r.procedureId ?? owner(r.text), source: r.source,
      ko: r.ko ?? null, series: r.series, series_start: r.series ? r.seriesStart : null,
    }));
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    await sql`insert into trend_keyword ${sql(chunk, 'market', 'text', 'norm', 'procedure_id', 'source', 'ko', 'series', 'series_start')}
      on conflict (market, norm) do update set series = excluded.series, series_start = excluded.series_start,
        ko = coalesce(excluded.ko, trend_keyword.ko), fetched_at = now()`;
  }
  return items.length;
}

// 대표 검색어가 들어 있는 시술 중 가장 긴(구체적인) 것 — 'スキンボトックス 効果'는 보톡스가 아니라 스킨보톡스
export function ownerResolver(procs: Array<{ id: string; jp: string }>): (text: string) => string | null {
  const byJp = new Map<string, string>();
  for (const p of procs) if (!byJp.has(p.jp)) byJp.set(p.jp, p.id);
  const names = [...byJp.keys()];
  return (text) => { const jp = ownerOf(text, names); return jp ? byJp.get(jp) ?? null : null; };
}

// 시술이 바뀌면(추가·대표 검색어 수정·숨김) 검색어 주인을 다시 정한다. 이름 검색어는 그 시술 것으로 고정.
export async function reassignOwners(sql: postgres.Sql, market: string): Promise<number> {
  const procs = await sql<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where market = ${market} and not hidden`;
  const owner = ownerResolver(procs);
  const kws = await sql<Array<{ id: string; text: string; procedure_id: string | null; source: string }>>`
    select id, text, procedure_id, source from trend_keyword where market = ${market}`;
  let changed = 0;
  for (const k of kws) {
    if (k.source === 'name' && k.procedure_id) continue;
    const next = owner(k.text);
    if (next !== k.procedure_id) { await sql`update trend_keyword set procedure_id = ${next} where id = ${k.id}`; changed++; }
  }
  return changed;
}

const monthOf = (d: Date | string) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 7);
const addMonths = (ym: string, k: number) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

// 완성본 다시 만들기 — 가장 최근 48개월(검색어마다 시작 달이 달라도 같은 달끼리 맞춘다)
export async function rebuildView(sql: postgres.Sql, market: string, window = 48): Promise<TrendViewDoc> {
  const procs = await sql<Array<{ id: string; major: string; major_order: number; middle: string; name: string; kr: string; jp: string; en: string; hidden: boolean; serp: TrendSerp | null }>>`
    select id, major, major_order, middle, name, kr, jp, en, hidden, serp from trend_procedure where market = ${market}
    order by major_order, case when id ~ '^p[0-9]+' then substring(id from '[0-9]+')::int else 1000000 end, id`;  // 시트 행 순서(p2 < p10), 앱에서 더한 건 뒤
  const kws = await sql<Array<{ text: string; procedure_id: string | null; source: TrendKeywordInput['source']; ko: string | null; intent_override: string | null; series: number[] | null; series_start: Date | null; fetched_at: Date | null }>>`
    select text, procedure_id, source, ko, intent_override, series, series_start, fetched_at from trend_keyword where market = ${market} order by id`;
  // 마지막 달 = 검색량이 있는 검색어들의 가장 늦은 달
  let last = '0000-00';
  for (const k of kws) if (k.series && k.series_start) { const e = addMonths(monthOf(k.series_start), k.series.length - 1); if (e > last) last = e; }
  const months = Array.from({ length: window }, (_, i) => addMonths(last, i - window + 1));
  const align = (k: (typeof kws)[number]): number[] | null => {
    if (!k.series || !k.series_start) return null;
    const start = monthOf(k.series_start);
    const out = months.map((m) => { const [y1, m1] = start.split('-').map(Number), [y2, m2] = m.split('-').map(Number); const i = (y2 - y1) * 12 + (m2 - m1); return i >= 0 && i < k.series!.length ? k.series![i] : NaN; });
    return out.some(Number.isNaN) ? null : out;  // 48개월이 다 있어야 비교된다(일부만 있으면 값 없음 취급)
  };
  const fetched = kws.reduce((t, k) => (k.fetched_at && k.fetched_at > t ? k.fetched_at : t), new Date(0));
  const doc = buildTrendView({
    market, fetchedAt: fetched.toISOString().slice(0, 10), months,
    procedures: procs.map((p) => ({ id: p.id, major: p.major, majorOrder: p.major_order, middle: p.middle, name: p.name, kr: p.kr, jp: p.jp, en: p.en, hidden: p.hidden, serp: p.serp })),
    keywords: kws.map((k) => ({ text: k.text, procedureId: k.procedure_id, source: k.source, ko: k.ko, intentOverride: k.intent_override as Intent | null, series: align(k) })),
  });
  await sql`insert into trend_view (market, built_at, doc) values (${market}, now(), ${sql.json(doc as unknown as postgres.JSONValue)})
    on conflict (market) do update set built_at = now(), doc = excluded.doc`;
  return doc;
}

export async function readView(sql: postgres.Sql, market: string): Promise<{ builtAt: string; doc: TrendViewDoc } | null> {
  const [r] = await sql<Array<{ built_at: Date; doc: TrendViewDoc }>>`select built_at, doc from trend_view where market = ${market}`;
  return r ? { builtAt: r.built_at.toISOString(), doc: r.doc } : null;
}

// ── 화면에서 고치기(상세 패널의 [수정]·검색어 점검) ──

export interface FamilyKeyword {
  id: string; text: string; ko: string | null; source: string; procedureId: string;
  intent: Intent; override: Intent | null; avg12: number | null;  // avg12 null = 값 없음
}

// 묶음(같은 분류·같은 시술명)의 검색어 전부 — 지금 적용된 태그(사람이 고친 것 우선)와 최근 12개월 월평균
export async function listFamilyKeywords(sql: postgres.Sql, market: string, procedureIds: string[]): Promise<FamilyKeyword[]> {
  if (!procedureIds.length) return [];
  const procs = await sql<Array<{ id: string; jp: string; serp: { unrelated?: number } | null }>>`
    select id, jp, serp from trend_procedure where market = ${market} and id in ${sql(procedureIds)}`;
  const homs = new Set(procs.filter((p) => (p.serp?.unrelated ?? 0) >= SERP_HOMONYM).map((p) => norm(p.jp)));
  const jpOf = new Map(procs.map((p) => [p.id, p.jp]));
  const rows = await sql<Array<{ id: string; text: string; ko: string | null; source: string; procedure_id: string; intent_override: string | null; series: number[] | null }>>`
    select id, text, ko, source, procedure_id, intent_override, series from trend_keyword where market = ${market} and procedure_id in ${sql(procedureIds)}`;
  return rows.map((r) => {
    const avg12 = r.series ? r.series.slice(-12).reduce((a, b) => a + b, 0) / Math.min(12, r.series.length) : null;
    const auto: Intent = r.source === 'korea' ? 'korea' : tagKeyword(r.text, [jpOf.get(r.procedure_id) ?? ''], homs);
    return { id: String(r.id), text: r.text, ko: r.ko, source: r.source, procedureId: r.procedure_id,
      intent: (r.intent_override as Intent | null) ?? auto, override: r.intent_override as Intent | null, avg12 };
  }).sort((a, b) => (b.avg12 ?? -1) - (a.avg12 ?? -1));
}

export async function setKeywordIntent(sql: postgres.Sql, market: string, id: string, intent: Intent | null): Promise<boolean> {
  const r = await sql`update trend_keyword set intent_override = ${intent} where market = ${market} and id = ${id}`;
  return r.count > 0;
}

export interface ProcedurePatch { name?: string; kr?: string; jp?: string; en?: string; major?: string; middle?: string; hidden?: boolean }

// 시술 고치기 — 시트에서 온 행은 처음 고치는 칸의 시트 원래 값을 sheet에 남긴다. 일본어 검색어가 바뀌면 다시 수집해야 한다(jpChanged).
export async function updateProcedure(sql: postgres.Sql, market: string, id: string, patch: ProcedurePatch): Promise<{ found: boolean; jpChanged: boolean }> {
  const [cur] = await sql<Array<Record<string, unknown> & { sheet: Record<string, unknown> | null }>>`
    select name, kr, jp, en, major, middle, hidden, sheet from trend_procedure where market = ${market} and id = ${id}`;
  if (!cur) return { found: false, jpChanged: false };
  const fields = ['name', 'kr', 'jp', 'en', 'major', 'middle', 'hidden'] as const;
  const next: Record<string, unknown> = {};
  const sheet = { ...(cur.sheet ?? {}) };
  for (const f of fields) {
    const v = patch[f];
    if (v === undefined || v === cur[f]) continue;
    next[f] = typeof v === 'string' ? v.trim() : v;
    if (/^p\d+/.test(id) && f !== 'hidden' && !(f in sheet)) sheet[f] = cur[f];
  }
  if (!Object.keys(next).length) return { found: true, jpChanged: false };
  await sql`update trend_procedure set ${sql(next as Record<string, string | boolean>)}, sheet = ${Object.keys(sheet).length ? sql.json(sheet as postgres.JSONValue) : null},
    ideas_at = ${'jp' in next ? null : sql`ideas_at`}, updated_at = now() where id = ${id}`;
  if ('jp' in next || 'hidden' in next) await reassignOwners(sql, market);
  return { found: true, jpChanged: 'jp' in next };
}

// 같은 일본어 검색어(띄어쓰기 무시)를 가진 다른 시술 — 있으면 검색어 주인이 섞이므로 추가·수정을 막는다
export async function findJpConflict(sql: postgres.Sql, market: string, jp: string, exceptId?: string): Promise<{ id: string; name: string } | null> {
  const rows = await sql<Array<{ id: string; name: string; jp: string }>>`select id, name, jp from trend_procedure where market = ${market} and not hidden`;
  return rows.find((r) => r.id !== exceptId && norm(r.jp) === norm(jp)) ?? null;
}

export async function createProcedure(sql: postgres.Sql, market: string, p: { name: string; kr: string; jp: string; en: string; major: string; middle: string }): Promise<string> {
  const id = `u${Date.now().toString(36)}`;
  await upsertProcedures(sql, [{ id, market, major: p.major, majorOrder: 0, middle: p.middle, name: p.name, kr: p.kr, jp: p.jp, en: p.en, note: '앱에서 추가' }]);
  await reassignOwners(sql, market);
  return id;
}
