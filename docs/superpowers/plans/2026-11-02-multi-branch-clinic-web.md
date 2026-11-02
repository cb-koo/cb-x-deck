# 다지점 클리닉(벤자민 방문협찬) — cb-x-deck 구현 계획서

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

작성일: 2026-11-02

**Goal:** 클라이언트 한 곳 아래 여러 지점(location)을 두고, 웹·익스텐션이 같은 지점 기준으로 예약을 등록·수정·판정하게 만든다. 지점 관리 화면, 협찬 항목 메모, 벤자민 기재시트 파싱 키를 함께 넣는다.

**Architecture:** `clinic_location`에 `name·position·active`를 더하고 `kind='branch'`를 허용한다(본점 자동 생성 구조와 부분 unique 인덱스는 유지). 클리닉 목록·캠페인·추출·등록·수정 API가 "클라이언트의 사용 중 지점" 목록을 한 함수(`listClientLocations`)로 읽는다. 지점 매칭은 LLM 추출 단계에서 지점 이름 후보를 주고 서버가 검증해 `locationId`로 돌려준다. 협찬 메모는 `client.sponsor_memo` 한 칸이며 익스텐션 API에는 읽기 라우트만 둔다.

**Tech Stack:** Next.js(App Router) · postgres.js · node:test(스테이징 Postgres) · 마이그레이션은 배포마다 전부 재실행(멱등 필수)

**Spec:** `../../../cb_x_extension/docs/superpowers/specs/2026-11-02-benjamin-visit-sponsorship-design.md` (§1 데이터 구조, §2 폼·시트, §3 지점 값의 출처, §5 대표 지점·지점 변경 저장, §6 웹 예약 등록, QA A·B·C·D·G·H·I절). 화면 기준 목업: `../../../cb_x_extension/mockup/benjamin.html` 오른쪽 패널(지점·운영시간·지도·양식·협찬 항목·웹 예약 등록 탭).

**짝 계획서:** 익스텐션 쪽은 `../../../cb_x_extension/docs/superpowers/plans/2026-11-02-multi-branch-clinic-extension.md`. **배포 순서는 cb-x-deck 먼저.** 익스텐션은 새 필드가 없어도 동작하도록 만들지만, 서버가 먼저 나가야 지점 선택이 실제로 저장된다.

## 공용 계약 (두 계획서가 같은 내용을 가진다)

```ts
// GET clinics → Page<ClinicSummary>
type ClinicSummary = { id: string; clientId: string; name: string /* 클라이언트명 */; configured: boolean;
  branchName: string /* '' 이면 화면에서 "본점" */; kind: 'main' | 'branch'; position: number; active: boolean };
// GET campaigns → Campaign.locationId = 대표 지점(사용 중 + position 최소). clientId는 그대로.
// POST reservation-extractions → ExtractionResult에 추가:
//   locationId: string | null   // 답변의 지점이 클라이언트의 사용 중 지점 하나와 맞으면 그 id, 아니면 null
// POST reservations: locationId(기존). templateRevisionId는 "같은 클라이언트의 장소" 리비전이면 허용.
// PATCH reservations/{id}: body에 locationId?: string 추가. 바꾸면 differences에
//   { field: 'location', label: '지점', before: '명동점', after: '신사점' } 1건 (시트 7. 지점 줄 차이는 따로 내지 않음)
// GET clients/{clientId}/sponsor-memo → { memo: string }   (익스텐션 product API, 읽기 전용. 쓰기는 웹 /api/clients/{id} PATCH만)
// 시트 키 추가(양쪽 동일): nationality('국적'), branch('지점'), followerTier('인플루언서팔로워')
//   별칭 추가: name += '성함(여권영문명)', preferred += '예약날짜및시간', treatment += '상담희망항목', profileUrl += '인플루언서계정링크'
```

## Global Constraints

- 마이그레이션은 **추가만** 하고 매 배포 재실행되므로 모든 문장이 멱등이어야 한다(`AGENTS.md` 규칙, `scripts/migrate-on-build.mjs`). 삭제·이름 변경 없음.
- `idx_clinic_location_client_main`(client당 main 1개)과 `listClinics`의 본점 자동 생성 `on conflict (client_id) where kind = 'main'`은 **그대로 둔다**(스펙 §1 마이그레이션 방식).
- 지점이 1개인 클라이언트의 화면·API 응답 의미가 바뀌면 실패다(스펙 "실패로 볼 것", QA H절). `branchName=''`이면 화면은 "본점"으로 표기한다.
- 익스텐션 product API에 협찬 메모 **쓰기 라우트를 만들지 않는다**(QA I5). `extensionProductDispatch`는 Bearer·쿠키 두 경로가 공유하므로 쓰기는 `/api/clients/[id]` PATCH에만 둔다.
- 변경 이력에 지점은 `field:'location'` 1건만 남긴다(QA D26). `branch` 키는 `DIFF_ORDER`에 넣지 않는다.
- 테스트: `npm test`는 `.env.staging`의 스테이징 Postgres를 쓴다. 로컬에 없으면 순수 함수 테스트(`reservationSheet`, `reservationPolicy`, `clinicHours`)만 돌고 dispatch 테스트는 건너뛴다. 각 검증 단계에 이 전제를 적는다.
- 벤자민 명동·신사 지점 데이터는 SQL로 넣지 않는다. 배포 뒤 담당자가 지점 관리 화면에서 기존 본점 행을 명동 또는 신사로 이름 짓고 나머지를 추가한다(스펙 §1 "사용자 확인").
- 작업 전 `git pull`. 로컬 main이 origin보다 104커밋 뒤에 있고 origin에는 073–082 마이그레이션이 이미 있다. 새 번호는 **083**. 작업 트리의 미커밋 변경(`campaignTaskStore.ts`·`reservationWriteGuard.ts`·`extensionProductApi.ts`·`CampaignDetail.tsx`·`FlowDetail.tsx`, 작업 삭제 규칙)은 이 작업과 무관하므로 같이 커밋하지 않는다.

## Review Focus

1. 사용 중지된 지점 id로 등록·수정 요청 → 422 `LOCATION_INACTIVE` "사용 중지된 지점이에요. 지점을 다시 골라 주세요."(QA I1). Task 5 테스트.
2. 지점 이름이 같은 두 행(공백·대소문자 차이만) → 지점 추가 API가 409로 막는다(QA A6). Task 3 테스트.
3. 마지막 사용 중 지점을 사용 중지 → 409로 막는다(대표 지점이 없어지면 캠페인 `locationId`가 null이 되어 익스텐션 파싱이 멈춘다). Task 3 테스트.
4. LLM이 `branch`에 후보 밖 문자열(예: "明洞店")을 돌려줌 → 서버가 `''`·`locationId:null`로 정리한다(QA C6). Task 6 테스트.
5. 등급 줄에 안내 문구 "영역 (나노/마이크로/메가)"가 값으로 들어온 채 저장 → 저장 시 빈 값으로 정리된다(QA I7). Task 4 테스트.

---

### Task 0: 저장소 동기화

**Files:** 없음(상태 확인)

- [ ] **Step 1:** `git stash` 없이 미커밋 변경을 확인하고 그대로 둔다. `git fetch origin && git merge --ff-only origin/main` (충돌 시 사용자에게 알리고 중단).
- [ ] **Step 2:** `ls migrations | tail -1` → `082_post_metric_estimate.sql`인지 확인. 다르면 아래 번호를 그 다음으로 바꾼다.
- [ ] **Step 3:** `.env.staging` 존재 여부를 기록한다(없으면 dispatch 테스트는 "스테이징 환경에서 실행 필요"로 보고).

### Task 1: 마이그레이션 083 — 지점 칸과 협찬 메모

**Files:**
- Create: `migrations/083_clinic_branches.sql`

**Interfaces:**
- Produces: `clinic_location.name text not null default ''`, `position integer not null default 1`, `active boolean not null default true`, `kind in ('main','branch')`; `client.sponsor_memo text not null default ''`.

- [ ] **Step 1: 마이그레이션 작성** (멱등 형식은 `071_settlement_auto_send.sql:38-39` 참고)

```sql
alter table clinic_location drop constraint if exists clinic_location_kind_check;
alter table clinic_location add constraint clinic_location_kind_check check (kind in ('main', 'branch'));
alter table clinic_location add column if not exists name text not null default '';
alter table clinic_location add column if not exists position integer not null default 1;
alter table clinic_location add column if not exists active boolean not null default true;
create index if not exists idx_clinic_location_client_position on clinic_location (client_id, position);
alter table client add column if not exists sponsor_memo text not null default '';
```

- [ ] **Step 2: 두 번 적용해 멱등 확인** — `scripts/apply-migrations.sh`를 스테이징에 2회 실행. Expected: 두 번째도 오류 없음(QA H7).
- [ ] **Step 3: Commit** `git commit -m "feat(db): clinic_location 지점명·순서·사용 여부, client.sponsor_memo (083)"`

### Task 2: `clinicStore` — 지점 목록·대표 지점·클라이언트 지점 조회

**Files:**
- Modify: `src/lib/clinicStore.ts:17-24` (`listClinics`), 타입 추가
- Modify: `src/lib/extensionProductApi.ts:148` (`Campaign.locationId`), `:159` (`GET clinics`)
- Test: `src/lib/clinicStore.test.ts` (신규, dispatch 테스트와 같은 픽스처 방식 `reservationCommands.test.ts:44-55`)

**Interfaces (Produces):**
```ts
export type ClinicSummary = { id: string; clientId: string; name: string; configured: boolean; branchName: string; kind: 'main'|'branch'; position: number; active: boolean };
export async function listClinics(sql): Promise<ClinicSummary[]>            // 정렬: c.position, c.name, l.position, l.created_at
export async function listClientLocations(sql, clientId: string, opts?: { activeOnly?: boolean }): Promise<ClinicSummary[]>  // 기본 activeOnly:true, position 순
export function representativeLocation(list: ClinicSummary[]): ClinicSummary | null  // active 중 position 최소
export function locationLabel(l: Pick<ClinicSummary,'name'|'branchName'>): string   // `${name} · ${branchName || '본점'}`
```

- [ ] **Step 1: 실패 테스트** `clinicStore.test.ts`
  - `'클라이언트 지점은 position 순이고 사용 중지는 기본 제외'`: 클라이언트 1 + main(name '명동점', position 2) + branch(name '신사점', position 1, active false) + branch('강남점', position 3) 삽입 → `listClientLocations` 결과 이름 `['명동점','강남점']`; `{activeOnly:false}`면 `['신사점','명동점','강남점']`.
  - `'대표 지점은 사용 중 가운데 순서 맨 앞'`: 위 데이터에서 `representativeLocation(...)?.branchName === '명동점'`.
  - `'listClinics를 두 번 불러도 본점이 추가로 생기지 않는다'`: main+branch 클라이언트에서 2회 호출 → 그 클라이언트 행 2개 그대로(H8).
  - `'지점이 1개면 branchName이 비고 라벨은 본점'`: 새 클라이언트만 삽입 후 `listClinics` → 해당 행 `branchName === ''`, `kind === 'main'`, `locationLabel(row) === '<클라이언트명> · 본점'`.
- [ ] **Step 2:** `npm test -- src/lib/clinicStore.test.ts` → FAIL(함수 없음). 스테이징 env 없으면 "실행 보류" 기록.
- [ ] **Step 3: 구현** — `listClinics`의 select에 `l.name as "branchName", l.kind, l.position, l.active` 추가, order by 보강. `listClientLocations`는 `listClinics` 쿼리에 `where l.client_id = ${clientId}`를 더한 별도 쿼리(본점 자동 생성 insert는 `listClinics`에만 둔다).
- [ ] **Step 4:** `extensionProductApi.ts:148`을 `representativeLocation(clinics.filter(l => l.clientId === c.clientId))?.id ?? null`로 바꾼다. `GET clinics`는 변경 없이 새 필드가 그대로 나간다.
- [ ] **Step 5:** 테스트 PASS 확인. `git commit -m "feat(clinic): 지점 목록에 지점명·순서·사용 여부, 대표 지점 선택"`

### Task 3: 지점 관리 API + 화면 (QA A절)

**Files:**
- Create: `src/app/api/clients/[id]/locations/route.ts` (POST 추가), `src/app/api/clients/[id]/locations/[locationId]/route.ts` (PATCH 이름·순서·사용 여부, DELETE)
- Modify: `src/lib/clinicStore.ts` (쓰기 함수), `src/app/clients/ClientDetail.tsx:159` (탭 추가), Create: `src/app/clients/BranchesTab.tsx`
- Test: `src/lib/clinicStore.test.ts`에 추가

**Interfaces (Produces):**
```ts
export async function createLocation(sql, clientId: string, input: { name: string }): Promise<ClinicSummary>  // kind 'branch', position = max+1, 이름 중복(trim·대소문자 무시) → ProductError('DUPLICATE_NAME', 409)
export async function updateLocation(sql, id: string, patch: { name?: string; position?: number; active?: boolean }): Promise<ClinicSummary>
  // active:false 요청인데 그 클라이언트의 사용 중 지점이 이 하나뿐 → ProductError('LAST_ACTIVE', 409)
export async function deleteLocation(sql, id: string): Promise<void>
  // kind 'main' → 409 'MAIN_LOCATION'; visit_reservation.location_id 참조 있음 → 409 'HAS_RESERVATIONS' (FK restrict에 기대지 말고 먼저 검사)
```

- [ ] **Step 1: 실패 테스트** (`clinicStore.test.ts`)
  - `'같은 이름 지점은 409'`: `createLocation(c,'명동점')` 후 `createLocation(c,' 명동점 ')` → rejects `code 'DUPLICATE_NAME'` (A6).
  - `'예약이 연결된 지점은 삭제 대신 409'`: visit_reservation 1건 연결 후 `deleteLocation` → `'HAS_RESERVATIONS'`; `updateLocation(id,{active:false})`는 성공하고 `listClientLocations`에서 빠진다(A4·A5).
  - `'마지막 사용 중 지점은 중지 불가'`: 지점 1개 클라이언트에서 `updateLocation(main,{active:false})` → `'LAST_ACTIVE'`.
  - `'본점 행은 삭제하지 않는다'`: `deleteLocation(main)` → `'MAIN_LOCATION'`.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3: 구현** 스토어 함수 3개 + 라우트 2개(`requireMember`, 오류는 `{ error }` JSON과 409/404). 순서 변경은 `position` 두 행 swap을 PATCH 2회로 처리(화면에서 ↑↓).
- [ ] **Step 4: 화면** `BranchesTab.tsx` — 목업 "지점" 탭 그대로: 안내문, 행마다 ↑↓·이름 input(blur 저장)·`main/branch` 태그·"대표" 태그·"예약 n건"·사용 중지/재개·삭제, 아래 "+ 지점 추가". 예약 건수는 `listClientLocations` 응답에 `reservations: number`(count 서브쿼리)를 더해 쓴다. `ClientDetail.tsx:159` 탭 목록에 `['branches','지점']`을 `clinicEnabled`일 때 `hours` 앞에 넣는다. **`ClinicTab`은 그대로 두고** `type ClientTab = 'basic' | 'branches' | 'sponsor' | ClinicTab`을 새로 만들어 `useState`·`?tab=` 파싱을 이 타입으로 바꾸고, L167 렌더를 3갈래(`branches` → `BranchesTab`, `sponsor` → `SponsorMemoTab`, 그 외 → `ClinicSettingsTab`)로 나눈다(`ClinicSettingsTab`에 새 값이 흘러가지 않게).
- [ ] **Step 5:** 테스트 PASS. 브라우저에서 A1·A2·A7 수동 확인(지점 1개 클라이언트는 본점 행 하나만, 이름 비어 "본점" 플레이스홀더).
- [ ] **Step 6:** `git commit -m "feat(clients): 지점 관리 탭과 API"`

### Task 4: 시트 키·별칭·등급 정리 (`reservationSheet.ts`, QA C·E·I7)

**Files:**
- Modify: `src/lib/reservationSheet.ts:5-20` (`ClientSheetFields`에 `branch?`), `:22` (`RESERVATION_EXTRACTION_KEYS`에 `'branch'`), `:84-96` (`ClientSheetEditFields`에 `nationality·branch·followerTier`), `:120-142` (별칭), `:231` (`updateClientSheetInput` 공백 보완), `:308-321` (`SHEET_FIELD_LABEL`에 `nationality:'국적'`, `followerTier:'팔로워 등급'`; **`branch`는 넣지 않음** — 타입을 `Record<Exclude<keyof ClientSheetEditFields,'branch'>, string>`으로 바꿔야 컴파일된다)
- Modify: `src/lib/reservationCommands.ts:40-41` (`EDIT_FIELDS`에 세 키)
- Test: `src/lib/reservationSheet.test.ts`

**Interfaces (Produces):** `ClientSheetEditFields` 키 + `followerTier` 정리 함수 `export function normalizeFollowerTier(value: string): '' | '나노' | '마이크로' | '메가'`.

- [ ] **Step 1: 실패 테스트**
  - `'벤자민 시트 라벨을 읽는다'`: 스펙 §2 기재시트(값 채운 것)로 `readClientSheetInputs` → `name==='YUKI TANAKA'`, `preferred`, `treatment`, `nationality==='일본'`, `branch==='신사점'`, `followerTier==='마이크로'`, `profileUrl==='https://x.com/yuki_tokyo?s=20'`.
  - `'콜론으로 끝나는 줄에 값을 쓰면 한 칸 띄운다'`: `updateClientSheetInput('- 인플루언서 팔로워 :', 'followerTier', '마이크로')` → `'- 인플루언서 팔로워 : 마이크로'` (`:마이크로` 아님).
  - `'등급 안내 문구는 빈 값'`: `normalizeFollowerTier('영역 (나노/마이크로/메가)') === ''`, `('메가') === '메가'`.
  - `'지점 줄 차이는 sheetDifferences가 내지 않는다'`: 7. 지점만 다른 두 시트 → `sheetDifferences(a,b)`가 `field:'branch'` 없이 `[]` (추가 문구 `sheet` 항목도 없어야 함 — `normalizeSheetForCompare`에서 branch 줄 제외).
- [ ] **Step 2:** `npm test -- src/lib/reservationSheet.test.ts` → FAIL.
- [ ] **Step 3: 구현** 위 수정. `fillClientSheetTemplate`(265)은 `values = {...context}` 뒤 추출 키 루프가 `context.branch`를 `fields.branch`로 덮는다 — Task 6에서 둘을 항상 같은 값으로 넘기므로 그대로 둔다(주석으로 명시).
- [ ] **Step 4:** PASS. `git commit -m "feat(sheet): 벤자민 시트 키(국적·지점·팔로워)와 별칭"`

### Task 5: 등록·수정 API — 지점 검사, 리비전 검사 완화, `locationId` 수정 (QA D13·D22·D26·I1~I4·I6)

**Files:**
- Modify: `src/lib/reservationCommands.ts:95-105` (등록 검사), `:120-155` (`saveReservation`), `:36-39·134-136` (계정 검사)
- Modify: `src/lib/reservationPolicy.ts:215-240` (`planReservationSave`에 지점 전후 비교), `src/lib/reservationSheet.ts:305` (`SheetDifferenceField`에 `'location'`)
- Test: `src/lib/reservationCommands.test.ts`

**Interfaces:**
- Consumes: Task 2 `listClientLocations`, Task 4 키.
- Produces: `saveReservation` body `locationId?: string`; `planReservationSave(input & { beforeLocation?: {id,label}; afterLocation?: {id,label} })` → differences에 `{ field:'location', label:'지점', before, after }`.

- [ ] **Step 1: 실패 테스트** (`reservationCommands.test.ts`, 기존 픽스처에 branch 행 추가)
  - `'사용 중지 지점으로 등록하면 422 LOCATION_INACTIVE'` (I1).
  - `'같은 클라이언트 다른 장소의 시트 리비전은 통과, 다른 클라이언트 리비전은 TEMPLATE_MISMATCH'` (D13·I3).
  - `'수정에서 locationId를 바꾸면 location_id가 바뀌고 differences는 location 1건'`: 시트 7. 지점 줄도 같이 바꿔 보내도 `differences.length === 1`, `field==='location'`, `before==='명동점'`, `after==='신사점'`(D22·D26·D27). 다른 클라이언트 지점이면 `LOCATION_MISMATCH`(I4).
  - `'핸들 줄 없는 시트에서 계정 링크 핸들을 바꾸면 IDENTITY_MISMATCH'` (I6): `- 인플루언서 계정 링크: https://x.com/other?s=20`.
- [ ] **Step 2:** 실행 → FAIL.
- [ ] **Step 3: 구현**
  - 등록 검사: `listClientLocations(tx, campaign.client_id /* task.campaign_id로 조회 */, {activeOnly:false})`에서 id 찾기 → 없으면 `LOCATION_MISMATCH`(문구 "이 캠페인 클리닉의 지점을 선택해 주세요."), `active===false`면 `LOCATION_INACTIVE` 422 "사용 중지된 지점이에요. 지점을 다시 골라 주세요.".
  - 리비전 검사: `location_id in (select id from clinic_location where client_id = <캠페인 client>)`.
  - 수정: body `locationId`를 읽어 같은 검사 → UPDATE에 `location_id = ${locationId ?? reservation.locationId}` 추가, `planReservationSave`에 전후 지점의 `branchName || '본점'`(클라이언트명 없이)을 넘긴다. 응답 DTO의 `locationId`는 새 값. 시트 `7. 지점:` 글자만 바뀌고 `locationId`가 그대로면 차이를 남기지 않는다(결정: 지점의 진실은 `location_id`이며 시트 줄은 표시용).
  - 계정 검사: `export function sheetHandle(sheet: string): string` = `inputs.handle || handleFromUrl(inputs.profileUrl)`(`x.com/h`·`x.com/h?s=20` 모두, `@`·대소문자 정규화)를 `reservationSheet.ts`에 두고, L134의 전후 비교와 `checkedHandle` **둘 다** 이 함수를 쓴다. 핸들 줄이 없는 시트는 `handle`이 전후 모두 `''`라 기존 비교는 영원히 통과하므로 비교 자체를 바꿔야 I6가 잡힌다.
- [ ] **Step 4:** PASS. `git commit -m "feat(reservation): 지점 검사·리비전 완화·수정 시 지점 변경"`

### Task 6: 추출 — 지점 후보 매칭 (QA C2~C7)

**Files:**
- Modify: `src/lib/reservationExtraction.ts:16-39`
- Test: `src/lib/reservationExtraction.test.ts` (신규; `llm.ts`에 주입 지점이 있는지 먼저 확인하고 없으면 `extractReservation(sql, raw, deps = { call: callLLM })`로 선택 인자를 추가해 스텁. `getClinic`·`findInfluencerById` 때문에 스테이징 DB 필요)

**Interfaces (Produces):** 응답에 `locationId: string | null` 추가. 프롬프트 입력에 `branchOptions: string[]`.

- [ ] **Step 1: 실패 테스트**
  - `'답변 지점이 후보와 맞으면 locationId와 7. 지점이 채워진다'`: LLM 스텁이 `{ branch:'신사점', ... }` 반환, 클라이언트 지점 명동점·신사점 → `locationId === 신사 id`, `sheetText`에 `7. 지점: 신사점`, `{{branch}}` 자리도 `신사점`.
  - `'후보 밖 값은 비운다'`: 스텁 `{ branch:'明洞店' }` → `locationId === null`, `7. 지점:` 빈 값.
  - `'지점 1개 클라이언트는 본점'`: `locationId === 그 지점 id`, `{{branch}}`→`본점`, 프롬프트에 `branchOptions` 없음.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: 구현** — `getClinic` 뒤 `listClientLocations(sql, clinic.clientId)`. 2개 이상이면 system 프롬프트에 "branch는 branchOptions 가운데 고객 답에 해당하는 이름 하나를 그대로 쓰고, 애매하거나 '어디든'이면 빈 문자열" 추가, user 메시지에 `branchOptions: names`. 결과 `fields.branch`가 목록에 없으면 `''`. `matched = list.find(name===fields.branch)`. `fillClientSheetTemplate(..., { branch: multi ? (matched?.branchName ?? '') : '본점' })`, `fields.branch`도 같은 값으로 맞춘다(Task 4 Step 3 주석의 이유). 반환에 `locationId: multi ? matched?.id ?? null : clinic.id`.
- [ ] **Step 4:** PASS. `git commit -m "feat(extraction): 답변 지점을 클라이언트 지점과 매칭"`

### Task 7: 협찬 메모 — 웹 저장, 익스텐션 읽기 (QA B1·B5·I5)

**Files:**
- Modify: `src/lib/clientStore.ts:65-82` (`updateClient` patch에 `sponsorMemo?`), `src/app/api/clients/[id]/route.ts` PATCH(허용 키 추가, 길이 ≤ 4000)
- Modify: `src/lib/extensionProductApi.ts` (GET `clients/{id}/sponsor-memo` 추가, `select sponsor_memo from client`)
- Create: `src/app/clients/SponsorMemoTab.tsx`; Modify: `ClientDetail.tsx:159` 탭 `['sponsor','협찬 항목']`
- Test: `src/lib/reservationCommands.test.ts`(dispatch 사용) 또는 신규 `src/lib/sponsorMemo.test.ts`

- [ ] **Step 1: 실패 테스트** `'협찬 메모는 GET만 있고 PATCH는 404'`: dispatch에 `GET clients/<id>/sponsor-memo` → `{ memo }`; 같은 경로 `PATCH`·`PUT`·`POST` → 404(`productMissing`).
- [ ] **Step 2:** FAIL. **Step 3:** 구현(화면은 목업 "협찬 항목" 탭: textarea 10줄 + 저장, 줄바꿈 보존). **Step 4:** PASS. `git commit -m "feat(clients): 협찬 항목 메모 (웹 편집, 익스텐션 읽기 전용)"`

### Task 8: 클리닉 설정·양식 — 지점 선택과 대표 양식 적용 (QA A3·§5)

**Files:**
- Modify: `src/app/clients/ClinicSettingsTab.tsx:20-31` (지점 선택), `:111` 안내문, `:15` 주석
- Modify: `src/lib/clinicStore.ts:76-86` (`saveClinicTemplate` 뒤 "다른 지점에도 적용" 옵션) 및 `extensionProductApi.ts:173-174` (body `applyToSiblings?: boolean`)

- [ ] **Step 1:** `ClinicSettingsTab`: `listClinics` 결과를 `clientId`로 걸러 2개 이상이면 상단에 `<select>`(목업 `branchPicker`; 사용 중지는 "(사용 중지)" 접미), 1개면 숨김. 선택 id를 `ClinicEditor key`로 넘긴다. 안내문을 "`{지점명}` 설정이에요. 저장하면 웹의 예약 화면과 익스텐션이 같은 내용을 사용해요."로.
- [ ] **Step 2:** 양식 저장: 저장 전 대표 지점 양식과 비교해 다르면 `confirm('대표 지점(…) 양식과 달라요. 다른 지점 n개에도 같은 양식을 적용할까요?')`, 기본 적용 → `applyToSiblings:true`로 PATCH. 서버는 같은 트랜잭션 안에서 같은 클라이언트의 다른 장소마다 현재 버전을 읽어(`saveClinicTemplate`의 `expected`로 넘김) 새 리비전을 만든다. 클라이언트가 형제 지점 버전을 알 필요 없음.
- [ ] **Step 3:** 브라우저 확인: 명동·신사 운영시간이 섞이지 않음(A3), 양식 적용 질문. `git commit -m "feat(clinic-settings): 지점 선택과 대표 양식 적용"`

### Task 9: 웹 예약 등록·상세 — 지점 드롭다운 (QA G1~G3·H5, §6)

**Files:**
- Modify: `src/components/reservations/NewReservationDialog.tsx:56-68·82·85·99·105-127`
- Modify: `src/components/reservations/ReservationSection.tsx:91-93·149-152·384`

**Interfaces (Consumes):** Task 2 `ClinicSummary`·`locationLabel`, Task 6 `locationId`, Task 5 PATCH `locationId`.

- [ ] **Step 1: NewReservationDialog** — 상태 `locations: ClinicSummary[]`(클라이언트의 사용 중 지점, position 순), `locationId: string | null`(대표 지점으로 초기화 — 지점 1개면 그 id). 목업 그대로: 1단계 "방문 클리닉" 칸은 `locations.length >= 2`면 `<select>`(빈 옵션 "지점 선택"), 아니면 기존 라벨 `${name} · 본점`. 2단계 context 줄에도 같은 select를 같은 state로 그린다. 파싱 `locationId`는 **대표 지점**(양식 출처)으로 보내고, 결과 `locationId`가 있으면 select를 그 값으로 바꾸고 초록 힌트 `고객 답변 "…" → 신사점 자동 선택`, null이면 select에 `warn` 스타일과 "고객 답변과 맞는 지점이 없어요 · 직접 골라 주세요". select 변경 시 시트 `7. 지점:` 줄을 `updateClientSheetInput(sheet,'branch',branchName)`로 다시 쓴다. `commit()`은 `locationId`(선택값) + `templateRevisionId`(대표 지점 양식) 전송. 2개 이상인데 미선택이면 저장 버튼에서 "지점을 선택해 주세요." 오류(G2). `branch:'본점'`(82)은 선택 지점명 또는 지점 1개면 '본점'.
- [ ] **Step 2: ReservationSection** — 클리닉 읽기: `detail?.locationId`가 있으면 그 id, 없으면 대표 지점. 수정 흐름에 같은 select를 두고 PATCH body에 `locationId` 포함. 변경 이력(492)은 `field:'location'`이 기존 `label: before → after`로 그려지므로 변경 없음.
- [ ] **Step 3:** 수동 확인 G1·G2·G3·H5(지점 1개 캠페인은 select 없음). `git commit -m "feat(reservations): 웹 예약 등록·상세 지점 선택"`

### Task 10: 문구 정리와 핸드오프

**Files:** `src/lib/reservationCommands.ts:97` 문구, `src/lib/clinicStore.ts:18`·`clinicHours.ts:1` 주석, `docs/PRODUCT_SPEC.md`(기획서 갱신은 `devnote` 스킬 규칙에 따라 커밋 직후 수행)

- [ ] **Step 1:** 남은 "본점" 문자열 중 사용자 노출 문구만 지점명 기준으로 바꾼다(`grep -rn 본점 src --exclude-dir=mockup`). 목업 폴더는 손대지 않는다.
- [ ] **Step 2:** `npm run build`와 `npm test` 전체 PASS(스테이징 env). `git commit -m "chore: 지점 표기 문구 정리"`
- [ ] **Step 3:** 배포 후 운영 절차 기록: (1) 지점 관리에서 벤자민 본점 행 이름을 사용자 확인대로 명동점/신사점 중 하나로, 나머지 추가 (2) 각 지점 운영시간(스펙 §1 표) 입력 (3) 양식 등록(`- 인플루언서 계정 링크: {{profileUrl}}`, `- 인플루언서 팔로워 :` 값 없이) (4) 협찬 항목 메모 입력. 이 절차를 핸드오프에 남긴다.
