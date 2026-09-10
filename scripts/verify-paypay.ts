import { getSql } from '../src/lib/db.ts';
const H = ['rinnabiyou417','2024_0406','_goriosan_','omochi57842411','_____como','akumachan_biyo','8_rivi','17dsy_','cie7le'];
async function main(): Promise<void> {
  const sql = getSql();
  console.log('── 반영 결과 ──');
  for (const r of await sql`
    select handle, display_name, payment_methods from influencer
     where lower(handle) in ${sql(H)} order by handle`) {
    const ms = (r.payment_methods as Array<Record<string, unknown>>)
      .map((m) => `${m.type}${m.isDefault ? '(기본)' : ''}:${m.identifier ?? m.email ?? m.account ?? '-'}`).join(' + ');
    console.log(`   @${r.handle}  ${ms}`);
  }
  const [c] = await sql`
    select count(*) filter (where payment_methods = '[]'::jsonb) as none,
           count(*) filter (where payment_methods <> '[]'::jsonb) as some,
           count(*) as total from influencer`;
  console.log(`\n결제수단 보유 ${c.some} / 없음 ${c.none} / 전체 ${c.total}명`);
  const [d] = await sql`
    select count(*) as n from influencer i
     where i.payment_methods = '[]'::jsonb
       and exists(select 1 from campaign_task t join campaign c on c.id = t.campaign_id
                   where lower(t.influencer_handle) = lower(i.handle)
                     and c.name not like '테스트%' and c.name not like '(삭제)%')`;
  console.log(`실제 캠페인 작업이 있는데 결제수단 없음: ${d.n}명`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
