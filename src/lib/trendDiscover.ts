import type postgres from 'postgres';
import { norm } from './searchIntent';
import { ownerResolver } from './trendStore';
import { addMonths, toSeries, WINDOW, type KpClient } from './trendCollect';

// 새로 뜨는 검색(스펙 2026-10-13 §11, koo 10-15) — 새 달을 받은 뒤 넓은 검색어 몇 개로 연관 검색어를 받아,
// 우리 시술 목록에 없는데 1년 새 늘어난 검색을 후보로 남긴다. 무엇인지(새 시술·다른 표기·고민·제외)는 모델이 가르고, 추가는 사람이 고른다.
// 10-15 실측: 걸린 51개 중 새 시술은 루메카 1개, 다른 표기 8(ボットクス 월 5.2만 = 보톡스 오타, 肌育注射 = 스킨부스터),
// 고민 9(毛穴メラニン 월 2만), 나머지는 화장품·병원 이름·일반어 — 분류 없이 보여 주면 쓸 수 없다.

// 넓은 검색어 — 분류마다 하나 이상, 한국 미용 수요 포함
export const DISCOVER_SEEDS = [
  '美容皮膚科', '韓国 美容皮膚科', '美容医療', '肌育注射', 'スキンブースター', 'ハイフ', 'リフトアップ 施術', 'ボトックス', 'ヒアルロン酸 注入',
  'ピーリング', 'レーザー 美容', 'シミ取り', '肝斑 治療', '毛穴 治療', 'ニキビ跡 治療', '医療脱毛', '脂肪溶解注射', '美容点滴', 'アートメイク', 'たるみ 治療',
];

// 문턱 — 주목 시술(trendNotable)보다 낮게: 아직 작은 새 말을 일찍 잡는 게 목적
export const DISCOVER = { minVolume: 300, minIncrease: 300, minRatio: 1.3, newBelow: 100 } as const;

export type CandidateKind = 'new' | 'variant' | 'concern' | 'self' | 'clinic' | 'other';
export interface RawCandidate { text: string; now: number; yearAgo: number; increase: number }
export interface Classified { text: string; kind: CandidateKind; term: string; of?: string | null; ko?: string | null }
export type ClassifyFn = (texts: string[], glossary: string) => Promise<Classified[]>;

const avg3 = (v: number[], end: number) => v.slice(end - 3, end).reduce((s, x) => s + x, 0) / 3;

// 늘어난 검색만 — 월 300 이상, 1년 새 +300건 이상, +30% 이상(1년 전 거의 없으면 신규로 통과)
export function risingOnly(rows: Array<{ text: string; series: number[] }>): RawCandidate[] {
  const out: RawCandidate[] = [];
  for (const r of rows) {
    const n = r.series.length;
    if (n < 15) continue;
    const now = avg3(r.series, n), yearAgo = avg3(r.series, n - 12), increase = now - yearAgo;
    if (now < DISCOVER.minVolume || increase < DISCOVER.minIncrease) continue;
    if (yearAgo >= DISCOVER.newBelow && now / yearAgo < DISCOVER.minRatio) continue;
    out.push({ text: r.text, now: Math.round(now), yearAgo: Math.round(yearAgo), increase: Math.round(increase) });
  }
  return out;
}

export interface CandidateGroup { kind: CandidateKind; term: string; ko: string | null; of: string | null; texts: string[]; volume: number; increase: number }

// 같은 핵심어로 분류된 검색어끼리 묶는다 — 어순·띄어쓰기만 다른 검색어(クレンジング ピーリング / ピーリング クレンジング)가 한 후보가 되게
export function groupCandidates(raw: RawCandidate[], cls: Classified[]): CandidateGroup[] {
  const byText = new Map(raw.map((r) => [norm(r.text), r]));
  const groups = new Map<string, CandidateGroup>();
  for (const c of cls) {
    const r = byText.get(norm(c.text));
    if (!r || !c.term) continue;
    const key = `${c.kind}|${norm(c.term)}`;
    const g = groups.get(key) ?? { kind: c.kind, term: c.term, ko: c.ko ?? null, of: c.of ?? null, texts: [], volume: 0, increase: 0 };
    if (!g.texts.includes(r.text)) g.texts.push(r.text);
    g.volume = Math.max(g.volume, r.now);
    g.increase = Math.max(g.increase, r.increase);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.increase - a.increase);
}

// 한 번 돌리기 — 새 달마다 한 번(trend_run kind 'discover'). 이미 고른(추가·무시) 후보는 다시 올리지 않고, 열린 후보는 숫자만 갈아 끼운다.
export async function runDiscover(sql: postgres.Sql, kp: KpClient, market: string, latest: string, classify: ClassifyFn, gapMs = 1500): Promise<{ raw: number; groups: number }> {
  const from = addMonths(latest, -(WINDOW - 1));
  const procs = await sql<Array<{ id: string; jp: string; name: string }>>`select id, jp, name from trend_procedure where market = ${market} and not hidden`;
  const owner = ownerResolver(procs);
  const seen = new Map<string, { text: string; series: number[] }>();
  for (const seed of DISCOVER_SEEDS) {
    for (const r of await kp.ideas(seed, from, latest)) {
      if (owner(r.text)) continue;  // 이미 우리 시술의 검색어
      const series = toSeries(r, from, latest);
      if (series && !seen.has(norm(r.text))) seen.set(norm(r.text), { text: r.text, series });
    }
    if (gapMs) await new Promise((x) => setTimeout(x, gapMs));
  }
  const raw = risingOnly([...seen.values()]);
  if (!raw.length) return { raw: 0, groups: 0 };
  const glossary = [...new Map(procs.map((p) => [p.jp, p.name])).entries()].map(([j, n]) => `${j}=${n}`).join(', ');
  const groups = groupCandidates(raw, await classify(raw.map((r) => r.text), glossary));
  const byJp = new Map(procs.map((p) => [norm(p.jp), p.id]));
  for (const g of groups) {
    const ofId = g.of ? byJp.get(norm(g.of)) ?? null : null;
    await sql`insert into trend_candidate (market, kind, term, norm, ko, of_procedure_id, texts, volume, increase, found_month)
      values (${market}, ${g.kind}, ${g.term}, ${norm(g.term)}, ${g.ko}, ${ofId}, ${g.texts}, ${g.volume}, ${g.increase}, ${latest})
      on conflict (market, kind, norm) do update set volume = excluded.volume, increase = excluded.increase, texts = excluded.texts,
        found_month = excluded.found_month, ko = coalesce(trend_candidate.ko, excluded.ko),
        of_procedure_id = coalesce(excluded.of_procedure_id, trend_candidate.of_procedure_id)
      where trend_candidate.status = 'open'`;
  }
  return { raw: raw.length, groups: groups.length };
}

export const CANDIDATE_CLASSIFY_SYSTEM = (glossary: string) =>
  `일본 구글 검색어 중 '우리 시술 목록에 없는 말'을 분류한다. 목록(일본어=한국어): ${glossary}\n`
  + '분류: new = 목록에 없는 새 시술·장비·주사·제품명(핵심어를 term에) / variant = 목록 시술의 다른 표기·오타·새 통칭(어느 시술인지 목록의 일본어를 of에) / '
  + 'concern = 피부 고민·증상 / self = 화장품·셀프케어·가정용 / clinic = 병원 이름 / other = 그 밖(일반어). 같은 핵심어 검색어는 term을 같게.';

// ── 화면(후보 패널) ──
export interface CandidateRow {
  id: string; kind: CandidateKind; term: string; ko: string | null; texts: string[]; volume: number; increase: number; foundMonth: string;
  of: { id: string; name: string } | null; status: 'open' | 'added' | 'ignored';
}

export async function listCandidates(sql: postgres.Sql, market: string): Promise<CandidateRow[]> {
  const rows = await sql<Array<{ id: string; kind: CandidateKind; term: string; ko: string | null; texts: string[]; volume: number; increase: number; found_month: string; of_id: string | null; of_name: string | null; status: CandidateRow['status'] }>>`
    select c.id, c.kind, c.term, c.ko, c.texts, c.volume, c.increase, c.found_month, p.id as of_id, p.name as of_name, c.status
    from trend_candidate c left join trend_procedure p on p.id = c.of_procedure_id
    where c.market = ${market} and c.status = 'open' order by c.increase desc`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, term: r.term, ko: r.ko, texts: r.texts, volume: r.volume, increase: r.increase, foundMonth: r.found_month,
    of: r.of_id ? { id: r.of_id, name: r.of_name ?? '' } : null, status: r.status }));
}

export async function decideCandidate(sql: postgres.Sql, market: string, id: string, status: 'added' | 'ignored', by: string): Promise<boolean> {
  const r = await sql`update trend_candidate set status = ${status}, decided_at = now(), decided_by_name = ${by} where market = ${market} and id = ${id} and status = 'open'`;
  return r.count > 0;
}

// [○○에 더하기]·[고민으로 추가] — 사람이 칸을 채울 필요가 없는 두 경우. 다른 표기는 그 시술과 같은 분류·같은 이름으로 넣어 한 줄로 묶인다.
export async function candidateProcedure(sql: postgres.Sql, market: string, id: string): Promise<{ name: string; kr: string; jp: string; en: string; major: string; middle: string } | null> {
  const [c] = await sql<Array<{ kind: CandidateKind; term: string; ko: string | null; major: string | null; middle: string | null; name: string | null; kr: string | null }>>`
    select c.kind, c.term, c.ko, p.major, p.middle, p.name, p.kr from trend_candidate c left join trend_procedure p on p.id = c.of_procedure_id
    where c.market = ${market} and c.id = ${id} and c.status = 'open'`;
  if (!c) return null;
  if (c.kind === 'variant' && c.name && c.major) return { name: c.name, kr: c.ko ?? c.kr ?? c.name, jp: c.term, en: '', major: c.major, middle: c.middle ?? '' };
  if (c.kind === 'concern') return { name: c.ko ?? c.term, kr: c.ko ?? c.term, jp: c.term, en: '', major: '피부 고민', middle: '' };
  return null;  // 새 시술은 이름·분류를 사람이 정한다(양식)
}
