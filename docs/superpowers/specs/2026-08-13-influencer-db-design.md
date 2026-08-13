# 인플루언서 DB (명부) 설계

날짜: 2026-08-13
상태: 설계 확정 (koo 승인, 섹션별 검토 완료)
선행: `2026-08-11-draft-influencer-assign-design.md` (원고 배정 — 핸들 자연키), `docs/research/` 리서치 7건 (CRM 3사 벤치마크 + X API 전략, a2c7091)

## 1. 목적과 범위

**목적**: 협업 관계에 있는 인플루언서의 단일 명부. "우리가 협업하는 인플루언서가 누구고 각자 어떤 상태인가"에 답하는 화면이 메인이다. 발굴/분석 도구가 아니다.

**v1 범위 = 명부만.**
- 인플루언서 목록 + 프로필 (X 프로필 스냅샷 · 태그 · 고정 메모 · 기록 타임라인 · 배정 원고 롤업)
- 기록 타임라인 = 앱 이벤트 자동 기록 + 수동 한 줄 기록

**v1에서 만들지 않는 것** (스키마도 만들지 않음):
- 캠페인·딜(캠페인×인플루언서 조인) 축 — 실사용 피드백 후 설계. 실무 단위는 확인됨: 클라이언트별 구분 → 유형(콘텐츠 의뢰/방문협찬/시딩) → 시즌·기간. `influencer_log.event_type` 확장으로 수용 가능하게만 설계해 둔다
- 관계 상태·등급 필드 — 추후 구체화
- X 활동 자동 감지(게시 감지 등, X Activity API) — 캠페인 축과 함께
- DM 대화 요약(LLM) — getxapi DM은 X Chat(암호화) 대화가 조용히 누락되는 것이 확인됨(08-13). 반쪽 데이터 위에 자동 요약을 얹지 않는다. 공식 X Chat API 안정화 후 재검토
- 동일 인물 병합 기능 (§7 알려진 한계)

## 2. 데이터 모델 (마이그레이션 024)

### `influencer` — 최상위 엔티티 (client 선례: 워크스페이스 FK 없음)

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | uuid PK | |
| `handle` | text not null | @ 없는 핸들. `parseXHandle` 결과 표기 보존. **`lower(handle)` 유니크 인덱스** — X 핸들은 대소문자 무관 |
| `x_user_id` | text | 개명 대비 식별자. 최초 프로필 조회 시 채움, 그 전엔 null |
| `display_name` | text | X 프로필 스냅샷 |
| `avatar_url` | text | 〃 |
| `bio` | text | 〃 |
| `followers_count` | int | 〃 |
| `profile_refreshed_at` | timestamptz | null = 미조회. "○일 전 기준" 표시 근거 |
| `tags` | jsonb `'[]'` | string[] 자유 태그 (`banned_phrases` 선례) |
| `note` | text `''` | 고정 메모 — 단가·주의사항 등 시간과 무관한 정보 |
| `created_at`, `created_by` | | `created_by`는 member FK on delete set null |

### `influencer_log` — 수동 기록과 자동 이벤트를 같은 시계열에

| 컬럼 | 타입 | 내용 |
|---|---|---|
| `id` | uuid PK | |
| `influencer_id` | uuid FK not null | influencer on delete **cascade** |
| `kind` | text | `'manual'` \| `'auto'` (check) |
| `event_type` | text | auto 전용: `draft_assigned` / `draft_unassigned` / `draft_delivered` / `handle_changed`. 표시 문구는 UI에서 렌더 — 문장을 저장하지 않아야 문구를 나중에 고칠 수 있다 |
| `body` | text | manual 전용: 사용자가 친 한 줄 |
| `channel` | text | manual 선택: `dm`/`line`/`email`/`other` |
| `draft_id` | uuid FK | draft on delete set null (auto 전용) |
| `draft_title` | text | 스냅샷 — `ko_title` 우선, 없으면 본문 첫 줄 (client_name 선례: 원고 삭제 후에도 로그 재현) |
| `payload` | jsonb | 구조 데이터. `handle_changed`: `{from, to}` |
| `author_id` | uuid FK | member on delete set null. auto는 행위를 일으킨 사용자 |
| `created_at` | timestamptz | |

인덱스: `(influencer_id, created_at desc)`.

### 파생 규칙 (라벨-값 일치)

- 목록의 날짜 컬럼 라벨은 **"마지막 기록"** — auto/manual 불문 최신 로그의 `created_at`. "마지막 연락"이라 부르면 원고 배정(내부 행위)이 섞여 거짓이 된다.
- 배정 원고 수·롤업은 `lower(draft.influencer_handle) = lower(influencer.handle)` 조인 — 참여 이력 테이블을 만들지 않는다 (Favikon 방식, 리서치 채택).

## 3. 화면

- **사이드바에 "인플루언서" 추가** — 클라이언트와 같은 급, 페이지 `/influencers`.
- **클라이언트 페이지의 2단 분할 패턴을 따른다** — 왼쪽 명부, 오른쪽 선택한 인플루언서 프로필. 새 레이아웃 문법을 만들지 않는다.

**왼쪽 — 명부 리스트**
- 행: 프사 · 표시 이름 · @핸들 · 팔로워 수 · 태그 칩 · 마지막 기록일 · 배정 원고 수
- 상단: 검색(이름/핸들/태그) · 태그 필터 · [인플루언서 추가]
- 추가 다이얼로그: 핸들 또는 프로필 URL, **여러 줄 허용**(줄당 하나). 제출 시 클라이언트가 줄 단위로 순차 POST — 줄마다 성공/실패/중복이 실시간 표시되고 실패 줄만 재시도 가능 (§4)
- 미조회 상태(자동 등록 행)는 핸들만으로 렌더 — 미조회를 1급 상태로 취급

**오른쪽 — 프로필**
- 헤더: 프사 · 이름 · @핸들(X 링크) · 팔로워 수 + "○일 전 기준" + [프로필 갱신] 버튼(비용 유발 opt-in, UX 원칙 6)
- 고정 메모, 태그 편집
- 기록 타임라인: 한 줄 입력창(+ 채널 칩) 위로 auto/manual 항목 시간 역순. auto 항목의 원고 제목 클릭 → 해당 원고로 이동. manual 항목만 삭제 가능(오타 정정) — auto는 앱이 한 일의 사실 기록이라 삭제 불가
- 배정 원고 롤업: 상태 뱃지 포함 목록, 클릭 → 워크벤치 해당 원고

**빈 상태를 기본 화면으로 간주하고 설계한다** — 명부가 비었을 때 추가 유도, 프로필 미조회일 때 "프로필 미조회 — 갱신 버튼으로 가져올 수 있어요" 안내.

## 4. 등록 경로

1. **수동 추가** — 위 다이얼로그. `parseXHandle` → `getUserInfo` 1회 자동 조회(핸들 실존 검증 겸 스냅샷 — 사용자가 방금 누른 행동의 직접 결과라 opt-in 원칙과 충돌하지 않음) → insert.
2. **원고 배정 시 자동 등록** — 명부에 없는 핸들을 배정하면 자동 추가. 이때는 **프로필 조회 없이 핸들만**(비용 원칙 — 스냅샷은 나중에 opt-in 갱신).
3. **기존 배정 이력** — 일괄 백필하지 않는다. **koo가 직접 큐레이션한 리스트를 제공하면 그때 1번 경로(여러 줄 추가)로 등록한다.** 별도 이관 스크립트 없음. 명부에 없는 옛 핸들의 원고 배정 표기는 그대로 보인다(스냅샷).

## 5. 데이터 흐름·API

### 신규 라우트 `/api/influencers` (읽기(GET)는 `requireAllowedUser`, 쓰기는 `requireMember` — drafts 라우트 선례)

| 라우트 | 동작 |
|---|---|
| `GET /api/influencers` | 목록 + 파생값(마지막 기록일, 배정 원고 수) |
| `POST /api/influencers` | **핸들 하나** 추가. 여러 줄은 클라이언트가 줄 단위 순차 호출(함수 타임아웃 회피 + 줄별 진행 표시). 중복(lower)은 오류가 아니라 "이미 명부에 있음" 정보로 응답 |
| `GET /api/influencers/[id]` | 프로필 + 로그 타임라인 + 원고 롤업 |
| `PATCH /api/influencers/[id]` | 메모·태그 수정 (핸들 수정은 없음 — 정정 경로는 삭제 후 재등록) |
| `DELETE /api/influencers/[id]` | 제거. 로그 cascade, 원고 배정 표기는 남음 (023 취지) |
| `POST /api/influencers/[id]/refresh` | 프로필 갱신 + 개명 처리 (아래) |
| `POST /api/influencers/[id]/logs` | 수동 기록 추가 |
| `DELETE /api/influencers/[id]/logs/[logId]` | manual 항목만 삭제 허용 |

로직은 신규 `src/lib/influencerStore.ts`에 집중, 라우트는 얇게 (`clientStore` 패턴 미러링 — 라우트 하네스가 없는 검증 실무 전제).

### 자동 로그 배선 — `updateDraft` 라우트 내부 (023이 가둬 둔 교체 지점 1)

- `influencer_handle` 변경: 배정 = `draft_assigned`, 해제 = `draft_unassigned`, 교체 = 해제+배정 두 줄. 명부에 없는 핸들이면 먼저 자동 등록.
- `status` → `delivered` 전이: 배정된 인플루언서가 있으면 `draft_delivered`.
- **draft 갱신과 로그 insert는 같은 트랜잭션** (6543 트랜잭션 모드 풀러에서 정상 동작). 로그만 누락되는 어긋남을 만들지 않는다.
- 기존 함정 유지: 해제=null 저장은 `case when`(coalesce 불가, 테스트로 고정돼 있음), 빈 문자열은 `parseXHandle` 호출 전에 null 확정.

### 옵션 소스 승계 — `GET /api/drafts/influencers` 내부 (교체 지점 2)

"draft에서 distinct 추출" → "명부 테이블 조회"로 내부 구현만 교체. 응답 형태·호출부·`InfluencerField` 저장 형식은 그대로. 명부에 없는 옛 핸들이 옵션에서 빠지는 것은 의도된 동작(명부가 곧 협업 대상). 필드의 도움말 문구("이미 배정한 적 있는 계정이 제안됩니다")는 옵션 소스가 바뀌면 거짓이 되므로 "등록된 인플루언서가 제안됩니다"로 교체 — 문구 교체가 스왑의 일부다.

### 프로필 갱신·개명 처리 (`refresh`)

1. `getUserInfo(handle)` 성공 + x_user_id 일치(또는 최초 조회) → 스냅샷 갱신.
2. 성공했는데 **id가 다름** → 그 핸들을 다른 계정이 차지한 것. 덮어쓰지 않고 "이 핸들은 현재 다른 계정입니다" 상태 표시.
3. **404** → getxapi에 id 기반 조회가 가능하면 `x_user_id`로 새 핸들 발견 → 개명 플로우: ① `influencer.handle` 갱신 ② 같은 사람의 `draft.influencer_handle` 일괄 UPDATE(같은 사람이므로 배정 사실 불변 — 023 스냅샷 취지는 "삭제 후 재현"이지 개명 추적이 아님) ③ `handle_changed` auto 로그(`payload: {from, to}`). id 조회 불가면 "핸들을 찾을 수 없음" 상태 + 수동 정정 유도. **id 기반 조회 지원 여부는 구현 단계에서 확인하고, 안 되면 후자만으로 시작한다.**

프로필 조회는 기존 `GetxapiClient.getUserInfo` 재사용 — 사용량 계측(`getxapi.userInfo`) 기왕에 붙어 있음.

## 6. 에러 처리

- 추가 시 `getUserInfo` 실패(레이트리밋·네트워크): 그 줄만 "실패 — 재시도", 등록하지 않음.
- 갱신 실패: 기존 스냅샷 유지 + 실패 사유 표시. 스냅샷을 지우지 않는다.
- `delivered` 상태를 오갔다 재도달하면 로그가 여러 줄 — 실제 일어난 일의 기록이므로 의도된 동작.

## 7. 알려진 한계

- **동일 인물 중복 행**: @old 등록 상태에서 개명 감지 전에 @new가 새로 등록되면 두 행이 된다. 갱신 시 x_user_id 충돌이 감지되면 경고 표시까지만 — 병합 기능은 이 규모(사용자 2~5명)에 과함(YAGNI). 정정은 수동(한쪽 삭제).
- 자동 등록 행은 스냅샷이 없어 핸들만 보인다 — opt-in 갱신 전까지. 의도된 비용 절제.
- 명부에 등록되지 않은 핸들이 배정된 원고의 `delivered` 전이는 기록되지 않으며, 이후 재저장으로도 소급 기록되지 않는다("등록은 배정에서만" 규칙의 의도된 귀결).
- 로그는 앱이 아는 사실 + 사람이 남긴 한 줄이다. X 활동·DM 내용의 자동 반영은 백로그(§1).

## 8. 테스트

- `influencerStore.ts` 단위: lower 중복 판정 · 마지막 기록일 파생 · 자동 로그 4종(배정/해제/교체/전달) · `case when` 해제 함정 회귀 · 개명 시 draft 핸들 UPDATE.
- tsx 단일 파일 실행(수초)으로 개발, 전체 `npm test`(실 DB, 4분)는 머지 전. 린트 기준선 24개 유지.

## 9. 백로그 (v1 이후, 트리거 조건부)

| 항목 | 트리거 |
|---|---|
| 캠페인·딜 축 (클라이언트×유형×기간, 조인에 스테이지) | 명부 실사용 후 진행 관리 요구가 구체화될 때 |
| 관계 상태·등급 필드 | koo가 기능 구체화 후 |
| X 활동 자동 감지 (X Activity API 웹훅) | 캠페인 축과 함께 |
| DM 요약 자동 로그 (LLM) | 공식 X Chat API 안정화 + 캠페인 축 이후 |
| 동일 인물 병합 | 중복이 실제로 반복 발생하면 |
