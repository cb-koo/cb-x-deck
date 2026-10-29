// 완전 사이클 대상 등록 — 한국어 시술명(묶음 대표)을 주면 운영 DB(읽기 전용)에서 id·일본어·묶음 구성을 읽어 procs.json에 더한다.
// 실행: node --env-file=<.env> --import tsx scripts/intent-audit/make_registry.mts 쿨웨이브 PDRN …
import postgres from 'postgres';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const F = new URL('./procs.json', import.meta.url);
const reg = existsSync(F) ? JSON.parse(readFileSync(F, 'utf8')) : {};
const view = JSON.parse(readFileSync(new URL('./data/view-intent.json', import.meta.url), 'utf8')) as Record<string, { members?: Array<{ id: string; jp: string }> }>;
const EXTRA = ['効果 ', 'ダウンタイム ', '違い', '何', 'と', '失敗 ', '回数'];  // 시범에서 수확이 컸던 공통 추가 입력(시술명 뒤)
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const procs = await sql.begin('read only', (tx) => tx<Array<{ id: string; kr: string; jp: string }>>`select id, kr, jp from trend_procedure where market = 'jp' and not hidden`);
  for (const kr of process.argv.slice(2)) {
    const p = procs.find((x) => x.kr === kr && view[x.id]) ?? procs.find((x) => x.kr.replace(/\s/g, '') === kr.replace(/\s/g, '') && view[x.id]);
    if (!p) { console.log('못 찾음', kr); continue; }
    const ids = view[p.id].members?.map((m) => m.id) ?? [p.id];
    const marks = [...new Set(procs.filter((x) => ids.includes(x.id)).map((x) => x.jp))];
    const key = p.id;
    reg[key] = { pid: p.id, kr: p.kr, name: p.jp, ids, marks, extras: EXTRA.map((e) => `${p.jp} ${e}`), noise: ['求人', '家庭用', 'セルフ', '通販', '個人輸入', '楽天', 'amazon', 'Amazon'] };
    console.log(key, p.kr, p.jp, ids.join(','), marks.join('/'));
  }
  writeFileSync(F, JSON.stringify(reg, null, 1));
} finally { await sql.end(); }
