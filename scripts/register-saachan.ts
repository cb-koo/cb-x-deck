// @saachan0013 명부 등록 (koo 지시 2026-09-11).
//
// 왜 지금: 더스퀘어치과_9월2주차 01번 작업(인용RT 5만원)이 09-10 18:56에 게시됐는데 명부에 없어
// 정산 요청이 막힌다(assessReadiness → no-influencer). 게시물 조회 응답에 프로필이 있어 함께 채운다.
//
// 앱과 같은 경로를 쓴다: ensureInfluencer(중복 방지는 lower(handle) unique 인덱스가 한다)
// + applyProfileSnapshot(x_user_id·표시이름·팔로워·소개·프로필이미지, profile_refreshed_at 갱신).
// 결제 수단은 넣지 않는다 — 모르는 값이라 비워 두고, 정산 요청 전에 확인해야 한다(그게 다음 관문이다).
//
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/register-saachan.ts [--apply]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { findByHandle, ensureInfluencer, findDuplicateByXUserId, applyProfileSnapshot } from '../src/lib/influencerStore.ts';
import type { UserInfo } from '../src/lib/getxapi.ts';

const HANDLE = 'saachan0013';
const TWEET_ID = '2097987689261809894';
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

const RAWS = JSON.parse(readFileSync(new URL('../data-work/week2-posts-raw.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown> | null>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  const existing = await findByHandle(sql, HANDLE);
  if (existing) { console.error(`✗ @${existing.handle} 는 이미 명부에 있어요 — 등록이 아니라 확인이 필요합니다.`); await sql.end(); process.exit(1); }

  const raw = RAWS[TWEET_ID];
  if (!raw) { console.error(`✗ 게시물 ${TWEET_ID} 조회 결과가 없어요 — fetch-week2-posts.ts 를 먼저 돌리세요.`); await sql.end(); process.exit(1); }
  const a = (raw.author ?? {}) as Record<string, unknown>;
  if (str(a.userName)?.toLowerCase() !== HANDLE) {
    console.error(`✗ 게시물 작성자가 @${a.userName} 예요 — @${HANDLE} 와 다릅니다(개명일 수 있음). 사람이 확인해야 해요.`);
    await sql.end(); process.exit(1);
  }
  const info: UserInfo = {
    id: String(a.id), userName: String(a.userName), name: str(a.name),
    followers: num(a.followers), profilePicture: str(a.profilePicture), description: str(a.description),
  };

  // 같은 계정이 다른 핸들로 이미 있으면 개명 상황이다 — 새 행을 만들면 한 사람이 두 줄로 남는다
  const dupRows = await sql<Array<{ handle: string }>>`select handle from influencer where x_user_id = ${info.id}`;
  if (dupRows.length) {
    console.error(`✗ x_user_id ${info.id} 를 @${dupRows[0].handle} 가 이미 쓰고 있어요 — 등록이 아니라 개명입니다. 사람이 확인해야 해요.`);
    await sql.end(); process.exit(1);
  }

  const [task] = await sql`
    select c.name as camp, t.type, (t.cost->>'amount')::int as amt, to_char(t.posted_at,'YYYY-MM-DD') as posted
      from campaign_task t join campaign c on c.id = t.campaign_id
     where lower(t.influencer_handle) = ${HANDLE} and c.name like '%_9월2주차'`;

  console.log(`명부 등록: @${info.userName}\n`);
  console.log(`   표시이름   ${info.name ?? '(없음)'}`);
  console.log(`   팔로워     ${info.followers?.toLocaleString() ?? '-'}`);
  console.log(`   x_user_id  ${info.id}`);
  console.log(`   소개       ${(info.description ?? '(없음)').replace(/\n/g, ' ⏎ ').slice(0, 70)}`);
  console.log(`   프로필이미지 ${info.profilePicture ? '있음' : '없음'}`);
  if (task) console.log(`\n   관련 작업  ${task.camp} · ${task.type} · ${Number(task.amt) / 10000}만원 · 게시 ${task.posted}`);
  console.log(`\n   결제 수단  넣지 않습니다 — 확인 후 별도 등록이 필요합니다(정산 요청의 다음 관문).`);

  if (!apply) { console.log('\n드라이런입니다 — 실제로 등록하려면 --apply'); await sql.end(); return; }

  const id = await ensureInfluencer(sql, info.userName, actor.id);
  const dup = await findDuplicateByXUserId(sql, info.id, id);
  if (dup) { console.error(`✗ x_user_id 중복(@${dup}) — 프로필은 채우지 않았습니다.`); await sql.end(); process.exit(1); }
  await applyProfileSnapshot(sql, id, info);

  const [after] = await sql`
    select handle, display_name, followers_count, x_user_id,
           coalesce(jsonb_array_length(payment_methods), 0) as pm,
           to_char(profile_refreshed_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as at
      from influencer where id = ${id}`;
  console.log(`\n✓ 등록 완료 — @${after.handle} "${after.display_name}" 팔로워 ${after.followers_count} · id ${after.x_user_id} · 기준 ${after.at}`);
  console.log(`   결제 수단 ${after.pm}개 — 🔴 정산 요청을 내려면 등록이 필요합니다.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
