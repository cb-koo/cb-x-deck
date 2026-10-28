// 운영 DB 읽기 전용 — 시범 시술(리쥬란·HIFU·포텐자)의 일본 검색어 전체를 받는다. b2b-marketing read_thermage_keywords.mjs 일반화.
// 실행: node --env-file=<.env> scripts/intent-audit/read_keywords.mjs   (read only 트랜잭션, 쓰기 없음, 접속 정보 출력 안 함)
import postgres from 'postgres';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const D = (f) => fileURLToPath(new URL(`./data/${f}`, import.meta.url));
mkdirSync(D(''), { recursive: true });
// 묶음 멤버 id는 trends_intent의 members 기준(p28 리쥬란 5개, p49 HIFU, p127 포텐자 2개)
const PROCS = {
  rejuran: { ids: ['p28', 'p132', 'p175', 'p189', 'p191'], marks: ['リジュラン', 'りじゅらん', 'rejuran'] },
  hifu: { ids: ['p49'], marks: ['ハイフ', 'はいふ', 'hifu'] },
  potenza: { ids: ['p127', 'p268'], marks: ['ポテンツァ', 'ぽてんつぁ', 'potenza', 'マックーム'] },
};
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  for (const [key, { ids, marks }] of Object.entries(PROCS)) {
    const likes = marks.map((m) => `%${m}%`);
    const rows = await sql.begin('read only', (tx) => tx`
      select k.text, k.norm, k.procedure_id, p.name, p.jp, k.source, k.ko, k.intent_override, k.series, k.series_start
      from trend_keyword k left join trend_procedure p on p.id = k.procedure_id
      where k.market = 'jp' and (k.procedure_id = any(${ids}) or lower(k.norm) like any(${likes}))`);
    writeFileSync(D(`db-${key}.json`), JSON.stringify(rows));
    const own = rows.filter((r) => ids.includes(r.procedure_id));
    console.log(key, 'keywords', rows.length, 'own procedure', own.length, 'with series', rows.filter((r) => r.series).length);
  }
} finally { await sql.end(); }
