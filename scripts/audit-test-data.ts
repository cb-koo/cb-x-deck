// 읽기 전용 — 운영 전환 전 테스트 데이터 판별용 감사. 쓰기·삭제 없음.
// 실행: node --env-file=.env --import tsx scripts/audit-test-data.ts
import { getSql } from '../src/lib/db.ts';
import { TEST_FIXTURE_HANDLE_PG } from './fixturePattern.ts';

const SEOUL = (c: string) => `to_char(${c} at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')`;

async function main(): Promise<void> {
  const sql = getSql();

  console.log('\n══════════ 캠페인 전량 ══════════');
  const camps = await sql.unsafe(`
    select c.id, c.name, c.name_en, c.client_name, c.kind, c.note,
           to_char(c.starts_on,'YYYY-MM-DD') as starts_on,
           to_char(c.ends_on,'YYYY-MM-DD') as ends_on,
           ${SEOUL('c.created_at')} as created_at,
           coalesce(m.name, m.email, '(없음)') as creator,
           (select count(*) from campaign_task t where t.campaign_id = c.id) as tasks,
           (select count(*) from payment_request r where r.campaign_id = c.id) as reqs,
           (select count(*) from payment_request r where r.campaign_id = c.id and r.external_status is not null) as reqs_ext
      from campaign c left join member m on m.id = c.created_by
     order by c.created_at
  `);
  for (const c of camps) {
    console.log(`\n[${c.created_at}] ${c.name}  (${c.name_en})`);
    console.log(`   클라: ${c.client_name ?? '(없음)'} | 기간 ${c.starts_on}~${c.ends_on} | 종류 ${c.kind ?? '(없음)'} | 만든이 ${c.creator}`);
    console.log(`   작업 ${c.tasks}건 | 정산요청 ${c.reqs}건 (그쪽 처리된 것 ${c.reqs_ext}건)`);
    if (c.note) console.log(`   메모: ${String(c.note).slice(0, 120)}`);
  }

  console.log('\n\n══════════ 작업 전량 ══════════');
  const tasks = await sql.unsafe(`
    select t.id, c.name as campaign, t.influencer_handle as handle, t.type,
           t.cost, t.post_url, t.draft_id,
           to_char(t.posted_at,'YYYY-MM-DD') as posted_at,
           ${SEOUL('t.created_at')} as created_at,
           (t.influencer_handle ~ '${TEST_FIXTURE_HANDLE_PG}') as is_fixture,
           (select count(*) from payment_request r where r.task_id = t.id) as reqs,
           (select count(*) from payment_request r where r.task_id = t.id and r.external_status is not null) as reqs_ext,
           exists(select 1 from influencer i where lower(i.handle) = lower(t.influencer_handle)) as in_roster
      from campaign_task t left join campaign c on c.id = t.campaign_id
     order by t.created_at
  `);
  for (const t of tasks) {
    const flags = [
      t.is_fixture ? '🔴픽스처' : null,
      !t.in_roster && t.handle ? '명부없음' : null,
      Number(t.reqs_ext) > 0 ? `🔴그쪽처리${t.reqs_ext}` : (Number(t.reqs) > 0 ? `정산요청${t.reqs}` : null),
      t.draft_id ? '원고있음' : null,
      t.post_url ? '링크있음' : null,
    ].filter(Boolean).join(' ');
    console.log(`[${t.created_at}] ${t.campaign ?? '(캠페인없음)'} | @${t.handle ?? '(미배정)'} | ${t.type} | ${JSON.stringify(t.cost) ?? '-'} | 게시 ${t.posted_at ?? '-'} ${flags ? '| ' + flags : ''}`);
  }

  console.log('\n\n══════════ 인플루언서 명부 업로드 시점 ══════════');
  const [ic] = await sql.unsafe(`
    select count(*) as total,
           ${SEOUL('min(created_at)')} as first_at,
           ${SEOUL('max(created_at)')} as last_at
      from influencer`);
  console.log(`총 ${ic.total}명 | 최초 ${ic.first_at} | 최근 ${ic.last_at}`);
  const byDay = await sql.unsafe(`
    select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day, count(*) as n
      from influencer group by 1 order by 1`);
  console.log('\n날짜별 등록:');
  for (const d of byDay) console.log(`   ${d.day}  ${String(d.n).padStart(4)}명`);

  console.log('\n\n══════════ 결제 수단 데이터 시점 ══════════');
  const [pm] = await sql.unsafe(`
    select count(*) filter (where payment_methods <> '[]'::jsonb) as with_method,
           count(*) as total from influencer`);
  console.log(`결제수단 있는 인플: ${pm.with_method} / ${pm.total}명`);
  const pmLog = await sql.unsafe(`
    select to_char(created_at at time zone 'Asia/Seoul','YYYY-MM-DD') as day,
           count(*) as n, count(distinct influencer_id) as people
      from influencer_log where event_type = 'payment_method_changed'
     group by 1 order by 1`);
  if (pmLog.length === 0) console.log('결제수단 변경 로그 없음');
  else {
    console.log('\n결제수단 변경 이력(날짜별):');
    for (const d of pmLog) console.log(`   ${d.day}  ${String(d.n).padStart(4)}건  (${d.people}명)`);
  }

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
