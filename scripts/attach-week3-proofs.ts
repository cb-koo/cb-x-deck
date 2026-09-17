// RT 작업의 증빙 스크린샷을 올리고 campaign_task.proof 를 채운다 + 같은 트랜잭션에서 게시됨으로 표시한다.
//
// 9월3주차 RT 6건(미모드림 3 · 백수약국 3). 증빙 이미지는 슬랙 스레드 답글에 붙어 있으므로
// 먼저 내려받아 ~/Downloads 에 `RT_@핸들.png` 로 저장해야 한다(9월2주차와 같은 규칙).
//
// 어디에 올리나: task-proof 버킷 · 경로 task/<작업id>/<파일id>.<확장자> · 10MB · jpg/png/webp.
//   draft-media(초안 첨부)와 다른 버킷·다른 경로 규칙이다 — 044가 "경로 정규식이 draft/<uuid>/…에 묶여 있고
//   용량 상한이 다르다"는 이유로 재사용하지 않기로 못박았다. 경로는 taskProofGuard 가 서버에서 검사한다.
//
// proof 는 URL 문자열이 아니라 {url, by, byName, at} 객체다(044 §4-2) — byName 은 표시용 이름 스냅샷이라
// 나중에 member 를 조인하지 않는다(payment_request 관례).
//
// 게시 표시: RT 는 자기 게시물이 없어 트윗 ID로 날짜를 못 뽑는다. posted_at 은 스키마상 '게시 확인일'이라
//   모에카가 리포스트를 확인해 슬랙에 올린 날(2026-09-09)을 쓴다. 증빙 없이 게시됨으로 만들면 RT 증빙 스펙 §5를
//   어기므로(proofGateError ④) 증빙과 한 트랜잭션에서 함께 넣는다.
//
// 기본은 드라이런. 실제 반영은 --apply. 이미 증빙이 있는 작업은 건너뛴다.
// 실행: node --env-file=.env --import tsx scripts/attach-week3-proofs.ts [--apply]
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getSql } from '../src/lib/db.ts';
import { isTaskProofPathFor } from '../src/lib/taskProofGuard.ts';

const BUCKET = 'task-proof';
const MAX_BYTES = 10 * 1024 * 1024;                                  // 044 버킷 file_size_limit 과 같은 값
const ALLOWED: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const SRC_DIR = '/Users/koo_clinicbridge/Downloads';
// 게시 확인일 — 슬랙에 증빙 답글이 올라온 날(핸들마다 다르다). RT 는 트윗 ID가 없어 날짜를 못 뽑는다.
const CONFIRMED_ON: Record<string, string> = {
  for_hk_: '2026-09-15', mpchan_a: '2026-09-15', y_yunicha2: '2026-09-15',
  shioringo1224: '2026-09-15', aik_ooooo: '2026-09-15', umm___nnn: '2026-09-16',
};

interface Task { no: number; campaign: string; handle: string; type: string; proof_file?: string; note: string }
const D = JSON.parse(readFileSync(new URL('../data-work/week3-normalized.json', import.meta.url), 'utf8')) as { tasks: Task[] };

function storage() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env 에 없습니다');
  return createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
}

// PNG/JPEG/WebP 시그니처로 실제 형식을 본다 — 확장자만 믿지 않는다(버킷이 MIME 로 거절한다)
function sniff(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const st = storage();

  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${'gugeon.park@clinicbridge.co.kr'} limit 1`;
  if (!actor) { console.error('멤버를 못 찾았어요'); await sql.end(); process.exit(2); }

  const src = D.tasks.filter((t) => t.proof_file);
  console.log(`증빙 대상 ${src.length}건 · 올린 사람 ${actor.name}\n`);

  const jobs: Array<{ t: Task; taskId: string; buf: Buffer; mime: string; ext: string }> = [];
  const fails: string[] = [];

  for (const t of src) {
    const [row] = await sql`
      select t.id, t.type, t.proof, to_char(t.posted_at,'YYYY-MM-DD') as posted_at,
             tg.influencer_handle as target
        from campaign_task t
        join campaign c on c.id = t.campaign_id
        left join campaign_task tg on tg.id = t.target_task_id
       where c.name like '%_9월3주차' and lower(t.influencer_handle) = ${t.handle.toLowerCase()} and t.type = ${t.type}`;
    if (!row) { fails.push(`@${t.handle}: DB에 작업이 없다`); continue; }
    if (row.type !== 'rt') { fails.push(`@${t.handle}: 유형이 ${row.type} — 증빙은 RT 에만 붙는다`); continue; }
    if (row.proof) { console.log(`   · @${t.handle}: 이미 증빙 있음 — 건너뜀`); continue; }

    const path = `${SRC_DIR}/${t.proof_file}`;
    if (!existsSync(path)) { fails.push(`@${t.handle}: 파일 없음 ${path}`); continue; }
    const buf = readFileSync(path);
    const size = statSync(path).size;
    const mime = sniff(buf);
    if (!mime || !ALLOWED[mime]) { fails.push(`@${t.handle}: 형식 불허(${mime ?? '알 수 없음'}) — jpg·png·webp 만`); continue; }
    if (size > MAX_BYTES) { fails.push(`@${t.handle}: ${(size / 1024 / 1024).toFixed(1)}MB — 10MB 초과`); continue; }

    jobs.push({ t, taskId: row.id as string, buf, mime, ext: ALLOWED[mime] });
    console.log(`   @${t.handle.padEnd(16)} ${t.proof_file!.padEnd(26)} ${mime} ${(size / 1024).toFixed(0)}KB · RT 대상 @${row.target ?? '-'} · 현재 게시 ${row.posted_at ?? '전'}`);
  }

  if (fails.length) { console.log('\n✗ 문제:'); for (const f of fails) console.log(`   ✗ ${f}`); await sql.end(); process.exit(1); }
  if (!jobs.length) { console.log('\n올릴 것이 없습니다.'); await sql.end(); return; }

  console.log(`\n넣을 값 — proof {url, by ${actor.id.slice(0, 8)}…, byName "${actor.name}", at 지금} · posted_at 은 핸들별 확인일 · posted_source manual`);
  if (!apply) { console.log('\n드라이런입니다 — 실제로 올리려면 --apply'); await sql.end(); return; }

  for (const j of jobs) {
    const path = `task/${j.taskId}/${crypto.randomUUID()}.${j.ext}`;
    // 서버 가드와 같은 함수로 먼저 본다 — 모양이 틀린 경로를 올려두고 DB만 실패하는 상태를 만들지 않는다
    if (!isTaskProofPathFor(j.taskId, path)) { console.log(`   ✗ @${j.t.handle}: 경로가 가드를 통과하지 못한다 — ${path}`); continue; }

    const up = await st.upload(path, j.buf, { contentType: j.mime, upsert: false });
    if (up.error) { console.log(`   ✗ @${j.t.handle} 업로드 실패: ${up.error.message}`); continue; }
    const sign = await st.createSignedUrl(path, 60);
    if (sign.error || !sign.data?.signedUrl) { console.log(`   ✗ @${j.t.handle} 서명 URL 실패`); continue; }
    const back = await fetch(sign.data.signedUrl);
    const got = back.ok ? Buffer.from(await back.arrayBuffer()).byteLength : -1;
    if (got !== j.buf.byteLength) { console.log(`   ✗ @${j.t.handle} 확인 실패 (${got}B / ${j.buf.byteLength}B)`); continue; }

    const proof = { url: path, by: actor.id, byName: actor.name ?? '', at: new Date().toISOString() };
    await sql`
      update campaign_task set
        proof = ${sql.json(proof)},
        posted_at = coalesce(posted_at, ${CONFIRMED_ON[j.t.handle]}::date),
        posted_source = coalesce(posted_source, 'manual'),
        updated_at = now()
      where id = ${j.taskId}`;
    console.log(`✓ @${j.t.handle} 증빙 ${path} · 게시 확인 ${CONFIRMED_ON[j.t.handle]}`);
  }

  const [x] = await sql`
    select count(*) as n from campaign_task t join campaign c on c.id = t.campaign_id
     where c.name like '%_9월3주차' and t.proof is not null`;
  console.log(`\n확인 — 증빙 있는 작업 ${x.n}건`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
