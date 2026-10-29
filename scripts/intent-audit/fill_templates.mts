// 정해 둔 조합(MODS 17개) 빈자리 채우기 — 시술마다 '시술명 + 말' 중 DB에 없는 것을 키워드 플래너로 조회한다.
// 처음 가져오기(10-14)가 그때 값 있던 조합만 넣어, 358개 중 17개 시술만 17개를 다 갖고 있었다(10-29 확인).
//   preview: 조회 → data/fill-templates.json 저장 → 운영 DB 읽기 전용으로 '넣었다면'의 화면을 계산해 지금 화면과 비교(쓰기 없음)
//   write:   저장해 둔 조회 결과를 trend_keyword에 넣고(source=template) trend_view를 다시 만든다(운영 DB 쓰기 — koo 확인 후)
// 실행: node --env-file=<.env> --import tsx scripts/intent-audit/fill_templates.mts preview|write
// 키워드 플래너는 로컬 Composio CLI(googleads 연결)로 부른다 — 앱 수집과 같은 계정·같은 해석 함수(parseKpRow·matchRows·toSeries).
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { MODS, addMonths, parseKpRow, matchRows, toSeries, type KpRow } from '../../src/lib/trendCollect.ts';
import { computeView, readView, upsertKeywords, rebuildView, type KeywordWrite } from '../../src/lib/trendStore.ts';
import { norm, STAGE_LABEL, type Stage } from '../../src/lib/searchIntent.ts';

const MODE = process.argv[2];
if (MODE !== 'preview' && MODE !== 'write') throw new Error('preview | write');
const D = (f: string) => new URL(`./data/${f}`, import.meta.url);
const CUSTOMER = '5852853331';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });

function historical(keywords: string[], from: string, to: string): KpRow[] {
  const MONTH = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const e = (ym: string) => ({ year: Number(ym.slice(0, 4)), month: MONTH[Number(ym.slice(5, 7)) - 1] });
  const f = new URL('./data/_req-fill.json', import.meta.url);
  writeFileSync(f, JSON.stringify({ geoTargetConstants: ['geoTargetConstants/2392'], language: 'languageConstants/1005', keywordPlanNetwork: 'GOOGLE_SEARCH',
    keywords, historicalMetricsOptions: { yearMonthRange: { start: e(from), end: e(to) } } }));
  const out = execFileSync('composio', ['proxy', `https://googleads.googleapis.com/v25/customers/${CUSTOMER}:generateKeywordHistoricalMetrics`,
    '--toolkit', 'googleads', '-X', 'POST', '-H', 'content-type: application/json', '-d', `@${f.pathname}`], { cwd: '/tmp', maxBuffer: 1 << 28 }).toString();
  unlinkSync(f);
  const d = JSON.parse(out);
  if (!d.results) throw new Error(out.slice(0, 300));
  return d.results.map(parseKpRow);
}

const L = (s: Stage | null | undefined) => (s ? STAGE_LABEL[s] : '보류');
const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;
const y12 = (xs: number[]) => xs.slice(-12).reduce((a, b) => a + b, 0);

try {
  if (MODE === 'preview') {
    const { procs, have, latest } = await sql.begin('read only', async (tx) => {
      const procs = await tx<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where market = 'jp' and not hidden order by id`;
      const have = new Set((await tx<Array<{ norm: string }>>`select norm from trend_keyword where market = 'jp'`).map((r) => r.norm));
      const [run] = await tx<Array<{ latest_month: string }>>`select latest_month from trend_run where market = 'jp' and kind in ('refresh', 'import')
        and finished_at is not null and latest_month is not null order by finished_at desc limit 1`;
      return { procs, have, latest: run.latest_month };
    });
    const from = addMonths(latest, -47);
    const seen = new Set<string>();
    const asks = procs.flatMap((p) => MODS.map((m) => ({ text: `${p.jp} ${m}`, id: p.id })))
      .filter((a) => !have.has(norm(a.text)) && !seen.has(norm(a.text)) && seen.add(norm(a.text)));
    console.log(`기간 ${from}~${latest} · 시술 ${procs.length}개 · 빈 조합 ${asks.length}개 조회`);
    const rows: KeywordWrite[] = [];
    for (let i = 0; i < asks.length; i += 1000) {
      const chunk = asks.slice(i, i + 1000);
      const hist = matchRows(chunk.map((a) => a.text), historical(chunk.map((a) => a.text), from, latest));
      for (const a of chunk) { const series = toSeries(hist.get(a.text), from, latest); if (series) rows.push({ text: a.text, source: 'template', series, seriesStart: `${from}-01`, procedureId: a.id }); }
      console.log(`  ${Math.min(i + 1000, asks.length)}/${asks.length} 조회, 값 있는 것 누적 ${rows.length}`);
    }
    writeFileSync(D('fill-templates.json'), JSON.stringify({ from, latest, asked: asks.length, rows }));
    const withVal = rows.filter((r) => r.series!.some((v) => v > 0));
    const byMod = Object.fromEntries(MODS.map((m) => [m, withVal.filter((r) => r.text.endsWith(` ${m}`)).length]));
    console.log(`값 있는 것 ${rows.length}개(0보다 큰 달이 있는 것 ${withVal.length}개) · 월 ${Math.round(withVal.reduce((a, r) => a + y12(r.series!), 0) / 12).toLocaleString()}`);
    console.log('말별', Object.entries(byMod).map(([m, n]) => `${m} ${n}`).join(', '));

    const { before, after } = await sql.begin('read only', async (tx) => {
      const v = await readView(tx as unknown as postgres.Sql, 'jp');
      return { before: v!.doc, after: await computeView(tx as unknown as postgres.Sql, 'jp', 48, rows) };
    });
    const name = new Map(after.procedures.map((p) => [p.id, p.kr]));
    const list = Object.entries(after.intent).map(([id, a]) => ({ id, kr: name.get(id) ?? id, a, b: before.intent[id], vol: y12(a.total) }));
    const KEYS = ['info', 'effect', 'worry', 'concern', 'cost', 'place', 'korea'] as const;
    const maxMove = (r: (typeof list)[number]) => Math.max(...KEYS.map((k) => Math.abs((r.a.profile?.[k] ?? 0) - (r.b?.profile?.[k] ?? 0))));
    const changed = list.filter((r) => L(r.b?.stage) !== L(r.a.stage));
    const moved = list.filter((r) => maxMove(r) >= 0.05);
    const out: string[] = [];
    out.push(`묶음 ${list.length}개 · 단계 바뀐 것 ${changed.length}개 · 의도 비중이 5%p 이상 바뀐 것 ${moved.length}개`);
    out.push(`단계 이동: ${Object.entries(changed.reduce((m, r) => { const k = `${L(r.b?.stage)}→${L(r.a.stage)}`; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>)).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    out.push('\n시술|12개월 검색량(전→후)|단계|개념·비교|효과·후기|부작용·통증|부위·대상|가격|병원·지역');
    for (const r of moved.sort((x, y) => y.vol - x.vol)) {
      const p0 = r.b?.profile, p1 = r.a.profile;
      out.push(`${r.kr}|${y12(r.b?.total ?? []).toLocaleString()}→${r.vol.toLocaleString()}|${L(r.b?.stage)}→${L(r.a.stage)}|` +
        KEYS.filter((k) => k !== 'korea').map((k) => `${pct(p0?.[k])}→${pct(p1?.[k])}`).join('|'));
    }
    writeFileSync(D('fill-preview.txt'), out.join('\n'));
    console.log(out.slice(0, 2).join('\n'));
  } else {
    const saved = JSON.parse(readFileSync(D('fill-templates.json'), 'utf8')) as { rows: KeywordWrite[] };
    const n = await upsertKeywords(sql, 'jp', saved.rows);
    const doc = await rebuildView(sql, 'jp');
    console.log('넣은 검색어', n, '· 완성본 다시 만듦, 묶음', Object.keys(doc.intent).length);
  }
} finally { await sql.end(); }
