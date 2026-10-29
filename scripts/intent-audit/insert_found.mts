// 시범·완전 사이클에서 찾은 검색어 넣기 — 키워드 플래너 값이 있고 DB에 없는 것(data/kp-*.json)을 source=idea로.
// 주인 = 대시보드 규칙(ownerResolver, 고민어보다 시술명). 다른 뜻·제외로 걸리는 것과 검수(review-output.csv)에서 '무관'인 것은 넣지 않는다.
// 검수에서 '시술 밖 관심'인데 규칙이 못 알아보는 것은 사람이 고친 태그(intent_override = adjacent)로 넣는다.
//   preview: 넣었다면의 화면을 운영 DB 읽기 전용으로 계산해 지금 화면과 비교(쓰기 없음) → data/insert-preview.txt
//   write:   trend_keyword에 넣고 태그를 고친 뒤 trend_view를 다시 만든다(운영 DB 쓰기 — koo 확인 후, 새 규칙 배포 뒤)
// 실행: node --env-file=<.env> --import tsx scripts/intent-audit/insert_found.mts preview|write
import postgres from 'postgres';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseKpRow, toSeries, addMonths } from '../../src/lib/trendCollect.ts';
import { computeView, readView, upsertKeywords, rebuildView, ownerResolver, reassignOwners, type KeywordWrite } from '../../src/lib/trendStore.ts';
import { tagKeyword, norm, STAGE_LABEL, type Intent, type Stage } from '../../src/lib/searchIntent.ts';

const MODE = process.argv[2];
if (MODE !== 'preview' && MODE !== 'write') throw new Error('preview | write');
const D = (f: string) => new URL(`./data/${f}`, import.meta.url);
const reg = JSON.parse(readFileSync(new URL('./procs.json', import.meta.url), 'utf8')) as Record<string, { pid: string }>;
const KEYS = ['rejuran', 'hifu', 'potenza', 'botox', 'threadlift', 'dermapen', 'picotoning', 'lipolysis', ...Object.keys(reg).filter((k) => reg[k].pid !== 'p194')];
const review = new Map<string, string>();
for (const line of readFileSync(D('review-output.csv'), 'utf8').split('\n').slice(1)) {
  const m = line.match(/^"?(.+?)"?,(\d+),[^,]*,(adjacent|unrelated|unsure)\b/); if (m) review.set(norm(m[1]), m[3]);
}
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
const L = (s: Stage | null | undefined) => (s ? STAGE_LABEL[s] : '보류');
const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;
const y12 = (xs: number[] | undefined) => (xs ?? []).slice(-12).reduce((a, b) => a + b, 0);

try {
  const { procs, have, latest } = await sql.begin('read only', async (tx) => {
    const procs = await tx<Array<{ id: string; jp: string }>>`select id, jp from trend_procedure where market = 'jp' and not hidden`;
    const have = new Set((await tx<Array<{ norm: string }>>`select norm from trend_keyword where market = 'jp'`).map((r) => r.norm));
    const [run] = await tx<Array<{ latest_month: string }>>`select latest_month from trend_run where market = 'jp' and kind in ('refresh', 'import')
      and finished_at is not null and latest_month is not null order by finished_at desc limit 1`;
    return { procs, have, latest: run.latest_month };
  });
  const from = addMonths(latest, -47);
  const owner = ownerResolver(procs); const jpOf = new Map(procs.map((p) => [p.id, p.jp]));
  const rows: Array<KeywordWrite & { intentOverride?: Intent | null }> = []; const seen = new Set<string>();
  const skipped = { noOwner: 0, ruleDrop: 0, unrelated: 0 };
  for (const key of KEYS) {
    if (!existsSync(D(`kp-${key}.json`))) continue;
    for (const raw of JSON.parse(readFileSync(D(`kp-${key}.json`), 'utf8')).results) {
      const r = parseKpRow(raw); const series = toSeries(r, from, latest);
      if (!series || !series.some((v) => v > 0)) continue;
      const n = norm(r.text); if (have.has(n) || seen.has(n)) continue; seen.add(n);
      const o = owner(r.text); if (!o) { skipped.noOwner++; continue; }
      if (review.get(n) === 'unrelated') { skipped.unrelated++; continue; }
      const tag = tagKeyword(r.text, [jpOf.get(o)!]);
      if (tag === 'noise' || tag === 'exclude') { skipped.ruleDrop++; continue; }
      const override: Intent | null = review.get(n) === 'adjacent' && tag !== 'adjacent' ? 'adjacent' : null;
      rows.push({ text: r.text, source: 'idea', series, seriesStart: `${from}-01`, procedureId: o, intentOverride: override });
    }
  }
  console.log(`넣을 검색어 ${rows.length}개 · 월 ${Math.round(rows.reduce((a, r) => a + y12(r.series!), 0) / 12).toLocaleString()} · 태그 고침(시술 밖 관심) ${rows.filter((r) => r.intentOverride).length}개`,
    `· 뺀 것: 주인 없음 ${skipped.noOwner}, 규칙이 다른 뜻·제외 ${skipped.ruleDrop}, 검수 무관 ${skipped.unrelated}`);

  if (MODE === 'preview') {
    const { before, after } = await sql.begin('read only', async (tx) => {
      const v = await readView(tx as unknown as postgres.Sql, 'jp');
      return { before: v!.doc, after: await computeView(tx as unknown as postgres.Sql, 'jp', 48, rows, true) };
    });
    const name = new Map(after.procedures.map((p) => [p.id, p.kr]));
    const KEYS2 = ['info', 'effect', 'worry', 'concern', 'cost', 'place', 'korea'] as const;
    const list = Object.entries(after.intent).map(([id, a]) => ({ id, kr: name.get(id) ?? id, a, b: before.intent[id] }));
    const maxMove = (r: (typeof list)[number]) => Math.max(...KEYS2.map((k) => Math.abs((r.a.profile?.[k] ?? 0) - (r.b?.profile?.[k] ?? 0))));
    const changed = list.filter((r) => L(r.b?.stage) !== L(r.a.stage)), moved = list.filter((r) => maxMove(r) >= 0.05);
    const out = [`묶음 ${list.length}개 · 단계 바뀐 것 ${changed.length}개 · 의도 비중 5%p 이상 바뀐 것 ${moved.length}개`,
      `단계 이동: ${Object.entries(changed.reduce((m, r) => { const k = `${L(r.b?.stage)}→${L(r.a.stage)}`; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>)).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      '\n시술|12개월 검색량(전→후)|단계|개념·비교|효과·후기|부작용·통증|부위·대상|가격|병원·지역|시술 밖 관심(월)'];
    for (const r of [...new Set([...changed, ...moved])].sort((x, y) => y12(y.a.total) - y12(x.a.total))) {
      const p0 = r.b?.profile, p1 = r.a.profile;
      out.push(`${r.kr}|${y12(r.b?.total).toLocaleString()}→${y12(r.a.total).toLocaleString()}|${L(r.b?.stage)}→${L(r.a.stage)}|` +
        (['info', 'effect', 'worry', 'concern', 'cost', 'place'] as const).map((k) => `${pct(p0?.[k])}→${pct(p1?.[k])}`).join('|') + `|${Math.round(y12(r.a.adjacent) / 12).toLocaleString()}`);
    }
    writeFileSync(D('insert-preview.txt'), out.join('\n'));
    console.log(out.slice(0, 2).join('\n'));
  } else {
    // 되돌리기용 — 쓰기 전 검색어 주인·태그와 화면 완성본을 저장. 되돌릴 땐 넣은 norm을 지우고 주인·태그를 되돌린 뒤 저장해 둔 doc을 trend_view에 다시 쓴다
    const snap = await sql`select norm, procedure_id, intent_override from trend_keyword where market = 'jp'`;
    const [view] = await sql`select built_at, doc from trend_view where market = 'jp'`;
    writeFileSync(D(`rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ keywords: snap, inserted: rows.map((r) => norm(r.text)), view }));
    console.log('되돌리기 파일 저장', snap.length, '개 검색어');
    const moved = await reassignOwners(sql, 'jp');  // 새 주인 규칙으로 기존 검색어 주인 다시 정하기
    console.log('주인 다시 정함', moved);
    const n = await upsertKeywords(sql, 'jp', rows);
    const ov = rows.filter((r) => r.intentOverride);
    for (const r of ov) await sql`update trend_keyword set intent_override = ${r.intentOverride!} where market = 'jp' and norm = ${norm(r.text)}`;
    const doc = await rebuildView(sql, 'jp');
    console.log('넣은 검색어', n, '· 태그 고침', ov.length, '· 완성본 다시 만듦, 묶음', Object.keys(doc.intent).length);
  }
} finally { await sql.end(); }
