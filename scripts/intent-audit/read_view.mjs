// 운영 DB 읽기 전용 — 지금 화면 완성본(trend_view jp)의 의도 부분만 받는다(비교 기준).
// 실행: node --env-file=<.env> scripts/intent-audit/read_view.mjs → data/view-intent.json
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const [r] = await sql.begin('read only', (tx) => tx`select built_at, doc from trend_view where market = 'jp'`);
  writeFileSync(new URL('./data/view-intent.json', import.meta.url), JSON.stringify(r.doc.intent));
  console.log('built_at', r.built_at.toISOString(), 'intent', Object.keys(r.doc.intent).length);
} finally { await sql.end(); }
