// 규칙 바꾼 영향 미리 보기 — 운영 DB 읽기 전용 트랜잭션에서 새 코드로 완성본을 계산하고, 저장된 trend_view(지금 화면)와 비교한다. 쓰기 없음.
// 실행: node --env-file=<.env> --import tsx scripts/intent-audit/preview.mts > scripts/intent-audit/data/preview.txt
import postgres from 'postgres';
import { computeView, readView } from '../../src/lib/trendStore.ts';
import { STAGE_LABEL, type Stage } from '../../src/lib/searchIntent.ts';

const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
const L = (s: Stage | null | undefined) => (s ? STAGE_LABEL[s] : '보류');
const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;
try {
  const { before, after } = await sql.begin('read only', async (tx) => {
    const v = await readView(tx as unknown as postgres.Sql, 'jp');
    return { before: v!.doc, after: await computeView(tx as unknown as postgres.Sql, 'jp') };
  });
  const name = new Map(after.procedures.map((p) => [p.id, p.kr]));
  const last12 = (xs: number[]) => xs.slice(-12).reduce((a, b) => a + b, 0);
  const rows = Object.entries(after.intent).map(([id, a]) => {
    const b = before.intent[id];
    return { id, kr: name.get(id) ?? id, vol: last12(a.total), b, a, info: [b?.profile?.info, a.profile?.info] as const,
      stageChanged: L(b?.stage) !== L(a.stage), totalDiff: b ? last12(b.total) - last12(a.total) : 0 };
  });
  const changed = rows.filter((r) => r.stageChanged).sort((x, y) => y.vol - x.vol);
  const infoMoved = rows.filter((r) => Math.abs((r.info[0] ?? 0) - (r.info[1] ?? 0)) >= 0.05);
  console.log(`묶음 ${rows.length}개 · 단계 바뀐 것 ${changed.length}개 · 개념·비교 비중 5%p 이상 바뀐 것 ${infoMoved.length}개`);
  console.log(`단계 이동: ${Object.entries(changed.reduce((m, r) => { const k = `${L(r.b?.stage)}→${L(r.a.stage)}`; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const other = rows.filter((r) => !infoMoved.includes(r) && JSON.stringify(r.b?.profile) !== JSON.stringify(r.a.profile));
  console.log(`그 밖에 비율이 바뀐 묶음 ${other.length}개(5%p 미만)`);
  console.log('\n시술|12개월 검색량(새)|단계|개념·비교|효과·후기|부작용·통증|가격|병원·지역|빠진 검색량(12개월)');
  for (const r of infoMoved.sort((x, y) => y.vol - x.vol)) {
    const p0 = r.b?.profile, p1 = r.a.profile;
    console.log(`${r.kr}|${r.vol.toLocaleString()}|${L(r.b?.stage)}→${L(r.a.stage)}|${pct(p0?.info)}→${pct(p1?.info)}|${pct(p0?.effect)}→${pct(p1?.effect)}|${pct(p0?.worry)}→${pct(p1?.worry)}|${pct(p0?.cost)}→${pct(p1?.cost)}|${pct(p0?.place)}→${pct(p1?.place)}|${r.totalDiff.toLocaleString()}`);
  }
} finally { await sql.end(); }
