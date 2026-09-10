// 읽기 전용 — @suni__fit 계좌 변경(09-07)의 실제 전/후 값.
import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select to_char(l.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as at, l.payload
      from influencer_log l join influencer i on i.id = l.influencer_id
     where lower(i.handle) = 'suni__fit' and l.event_type = 'payment_method_changed'
     order by l.created_at`;
  for (const r of rows) console.log(`[${r.at}] ${JSON.stringify(r.payload, null, 2)}`);
  console.log('\n── 현재 값 ──');
  const [cur] = await sql`select payment_methods from influencer where lower(handle) = 'suni__fit'`;
  console.log(JSON.stringify(cur.payment_methods, null, 2));
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
