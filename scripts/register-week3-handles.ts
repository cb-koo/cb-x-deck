// 9월3주차 적재 대상 중 명부에 없던 핸들 3개 등록 (koo 지시 2026-09-17).
//
// 왜 지금: @nako_beauty·@titin_and_co20_ 은 이미 게시까지 끝났는데 명부에 없어 정산 요청이 막힌다
// (assessReadiness → no-influencer). @4nAtumilK_4HInE 은 아직 협의 중이지만 같은 자리에서 같이 넣는다.
//
// 앱과 같은 경로를 쓴다: ensureInfluencer(중복 방지는 lower(handle) unique 인덱스가 한다)
// + applyProfileSnapshot(x_user_id·표시이름·팔로워·소개·프로필이미지, profile_refreshed_at 갱신).
// 결제 수단은 넣지 않는다 — 모르는 값이라 비워 두고, 정산 요청 전에 사람이 확인한다(다음 관문).
//
// 안전장치: ① 이미 명부에 있으면 그 핸들은 건너뛴다(덮어쓰지 않는다)
//           ② X가 돌려준 x_user_id 를 다른 핸들이 이미 쓰고 있으면 개명이므로 등록하지 않고 멈춘다
//              (새 행을 만들면 한 사람이 두 줄로 남는다 — @coco__ns_5 선례)
//           ③ 핸들 표기가 X 정규형과 다르면 X 표기로 넣고 알린다(작업 조인은 lower 기준이라 영향 없다)
// 비용: 프로필 조회 3회(트윗 조회보다 싸다).
//
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/register-week3-handles.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { makeClient } from '../src/lib/getxapi.ts';
import { findByHandle, ensureInfluencer, applyProfileSnapshot } from '../src/lib/influencerStore.ts';
import type { UserInfo } from '../src/lib/getxapi.ts';

const HANDLES = ['4nAtumilK_4HInE', 'nako_beauty', 'titin_and_co20_'];
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const x = makeClient();

  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  console.log(`명부 등록 대상 ${HANDLES.length}개 · 등록자 ${actor.name}\n`);

  const jobs: Array<{ handle: string; info: UserInfo; task: Record<string, unknown> | undefined }> = [];
  const skips: string[] = [];
  const stops: string[] = [];

  for (const h of HANDLES) {
    const exists = await findByHandle(sql, h);
    if (exists) { skips.push(`@${h}: 이미 명부에 있음(@${exists.handle}) — 건너뜁니다`); continue; }

    let info: UserInfo;
    try { info = await x.getUserInfo(h); }
    catch (e) { stops.push(`@${h}: X 프로필 조회 실패 — ${(e as Error).message}`); continue; }
    if (!info.id) { stops.push(`@${h}: X가 계정을 못 찾았습니다(정지·삭제·개명?)`); continue; }

    const dup = await sql<Array<{ handle: string }>>`select handle from influencer where x_user_id = ${info.id}`;
    if (dup.length) { stops.push(`@${h}: x_user_id ${info.id} 를 @${dup[0].handle} 가 이미 쓰고 있어요 — 등록이 아니라 개명입니다. 사람이 확인해야 해요.`); continue; }

    const [task] = await sql`
      select c.name as camp, t.type, (t.cost->>'amount')::int as amt, to_char(t.posted_at,'YYYY-MM-DD') as posted
        from campaign_task t join campaign c on c.id = t.campaign_id
       where lower(t.influencer_handle) = ${h.toLowerCase()} and c.name like '%9월3주차'`;

    jobs.push({ handle: info.userName, info, task });
    const cased = info.userName !== h ? `  ⚠️ 슬랙 표기 @${h} → X 정규형 @${info.userName}` : '';
    console.log(`@${info.userName.padEnd(18)} ${String(info.name ?? '(이름 없음)').padEnd(18)} 팔로워 ${(info.followers ?? 0).toLocaleString('ko-KR').padStart(9)}`);
    console.log(`   작업: ${task ? `${task.camp} · ${task.type} · ${(Number(task.amt) / 10000)}만원 · ${task.posted ? '게시 ' + task.posted : '게시 전'}` : '(없음)'}${cased}`);
    if (info.description) console.log(`   소개: ${String(info.description).replace(/\n/g, ' ').slice(0, 60)}`);
  }

  if (skips.length) { console.log('\n건너뜀:'); for (const s of skips) console.log(`   · ${s}`); }
  if (stops.length) { console.log('\n✗ 멈춤:'); for (const s of stops) console.log(`   ✗ ${s}`); }
  if (!jobs.length) { console.log('\n등록할 것이 없습니다.'); await sql.end(); return; }

  console.log(`\n넣을 값 — handle·x_user_id·display_name·avatar_url·bio·followers_count·profile_refreshed_at. 결제 수단은 비워 둡니다.`);
  if (!apply) { console.log(`\n드라이런입니다 — 실제로 넣으려면 --apply (등록 ${jobs.length}건)`); await sql.end(); return; }

  for (const j of jobs) {
    const id = await ensureInfluencer(sql, j.handle, actor.id);
    await applyProfileSnapshot(sql, id, j.info);
    console.log(`✓ @${j.handle} → ${id}`);
  }

  const rows = await sql<Array<{ handle: string; followers_count: number | null; x_user_id: string | null }>>`
    select handle, followers_count, x_user_id from influencer
     where lower(handle) = any(${HANDLES.map((h) => h.toLowerCase())}) order by handle`;
  console.log(`\n확인 — 명부에 있는 대상 ${rows.length}/${HANDLES.length}건`);
  for (const r of rows) console.log(`   @${r.handle.padEnd(18)} x_user_id ${r.x_user_id ?? '없음'} · 팔로워 ${(r.followers_count ?? 0).toLocaleString('ko-KR')}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
