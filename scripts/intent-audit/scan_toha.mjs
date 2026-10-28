// 운영 DB 읽기 전용 — 전 시술에서 키워드 플래너가 'X と は'로 쪼개 돌려준 검색어(붙여 쓴 とは 이상값)를 센다.
// 실행: node --env-file=<.env> scripts/intent-audit/scan_toha.mjs
import postgres from 'postgres';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const rows = await sql.begin('read only', (tx) => tx`
    select k.text, k.norm, k.source, k.procedure_id, p.name, k.series from trend_keyword k join trend_procedure p on p.id = k.procedure_id
    where k.market = 'jp' and k.norm like '%とは'`);
  const y = (s) => (s ? s.slice(-12).reduce((a, b) => a + b, 0) / 12 : 0);
  const split = rows.filter((r) => /\sと\sは$/.test(r.text)), spaced = rows.filter((r) => !/\sと\sは$/.test(r.text));
  console.log('とは 검색어', rows.length, '쪼개진(と は)', split.length, '월', Math.round(split.reduce((a, r) => a + y(r.series), 0)),
    '/ 그 외', spaced.length, '월', Math.round(spaced.reduce((a, r) => a + y(r.series), 0)));
  console.log('쪼개진 쪽 source', Object.entries(split.reduce((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {})));
  console.log('그 외 source', Object.entries(spaced.reduce((m, r) => ((m[r.source] = (m[r.source] ?? 0) + 1), m), {})));
  const byProc = {};
  for (const r of split) (byProc[r.name] ??= []).push(y(r.series));
  const top = Object.entries(byProc).map(([n, v]) => [n, Math.round(v.reduce((a, b) => a + b, 0))]).sort((a, b) => b[1] - a[1]);
  console.log('시술 수', top.length, '상위', top.slice(0, 15).map(([n, v]) => `${n} ${v}`).join(', '));
  // 같은 norm으로 쪼개진 쪽과 띄어 쓴 쪽이 둘 다 있는 경우 — 배율
  const sp = new Map(spaced.map((r) => [r.norm, y(r.series)]));
  const pairs = split.filter((r) => sp.has(r.norm)).map((r) => [r.text, Math.round(y(r.series)), Math.round(sp.get(r.norm))]);
  console.log('둘 다 있는 쌍', pairs.length, pairs.slice(0, 10).map((p) => p.join('/')).join(', '));
  const other = spaced.slice().sort((a, b) => y(b.series) - y(a.series)).slice(0, 8).map((r) => `${r.text}=${Math.round(y(r.series))}`);
  console.log('그 외 상위', other.join(', '));
} finally { await sql.end(); }
