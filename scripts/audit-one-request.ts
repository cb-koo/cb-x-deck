// 읽기 전용 — @Qni6F 요청 한 건의 전체 내용.
import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select r.*, c.name as campaign_full,
           t.type as task_type_now, t.post_url as task_post_url,
           to_char(t.posted_at,'YYYY-MM-DD') as task_posted_at,
           t.cost as task_cost
      from payment_request r
      left join campaign c on c.id = r.campaign_id
      left join campaign_task t on t.id = r.task_id
     where lower(r.influencer_handle) = 'qni6f'
     order by r.created_at`;
  for (const r of rows) {
    console.log('\n════════════════════════════════════════');
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined || v === '') continue;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      console.log(`  ${k.padEnd(22)} ${s}`);
    }
  }
  console.log(`\n총 ${rows.length}건`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
