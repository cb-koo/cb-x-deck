// 정해 둔 말(MODS) 조합이 시술마다 저장돼 있나 — 운영 DB 읽기 전용. 같은 글자(정규화)가 idea로 들어와 있어도 있는 것으로 친다.
import postgres from 'postgres';
import { MODS } from '../../src/lib/trendCollect.ts';
import { norm } from '../../src/lib/searchIntent.ts';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const { procs, kws, runs } = await sql.begin('read only', async (tx) => ({
    procs: await tx<Array<{ id: string; jp: string; ideas_at: Date | null; created_at: Date | null }>>`select id, jp, ideas_at, null::timestamptz as created_at from trend_procedure where market = 'jp' and not hidden`,
    kws: await tx<Array<{ norm: string; source: string; procedure_id: string }>>`select norm, source, procedure_id from trend_keyword where market = 'jp'`,
    runs: await tx`select kind, started_at, finished_at, latest_month from trend_run where market = 'jp' order by started_at`,
  }));
  const have = new Set(kws.map((k) => k.norm));
  const per = MODS.map((m) => [m, procs.filter((p) => have.has(norm(`${p.jp} ${m}`))).length] as const);
  console.log(`시술 ${procs.length}개 — 말별로 저장된 시술 수:`, per.map(([m, n]) => `${m} ${n}`).join(', '));
  const full = procs.filter((p) => MODS.every((m) => have.has(norm(`${p.jp} ${m}`)))).length;
  console.log('17개 다 있는 시술', full, '/ ideas_at 없는 시술', procs.filter((p) => !p.ideas_at).length,
    '/ ideas_at 분포', JSON.stringify(procs.reduce((m, p) => { const k = p.ideas_at ? p.ideas_at.toISOString().slice(0, 10) : 'null'; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>)));
  console.log('수집 기록', runs.map((r) => `${r.kind} ${String(r.started_at.toISOString()).slice(0, 10)}`).join(', '));
} finally { await sql.end(); }
