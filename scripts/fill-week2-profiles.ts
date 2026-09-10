// 명부의 X 프로필 스냅샷을 채운다 — 값은 9월2주차 게시물 조회(fetch-week2-posts.ts) 응답의 author 객체다.
// API를 다시 부르지 않는다(data-work/week2-posts-raw.json 재사용).
//
// 계기: @coco__ns_5 → @coco_______5 개명 후 프로필이 비어 있어 명부에서 누군지 알 수 없었다.
//       같은 상태인 @skysky_ca 도 함께 채운다(같은 응답에 값이 있다).
// 값을 손으로 옮기지 않고 파일에서 직접 읽는다 — 전사 실수를 없앤다(fill-profile-snapshots.ts 는 하드코딩했다).
//
// 기본은 표시이름이 빈 계정만(--empty-only 기본). 이미 채워진 14명까지 새로 고치려면 --refresh-all.
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/fill-week2-profiles.ts [--refresh-all] [--apply]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { findByHandle, findDuplicateByXUserId, applyProfileSnapshot } from '../src/lib/influencerStore.ts';
import type { UserInfo } from '../src/lib/getxapi.ts';

const RAWS = JSON.parse(readFileSync(new URL('../data-work/week2-posts-raw.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown> | null>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const nOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const refreshAll = argv.includes('--refresh-all');
  const sql = getSql();

  // 응답의 author 객체 → UserInfo. 같은 계정이 여러 게시물에 나오면 한 번만 쓴다.
  const infos = new Map<string, UserInfo>();
  for (const raw of Object.values(RAWS)) {
    if (!raw) continue;
    const a = raw.author as Record<string, unknown> | undefined;
    if (!a || typeof a.id !== 'string' || typeof a.userName !== 'string') continue;
    if (!infos.has(a.userName.toLowerCase())) {
      infos.set(a.userName.toLowerCase(), {
        id: a.id, userName: a.userName, name: str(a.name),
        followers: nOrNull(a.followers), profilePicture: str(a.profilePicture), description: str(a.description),
      });
    }
  }

  const skipped: string[] = [];
  const jobs: Array<{ info: UserInfo; id: string; handle: string; wasEmpty: boolean; before: string }> = [];
  for (const info of infos.values()) {
    const row = await findByHandle(sql, info.userName);
    if (!row) { skipped.push(`@${info.userName}: 명부에 없음`); continue; }
    const wasEmpty = !row.displayName;
    if (!wasEmpty && !refreshAll) { skipped.push(`@${row.handle}: 이미 채워짐(${row.displayName} · 팔로워 ${row.followersCount ?? '-'})`); continue; }
    // 같은 x_user_id 를 다른 행이 쓰고 있으면 한 사람이 두 줄로 남아 있는 것 — 사람이 판단해야 한다
    const dup = await findDuplicateByXUserId(sql, info.id, row.id);
    if (dup) { skipped.push(`🔴 @${row.handle}: x_user_id ${info.id} 를 @${dup} 도 쓴다 — 중복 행 확인 필요`); continue; }
    jobs.push({
      info, id: row.id, handle: row.handle, wasEmpty,
      before: `${row.displayName ?? '(비어 있음)'} · 팔로워 ${row.followersCount ?? '(미조회)'}`,
    });
  }

  console.log(`총계 — 응답에 프로필 있는 계정 ${infos.size}명 · 채울 대상 ${jobs.length}명 · 건너뜀 ${skipped.length}명${refreshAll ? ' (--refresh-all)' : ''}\n`);
  for (const j of jobs) {
    console.log(`━━ @${j.handle}${j.wasEmpty ? ' (비어 있던 계정)' : ' (갱신)'}`);
    console.log(`   전: ${j.before}`);
    console.log(`   후: ${j.info.name ?? '(이름 없음)'} · 팔로워 ${j.info.followers ?? '-'} · x_user_id ${j.info.id}`);
    console.log(`   소개: ${(j.info.description ?? '(없음)').replace(/\n/g, ' ⏎ ').slice(0, 80)}`);
    console.log(`   프로필 이미지: ${j.info.profilePicture ? '있음' : '없음'}`);
  }
  if (skipped.length) { console.log('\n건너뜀:'); for (const s of skipped) console.log(`   · ${s}`); }

  if (!jobs.length) { console.log('\n채울 것이 없습니다.'); await sql.end(); return; }
  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면 --apply'); await sql.end(); return; }

  for (const j of jobs) {
    await applyProfileSnapshot(sql, j.id, j.info);
    console.log(`✓ @${j.handle} 프로필 기록 (profile_refreshed_at 갱신)`);
  }

  const after = await sql`
    select handle, display_name, followers_count, x_user_id,
           to_char(profile_refreshed_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as at
      from influencer where id = any(${jobs.map((j) => j.id)}::uuid[]) order by handle`;
  console.log('\n확인 —');
  for (const r of after) console.log(`   @${r.handle} "${r.display_name}" 팔로워 ${r.followers_count} · id ${r.x_user_id} · 기준 ${r.at}`);
  const [n] = await sql`select count(*) as n from influencer where display_name is null`;
  console.log(`명부에서 표시이름이 아직 빈 계정: ${n.n}명`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
