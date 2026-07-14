// 기존 아카이브의 인용 트윗을 일괄 보강 — 고유 ID × $0.001, 캐시 보유분은 자동 제외.
// 실행: npm run backfill:quoted
import { getSql } from '../src/lib/db.ts';
import { makeClient } from '../src/lib/getxapi.ts';
import { enrichQuoted } from '../src/lib/quotedEnrich.ts';

async function main() {
  const sql = getSql();
  const rows = await sql<{ id: string }[]>`
    select distinct quoted->>'id' as id from tweet where quoted is not null`;
  console.log(`인용 고유 ID ${rows.length}건 — 캐시 미보유분만 조회합니다 (예상 상한 $${(rows.length * 0.001).toFixed(3)})`);

  const r = await enrichQuoted(sql, makeClient(), rows.map((x) => x.id), { cap: Infinity, concurrency: 4 });
  const [{ count }] = await sql<{ count: string }[]>`select count(*) from quoted_tweet`;
  console.log(`완료: 보강 ${r.fetched}건 · 삭제/비공개 ${r.missing}건 · 캐시 총 ${count}건`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
