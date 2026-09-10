// 읽기 전용 — 08-27 이후 손댄 5개 계정의 현재 결제수단 상세(수수료·식별값 판별용).
import { getSql } from '../src/lib/db.ts';
const HANDLES = ['yuichan___27','cie7le','qni6f','suni__fit','aik_ooooo'];

async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select i.handle, i.payment_methods,
           exists(select 1 from campaign_task t join campaign c on c.id = t.campaign_id
                   where lower(t.influencer_handle) = lower(i.handle) and c.name not like '테스트%' and c.name not like '(삭제)%') as in_real,
           exists(select 1 from campaign_task t join campaign c on c.id = t.campaign_id
                   where lower(t.influencer_handle) = lower(i.handle) and (c.name like '테스트%' or c.name like '(삭제)%')) as in_test
      from influencer i where lower(i.handle) in ${sql(HANDLES)} order by i.handle`;
  for (const r of rows) {
    const where = [r.in_real ? '실제캠페인' : null, r.in_test ? '🔴테스트캠페인' : null].filter(Boolean).join(' + ');
    console.log(`\n@${r.handle}  [${where || '캠페인 없음'}]`);
    for (const m of r.payment_methods as Array<Record<string, unknown>>) {
      const ident = m.email ?? m.paypalId ?? m.account ?? m.identifier ?? m.paypayId ?? '(없음)';
      console.log(`   ${m.type} | 수취인 ${m.holder ?? '-'} | 식별값 ${ident} | 통화 ${m.currency ?? '-'} | 기본 ${m.isDefault ? 'O' : 'X'}`);
      console.log(`      수수료: ${m.fee ? JSON.stringify(m.fee) : '(없음 = 인플 부담)'}`);
    }
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
