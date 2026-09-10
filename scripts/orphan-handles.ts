import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select distinct t.influencer_handle as handle, c.name as campaign
      from campaign_task t join campaign c on c.id = t.campaign_id
     where t.influencer_handle is not null
       and c.name not like '테스트%' and c.name not like '(삭제)%'
       and not exists (select 1 from influencer i where lower(i.handle) = lower(t.influencer_handle))
     order by 1`;
  if (!rows.length) console.log('   없음 ✅');
  for (const r of rows) console.log(`   @${r.handle}  (${r.campaign})`);
  const [c] = await sql`
    select count(*) filter (where payment_methods = '[]'::jsonb) as none from influencer i
     where exists (select 1 from campaign_task t join campaign c on c.id=t.campaign_id
                    where lower(t.influencer_handle)=lower(i.handle)
                      and c.name not like '테스트%' and c.name not like '(삭제)%')`;
  console.log(`\n실제 캠페인 작업이 있는데 결제수단 없음: ${c.none}명`);
  await sql.end();
}
main().catch((e)=>{console.error(e);process.exit(1);});
