# 다른 인플의 게시물 등록 차단 — 설계

- 날짜: 2026-09-30 · 브랜치 `cb-koo/post-author-guard`(origin/main `a1d74d5`에서)
- DB 변경 없음(마이그레이션 0)

## 1. 왜

09-30 운영 사고: 더스퀘어치과_9월4주차 **@Rinnabiyou417 작업에 @Qni6F의 게시물 링크**가 붙어 있었다. 그 결과
- 인플루언서 성과 페이지에서 Rinnabiyou417의 성과가 Qni6F 글 조회수로 나왔고(선별 숫자 오류),
- Qni6F 본인 작업엔 트래킹이 안 붙었고,
- **정산 요청이 Qni6F 링크를 증빙으로 달고 지급완료까지** 갔다.

지금은 게시물을 작업에 붙이는 어느 입구도 "게시물 작성자 = 배정 인플"을 확인하지 않는다(09-30 코드 감사). koo 요청: **작성자가 다르면 경고하고 등록 불가.**

## 2. 판정 규칙 (한 함수)

`judgePostAuthor({ post, influencer })` → `ok` | `mismatch` | `unverified` | `unassigned`
- 작성자 = **X에서 받아 온 실제 작성자**(`fetchPost`). 링크 주소 속 핸들은 쓰지 않는다 — X는 주소 속 핸들이 틀려도 글을 열어 주고, 핸들을 바꾼 인플의 옛 링크엔 옛 핸들이 남는다(실례: coco_______5 작업 2건의 링크는 `coco__ns_5`, 실제 작성자는 `coco_______5`).
- 비교: 작성자 계정 고유번호(`author.id`)와 명부 `influencer.x_user_id`가 **둘 다 있으면 고유번호로**(핸들 변경에 안전). 아니면 핸들을 대소문자 무시로(명부 밖 핸들·고유번호 미저장 13명).
- `unassigned`: 작업에 인플이 배정돼 있지 않음.
- `unverified`: X 조회 실패(연동 오류·삭제·비공개·기형 응답). **koo 결정: 막는다** — 확인 안 된 링크는 들어가지 않는다.

`fetchPost`의 결과에 `authorUserId`(`author.id`)를 추가한다(저장은 안 함 — DB 변경 없음).

## 3. 막는 입구

| 입구 | 지금 | 바뀜 |
|---|---|---|
| ① 게시 확인(작업 패널 `PostedBox`·옛 `PostedCell`) → `PATCH /api/campaigns/[id]/tasks/[taskId]`의 `postUrl` | 주소 형식만 검사하고 저장, 화면이 이어서 `POST /api/tracking`을 따로(실패해도 무시) | **서버가 같은 요청 안에서** 조회 → 판정 → 통과 시 `post_url` 저장 + 트래킹 등록·연결(`addTrackedPost`+`linkTrackedPost`)까지. 화면의 두 번째 호출은 없앤다(트래킹 누락도 함께 사라짐). |
| ② 게시물 연결(옛 `LinkPostModal`) → `POST /api/tracking` + `PATCH /api/tracking/[id] {taskId}` | 조회해서 작성자를 저장하지만 비교 안 함 | 작업에 연결하기 전 판정. 저장된 `tracked_post.author_handle`로 1차 비교, 고유번호 비교가 필요하면(명부에 x_user_id 있음) 조회. |
| ③ `POST /api/tracking {taskId}` | 같음 | ②와 같은 판정 |
| ④ 트래킹 화면 원고 연결 → `PATCH /api/tracking/[id] {draftId}` (그 원고가 작업에 붙어 있으면 작업에도 연결) | 비교 안 함 | 원고에 작업이 있으면 그 작업 기준으로 판정. 작업 없는 원고 연결은 그대로 허용. |
| ⑤ 게시물이 붙은 작업의 인플 바꾸기 | **이미 막혀 있음** — 게시된 작업은 인플 변경·해제 불가(`influencerChangeGuard`의 POSTED_TASK_MESSAGE). 예외: 게시된 **미배정** 작업의 최초 배정은 허용 | 그 예외에만 판정 추가: 작업에 게시물(tracked_post)이 붙어 있으면 새로 배정하는 인플이 작성자와 같아야 한다(저장된 author_handle + 명부 x_user_id로 비교, 필요 시 조회). ①~④가 미배정 작업 연결을 막으므로 옛 데이터용 방어. |

- RT 작업은 자기 게시물이 없다(기존 규칙: 트래킹 연결 거절) — 변화 없음.
- 정산 요청 생성 시 재검사는 **하지 않는다**(koo 결정: 입구만 막기).
- 자동 게시 확인(`checkPosted`, RT 리트윗 목록 대조)은 이미 핸들로 본인 확인을 하고 게시물 링크를 건드리지 않는다 — 변화 없음.
- 이미 저장된 데이터는 건드리지 않는다(09-30 점검: 실제 작성자 불일치 0건).

## 4. 거절 문구 (사용자 말, UX 원칙 1·3)

- mismatch: `이 게시물은 @{작성자}의 글이에요. 이 작업의 인플은 @{배정}이에요 — 링크를 확인해 주세요`
- unverified: `게시물 작성자를 확인하지 못했어요 — 링크가 맞는지 보고 잠시 후 다시 시도해 주세요`
- unassigned: `인플을 먼저 배정해 주세요 — 누구의 게시물인지 확인할 수 없어요`
- 최초 배정 거절(⑤): mismatch 문구와 같은 모양 — `이 작업에 붙은 게시물은 @{작성자}의 글이에요 — 그 인플로 배정해 주세요`

서버는 400 + `{ error, code: 'author-mismatch' | 'author-unverified' | 'task-unassigned' }`.

## 5. 화면: 붙여 넣는 순간 알림

- 게시 확인 칸(`PostedBox`)은 링크를 붙여 넣으면 이미 게시물 미리보기를 불러온다(`useTweetPreview`). 미리보기에 **작성자 `@핸들`**을 보이고, 배정 인플과 다르면 그 자리에 빨간 안내(위 mismatch 문구) + **게시 확인 버튼 비활성.** 미리보기 조회 실패면 버튼은 켜 두되 서버가 판정한다(서버가 최종 권위).
- 화면 비교는 핸들 기준(편의용). 최종 판정은 서버(고유번호 우선).
- 옛 화면(`PostedCell`·`LinkPostModal`)·트래킹 화면은 서버 거절 문구를 그대로 보여준다(미리보기 추가는 하지 않는다 — 주 사용 화면은 캠페인 v2).

## 6. 구조

- `src/lib/postAuthor.ts` (순수): `judgePostAuthor`, 거절 문구·코드. 단위 테스트.
- `src/lib/postMetrics.ts`: `authorUserId` 추가.
- `src/lib/postAttach.ts`(DB+주입 가능한 fetch): `attachPostToTask(sql, taskId, url, { fetchPost })` — 조회·판정·`post_url` 저장·트래킹 등록/연결을 한 트랜잭션으로. `guardTaskLink(sql, taskId, trackedPost, deps)` — ②~④용 판정. 라우트는 이 함수만 부른다(라우트 테스트 하네스가 없어 로직을 lib에 둔다).
- 작업 PATCH 라우트: `postUrl`이 오면 `attachPostToTask` 사용. 게시된 미배정 작업 최초 배정 시 ⑤ 판정.
- `src/app/api/tracking/route.ts`·`[id]/route.ts`: 작업 연결 직전 판정(작업·명부 조회 헬퍼 공용).
- `src/app/campaigns/useCampaignTaskActions.ts`: 게시 확인 뒤 `registerTrackedPostApi` 두 번째 호출 제거.
- `PostedBox`: 미리보기 작성자 표시·불일치 안내·버튼 비활성.

## 7. 테스트

- 판정: 고유번호 일치(핸들 달라도 ok — coco 사례), 고유번호 불일치(핸들 같아도 mismatch), 고유번호 없으면 핸들 대소문자 무시 비교, 미배정, 조회 실패.
- 라우트/스토어(연습용 DB, fetchPost는 주입/대역): ① 불일치면 post_url·트래킹 모두 안 생김, 일치면 둘 다 생김 ② ③ ④ 거절 ⑤ 게시물 붙은 미배정 작업에 다른 인플 최초 배정 거절, RT 작업은 기존대로.

## 8. 업데이트 소식

`개선` 1건: `다른 인플의 게시물은 작업에 붙지 않아요` — 게시 확인·게시물 연결 때 작성자를 확인하고, 다르면 붙여 넣는 순간 알려 줘요. 게시 확인하면 트래킹 등록까지 한 번에 돼요.
