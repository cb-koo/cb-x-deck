# 보관함 공유 제거 모델 — 트윗 소속 ≠ 개인 저장 (설계)

2026-07-25. 배경: [2026-07-13 공유 코멘트 설계](2026-07-13-library-shared-comments-design.md)에서 "저장 취소"는 내 candidate 행을 지우고, **마지막 저장자가 취소하면 트윗이 팀 전체에서 사라지도록** 했다. 그러나 보관함은 코멘트를 남기지 않고 **참고만 하는 팀원**도 있는 공유 공간이다. 마지막 저장자가 취소하면 그 팀원은 아무 예고 없이 참고하던 트윗을 잃는다 → 나쁜 사용자 경험.

**해결(패턴 1 — 소유권 분리):** "트윗이 팀 보관함에 있음"과 "내 개인 저장/코멘트"를 분리한다. 저장 취소는 내 참여만 떼고 트윗은 남긴다. 트윗을 팀 보관함에서 실제로 빼는 것은 별도의 의도적 액션으로만.

## 원칙

- **`library_item`이 팀 보관함 소속의 단일 진실.** 트윗이 보관함에 남는 근거는 개인 저장(candidate)이 아니라 library_item이다.
- **저장/저장 취소 = 순수하게 개인 참여.** 팀 콘텐츠를 파괴하지 않는다.
- **파괴적 제거는 하나뿐 — "팀 보관함에서 빼기"** — 의도적·강한 확인·되돌리기 제공.
- 사용자에게 내부어(library_item·candidate) 노출 금지. UI 언어는 "팀 보관함", "저장", "코멘트".

## 데이터 모델

- **신규 테이블 `library_item`**: `(id, workspace_id, tweet_id, added_by, added_at)`, 유니크 제약 `(workspace_id, tweet_id)`. `tweet_id`는 기존 영속 `tweet` 테이블을 참조(저장자 0명이어도 조인으로 트윗 스냅샷 취득).
- **기존 `candidate`(개인 저장/코멘트)**: 스키마·의미론 불변. 여전히 트윗×워크스페이스×멤버당 1행, memo·태그 보유.
- **마이그레이션**: candidate가 존재하는 모든 `(workspace_id, tweet_id)`에 library_item backfill — `added_by` = 가장 먼저 저장한 멤버, `added_at` = 최소 `saved_at`. 데이터 손실 없음.
- **정리 고려**: tweet 행 prune 로직이 있다면 library_item이 참조하는 tweet은 보존해야 한다(구현 시 확인).

## 동작 정의

1. **저장(덱·보관함)**: `library_item` upsert(없으면 생성, added_by=나) + 내 candidate 생성. 이미 있으면 각각 무해(ON CONFLICT).
2. **저장 취소**: 내 candidate 행만 삭제. **library_item은 유지 → 트윗은 팀 보관함에 남음.**
   - 파괴적이지 않으므로 확인 간소화: **메모·태그가 있을 때만** 가벼운 확인("내 메모·태그가 삭제돼요"), 북마크만이면 확인 없이 즉시 취소.
   - 덱의 저장 취소도 동일(즉시, 확인 없음). **behavior change: 덱에서 저장 취소해도 트윗은 팀 보관함에 남는다**(이전엔 마지막이면 라이브러리에서 사라짐).
3. **저장자 0명 카드**(신규 상태): candidate가 0개여도 library_item이 있으면 카드 표시. 헤더에 "○○이 담음 · 저장한 사람 없음", 어포던스로 저장/코멘트 달기 노출.
4. **팀 보관함에서 빼기**(신규·파괴적): library_item + 그 트윗의 **모든 candidate(코멘트)** 삭제 → 팀 전체에서 사라짐.
   - **권한**: 허용 멤버 누구나(소규모·신뢰 팀, 어드민 역할 백로그). 차단 대신 **확인으로 예방**.
   - **강한 확인**: 잃는 것 구체 명시 — 코멘트 있는 멤버 수를 보여줌. 예) "이 트윗을 팀 보관함에서 뺄까요? 다른 팀원 N명의 코멘트도 함께 삭제됩니다."
   - **되돌리기(실행취소, 옵션 B)**: 확인 후 즉시 서버 삭제하지 않고 **지연 커밋** — 카드를 낙관적으로 숨기고 하단 토스트 "팀 보관함에서 뺐어요 · 실행취소"를 ~5초 노출. 실행취소 누르면 아무것도 삭제 안 하고 카드 복원. 타임아웃 또는 페이지 이탈 시 실제 DELETE 커밋. (브라우저 종료로 커밋 못 하면 미삭제 — fail-safe.) 동시에 하나만 대기; 대기 중 다른 빼기 요청 시 앞의 것을 즉시 커밋 후 시작.
5. **멤버/태그 필터**: candidate 기준(그 멤버가 참여했거나 그 태그를 단 카드). **저장자 0명 카드는 '전체' 필터에서만** 보임(자연스러운 결과, 그대로 둠).
6. **건수 표시**: 보관함 헤더 카운트 = 카드(=library_item) 수.

### 카드 4상태

| 상태 | 카드 내용 |
|---|---|
| 나 저장 + 팀원 저장 | 내 코멘트(편집) · 팀원 코멘트(읽기) · 저장 취소 · 팀에서 빼기 |
| 나만 저장 | 내 코멘트 · 저장 취소 · 팀에서 빼기 |
| 팀원만 저장(나 미저장) | 팀원 코멘트 · 저장/코멘트 달기 · 팀에서 빼기 |
| 저장자 0명 | 트윗 + "○○이 담음 · 저장한 사람 없음" · 저장/코멘트 달기 · 팀에서 빼기 |

### 두 액션의 시각적 분리

- **저장 취소** = TweetCard 상단 `★ 저장됨` 토글(기존 자리, 개인 참여).
- **팀 보관함에서 빼기** = 카드 하단 **눈에 덜 띄는 muted 텍스트 버튼** → 앱 공통 **빨간 인라인 확인 박스**. 새 ⋯메뉴 컴포넌트는 만들지 않음(YAGNI).

## 구현 구조

- **마이그레이션** `migrations/012_library_item.sql`: `library_item` 생성 + 유니크 + candidate 기반 backfill.
- **`candidateStore`**:
  - `ensureLibraryItem(sql, {workspaceId, tweetId, addedBy})` — upsert.
  - `removeLibraryTweet(sql, {workspaceId, tweetId})` — 트랜잭션으로 candidate(+candidate_tag) 및 library_item 삭제.
  - `listLibraryTweets(sql, {workspaceId})` — library_item 기준 + tweet 조인 + candidate LEFT JOIN. 저장자 0명 항목 포함. (보관함 로드의 새 소스)
- **API**:
  - `POST /api/candidates`(저장): 핸들러에서 `ensureLibraryItem` 호출 추가.
  - 신규 `DELETE /api/library?workspaceId&tweetId`(팀에서 빼기): 허용 멤버 확인 후 `removeLibraryTweet`.
  - 보관함 로드: **신규 `GET /api/library?workspaceId`** — `listLibraryTweets` 반환(`{tweet, addedBy, addedAt, candidates[]}[]`). 기존 `GET /api/candidates`는 덱 등 다른 소비자를 위해 유지. 보관함 페이지는 이 신규 경로로 전환.
- **UI**:
  - `src/app/w/[wsId]/library/page.tsx`: 로드 소스를 library 항목으로 교체(저장자 0명 카드 렌더), 팀에서 빼기의 지연 커밋·실행취소 토스트 상태 관리.
  - `src/components/CandidateCard.tsx`: 저장자 0명 상태 렌더, "팀에서 빼기" 버튼+확인, 저장 취소 확인 간소화.
  - 신규 최소 `Toast`(단일·하단·실행취소·자동 소멸). 기존 앱엔 토스트 없음 → 작게 신설.
- **덱**: `Column.save`는 API가 library_item을 처리하므로 클라이언트 변경 최소. 저장 취소 불변.

## 변경하지 않는 것

- candidate CRUD 의미론(내 행만), TweetCard 저장 토글 UI, 태그 전역 네임스페이스, 덱 컬럼 저장소.

## 리서치 체크리스트 대조 (추적성)

`docs/ui-ux-principles-checklist.md` 및 AGENTS.md UX 원칙 기반:

| 설계 결정 | 근거 축 |
|---|---|
| 카드 4상태(0명 포함) 명시 처리 | G(UI 4상태) |
| 저장 취소(개인)와 팀에서 빼기(파괴적) 시각·문구 분리 | K(안심·선택지 최소) · C(Hick) · F(거짓 어포던스) |
| 파괴적 액션 덜 눈에 띄게 + 강한 확인 | F(제약) · B-5(오류 예방) |
| 확인창에 잃는 것 구체 명시 | H(결과 서술) · AGENTS 원칙3 |
| 저장 취소 문구 간소화(메모 있을 때만) | AGENTS 원칙4(라벨-값 일치) |
| 실행취소 토스트(지연 커밋) | **B-3(사용자 통제·자유)** · G(낙관적 UI·복구) |
| 내부어 비노출, "팀 보관함" 사용자 언어 | AGENTS 원칙1·5 · B-2 |
| 앱 공통 빨간 인라인 확인 재사용 | A/J(반복·일관성) |

**의도적 결정**: 파괴적 제거는 소프트 삭제/보관(패턴 3, 인프라 과함)이 아니라 **하드 삭제 + 실행취소 토스트(옵션 B)**로 간다 — 체크리스트가 권하는 "되돌릴 출구"를 저비용으로 충족.

## 검증

- **단위**: backfill 정확성(added_by=최초 저장자·added_at=최소), `ensureLibraryItem` idempotent, `removeLibraryTweet`가 candidate+library_item 전부 삭제, `listLibraryTweets`가 저장자 0명 항목 포함, 저장→취소 후 library_item 잔존.
- **수동**: 나만 저장→취소→트윗 잔존(0명 카드)·팀원 계속 열람 / 팀원만 저장한 카드에 저장/코멘트 / 팀에서 빼기→사라짐 + 실행취소로 복원 / 덱 저장→library_item 생성·덱 취소해도 잔존 / 멤버·태그 필터 / 강한 확인의 코멘트 수 정확성.
