// 주인 규칙(고민어보다 시술명) 미리보기 — 지금 DB 검색어 중 주인이 바뀌는 것을 센다(reassignOwners와 같은 조건). 쓰기 없음.
import postgres from 'postgres';
import { ownerResolver } from '../../src/lib/trendStore.ts';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const { procs, kws } = await sql.begin('read only', async (tx) => ({
    procs: await tx<Array<{ id: string; jp: string; kr: string }>>`select id, jp, kr from trend_procedure where market = 'jp' and not hidden`,
    kws: await tx<Array<{ text: string; procedure_id: string | null; source: string; series: number[] | null }>>`select text, procedure_id, source, series from trend_keyword where market = 'jp'`,
  }));
  const owner = ownerResolver(procs); const kr = new Map(procs.map((p) => [p.id, p.kr]));
  const moves = kws.filter((k) => !((k.source === 'name' || k.source === 'korea') && k.procedure_id)).map((k) => ({ ...k, next: owner(k.text) })).filter((k) => k.next !== k.procedure_id);
  const v = (k: { series: number[] | null }) => (k.series ?? []).slice(-12).reduce((a, b) => a + b, 0) / 12;
  const pairs = new Map<string, { n: number; v: number }>();
  for (const m of moves) { const key = `${kr.get(m.procedure_id ?? '') ?? '없음'} → ${kr.get(m.next ?? '') ?? '없음'}`; const p = pairs.get(key) ?? { n: 0, v: 0 }; p.n++; p.v += v(m); pairs.set(key, p); }
  console.log(`주인 바뀌는 검색어 ${moves.length}개 · 월 ${Math.round(moves.reduce((a, m) => a + v(m), 0)).toLocaleString()}`);
  console.log([...pairs].sort((a, b) => b[1].v - a[1].v).slice(0, 15).map(([k, p]) => `${k}: ${p.n}개 월 ${Math.round(p.v).toLocaleString()}`).join('\n'));
  console.log('상위 예:', moves.sort((a, b) => v(b) - v(a)).slice(0, 8).map((m) => `${m.text}=${Math.round(v(m))}`).join(', '));
} finally { await sql.end(); }
