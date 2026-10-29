// 동음이의 시술 점검 — HOMONYM 등록 시술마다 지금 규칙으로 '세는' 검색어(다른 뜻·제외가 아닌 것)를 검색량 순으로 보여 준다.
// 자동완성 후보(data/audit-new.csv)도 함께 본다. 운영 DB 읽기만.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { tagKeyword, norm, HOMONYM } from '../../src/lib/searchIntent.ts';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
const v = (s: number[] | null) => Math.round(((s ?? []).slice(-12).reduce((a, b) => a + b, 0)) / 12);
try {
  const rows = await sql<Array<{ text: string; jp: string; series: number[] | null }>>`
    select k.text, p.jp, k.series from trend_keyword k join trend_procedure p on p.id = k.procedure_id where k.market = 'jp'`;
  const cand = readFileSync(new URL('./data/audit-new.csv', import.meta.url), 'utf8').split('\n').slice(1)
    .map((l) => l.match(/^"(.+?)",(\d+),/)).filter(Boolean).map((m) => ({ text: m![1], v: Number(m![2]) }));
  for (const h of Object.keys(HOMONYM)) {
    const mine = rows.filter((r) => norm(r.jp) === h);
    if (!mine.length) { console.log(`\n## ${h}: DB 검색어 없음`); continue; }
    const jp = mine[0].jp;
    const counted = mine.filter((r) => !['noise', 'exclude', 'adjacent'].includes(tagKeyword(r.text, [jp])));
    const nc = cand.filter((c) => norm(c.text).includes(h) && !['noise', 'exclude', 'adjacent'].includes(tagKeyword(c.text, [jp])));
    console.log(`\n## ${h}: DB ${mine.length}개 중 세는 것 ${counted.length}개 월 ${counted.reduce((a, r) => a + v(r.series), 0).toLocaleString()}`);
    console.log('  DB:', counted.sort((a, b) => v(b.series) - v(a.series)).slice(0, 25).map((r) => `${norm(r.text)}=${v(r.series)}`).join(' '));
    if (nc.length) console.log('  새 후보:', nc.sort((a, b) => b.v - a.v).slice(0, 20).map((c) => `${norm(c.text)}=${c.v}`).join(' '));
  }
} finally { await sql.end(); }
