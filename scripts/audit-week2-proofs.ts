// 읽기 전용 — RT 증빙을 앱 가드·스토리지·정산 준비도로 전건 검증한다.
// 실행: node --env-file=.env --import tsx scripts/audit-week2-proofs.ts
import { createClient } from '@supabase/supabase-js';
import { getSql } from '../src/lib/db.ts';
import { taskProofOf, isTaskProofPathFor, proofUploadedLine } from '../src/lib/taskProofGuard.ts';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE 환경변수 없음');
  const st = createClient(url, key, { auth: { persistSession: false } }).storage.from('task-proof');
  const sql = getSql();
  const fails: string[] = [];

  const rows = await sql`
    select t.id, t.influencer_handle as h, t.type, t.proof, t.post_url,
           to_char(t.posted_at,'YYYY-MM-DD') as posted_at, t.posted_source,
           tg.influencer_handle as target, c.name as camp
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      left join campaign_task tg on tg.id = t.target_task_id
     where c.name like '%_9월2주차' and t.type = 'rt'
     order by t.influencer_handle`;

  console.log(`RT 작업 ${rows.length}건\n`);
  for (const r of rows) {
    const h = String(r.h);
    const p = taskProofOf(r.proof);
    if (!p) { console.log(`  @${h.padEnd(16)} 증빙 없음`); continue; }
    // 앱 가드 — 이 작업 것인지까지
    if (!isTaskProofPathFor(String(r.id), p.url)) fails.push(`@${h}: 경로가 이 작업 것이 아니다 — ${p.url}`);
    // 스토리지 실존
    const sign = await st.createSignedUrl(p.url, 60);
    if (sign.error || !sign.data?.signedUrl) { fails.push(`@${h}: 서명 URL 실패`); continue; }
    const res = await fetch(sign.data.signedUrl);
    const bytes = res.ok ? Buffer.from(await res.arrayBuffer()).byteLength : -1;
    if (bytes <= 0) fails.push(`@${h}: 스토리지 객체 없음/빈 파일`);
    // RT 증빙 3규칙: 게시됨인 RT 는 증빙이 반드시 있어야 한다
    if (r.posted_at && !p) fails.push(`@${h}: 게시됨인데 증빙 없음`);
    if (r.post_url) fails.push(`@${h}: RT 인데 post_url 이 있다`);
    console.log(`  @${h.padEnd(16)} 증빙 ${(bytes/1024).toFixed(0)}KB · ${proofUploadedLine(p.byName, p.at)} · 게시 ${r.posted_at}(${r.posted_source}) · RT 대상 @${r.target ?? '-'}`);
  }

  // 정산 준비 — 증빙까지 갖춘 작업 수
  const [s] = await sql`
    select count(*) filter (where t.posted_at is not null) as posted,
           count(*) filter (where t.type='rt' and t.posted_at is not null and t.proof is null) as rt_no_proof,
           sum((t.cost->>'amount')::int) filter (where t.posted_at is not null) as sum
      from campaign_task t join campaign c on c.id=t.campaign_id where c.name like '%_9월2주차'`;
  console.log(`\n게시 완료 작업 ${s.posted}건 · 합 ${Number(s.sum)/10000}만원`);
  console.log(`게시됐는데 증빙 없는 RT: ${s.rt_no_proof}건 (0이어야 정산 요청이 막히지 않는다)`);
  if (Number(s.rt_no_proof) !== 0) fails.push(`증빙 없는 게시 RT ${s.rt_no_proof}건`);

  console.log('\n════════════');
  if (!fails.length) console.log('✓ 검증 통과 — 가드·스토리지·증빙 규칙 정상');
  else { for (const f of fails) console.log(`   ✗ ${f}`); }
  await sql.end();
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
