import type postgres from 'postgres';
import { composioFromEnv, googleAdsFromEnv, ComposioError } from './composio';
import { recordUsageSafe } from './usageStore';
import { norm } from './searchIntent';
import { ownerResolver, upsertKeywords, rebuildView, type KeywordWrite } from './trendStore';
import { showKeyword } from './trendBuild';
import { risingOnly } from './trendRising';

// 검색 트렌드 자동 수집(스펙 2026-10-13 §7) — DB 예약 실행(scripts/search-trends-cron.sql)이 주 1회(월요일 새벽) 부른다(koo 10-14).
// 1) 진행 중인 전체 갱신 이어 하기 → 2) 새 달 확인(있으면 전체 갱신 시작 — 직전 달들 고쳐진 값도 같이 받는다)
// → 3) 남는 시간에 연관 검색어 넓히기(90일 지난 시술·새 시술, 수식어·한국 조합 포함) → 4) 화면에 보이는데 번역 없는 검색어 번역.
// 키워드 플래너가 429(요청 과다)를 주면 그 실행은 멈추고 다음 실행이 이어 한다.

export const WINDOW = 48;
const BATCH = 1000;                 // 검색량 조회 1번에 키워드 1,000개까지
const CHECK_EVERY_H = 6 * 24;       // 새 달 확인 간격 — 주 1회 실행마다 확인(손으로 다시 불러도 6일 안엔 다시 묻지 않는다)
const IDEAS_EVERY_D = 90;           // 연관 검색어 넓히기 간격
const IDEAS_GAP_MS = 1500;          // 연관 검색어는 동시에 보내면 거절(429) — 1건씩 간격

export const MODS = ['とは', '違い', 'おすすめ', '効果', '口コミ', '経過', 'ビフォーアフター', 'ダウンタイム', '痛み', '副作用', '失敗', '値段', '料金', '安い', '東京', '大阪', 'クリニック'];
export const KOREA = (n: string) => [`韓国 ${n}`, `${n} 韓国`, `韓国 ${n} 値段`, `韓国 ${n} 安い`, `韓国 ${n} おすすめ`, `ソウル ${n}`, `江南 ${n}`, `明洞 ${n}`, `${n} 明洞`, `弘大 ${n}`, `${n} 弘大`, `ホンデ ${n}`, `${n} ホンデ`];

// ── 달 계산 ──
export const addMonths = (ym: string, k: number) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + k; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const MONTH_ENUM = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const toEnum = (ym: string) => ({ year: Number(ym.slice(0, 4)), month: MONTH_ENUM[Number(ym.slice(5, 7)) - 1] });

// ── 키워드 플래너 ──
export interface KpRow { text: string; closeVariants: string[]; months: Array<[string, number]> | null }  // months: [['2026-08', 1300], …] 오래된 달 → 최근 달
export interface KpClient {
  historical(keywords: string[], from: string, to: string): Promise<KpRow[]>;
  ideas(seed: string, from: string, to: string): Promise<KpRow[]>;
}
export class KpRateLimited extends Error {}

type RawMV = { year?: number | string; month?: string; monthlySearches?: string | number };
type RawRow = { text: string; closeVariants?: string[]; keywordMetrics?: { monthlySearchVolumes?: RawMV[] }; keywordIdeaMetrics?: { monthlySearchVolumes?: RawMV[] } };
export function parseKpRow(r: RawRow): KpRow {
  const mv = r.keywordMetrics?.monthlySearchVolumes ?? r.keywordIdeaMetrics?.monthlySearchVolumes;
  const months = mv?.length
    ? mv.map((x): [string, number] => [`${x.year}-${String(MONTH_ENUM.indexOf(String(x.month)) + 1).padStart(2, '0')}`, Number(x.monthlySearches ?? 0)])
    : null;
  return { text: r.text, closeVariants: r.closeVariants ?? [], months };
}

export function kpFromComposio(): KpClient {
  const c = composioFromEnv();
  const g = googleAdsFromEnv();
  const base = { geoTargetConstants: ['geoTargetConstants/2392'], language: 'languageConstants/1005', keywordPlanNetwork: 'GOOGLE_SEARCH' };
  const call = async (op: 'historical' | 'ideas', endpoint: string, body: object): Promise<KpRow[]> => {
    try {
      const d = await c.proxy<{ results?: RawRow[] }>({ endpoint: `https://googleads.googleapis.com/v25/customers/${g.customerId}:${endpoint}`, method: 'POST', connectedAccountId: g.connectedAccountId, body });
      recordUsageSafe({ api: 'googleads', operation: `googleads.${op}` });
      return (d.results ?? []).map(parseKpRow);
    } catch (e) {
      recordUsageSafe({ api: 'googleads', operation: `googleads.${op}`, ok: false, httpStatus: e instanceof ComposioError ? e.status : null });
      if (e instanceof ComposioError && e.status === 429) throw new KpRateLimited(e.message);
      throw e;
    }
  };
  const range = (from: string, to: string) => ({ historicalMetricsOptions: { yearMonthRange: { start: toEnum(from), end: toEnum(to) } } });
  return {
    historical: (keywords, from, to) => call('historical', 'generateKeywordHistoricalMetrics', { ...base, keywords, ...range(from, to) }),
    ideas: (seed, from, to) => call('ideas', 'generateKeywordIdeas', { ...base, keywordSeed: { keywords: [seed] }, pageSize: 1000, ...range(from, to) }),
  };
}

// 요청한 검색어 ↔ 응답 행: 응답 글자는 키워드 플래너가 띄어쓰기를 다시 넣어 돌려준다(エラボトックス → エラ ボトックス) — 정규화·유사 표기로 맞춘다
export function matchRows(asked: string[], rows: KpRow[]): Map<string, KpRow> {
  const byNorm = new Map<string, KpRow>();
  for (const r of rows) { byNorm.set(norm(r.text), r); for (const v of r.closeVariants) if (!byNorm.has(norm(v))) byNorm.set(norm(v), r); }
  return new Map(asked.flatMap((a) => { const r = byNorm.get(norm(a)); return r ? [[a, r] as [string, KpRow]] : []; }));
}

// 응답 달들을 [from..to] 창에 맞춘 배열로 — 창의 달이 하나라도 비면 null(값 없음)
export function toSeries(r: KpRow | undefined, from: string, to: string): number[] | null {
  if (!r?.months) return null;
  const m = new Map(r.months);
  const out: number[] = [];
  for (let ym = from; ym <= to; ym = addMonths(ym, 1)) { const v = m.get(ym); if (v === undefined) return null; out.push(v); }
  return out;
}

// ── 실행 ──
export interface CollectResult { did: string[]; latest: string | null; stoppedBy?: 'deadline' | 'rate-limit' }
type Translate = (texts: string[], glossary: string) => Promise<Record<string, string>>;

export async function runTrendCollect(sql: postgres.Sql, kp: KpClient, opts: { market?: string; now?: Date; deadlineMs: number; translate?: Translate; forceCheck?: boolean;
  discover?: (latest: string) => Promise<{ raw: number; groups: number }>; meanings?: (left: () => number) => Promise<number>;
  altSpell?: (latest: string, left: () => number) => Promise<{ procedures: number; kept: number }> }): Promise<CollectResult> {
  const market = opts.market ?? 'jp';
  const now = opts.now ?? new Date();
  const t0 = Date.now();
  const left = () => opts.deadlineMs - (Date.now() - t0);
  const did: string[] = [];
  let rebuilt = false;
  const stored = await storedLatest(sql, market);
  try {
    // 1·2) 전체 갱신 — 진행 중이면 이어 하고, 아니면 하루 한 번 새 달 확인
    let [run] = await sql<Array<{ id: string; latest_month: string; detail: { cursor?: number } | null }>>`
      select id, latest_month, detail from trend_run where market = ${market} and kind = 'refresh' and finished_at is null
        and started_at > ${new Date(now.getTime() - 7 * 864e5)} order by started_at desc limit 1`;
    if (!run) {
      const [chk] = await sql<Array<{ started_at: Date }>>`select started_at from trend_run where market = ${market} and kind = 'check' order by started_at desc limit 1`;
      if (opts.forceCheck || !chk || now.getTime() - chk.started_at.getTime() > CHECK_EVERY_H * 36e5) {
        const latest = await probeLatest(sql, kp, market, now);
        await sql`insert into trend_run (market, kind, started_at, finished_at, latest_month, detail) values (${market}, 'check', ${now}, now(), ${latest}, ${sql.json({ stored })})`;
        did.push(`새 달 확인(${latest ?? '응답 없음'}, 저장 ${stored ?? '없음'})`);
        if (latest && (!stored || latest > stored)) {
          [run] = await sql<Array<{ id: string; latest_month: string; detail: { cursor?: number } | null }>>`
            insert into trend_run (market, kind, started_at, latest_month, detail) values (${market}, 'refresh', ${now}, ${latest}, ${sql.json({ cursor: 0 })}) returning id, latest_month, detail`;
        }
      }
    }
    if (run) {
      const done = await refreshAll(sql, kp, market, run, left);
      did.push(`전체 갱신 ${done.updated}개${done.finished ? ' — 끝' : ' — 이어서'}`);
      if (done.finished) { await rebuildView(sql, market); rebuilt = true; }
      if (!done.finished) return { did, latest: run.latest_month, stoppedBy: 'deadline' };
    }
    // 3) 연관 검색어 넓히기
    const latest = (await storedLatest(sql, market)) ?? stored;
    if (latest && left() > 30_000) {
      const n = await widenIdeas(sql, kp, market, latest, now, left);
      if (n.procedures) { did.push(`연관 검색어 ${n.procedures}개 시술 · 검색어 ${n.keywords}개`); await rebuildView(sql, market); rebuilt = true; }
    }
  } catch (e) {
    if (!(e instanceof KpRateLimited)) throw e;
    did.push('키워드 플래너 요청 과다 — 다음 실행에 이어 함');
    await rebuildView(sql, market);  // 멈추기 전에 쓴 검색어도 화면에 반영
    return { did, latest: stored, stoppedBy: 'rate-limit' };
  }
  // 3-2) 새로 뜨는 검색 찾기 — 달마다 한 번(그 달 기록이 없을 때). 연관 검색어 20번 + 분류라 시간이 넉넉할 때만
  const cur = (await storedLatest(sql, market)) ?? stored;
  // 연관 검색어 20번 + 분류로 2~3분 — 전체 갱신과 같은 실행에선 시간이 모자라 1시간 뒤 두 번째 실행(예약 2회)이 맡는다
  if (opts.discover && cur && left() > 200_000) {
    const [d] = await sql`select 1 from trend_run where market = ${market} and kind = 'discover' and latest_month = ${cur} and finished_at is not null limit 1`;
    if (!d) {
      const [run] = await sql<Array<{ id: string }>>`insert into trend_run (market, kind, latest_month) values (${market}, 'discover', ${cur}) returning id`;
      try {
        const r = await opts.discover(cur);
        await sql`update trend_run set finished_at = now(), detail = ${sql.json(r)} where id = ${run.id}`;
        did.push(`새로 뜨는 검색 ${r.groups}개 후보`);
      } catch (e) {
        if (!(e instanceof KpRateLimited)) throw e;
        did.push('새로 뜨는 검색 — 요청 과다로 다음 실행에');
      }
    }
  }
  // 3-3) 후보 뜻 확인 — 남는 시간에 몇 개씩
  if (opts.meanings && left() > 40_000) {
    const n = await opts.meanings(left);
    if (n) did.push(`후보 뜻 확인 ${n}개`);
  }
  // 3-4) 값 없음 시술의 다른 표기 — 실행마다 몇 개 시술씩(90일마다 다시)
  const cur2 = (await storedLatest(sql, market)) ?? stored;
  if (opts.altSpell && cur2 && left() > 60_000) {
    const r = await opts.altSpell(cur2, left);
    if (r.procedures) did.push(`값 없음 시술 ${r.procedures}개 다른 표기 찾기 — 후보 ${r.kept}개`);
  }
  // 4) 번역 — 화면에 보이는 검색어(의도별 상위)만
  if (opts.translate && rebuilt && left() > 20_000) {
    const n = await translateMissing(sql, market, opts.translate);
    if (n) { did.push(`번역 ${n}개`); await rebuildView(sql, market); }
  }
  return { did, latest: (await storedLatest(sql, market)) ?? stored };
}

// 시술 하나만 바로 수집 — 화면에서 시술을 더하거나 일본어 검색어를 고쳤을 때(약 5초). 끝나면 완성본을 다시 만든다.
// 키워드 플래너에 새 달이 나와 있으면(예: 9월 값이 나온 뒤 월요일 갱신 전) 4년 창의 첫 달이 빠져 새 검색어가 전부 값 없음이 된다 —
// 그럴 땐 전체 갱신을 먼저 끝내고(1~2분) 새 창으로 받는다(10-15).
export async function collectProcedure(sql: postgres.Sql, kp: KpClient, market: string, id: string, now = new Date()): Promise<{ keywords: number }> {
  let latest = await storedLatest(sql, market);
  if (!latest) return { keywords: 0 };
  const kpLatest = await probeLatest(sql, kp, market, now);
  if (kpLatest && kpLatest > latest) {
    const [run] = await sql<Array<{ id: string; latest_month: string; detail: { cursor?: number } | null }>>`
      insert into trend_run (market, kind, started_at, latest_month, detail) values (${market}, 'refresh', ${now}, ${kpLatest}, ${sql.json({ cursor: 0, by: 'procedure' })}) returning id, latest_month, detail`;
    const t0 = Date.now();
    const done = await refreshAll(sql, kp, market, run, () => 240_000 - (Date.now() - t0));
    if (!done.finished) throw new Error('새 달 전체 갱신을 다 못 끝냈어요 — 잠시 뒤 다시 저장해 주세요');
    await rebuildView(sql, market);
    latest = kpLatest;
  }
  const r = await widenIdeas(sql, kp, market, latest, now, () => 60_000, id);
  await rebuildView(sql, market);
  return { keywords: r.keywords };
}

async function storedLatest(sql: postgres.Sql, market: string): Promise<string | null> {
  const [r] = await sql<Array<{ last: string | null }>>`select doc->'months'->>-1 as last from trend_view where market = ${market}`;
  return r?.last ?? null;
}

// 새 달 확인 — 검색량 큰 이름 검색어 몇 개로 키워드 플래너가 어느 달까지 주는지 본다
async function probeLatest(sql: postgres.Sql, kp: KpClient, market: string, now: Date): Promise<string | null> {
  const probe = await sql<Array<{ text: string }>>`select text from trend_keyword where market = ${market} and source = 'name' and series is not null
    order by series[array_length(series, 1)] desc nulls last limit 5`;
  if (!probe.length) return null;
  const to = now.toISOString().slice(0, 7);
  const rows = await kp.historical(probe.map((p) => p.text), addMonths(to, -3), to);
  return rows.reduce<string | null>((m, r) => { const last = r.months?.at(-1)?.[0] ?? null; return last && (!m || last > m) ? last : m; }, null);
}

async function refreshAll(sql: postgres.Sql, kp: KpClient, market: string, run: { id: string; latest_month: string; detail: { cursor?: number } | null }, left: () => number) {
  const to = run.latest_month, from = addMonths(to, -(WINDOW - 1));
  let cursor = run.detail?.cursor ?? 0, updated = 0;
  while (left() > 40_000) {
    const batch = await sql<Array<{ id: string; text: string }>>`select id, text from trend_keyword where market = ${market} and id > ${cursor} order by id limit ${BATCH}`;
    if (!batch.length) {
      await sql`update trend_run set finished_at = now(), detail = ${sql.json({ cursor, updated })} where id = ${run.id}`;
      return { updated, finished: true };
    }
    const rows = matchRows(batch.map((b) => b.text), await kp.historical(batch.map((b) => b.text), from, to));
    // 1,000개를 한 문장으로 — 한 행씩 쓰면 1,200개에 2분이 넘었다(전체 1.6만 개면 30분)
    const payload = batch.map((b) => { const series = toSeries(rows.get(b.text), from, to); return { id: Number(b.id), s: series, st: series ? `${from}-01` : null }; });
    await sql`update trend_keyword k set
        series = case when x.s is null then null else array(select jsonb_array_elements_text(x.s)::int) end,
        series_start = x.st::date, fetched_at = now()
      from jsonb_to_recordset(${sql.json(payload)}) as x(id bigint, s jsonb, st text) where k.id = x.id`;
    updated += batch.length;
    cursor = Number(batch[batch.length - 1].id);
    await sql`update trend_run set detail = ${sql.json({ cursor, updated })} where id = ${run.id}`;
  }
  return { updated, finished: false };
}

// 연관 검색어 넓히기 + 그 시술의 이름·수식어·한국 조합 검색량 — 오래된(또는 새) 시술부터 시간이 허락하는 만큼
async function widenIdeas(sql: postgres.Sql, kp: KpClient, market: string, latest: string, now: Date, left: () => number, onlyId?: string) {
  const from = addMonths(latest, -(WINDOW - 1));
  const due = onlyId
    ? await sql<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where id = ${onlyId} and not hidden`
    : await sql<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where market = ${market} and not hidden
    and (ideas_at is null or ideas_at < ${new Date(now.getTime() - IDEAS_EVERY_D * 864e5)}) order by ideas_at nulls first, id limit 40`;
  if (!due.length) return { procedures: 0, keywords: 0 };
  const owner = ownerResolver(await sql<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where market = ${market} and not hidden`);
  let procedures = 0, keywords = 0;
  for (const p of due) {
    if (left() < 30_000) break;
    const all = await kp.ideas(p.jp, from, latest);
    const ideas = all.filter((r) => owner(r.text) === p.id);
    // 우리 목록 밖인데 늘어난 검색은 '새로 뜨는 검색' 재료로 모아 둔다(trend_orphan) — 시작점을 시술 전체로 넓힌다(10-15)
    const orphans = risingOnly(all.filter((r) => !owner(r.text)).flatMap((r) => { const v = toSeries(r, from, latest); return v ? [{ text: r.text, series: v }] : []; }));
    for (const o of orphans) {
      await sql`insert into trend_orphan (market, norm, text, series, series_start) values (${market}, ${norm(o.text)}, ${o.text}, ${o.series}, ${`${from}-01`})
        on conflict (market, norm) do update set series = excluded.series, series_start = excluded.series_start, seen_at = now()`;
    }
    const fixed = [p.jp, ...MODS.map((m) => `${p.jp} ${m}`), ...KOREA(p.jp)];
    const hist = matchRows(fixed, await kp.historical(fixed, from, latest));
    const rows: KeywordWrite[] = [
      ...ideas.map((r): KeywordWrite => ({ text: r.text, source: norm(r.text) === norm(p.jp) ? 'name' : 'idea', series: toSeries(r, from, latest), seriesStart: `${from}-01`, procedureId: p.id })),
      { text: p.jp, source: 'name' as const, series: toSeries(hist.get(p.jp), from, latest), seriesStart: `${from}-01`, procedureId: p.id },
      ...KOREA(p.jp).map((t): KeywordWrite => ({ text: t, source: 'korea', series: toSeries(hist.get(t), from, latest), seriesStart: `${from}-01`, procedureId: p.id })),
      ...MODS.map((m) => `${p.jp} ${m}`).map((t): KeywordWrite => ({ text: t, source: 'template', series: toSeries(hist.get(t), from, latest), seriesStart: `${from}-01`, procedureId: p.id })),
    ].filter((r) => r.series || r.source === 'name');  // 값 없는 조합은 저장하지 않는다(이름은 '값 없음'으로 남긴다)
    keywords += await upsertKeywords(sql, market, rows);
    await sql`update trend_procedure set ideas_at = now() where id = ${p.id}`;
    procedures++;
    if (!onlyId) await new Promise((r) => setTimeout(r, IDEAS_GAP_MS));
  }
  return { procedures, keywords };
}

// 화면에 보이는(의도별 상위) 검색어 중 번역이 없는 것 — 시술명(대표 검색어 = 한국어 시술명)을 용어집으로
export async function translateMissing(sql: postgres.Sql, market: string, translate: Translate): Promise<number> {
  const [v] = await sql<Array<{ doc: { intent: Record<string, { top: Record<string, Array<[string, number, string]>> }> } }>>`select doc from trend_view where market = ${market}`;
  if (!v) return 0;
  const shown = new Set<string>();
  for (const it of Object.values(v.doc.intent)) for (const arr of Object.values(it.top)) for (const [t, , ko] of arr) if (!ko) shown.add(t);
  if (!shown.size) return 0;
  const procs = await sql<Array<{ jp: string; kr: string }>>`select jp, kr from trend_procedure where market = ${market} and not hidden`;
  const glossary = [...new Map(procs.map((p) => [p.jp, p.kr])).entries()].map(([j, k]) => `${j}=${k}`).join(', ');
  const texts = [...shown].slice(0, 300);
  const map = await translate(texts, glossary);
  const kws = await sql<Array<{ id: string; text: string }>>`select id, text from trend_keyword where market = ${market} and ko is null and norm in ${sql(texts.map(norm))}`;
  let n = 0;
  for (const k of kws) { const ko = map[showKeyword(k.text)]; if (ko) { await sql`update trend_keyword set ko = ${ko} where id = ${k.id}`; n++; } }
  return n;
}
