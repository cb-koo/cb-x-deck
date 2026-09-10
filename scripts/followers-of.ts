import { getSql } from '../src/lib/db.ts';
const H=['8_rivi','b___zooly','rinnabiyou417','2024_0406','yuyudayo0924','qni6f','ykss_2141','ivl9t','ararechan_note'];
async function main(): Promise<void> {
  const sql = getSql();
  for (const r of await sql`
    select handle, display_name, followers_count,
           (select jsonb_agg(x->'fee') from jsonb_array_elements(payment_methods) x where x->>'type'='paypal') as paypal_fee
      from influencer where lower(handle) in ${sql(H)} order by followers_count desc nulls last`)
    console.log(`   @${String(r.handle).padEnd(16)} 팔로워 ${String(r.followers_count ?? '미조회').padStart(8)}  수수료 ${JSON.stringify(r.paypal_fee)}`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
