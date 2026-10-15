import type postgres from 'postgres';
import { norm } from './searchIntent';
import { ownerResolver } from './trendStore';
import { addMonths, toSeries, matchRows, WINDOW, type KpClient } from './trendCollect';
import { summarize } from './searchTrend';
import { DISCOVER, risingOnly, type RawCandidate } from './trendRising';
export { DISCOVER, risingOnly, type RawCandidate };

const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;

// 새로 뜨는 검색(스펙 2026-10-13 §11, koo 10-15) — 새 달을 받은 뒤 넓은 검색어 몇 개로 연관 검색어를 받아,
// 우리 시술 목록에 없는데 1년 새 늘어난 검색을 후보로 남긴다. 무엇인지(새 시술·다른 표기·고민·제외)는 모델이 가르고, 추가는 사람이 고른다.
// 10-15 실측: 걸린 51개 중 새 시술은 루메카 1개, 다른 표기 8(ボットクス 월 5.2만 = 보톡스 오타, 肌育注射 = 스킨부스터),
// 고민 9(毛穴メラニン 월 2만), 나머지는 화장품·병원 이름·일반어 — 분류 없이 보여 주면 쓸 수 없다.

// 넓은 검색어 — 분류마다 하나 이상, 한국 미용 수요 포함
export const DISCOVER_SEEDS = [
  '美容皮膚科', '韓国 美容皮膚科', '美容医療', '肌育注射', 'スキンブースター', 'ハイフ', 'リフトアップ 施術', 'ボトックス', 'ヒアルロン酸 注入',
  'ピーリング', 'レーザー 美容', 'シミ取り', '肝斑 治療', '毛穴 治療', 'ニキビ跡 治療', '医療脱毛', '脂肪溶解注射', '美容点滴', 'アートメイク', 'たるみ 治療',
];

export type CandidateKind = 'new' | 'variant' | 'concern' | 'self' | 'clinic' | 'other';
export interface Classified { text: string; kind: CandidateKind; term: string; of?: string | null; ko?: string | null }
export type ClassifyFn = (texts: string[], glossary: string) => Promise<Classified[]>;

export interface CandidateGroup { kind: CandidateKind; term: string; ko: string | null; of: string | null; texts: string[]; volume: number; increase: number; series: number[] }

// 같은 핵심어로 분류된 검색어끼리 묶는다 — 어순·띄어쓰기만 다른 검색어(クレンジング ピーリング / ピーリング クレンジング)가 한 후보가 되게
export function groupCandidates(raw: RawCandidate[], cls: Classified[]): CandidateGroup[] {
  const byText = new Map(raw.map((r) => [norm(r.text), r]));
  const groups = new Map<string, CandidateGroup>();
  for (const c of cls) {
    const r = byText.get(norm(c.text));
    if (!r || !c.term) continue;
    const key = `${c.kind}|${norm(c.term)}`;
    const g = groups.get(key) ?? { kind: c.kind, term: c.term, ko: c.ko ?? null, of: c.of ?? null, texts: [], volume: 0, increase: 0, series: r.series };
    if (!g.texts.includes(r.text)) g.texts.push(r.text);
    if (r.now > g.volume) g.series = r.series;  // 대표 검색어(가장 큰 것)의 추이
    g.volume = Math.max(g.volume, r.now);
    g.increase = Math.max(g.increase, r.increase);
    groups.set(key, g);
  }
  // 핵심어 표기가 달라도(蓄熱式脱毛 / 蓄熱式 脱毛 / 蓄熱式) 한국어 이름이 같으면 한 후보 — 10-15 '축열식 제모'가 두 줄로 나왔다
  const merged = new Map<string, CandidateGroup>();
  for (const g of [...groups.values()].sort((a, b) => b.increase - a.increase)) {
    const key = `${g.kind}|${g.ko ? norm(g.ko) : norm(g.term)}`;
    const m = merged.get(key);
    if (!m) { merged.set(key, g); continue; }
    for (const t of g.texts) if (!m.texts.includes(t)) m.texts.push(t);
    if (g.volume > m.volume) m.series = g.series;
    m.volume = Math.max(m.volume, g.volume);
    m.increase = Math.max(m.increase, g.increase);
  }
  return [...merged.values()].sort((a, b) => b.increase - a.increase);
}

// ── 정합성 검사(10-15) ──
// 몇 달째 늘어난 상태인지 — 지난달부터 거꾸로, 3개월 평균이 1년 전 같은 3개월보다 +30% 이상(또는 1년 전 거의 없음)인 달 수. 반짝 검색을 가린다.
export function risingMonths(series: number[]): number {
  let k = 0;
  for (let end = series.length; end - 15 >= 0; end--) {
    const now = avg3(series, end), ya = avg3(series, end - 12);
    if (now >= DISCOVER.minVolume && (ya < DISCOVER.newBelow || now / ya >= DISCOVER.minRatio)) k++; else break;
  }
  return k;
}

// 이미 세고 있는 검색인가 — 키워드 플래너는 오타·유사 표기를 원래 이름과 한 묶음으로 같은 숫자를 준다(ボットクス = ボトックス, 4년치가 똑같다).
// ① 응답의 유사 표기(closeVariants)나 응답 글자가 우리 검색어 ② 4년치 숫자가 우리 검색어와 똑같음(월평균 50 이상 — 작은 값은 우연히 같을 수 있다)
export function alreadyCounted(term: { text?: string; closeVariants?: string[]; series: number[] | null }, ours: { norms: ReadonlySet<string>; seriesKeys: ReadonlySet<string> }): boolean {
  if (term.text && ours.norms.has(norm(term.text))) return true;
  if ((term.closeVariants ?? []).some((v) => ours.norms.has(norm(v)))) return true;
  if (term.series && term.series.reduce((s, x) => s + x, 0) / term.series.length >= 50 && ours.seriesKeys.has(term.series.join(','))) return true;
  return false;
}

// 다른 표기 처리 — 우리 표기보다 3배 이상 많이 찾으면 더하기가 아니라 표기 바꾸기(ピコフラクセル 320 → ピコフラクショナル 2.2만).
// 단 넓은 말로는 바꾸지 않는다(10-15: 'RF → 고주파리프팅', '毛穴 → 모공'이 바꾸기 후보로 올라왔다) — 시술 이름이 그 말을 통째로 품고 있거나
// (毛穴 ⊂ 毛穴縮小), 너무 짧은 말(영문 3자 이하·일본어 2자 이하)이면 '더하기'만.
export const REPLACE_RATIO = 3;
export function isBroadTerm(term: string, procedureJps: string[]): boolean {
  const t = norm(term);
  if (/^[a-z0-9]+$/.test(t) ? t.length <= 3 : t.length <= 2) return true;
  return procedureJps.some((jp) => { const j = norm(jp); return j !== t && j.includes(t); });
}
export function variantAction(termNow: number, oursNow: number | null, broad = false): 'add' | 'replace' {
  if (broad) return 'add';
  return oursNow === null || termNow >= Math.max(1, oursNow) * REPLACE_RATIO ? 'replace' : 'add';
}

// 한 번 돌리기 — 새 달마다 한 번(trend_run kind 'discover'). 이미 고른(추가·무시) 후보는 다시 올리지 않고, 열린 후보는 숫자만 갈아 끼운다.
// 뜻 확인 — 새 시술·새 고민 후보의 일본 사이트 검색 결과 구성(시술과 같은 방식). 하나에 몇 초라 한 번에 몇 개씩만(다음 실행이 이어 함) —
// 한꺼번에 하면 46개에 7분이 걸려 서버 제한(5분)을 넘었다(10-15).
export async function checkCandidateMeanings(sql: postgres.Sql, market: string, meaning: MeaningFn, limit = 10, left: () => number = () => Infinity): Promise<number> {
  const todo = await sql<Array<{ id: string; term: string }>>`select id, term from trend_candidate where market = ${market} and status = 'open'
    and kind in ('new', 'concern') and serp is null order by increase desc limit ${limit}`;
  let n = 0;
  for (const c of todo) {
    if (left() < 20_000) break;
    const m = await meaning(c.term).catch(() => null);
    await sql`update trend_candidate set serp = ${sql.json(m ?? { derm: 0, med: 0, self: 0, unrelated: 0, note: '검색 결과 없음' })} where id = ${c.id}`;
    n++;
  }
  return n;
}

export type MeaningFn = (term: string) => Promise<{ derm: number; med: number; self: number; unrelated: number; note: string } | null>;

export async function runDiscover(sql: postgres.Sql, kp: KpClient, market: string, latest: string, classify: ClassifyFn, gapMs = 1500):
  Promise<{ raw: number; groups: number; counted: number; spiked: number; notRising: number; kept: number }> {
  const from = addMonths(latest, -(WINDOW - 1));
  const months = Array.from({ length: WINDOW }, (_, i) => addMonths(from, i));
  const procs = await sql<Array<{ id: string; jp: string; name: string }>>`select id, jp, name from trend_procedure where market = ${market} and not hidden`;
  const owner = ownerResolver(procs);
  const seen = new Map<string, { text: string; series: number[] }>();
  // 시작점 ① 넓은 검색어 20개의 연관 검색어
  for (const seed of DISCOVER_SEEDS) {
    for (const r of await kp.ideas(seed, from, latest)) {
      if (owner(r.text)) continue;  // 이미 우리 시술의 검색어
      const series = toSeries(r, from, latest);
      if (series && !seen.has(norm(r.text))) seen.set(norm(r.text), { text: r.text, series });
    }
    if (gapMs) await new Promise((x) => setTimeout(x, gapMs));
  }
  // 시작점 ② 시술별 연관 검색어를 넓힐 때 모아 둔 '목록 밖' 검색어(최근 100일, 같은 4년 창인 것만)
  for (const o of await sql<Array<{ text: string; series: number[]; series_start: Date }>>`
      select text, series, series_start from trend_orphan where market = ${market} and seen_at > now() - interval '100 days'`) {
    if (owner(o.text) || seen.has(norm(o.text))) continue;
    if (o.series_start.toISOString().slice(0, 7) === from && o.series.length === WINDOW) seen.set(norm(o.text), { text: o.text, series: o.series });
  }
  const raw = risingOnly([...seen.values()]);
  if (!raw.length) return { raw: 0, groups: 0, counted: 0, spiked: 0, notRising: 0, kept: 0 };
  const glossary = [...new Map(procs.map((p) => [p.jp, p.name])).entries()].map(([j, n]) => `${j}=${n}`).join(', ');
  const groups = groupCandidates(raw, await classify(raw.map((r) => r.text), glossary));

  // 정합성 — 핵심어 자체를 다시 조회해 ① 이미 세는 검색이면 빼고 ② 숫자는 핵심어 자체의 것으로 ③ 한 달만 튄 것은 빼고 ④ 몇 달째 늘었는지
  const ours = await sql<Array<{ norm: string; series: number[] | null }>>`select norm, series from trend_keyword where market = ${market}`;
  const ourSet = { norms: new Set(ours.map((o) => o.norm)), seriesKeys: new Set(ours.flatMap((o) => (o.series ? [o.series.join(',')] : []))) };
  const terms = [...new Set(groups.map((g) => g.term))];
  const termRows = terms.length ? matchRows(terms, await kp.historical(terms, from, latest)) : new Map();
  const nameNow = new Map((await sql<Array<{ procedure_id: string; series: number[] | null }>>`
    select procedure_id, series from trend_keyword where market = ${market} and source = 'name' and procedure_id is not null`)
    .map((r) => [r.procedure_id, r.series ? avg3(r.series, r.series.length) : null]));
  const byJp = new Map(procs.map((p) => [norm(p.jp), p.id]));
  const keep = new Set<string>();
  let counted = 0, spiked = 0, notRising = 0;
  for (const g of groups) {
    const tr = termRows.get(g.term);
    const ts = toSeries(tr, from, latest);
    // 예시 검색어가 모두 우리 검색어와 4년치 숫자가 같으면(ボットクス と は = ボトックス と は) 이것도 이미 세는 검색
    const examplesCounted = g.texts.every((t) => { const r = raw.find((x) => x.text === t); return !!r && alreadyCounted({ series: r.series }, ourSet); });
    if (alreadyCounted({ text: tr?.text, closeVariants: tr?.closeVariants, series: ts }, ourSet) || examplesCounted) { counted++; continue; }
    const series = ts ?? g.series;  // 핵심어 자체 값이 없으면(값 없음) 대표 예시 검색어로
    const ofId = g.of ? byJp.get(norm(g.of)) ?? null : null;
    // 다른 표기 처리 — 같은 시술명 묶음(백옥주사 = 白玉点滴·グルタチオン点滴·白玉注射)의 가장 큰 우리 표기와 견준다
    const ofName = ofId ? procs.find((p) => p.id === ofId)?.name : undefined;
    const family = ofName ? procs.filter((p) => p.name === ofName) : [];
    const oursBest = family.reduce<{ jp: string; now: number } | null>((b, p) => { const v = nameNow.get(p.id) ?? 0; return !b || v > b.now ? { jp: p.jp, now: v } : b; }, null);
    const oursNow = oursBest ? oursBest.now : null;
    const tsNow = (ts ?? g.series).length ? avg3(ts ?? g.series, (ts ?? g.series).length) : 0;
    const action = g.kind === 'variant' ? variantAction(tsNow, oursNow, isBroadTerm(g.term, procs.map((p) => p.jp))) : null;
    // 핵심어 자체도 '늘어난 검색'이어야 — 긴 검색어 몇 개만 늘고 핵심어(シミ 월 3만)는 그대로·감소면 후보가 아니다(10-15: '1년 증가'에 −6,933이 뜨던 문제).
    // 단 표기 바꾸기 후보는 추세가 아니라 표기 문제라(ピコフラクセル 320 vs ピコフラクショナル 2.2만) 늘지 않아도 남긴다.
    if (ts && action !== 'replace' && !risingOnly([{ text: g.term, series: ts }]).length) { notRising++; continue; }
    const st = summarize(series, months);
    if (st.state === 'spiked') { spiked++; continue; }
    const now = avg3(series, series.length), increase = now - avg3(series, series.length - 12);
    // 같은 한국어 이름의 열린 후보가 이미 있으면(지난 실행에 口元シミ, 이번에 口元のシミ) 그 후보에 숫자만 갈아 끼운다 — 두 줄이 되지 않게
    if (g.ko) {
      const [same] = await sql<Array<{ id: string; norm: string }>>`select id, norm from trend_candidate where market = ${market} and kind = ${g.kind}
        and status = 'open' and ko = ${g.ko} and norm <> ${norm(g.term)} limit 1`;
      if (same) {
        keep.add(`${g.kind}|${same.norm}`);
        await sql`update trend_candidate set volume = ${Math.round(now)}, increase = ${Math.round(increase)}, texts = ${g.texts}, found_month = ${latest},
          rising_months = ${risingMonths(series)}, action = ${action}, ours_jp = ${oursBest?.jp ?? null}, ours_volume = ${oursBest ? Math.round(oursBest.now) : null} where id = ${same.id}`;
        continue;
      }
    }
    keep.add(`${g.kind}|${norm(g.term)}`);
    await sql`insert into trend_candidate (market, kind, term, norm, ko, of_procedure_id, texts, volume, increase, found_month, first_month, rising_months, action, ours_jp, ours_volume)
      values (${market}, ${g.kind}, ${g.term}, ${norm(g.term)}, ${g.ko}, ${ofId}, ${g.texts}, ${Math.round(now)}, ${Math.round(increase)}, ${latest}, ${latest}, ${risingMonths(series)}, ${action},
        ${oursBest?.jp ?? null}, ${oursBest ? Math.round(oursBest.now) : null})
      on conflict (market, kind, norm) do update set volume = excluded.volume, increase = excluded.increase, texts = excluded.texts,
        found_month = excluded.found_month, rising_months = excluded.rising_months, action = excluded.action, ours_jp = excluded.ours_jp, ours_volume = excluded.ours_volume,
        ko = coalesce(trend_candidate.ko, excluded.ko),
        of_procedure_id = coalesce(excluded.of_procedure_id, trend_candidate.of_procedure_id)
      where trend_candidate.status = 'open'`;
  }
  // 한국 관련성 — '韓国 + 핵심어' 검색량(두 어순 합) · 뜻 확인(새 시술·새 고민만 — 다른 표기는 기존 시술의 뜻을 따른다)
  const kept = await sql<Array<{ id: string; kind: string; term: string }>>`select id, kind, term from trend_candidate
    where market = ${market} and status = 'open' and kind in ('new', 'variant', 'concern') and found_month = ${latest}`;
  if (kept.length) {
    const kw = kept.flatMap((c) => [`韓国 ${c.term}`, `${c.term} 韓国`]);
    const rows = matchRows(kw, await kp.historical(kw, from, latest));
    for (const c of kept) {
      const k = [`韓国 ${c.term}`, `${c.term} 韓国`].reduce((s, t) => { const v = toSeries(rows.get(t), from, latest); return s + (v ? avg3(v, v.length) : 0); }, 0);
      await sql`update trend_candidate set korea = ${Math.round(k)} where id = ${c.id}`;
    }
  }
  // 이번 실행에 안 걸린 열린 후보는 바로 지우지 않는다 — 모델 분류가 실행마다 조금씩 달라(肌育注射를 肌育으로 줄이는 등) 중요한 후보가
  // 나타났다 사라졌다 했다(10-15). 핵심어를 다시 조회해 아직 늘어난 검색이고(또는 표기 바꾸기) 이미 세는 검색이 아니면 숫자만 갈아 끼워 남긴다.
  const open = await sql<Array<{ id: string; kind: string; norm: string; term: string; action: string | null }>>`
    select id, kind, norm, term, action from trend_candidate where market = ${market} and status = 'open'`;
  const stale = open.filter((o) => !keep.has(`${o.kind}|${o.norm}`));
  if (stale.length) {
    const rows = matchRows(stale.map((o) => o.term), await kp.historical(stale.map((o) => o.term), from, latest));
    const drop: string[] = [];
    for (const o of stale) {
      const r = rows.get(o.term);
      const v = toSeries(r, from, latest);
      // 표기 바꾸기였다가 넓은 말로 판정되면 늘어난 검색이어야 남는다
      if (o.action === 'replace' && isBroadTerm(o.term, procs.map((p) => p.jp))) o.action = 'add';
      const still = v && !alreadyCounted({ text: r?.text, closeVariants: r?.closeVariants, series: v }, ourSet)
        && summarize(v, months).state !== 'spiked' && (o.action === 'replace' || risingOnly([{ text: o.term, series: v }]).length > 0);
      if (!still || !v) { drop.push(o.id); continue; }
      // 넓은 말 판정이 생기기 전에 '바꾸기'로 남은 후보는 '더하기'로 낮춘다
      const action = o.action === 'replace' && isBroadTerm(o.term, procs.map((p) => p.jp)) ? 'add' : o.action;
      await sql`update trend_candidate set volume = ${Math.round(avg3(v, v.length))}, increase = ${Math.round(avg3(v, v.length) - avg3(v, v.length - 12))},
        rising_months = ${risingMonths(v)}, found_month = ${latest}, action = ${action} where id = ${o.id}`;
    }
    if (drop.length) await sql`delete from trend_candidate where id in ${sql(drop)}`;
  }
  return { raw: raw.length, groups: groups.length, counted, spiked, notRising, kept: keep.size };
}

export const CANDIDATE_CLASSIFY_SYSTEM = (glossary: string) =>
  `일본 구글 검색어 중 '우리 시술 목록에 없는 말'을 분류한다. 목록(일본어=한국어): ${glossary}\n`
  + '분류: new = 목록에 없는 새 시술·장비·주사·제품명(핵심어를 term에) / variant = 목록 시술의 다른 표기·오타·새 통칭(어느 시술인지 목록의 일본어를 of에) / '
  + 'concern = 피부 고민·증상 / self = 화장품·셀프케어·가정용 / clinic = 병원 이름 / other = 그 밖(일반어). 같은 핵심어 검색어는 term을 같게.\n'
  + 'term은 검색어 안에 실제로 들어 있는 시술·제품·고민 이름을 띄어쓰기 없이 그대로(줄이거나 바꾸지 말 것 — 肌育注射를 肌育으로 줄이지 않는다). 수식어(とは·効果·値段·おすすめ 등)는 뺀다.';

// ── 화면(후보 패널) ──
export interface CandidateRow {
  id: string; kind: CandidateKind; term: string; ko: string | null; texts: string[]; volume: number; increase: number; foundMonth: string;
  of: { id: string; name: string; jp: string } | null; status: 'open' | 'added' | 'ignored';
  firstMonth: string | null; risingMonths: number | null; action: 'add' | 'replace' | null; korea: number | null;
  ours: { jp: string; volume: number | null } | null;  // 표기 바꾸기 확인용 — 비교한 우리 표기
  serp: { derm: number; med: number; self: number; unrelated: number; note: string } | null;
}

export async function listCandidates(sql: postgres.Sql, market: string): Promise<CandidateRow[]> {
  const rows = await sql<Array<{ id: string; kind: CandidateKind; term: string; ko: string | null; texts: string[]; volume: number; increase: number; found_month: string; of_id: string | null; of_name: string | null; of_jp: string | null; status: CandidateRow['status'];
    first_month: string | null; rising_months: number | null; action: CandidateRow['action']; korea: number | null; serp: CandidateRow['serp']; ours_jp: string | null; ours_volume: number | null }>>`
    select c.id, c.kind, c.term, c.ko, c.texts, c.volume, c.increase, c.found_month, p.id as of_id, p.name as of_name, p.jp as of_jp, c.status,
      c.first_month, c.rising_months, c.action, c.korea, c.serp, c.ours_jp, c.ours_volume
    from trend_candidate c left join trend_procedure p on p.id = c.of_procedure_id
    where c.market = ${market} and c.status = 'open' order by (coalesce(c.korea, 0) >= 50) desc, c.increase desc`;  // 한국 검색이 있는 후보 먼저(한국 클리닉 관련성)
  return rows.map((r) => ({ id: r.id, kind: r.kind, term: r.term, ko: r.ko, texts: r.texts, volume: r.volume, increase: r.increase, foundMonth: r.found_month,
    of: r.of_id ? { id: r.of_id, name: r.of_name ?? '', jp: r.of_jp ?? '' } : null, status: r.status,
    firstMonth: r.first_month, risingMonths: r.rising_months, action: r.action, korea: r.korea, serp: r.serp,
    ours: r.ours_jp ? { jp: r.ours_jp, volume: r.ours_volume } : null }));
}

export async function decideCandidate(sql: postgres.Sql, market: string, id: string, status: 'added' | 'ignored', by: string): Promise<boolean> {
  const r = await sql`update trend_candidate set status = ${status}, decided_at = now(), decided_by_name = ${by} where market = ${market} and id = ${id} and status = 'open'`;
  return r.count > 0;
}

// [○○에 더하기]·[고민으로 추가] — 사람이 칸을 채울 필요가 없는 두 경우. 다른 표기는 그 시술과 같은 분류·같은 이름으로 넣어 한 줄로 묶인다.
export async function candidateProcedure(sql: postgres.Sql, market: string, id: string): Promise<{ name: string; kr: string; jp: string; en: string; major: string; middle: string } | null> {
  const [c] = await sql<Array<{ kind: CandidateKind; term: string; ko: string | null; major: string | null; middle: string | null; name: string | null; kr: string | null; action: string | null }>>`
    select c.kind, c.term, c.ko, c.action, p.major, p.middle, p.name, p.kr from trend_candidate c left join trend_procedure p on p.id = c.of_procedure_id
    where c.market = ${market} and c.id = ${id} and c.status = 'open'`;
  if (!c) return null;
  if (c.kind === 'variant' && c.action === 'replace') return null;  // 표기 바꾸기는 새 행이 아니라 그 시술의 일본어를 고친다(라우트)
  if (c.kind === 'variant' && c.name && c.major) return { name: c.name, kr: c.ko ?? c.kr ?? c.name, jp: c.term, en: '', major: c.major, middle: c.middle ?? '' };
  if (c.kind === 'concern') return { name: c.ko ?? c.term, kr: c.ko ?? c.term, jp: c.term, en: '', major: '피부 고민', middle: '' };
  return null;  // 새 시술은 이름·분류를 사람이 정한다(양식)
}
