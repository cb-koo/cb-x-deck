// 검색 트렌드 처음 가져오기(스펙 2026-10-13 §7) — 시안 단계에서 모은 데이터(시술 목록 + 키워드 플래너 응답 + 번역 + 검색 결과 분류)를
// 074 테이블에 넣고 화면 완성본(trend_view)을 만든다. 시트는 다시 읽지 않는다(가져온 뒤엔 앱이 원본).
// 기본은 드라이런 — 같은 데이터로 완성본을 만들어 시안(src/app/trends/intent.json)과 같은지 비교만 한다. 실제로 쓰려면 --apply.
// 실행: node --env-file=.env.staging --import tsx scripts/import-search-trends.ts <수집 데이터 폴더> [--apply]
//   폴더: ideas/{id}.json · template.json · korea.json · korea2.json · ko-map.json · serp-class2.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSql } from '../src/lib/db.ts';
import { norm, ownerOf } from '../src/lib/searchIntent.ts';
import { buildTrendView, showKeyword, type TrendKeywordInput } from '../src/lib/trendBuild.ts';
import { upsertProcedures, upsertKeywords, rebuildView, type ProcedureWrite, type KeywordWrite } from '../src/lib/trendStore.ts';

const [dir, flag] = process.argv.slice(2);
if (!dir) { console.error('사용법: import-search-trends.ts <수집 데이터 폴더> [--apply]'); process.exit(1); }
const apply = flag === '--apply';
const MARKET = 'jp';

type MV = { monthlySearches?: string };
type KP = { text: string; keywordMetrics?: { monthlySearchVolumes?: MV[] }; keywordIdeaMetrics?: { monthlySearchVolumes?: MV[] } };
const vals = (m?: MV[]) => (m ?? []).map((x) => Number(x.monthlySearches ?? 0));
const read = <T>(f: string, fallback: T): T => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : fallback);

const snap = JSON.parse(readFileSync('src/app/trends/snapshot.json', 'utf8')) as {
  months: string[]; fetchedAt: string;
  procedures: Array<{ id: string; major: string; majorOrder: number; middle: string; name: string; kr: string; jp: string; en: string; volumes: number[] | null; sheet?: Record<string, unknown>; added?: string }>;
};
const N = snap.months.length;
const seriesStart = `${snap.months[0]}-01`;
const serp = read<Record<string, { derm?: number; med?: number; self?: number; unrelated?: number; note?: string }>>('serp-class2.json', {});
const KO = read<Record<string, string>>('ko-map.json', {});
const byText = new Map([...read<KP[]>('korea.json', []), ...read<KP[]>('korea2.json', []), ...read<KP[]>('template.json', [])]
  .map((r) => [norm(r.text), vals(r.keywordMetrics?.monthlySearchVolumes)]));

const MODS = ['とは', '違い', 'おすすめ', '効果', '口コミ', '経過', 'ビフォーアフター', 'ダウンタイム', '痛み', '副作用', '失敗', '値段', '料金', '安い', '東京', '大阪', 'クリニック'];
const combos = (n: string) => [`韓国 ${n}`, `${n} 韓国`, `韓国 ${n} 値段`, `韓国 ${n} 安い`, `韓国 ${n} おすすめ`, `ソウル ${n}`, `江南 ${n}`, `明洞 ${n}`, `${n} 明洞`, `弘大 ${n}`, `${n} 弘大`, `ホンデ ${n}`, `${n} ホンデ`];

const procedures: ProcedureWrite[] = snap.procedures.map((p) => {
  const s = serp[p.id];
  return {
    id: p.id, market: MARKET, major: p.major, majorOrder: p.majorOrder, middle: p.middle, name: p.name, kr: p.kr, jp: p.jp, en: p.en,
    sheet: p.sheet ?? null, note: p.added ?? null,
    serp: s ? { derm: s.derm ?? 0, med: s.med ?? 0, self: s.self ?? 0, unrelated: s.unrelated ?? 0, note: s.note ?? '' } : null,
  };
});

// 검색어 — 시안 분석기와 같은 순서(연관 검색어 → 이름 → 한국 조합 → 수식어)로 시술마다 모은다
const ALL = [...new Set(snap.procedures.map((p) => p.jp))];
const ideaFiles = new Map(readdirSync(join(dir, 'ideas')).map((f) => { const d = JSON.parse(readFileSync(join(dir, 'ideas', f), 'utf8')); return [d.id as string, d.results as KP[]]; }));
const keywords: Array<KeywordWrite & { procedureId: string }> = [];
const seen = new Set<string>();
// 같은 검색어(띄어쓰기만 다른 것 포함)는 한 번만 — 키워드 플래너가 'ハイフ 効果'와 'ハイフ効果'를 따로 주면 시안은 두 번 셌다
const add = (k: KeywordWrite & { procedureId: string }) => { const key = norm(k.text); if (seen.has(key)) return; seen.add(key); keywords.push(k); };
const seenJp = new Set<string>();
for (const p of snap.procedures) {
  if (seenJp.has(norm(p.jp))) continue;
  seenJp.add(norm(p.jp));
  const ko = (t: string) => KO[showKeyword(t)] ?? null;
  for (const r of ideaFiles.get(p.id) ?? []) {
    if (ownerOf(r.text, ALL) !== p.jp) continue;
    const v = vals(r.keywordIdeaMetrics?.monthlySearchVolumes);
    // 연관 검색어로 대표 검색어 자체가 오면 그게 이름 검색 — 출처를 'name'으로(화면의 시술명 검색량·값 없음 판정이 이걸 본다)
    if (v.length === N) add({ text: r.text, source: norm(r.text) === norm(p.jp) ? 'name' : 'idea', series: v, seriesStart, ko: ko(r.text), procedureId: p.id });
  }
  add({ text: p.jp, source: 'name', series: p.volumes && p.volumes.length === N ? p.volumes : null, seriesStart, ko: null, procedureId: p.id });
  for (const t of combos(p.jp)) { const v = byText.get(norm(t)); if (v && v.length === N) add({ text: t, source: 'korea', series: v, seriesStart, ko: ko(t), procedureId: p.id }); }
  for (const t of MODS.map((m) => `${p.jp} ${m}`)) { const v = byText.get(norm(t)); if (v && v.length === N) add({ text: t, source: 'template', series: v, seriesStart, ko: ko(t), procedureId: p.id }); }
}
console.log(`시술 ${procedures.length} · 검색어 ${keywords.length} (값 있음 ${keywords.filter((k) => k.series).length})`);

// 시안과 비교 — 같은 데이터면 화면 값이 같아야 한다
const doc = buildTrendView({
  market: MARKET, fetchedAt: snap.fetchedAt, months: snap.months, procedures,
  keywords: keywords.map((k): TrendKeywordInput => ({ text: k.text, procedureId: k.procedureId, source: k.source, ko: k.ko, series: k.series })),
});
const proto = JSON.parse(readFileSync('src/app/trends/intent.json', 'utf8')) as Record<string, { total: number[]; stage: string | null; ambiguous: boolean; noName: number[] }>;
let same = 0, small = 0; const diff: string[] = [];
const last3 = (v: number[]) => v.slice(-3).reduce((a, b) => a + b, 0) / 3;
for (const [id, v] of Object.entries(proto)) {
  const d = doc.intent[id];
  if (d && d.total.join() === v.total.join() && d.stage === v.stage && d.ambiguous === v.ambiguous && d.noName.join() === v.noName.join()) same++;
  // 같은 검색어가 시안에선 두 시술에 겹쳐 세지기도 했다(시술마다 따로 모아서) — 지금은 한 곳에만 센다. 판정이 바뀌는 차이만 따로 센다.
  else if (d && d.stage === v.stage && d.ambiguous === v.ambiguous && Math.abs(last3(d.total) - last3(v.total)) <= 0.02 * Math.max(1, last3(v.total))) small++;
  else { diff.push(id); console.log('  다름', id, '시안', Math.round(last3(v.total)), v.stage, '→', d ? Math.round(last3(d.total)) : '-', d?.stage); }
}
const noVal = (xs: Array<{ volumes: number[] | null }>) => xs.filter((p) => !p.volumes).length;
console.log(`시술명 값 없음: 시안 ${noVal(snap.procedures)} · 새 ${noVal(doc.procedures)}`);
console.log(`시안 대비: 묶음 ${Object.keys(proto).length} 중 같음 ${same} · 2% 이내 차이 ${small}${diff.length ? ` · 다름 ${diff.length} (${diff.slice(0, 10).join(', ')})` : ''} · 새 묶음 ${Object.keys(doc.intent).length - Object.keys(proto).length}`);

async function write() {
  const sql = getSql();
  const [run] = await sql<Array<{ id: string }>>`insert into trend_run (market, kind, latest_month) values (${MARKET}, 'import', ${snap.months[N - 1]}) returning id`;
  await upsertProcedures(sql, procedures);
  const written = await upsertKeywords(sql, MARKET, keywords);
  await sql`update trend_procedure set ideas_at = ${snap.fetchedAt}::date where market = ${MARKET} and ideas_at is null`;
  const built = await rebuildView(sql, MARKET);
  await sql`update trend_run set finished_at = now(), detail = ${sql.json({ procedures: procedures.length, keywords: written, families: Object.keys(built.intent).length })} where id = ${run.id}`;
  console.log(`썼어요: 시술 ${procedures.length} · 검색어 ${written} · 완성본 묶음 ${Object.keys(built.intent).length} (${built.months[0]} ~ ${built.months[built.months.length - 1]})`);
  await sql.end();
}

if (!apply) console.log('드라이런 — 쓰려면 --apply');
else write().catch((e) => { console.error(e); process.exit(1); });
