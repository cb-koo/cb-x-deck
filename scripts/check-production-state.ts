// 읽기 전용 — 프로덕션 현황 확인. 쓰기 없음. 적재 전/후 대조에 쓴다.
// 실행: node --env-file=.env --import tsx scripts/check-production-state.ts
import { getSql } from '../src/lib/db.ts';

async function main(): Promise<void> {
  const sql = getSql();
  const [r] = await sql`
    select
      (select count(*) from client)          as clients,
      (select count(*) from campaign)        as campaigns,
      (select count(*) from campaign_task)   as tasks,
      (select count(*) from influencer)      as roster,
      (select count(*) from payment_request) as payment_requests
  `;
  console.log(r);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
