// 읽기 전용 — 같은 사람이 두 핸들로 명부에 들어간 경우의 의존 데이터 확인.
import { getSql } from '../src/lib/db.ts';
const PAIRS = [['_ponchan78', 'osuzzuu'], ['yuipi_beauty7', 'yuna_skincare77']];
async function main(): Promise<void> {
  const sql = getSql();
  for (const pair of PAIRS) {
    console.log(`\n━━━━━ ${pair.map((h) => '@' + h).join('  ↔  ')} ━━━━━`);
    for (const h of pair) {
      const [i] = await sql`
        select id, handle, display_name, followers_count, x_user_id,
               to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') as created,
               to_char(profile_refreshed_at at time zone 'Asia/Seoul','YYYY-MM-DD') as refreshed,
               jsonb_array_length(payment_methods) as pm, analyzed_at is not null as analyzed
          from influencer where lower(handle) = ${h}`;
      if (!i) { console.log(`  @${h}: 명부에 없음`); continue; }
      const [c] = await sql`
        select (select count(*) from campaign_task t where lower(t.influencer_handle) = ${h}) as tasks,
               (select count(*) from draft d where lower(d.influencer_handle) = ${h}) as drafts,
               (select count(*) from payment_request r where lower(r.influencer_handle) = ${h}) as reqs,
               (select count(*) from influencer_log l where l.influencer_id = ${i.id}) as logs,
               (select count(*) from campaign_influencer_cost x where lower(x.influencer_handle) = ${h}) as costs`;
      console.log(`  @${i.handle} ("${i.display_name ?? '-'}")  등록 ${i.created}`);
      console.log(`     x_user_id ${i.x_user_id ?? '(미조회)'} | 팔로워 ${i.followers_count ?? '-'} | 프로필갱신 ${i.refreshed ?? '없음'} | 분석 ${i.analyzed ? 'O' : 'X'}`);
      console.log(`     결제수단 ${i.pm}개 | 작업 ${c.tasks} · 원고 ${c.drafts} · 정산요청 ${c.reqs} · 캠페인비용 ${c.costs} · 기록 ${c.logs}`);
    }
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
