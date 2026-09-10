// @coco__ns_5 → @coco_______5 개명 (koo 지시 2026-09-10).
//
// 근거 — 9월2주차 게시물 조회(getxapi tweet/detail) 응답 세 곳이 같은 것을 말한다:
//   ① 게시물 2096910045032362141 의 author.userName = "coco_______5"
//      (계정 id 1342314515631751170 · 2020-12-25 개설 · "coco|美容辞典" · 팔로워 29,840 — 계정 자체는 그대로)
//      같은 응답의 url 도 https://x.com/coco_______5/... 로 온다.
//   ② 이 게시물을 인용한 @2024_0406 · @Eveniffen 두 건의 quoted_tweet.user.screen_name 도 "coco_______5"
//   ③ 반면 media[].expanded_url 은 "coco__ns_5" 로 굳어 있다 — 업로드 시점 값이라 개명을 따라오지 않는다.
//      슬랙의 게시물 링크도 예전 핸들인데, X가 status ID로 라우팅해 그대로 열린다(그래서 링크는 안 고친다).
//   ※ user/info 엔드포인트는 이 시점에 502라 별도 프로필 조회로는 확인하지 못했다. 위 근거가 직접 증거다.
//
// 명부에는 @coco__ns_5 한 행만 있다(@coco_______5 없음) → 병합이 아니라 개명이 맞다.
// 앱의 renameInfluencer 를 쓴다 — 명부·원고·작업·캠페인 추가비용의 핸들 참조를 함께 옮기고
// handle_changed 이력을 남긴다. 새 행을 만들면 같은 사람이 두 줄로 남는다.
//
// 🔴 renameInfluencer 가 건드리지 않는 것(설계 그대로 둔다):
//   · tracked_post.author_handle — 지금 두 표기가 섞여 있다(이번에 넣은 1건은 coco_______5,
//     기존 1건은 coco__ns_5). 명부와 조인되지 않고 표시·permalink 조립에만 쓰이며, 예전 핸들 URL도
//     X가 열어 준다. 되돌아볼 수 있게 그대로 남긴다.
//   · payment_request — 이 인플루언서는 요청 0건이라 영향 없음(스냅샷이라 원래 안 바꾼다).
//   · tracking_link.utm_content — 이 인플루언서는 0건.
//
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/rename-coco.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { findByHandle, renameInfluencer, updateInfluencer, getInfluencerDetail } from '../src/lib/influencerStore.ts';

const FROM = 'coco__ns_5';
const TO = 'coco_______5';
const NOTE = '개명: @coco__ns_5 → @coco_______5 (2026-09-10 확인). 계정 id 1342314515631751170 그대로이고 핸들 표기만 밑줄 2개→7개로 바뀌었다. 근거: 9월2주차 백수약국 게시물(2096910045032362141) 조회 응답의 author.userName, 그리고 이 게시물을 인용한 @2024_0406·@Eveniffen의 quoted_tweet.user.screen_name 이 모두 coco_______5. 슬랙 기록과 게시물 미디어 URL은 예전 핸들로 남아 있다(X가 status ID로 라우팅해 링크는 그대로 열린다). 앱에 별칭 기능이 없어 다시 바뀌면 재개명해야 한다.';
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  const from = await findByHandle(sql, FROM);
  const to = await findByHandle(sql, TO);
  if (!from) { console.error(`✗ @${FROM}: 명부에 없어요`); await sql.end(); process.exit(1); }
  if (to) {
    console.error(`✗ @${TO}: 이미 명부에 있어요(@${to.handle}) — 개명이 아니라 두 행을 합쳐야 하는 상황입니다. 사람이 확인해야 해요.`);
    await sql.end(); process.exit(1);
  }

  const [cnt] = await sql`
    select (select count(*) from draft where lower(influencer_handle) = ${FROM}) as drafts,
           (select count(*) from campaign_task where lower(influencer_handle) = ${FROM}) as tasks,
           (select count(*) from campaign_influencer_cost where lower(influencer_handle) = ${FROM}) as costs,
           (select count(*) from payment_request where lower(influencer_handle) = ${FROM}) as reqs,
           (select count(*) from tracking_link where lower(utm_content) like ${'%' + FROM + '%'}) as links,
           (select count(*) from tracked_post where lower(author_handle) = ${FROM}) as tp_old,
           (select count(*) from tracked_post where lower(author_handle) = ${TO}) as tp_new`;
  const detail = await getInfluencerDetail(sql, from.id);

  console.log(`개명: @${from.handle} → @${TO}\n`);
  console.log('현재 상태');
  console.log(`   표시이름 ${from.displayName ?? '(비어 있음)'} · 팔로워 ${from.followersCount ?? '(미조회)'}`);
  console.log(`   결제수단 ${detail?.paymentMethods.length ?? 0}개 · 기록 ${detail?.logs.length ?? 0}건`);
  console.log(`\n함께 옮겨지는 것 — 원고 ${cnt.drafts}건 · 작업 ${cnt.tasks}건 · 캠페인 추가비용 ${cnt.costs}건`);
  console.log(`건드리지 않는 것 — 정산 요청 ${cnt.reqs}건 · 트래킹 링크 ${cnt.links}건 · tracked_post(옛 표기 ${cnt.tp_old}건 · 새 표기 ${cnt.tp_new}건)`);
  if (Number(cnt.tp_old) > 0) {
    console.log(`   ⓘ tracked_post 에 옛 표기가 ${cnt.tp_old}건 남습니다 — 명부와 조인되지 않고 표시·링크 조립에만 쓰여 동작에는 영향이 없습니다.`);
  }
  console.log(`\n메모에 남길 내용:\n   ${NOTE}`);
  console.log('\n남는 것: handle_changed 이력({from,to})이 타임라인에 기록됩니다.');
  console.log(`주의: @${TO}의 프로필(표시이름·팔로워)은 개명만으로 갱신되지 않습니다 — 화면에서 프로필 조회를 눌러야 새 값이 들어옵니다.`);
  console.log('      (참고: 조회해 둔 응답에 표시이름 "coco|美容辞典" · 팔로워 29,840 · x_user_id 1342314515631751170 이 있습니다)');

  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면 --apply를 붙여 다시 실행하세요.'); await sql.end(); return; }

  await sql.begin(async (tx) => {
    await renameInfluencer(tx as never, { influencerId: from.id, from: from.handle, to: TO, actorId: actor.id });
    await updateInfluencer(tx as never, from.id, { note: NOTE });
  });

  const after = await findByHandle(sql, TO);
  const [post] = await sql`
    select (select count(*) from draft where lower(influencer_handle) = ${TO}) as drafts,
           (select count(*) from campaign_task where lower(influencer_handle) = ${TO}) as tasks,
           (select count(*) from influencer where lower(handle) = ${FROM}) as old_row,
           (select count(*) from influencer_log where influencer_id = ${from.id} and event_type = 'handle_changed') as logs`;
  console.log(`\n✓ @${from.handle} → @${after?.handle} 개명 완료 · 메모 기록됨`);
  console.log(`확인 — 새 표기 원고 ${post.drafts}건 · 작업 ${post.tasks}건 · 옛 명부 행 ${post.old_row}개(0이어야 함) · handle_changed 로그 ${post.logs}건`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
