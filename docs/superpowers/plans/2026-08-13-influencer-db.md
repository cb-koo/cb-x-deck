# 인플루언서 DB (명부) v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 협업 인플루언서의 단일 명부 — 목록·프로필(X 스냅샷·태그·고정 메모)·기록 타임라인(앱 이벤트 자동 + 수동 한 줄)·원고 롤업. 스펙: `docs/superpowers/specs/2026-08-13-influencer-db-design.md`

**Architecture:** 최상위 엔티티 `influencer` + 시계열 `influencer_log` 2테이블(마이그레이션 024). 로직은 `src/lib/influencerStore.ts`에 집중하고 라우트는 얇게(clientStore 패턴). 원고 배정·전달의 자동 로그는 `updateDraft`와 같은 트랜잭션(`sql.begin`)에서 `influencerSync.ts`가 기록. UI는 `/influencers` 2단 분할(clients 페이지 패턴).

**Tech Stack:** Next.js(이 저장소의 커스텀 버전 — `node_modules/next/dist/docs/` 필독), postgres(porsager), node:test + tsx, getxapi REST 클라이언트(기존 `src/lib/getxapi.ts`).

## Global Constraints

- **이 저장소의 Next.js는 훈련 데이터와 다르다** — 라우트/컴포넌트 작성 전 `node_modules/next/dist/docs/` 확인 (AGENTS.md).
- **UX 원칙 (AGENTS.md)**: 라벨은 이득을 사용자 언어로 / 행동 전 기대 설정 / 숫자에 판단 서술 / 라벨-값 일치 / 기술 값은 맥락으로 감싸기 / 비용 유발 액션은 opt-in.
- 핸들은 '@' 없는 표기 보존 저장, 비교·중복은 `lower()` 기준. 이름 컬럼으로 사람을 식별하지 않는다.
- `title=` 브라우저 기본 툴팁 금지 (InfoTip.tsx 선례), 브라우저 `alert/confirm` 대신 인라인 UI.
- 날짜 표시는 서울 시간대 관례(`relTime` 등 기존 유틸 재사용).
- 테스트: `npm test`는 실 DB 4분 — 개발 중엔 단일 파일 `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>.test.ts`(수초). 린트 기준선 24개(`npm run lint` — 새 경고 추가 금지).
- 마이그레이션 적용: `npm run migrate` (실 DB에 적용됨 — 023도 같은 방식으로 나갔다, 재실행 안전하게 작성).
- 커밋 메시지 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## 실행 웨이브 (병렬 그룹)와 모델 배정

| 웨이브 | 태스크 | 병렬 | 모델 |
|---|---|---|---|
| 1 | T1 마이그레이션 · T2 getxapi description · T8 generate 딥링크 | 서로 병렬 | sonnet |
| 2 | T3 influencerStore + 테스트 | 단독 (T1 후) | opus |
| 3 | T4 자동 로그 배선 · T5 API 라우트 · T6 옵션 소스 승계 | 서로 병렬 (T3 후) | T4·T5 opus, T6 sonnet |
| 4 | T7 UI (/influencers + 사이드바) | 단독 (T5·T6 후) | opus |
| 5 | T9 통합 검증 | 메인 세션 | — |

파일 소유권이 겹치지 않아 병렬 안전: T4=`influencerSync.ts`+`api/drafts/[id]/route.ts`, T5=`api/influencers/**`, T6=`draftStore.ts`+`api/drafts/influencers/route.ts`+`InfluencerField.tsx`.

---

### Task 1: 마이그레이션 024 — influencer + influencer_log

**Files:**
- Create: `migrations/024_influencer.sql`

**Interfaces:**
- Produces: `influencer`·`influencer_log` 테이블 (T3가 소비)

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 024: 인플루언서 명부 — 협업 인플루언서 단일 목록 + 기록 타임라인 (스펙 2026-08-13)
-- influencer는 client 선례를 따라 최상위 엔티티(워크스페이스 FK 없음). 재실행 안전.
create table if not exists influencer (
  id uuid primary key default gen_random_uuid(),
  handle text not null,                  -- '@' 없는 핸들, 입력 표기 보존(parseXHandle 결과)
  x_user_id text,                        -- 개명 대비 식별자 — 최초 프로필 조회 시 채움
  display_name text,                     -- 이하 4개: X 프로필 스냅샷 (null = 미조회)
  avatar_url text,
  bio text,
  followers_count int,
  profile_refreshed_at timestamptz,      -- null = 미조회. "○일 전 기준" 표시 근거
  tags jsonb not null default '[]',      -- string[] 자유 태그
  note text not null default '',         -- 고정 메모 — 시간과 무관한 정보(단가·주의사항)
  created_by uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
-- X 핸들은 대소문자 무관 — 표기는 보존하되 중복은 소문자 기준으로 막는다
create unique index if not exists idx_influencer_handle_lower on influencer (lower(handle));

-- 수동 한 줄 기록과 자동 앱 이벤트를 같은 시계열에 (스펙 §2)
create table if not exists influencer_log (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references influencer(id) on delete cascade,
  kind text not null check (kind in ('manual','auto')),
  event_type text check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed')),
  body text,                             -- manual 전용: 사용자가 친 한 줄 (표시 문구는 저장하지 않는다 — auto는 UI가 event_type으로 렌더)
  channel text check (channel in ('dm','line','email','other')),
  draft_id uuid references draft(id) on delete set null,
  draft_title text,                      -- 스냅샷 — 원고 삭제 후에도 로그 재현(client_name 선례)
  payload jsonb,                         -- 구조 데이터. handle_changed: {"from","to"}
  author_id uuid references member(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_influencer_log_timeline on influencer_log (influencer_id, created_at desc);
```

- [ ] **Step 2: 적용 및 확인**

Run: `npm run migrate`
Expected: 024 적용, 오류 없음. 확인: `psql`이 없으므로 `node --import tsx --env-file-if-exists=.env -e "import('./src/lib/db.ts').then(async m=>{const sql=m.getSql();console.log(await sql\`select count(*) from influencer\`);await sql.end()})"` → `[ { count: '0' } ]`

- [ ] **Step 3: Commit**

```bash
git add migrations/024_influencer.sql
git commit -m "feat(influencer): 마이그레이션 024 — influencer·influencer_log 테이블"
```

---

### Task 2: getxapi UserInfo에 description(bio) 추가

**Files:**
- Modify: `src/lib/getxapi.ts:13-18` (UserInfo 인터페이스), `:66-76` (getUserInfo 매퍼)
- Test: `src/lib/getxapi.test.ts` (기존 getUserInfo 픽스처가 있으면 필드 추가, 없으면 매퍼 테스트 1개 추가)

**Interfaces:**
- Produces: `UserInfo.description: string | null` (T3 `applyProfileSnapshot`·T5 POST가 bio로 저장)

- [ ] **Step 1: 실패하는 테스트 — 기존 getxapi.test.ts의 패턴을 먼저 읽고 동일 방식으로 작성.** getUserInfo 매핑 테스트에 `description: '뷰티 인플루언서'`를 응답 픽스처에 넣고 결과에 `description` 필드가 그대로 오는지, 픽스처에 없으면 `null`인지 assert.
- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/getxapi.test.ts`
Expected: FAIL (description undefined)

- [ ] **Step 3: 구현** — UserInfo에 `description: string | null;` 추가, 매퍼에 `description: typeof d.description === 'string' ? d.description : null,` 추가. (실 API가 이 필드를 안 주면 null로 남는다 — 무해.)
- [ ] **Step 4: 테스트 통과 확인** (같은 명령, PASS)
- [ ] **Step 5: Commit** — `feat(getxapi): getUserInfo에 description 매핑 — 인플루언서 bio 스냅샷용`

---

### Task 3: influencerStore — 스토어 + 실 DB 테스트

**Files:**
- Create: `src/lib/influencerStore.ts`, `src/lib/influencerStore.test.ts`

**Interfaces:**
- Consumes: T1 테이블, `UserInfo`(getxapi), `Member`(types), `DraftStatus`(draftStatus), `draftVersionHash`(draftStore)
- Produces (T4·T5·T6·T7가 소비 — 시그니처 고정):

```ts
export type InfluencerChannel = 'dm' | 'line' | 'email' | 'other';
export type InfluencerAutoEvent = 'draft_assigned' | 'draft_unassigned' | 'draft_delivered' | 'handle_changed';
export interface InfluencerRow {
  id: string; handle: string; xUserId: string | null;
  displayName: string | null; avatarUrl: string | null; bio: string | null;
  followersCount: number | null; profileRefreshedAt: string | null;
  tags: string[]; note: string; createdAt: string;
  lastLogAt: string | null;  // 파생: 로그 최신행 — 라벨은 "마지막 기록" (스펙 §2)
  draftCount: number;        // 파생: lower(handle) 조인 count
}
export interface InfluencerLogRow {
  id: string; kind: 'manual' | 'auto'; eventType: InfluencerAutoEvent | null;
  body: string | null; channel: InfluencerChannel | null;
  draftId: string | null; draftTitle: string | null;
  payload: { from?: string; to?: string } | null;
  member: Member | null; createdAt: string;
}
export interface DraftRollupItem { id: string; title: string; status: DraftStatus; createdAt: string }
export interface InfluencerDetail { influencer: InfluencerRow; logs: InfluencerLogRow[]; drafts: DraftRollupItem[] }

export async function createInfluencer(sql, input: { handle: string; createdBy: string | null;
  snapshot?: UserInfo | null }): Promise<{ row: InfluencerRow; created: boolean }>
export async function listInfluencers(sql): Promise<InfluencerRow[]>          // last_log_at desc nulls last, lower(handle)
export async function findInfluencerById(sql, id: string): Promise<InfluencerRow | null>
export async function findByHandle(sql, handle: string): Promise<InfluencerRow | null>  // lower 비교
export async function findDuplicateByXUserId(sql, xUserId: string, excludeId: string): Promise<string | null> // 다른 행의 handle 또는 null
export async function getInfluencerDetail(sql, id: string): Promise<InfluencerDetail | null>
export async function updateInfluencer(sql, id: string, patch: { note?: string; tags?: string[] }): Promise<void>
export async function deleteInfluencer(sql, id: string): Promise<void>
export async function applyProfileSnapshot(sql, id: string, info: UserInfo): Promise<void>  // x_user_id·스냅샷 4종 + profile_refreshed_at=now()
export async function ensureInfluencer(sql, handle: string, createdBy: string | null): Promise<string> // id — 배정 자동 등록(스냅샷 없이)
export async function renameInfluencer(sql, args: { influencerId: string; from: string; to: string; actorId: string | null }): Promise<void>
export async function addManualLog(sql, influencerId: string, input: { body: string; channel: InfluencerChannel | null; authorId: string | null }): Promise<InfluencerLogRow>
export async function deleteManualLog(sql, influencerId: string, logId: string): Promise<boolean> // manual만, 성공 여부
export async function insertAutoLog(sql, input: { influencerId: string; eventType: InfluencerAutoEvent;
  draftId: string | null; draftTitle: string | null; payload?: { from: string; to: string }; authorId: string | null }): Promise<void>
export async function listOptions(sql): Promise<InfluencerOption[]>  // {handle, name: displayName ?? undefined}, lower(handle) 사전순
```

- [ ] **Step 1: 실패하는 테스트 작성** — `clientStore.test.ts`의 관례(실 DB, `getSql`, 접두어 정리, `after`에서 삭제+`sql.end()`)를 그대로 따른다. 접두어 `const P = 'tinf' + process.pid;`. 케이스:

```ts
// 1) CRUD 왕복: createInfluencer(스냅샷 없이) → created:true, tags [], note '' /
//    updateInfluencer({note, tags}) 반영 / listInfluencers에 포함 / deleteInfluencer 후 findInfluencerById null
// 2) lower 중복: createInfluencer(P+'Abc') 후 createInfluencer(P+'ABC') → created:false, 기존 row 반환(표기 'Abc' 유지)
// 3) ensureInfluencer: 새 핸들 → 행 생성·id 반환, 같은 핸들 대소문자 변형 재호출 → 같은 id (on conflict 경로)
// 4) applyProfileSnapshot: UserInfo {id:'999', userName, name, followers, profilePicture, description} 적용 →
//    xUserId·displayName·followersCount·bio 채워지고 profileRefreshedAt not null
// 5) 로그: addManualLog(body,'dm') → 반환 row kind manual / insertAutoLog(draft_assigned, draftTitle 'T') →
//    getInfluencerDetail.logs 최신순 2건 / deleteManualLog(auto 행 id) → false(안 지워짐), (manual 행 id) → true
// 6) 파생값: 로그 있는 행의 lastLogAt not null / insertDraft(draftStore)로 원고 만들고 updateDraft로
//    influencerHandle 배정(대소문자 다르게) → listInfluencers의 draftCount 1 (lower 조인 확인)
// 7) findDuplicateByXUserId: 같은 x_user_id 두 행 → 상대 handle 반환, excludeId 자신은 제외
// 8) renameInfluencer: 핸들 교체 + 해당 핸들 draft.influencer_handle 일괄 UPDATE + handle_changed 로그(payload {from,to})
// 9) listOptions: displayName 있으면 name으로, 없으면 undefined
```

각 케이스를 실제 assert 코드로 작성한다(위는 요약이 아니라 케이스 명세 — 구현자가 코드로 옮긴다). draft 정리: `after`에서 `delete from draft where influencer_handle like P+'%'`도 수행.

- [ ] **Step 2: 실행 — 실패 확인**: `node --import tsx --env-file-if-exists=.env --test src/lib/influencerStore.test.ts` → FAIL (모듈 없음)
- [ ] **Step 3: 구현.** 핵심 SQL:

```ts
// list 파생값 — 서브쿼리 2개, count는 bigint라 Number() 변환
const rows = await sql`
  select i.*, 
    (select max(l.created_at) from influencer_log l where l.influencer_id = i.id) as last_log_at,
    (select count(*) from draft d where lower(d.influencer_handle) = lower(i.handle)) as draft_count
  from influencer i
  order by last_log_at desc nulls last, lower(i.handle)`;

// ensureInfluencer — 표현식 유니크 인덱스에는 on conflict ((lower(handle))) 형태를 쓴다.
// do update의 handle=influencer.handle은 no-op — do nothing은 기존 행을 returning하지 않아서다.
const r = await sql`
  insert into influencer (handle, created_by) values (${handle}, ${createdBy})
  on conflict ((lower(handle))) do update set handle = influencer.handle
  returning id`;

// getInfluencerDetail의 원고 롤업 — title은 ko_title(최신 해시 일치 시) 우선, 아니면 최신 본문 첫 줄 60자
// (draftStore.toRow의 koTitle 스테일 판정과 동일 규칙 — draftVersionHash 재사용)
const drafts = await sql`
  select id, ko_title, ko_title_hash, edited, content, status, created_at
    from draft where lower(influencer_handle) = lower(${handle})
   order by created_at desc limit 50`;

// deleteManualLog — kind 조건이 auto 삭제를 원천 차단
const del = await sql`delete from influencer_log
  where id = ${logId} and influencer_id = ${influencerId} and kind = 'manual' returning id`;
return del.length > 0;

// renameInfluencer — 같은 사람이므로 배정 사실 불변(스펙 §5 개명 플로우), 호출자가 트랜잭션 여부 결정
await sql`update influencer set handle = ${to} where id = ${influencerId}`;
await sql`update draft set influencer_handle = ${to} where lower(influencer_handle) = ${from.toLowerCase()}`;
await insertAutoLog(sql, { influencerId, eventType: 'handle_changed', draftId: null, draftTitle: null, payload: { from, to }, authorId: actorId });
```

로그 조회는 `left join member m on m.id = l.author_id`로 Member 구성(draftStore SELECT 선례). `createInfluencer`는 먼저 `findByHandle` — 있으면 `{row, created:false}`, 없으면 insert(스냅샷 인자 있으면 컬럼 포함) 후 `{row, created:true}`.

- [ ] **Step 4: 테스트 통과 확인** (같은 명령, 전체 PASS)
- [ ] **Step 5: Commit** — `feat(influencer): influencerStore — 명부 CRUD·로그·파생값·개명 (스펙 §2·§5)`

---

### Task 4: 자동 로그 배선 — influencerSync + draft PATCH 트랜잭션

**Files:**
- Create: `src/lib/influencerSync.ts`, `src/lib/influencerSync.test.ts`
- Modify: `src/app/api/drafts/[id]/route.ts:54-58` (PATCH 마지막 블록)

**Interfaces:**
- Consumes: T3 `ensureInfluencer`·`findByHandle`·`insertAutoLog`, draftStore `getDraft`·`updateDraft`·`DraftRow`
- Produces: `syncInfluencerOnDraftUpdate(tx, {before, influencerHandle, status, actorId})`, `draftLogTitle(d)`

- [ ] **Step 1: 실패하는 테스트** — 실 DB. `insertDraft`로 원고 생성 → `getDraft`로 before 확보 → `sql.begin`에서 `updateDraft`+`syncInfluencerOnDraftUpdate` 호출(라우트와 동일 순서) 후 로그 assert:

```ts
// a) 미배정 → 배정: influencer 행 자동 생성 + draft_assigned 로그 1건(draft_title 포함)
// b) 배정 → 해제(null): draft_unassigned 로그 (행은 삭제되지 않음)
// c) A → B 교체: A에 unassigned, B에 assigned (B 행 자동 생성)
// d) 대소문자만 다른 재배정(abc → ABC): 로그 0건 (같은 사람 — norm 비교)
// e) status delivered 전이(배정 상태): draft_delivered 1건 / 이미 delivered에서 재저장: 추가 로그 없음
// f) 명부에 없는 핸들의 해제: 로그 없음, 행 생성 없음 (등록은 배정에서만)
// g) 배정+delivered 동시 PATCH: assigned와 delivered 둘 다 기록
```

- [ ] **Step 2: 실행 — 실패 확인** (모듈 없음)
- [ ] **Step 3: 구현** — `src/lib/influencerSync.ts` 전체:

```ts
import type postgres from 'postgres';
import type { DraftRow } from './draftStore.ts';
import { ensureInfluencer, findByHandle, insertAutoLog } from './influencerStore.ts';

// 원고 제목 스냅샷 — ko_title 우선, 없으면 최신 본문 첫 줄 60자 (스펙 §2)
export function draftLogTitle(d: Pick<DraftRow, 'koTitle' | 'edited' | 'content'>): string {
  if (d.koTitle) return d.koTitle;
  const line = ((d.edited ?? d.content).posts[0]?.text ?? '').split('\n')[0].trim();
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

const norm = (h: string | null | undefined) => (h ? h.toLowerCase() : null);

// updateDraft와 같은 트랜잭션에서 호출 — 로그만 누락되는 어긋남을 만들지 않는다 (스펙 §5).
// 등록은 배정에서만 일어난다: 명부에 없는 핸들의 해제·전달은 행을 만들면서까지 기록하지 않는다.
export async function syncInfluencerOnDraftUpdate(tx: postgres.Sql, args: {
  before: DraftRow;                              // PATCH 이전 상태 — 라우트가 미리 읽어 전달
  influencerHandle: string | null | undefined;   // undefined = 이번 PATCH가 배정을 건드리지 않음
  status: string | undefined;
  actorId: string | null;
}): Promise<void> {
  const { before, influencerHandle, status, actorId } = args;
  const title = draftLogTitle(before);
  const changed = influencerHandle !== undefined && norm(influencerHandle) !== norm(before.influencerHandle);
  if (changed) {
    if (before.influencerHandle) {
      const prev = await findByHandle(tx, before.influencerHandle);
      if (prev) await insertAutoLog(tx, { influencerId: prev.id, eventType: 'draft_unassigned', draftId: before.id, draftTitle: title, authorId: actorId });
    }
    if (influencerHandle) {
      const id = await ensureInfluencer(tx, influencerHandle, actorId);
      await insertAutoLog(tx, { influencerId: id, eventType: 'draft_assigned', draftId: before.id, draftTitle: title, authorId: actorId });
    }
  }
  // 배정과 전달이 한 PATCH에 오면 배정 블록이 먼저 실행돼 delivered가 새 행을 찾는다 — 순서 불변 유지
  const effective = influencerHandle !== undefined ? influencerHandle : before.influencerHandle;
  if (status === 'delivered' && before.status !== 'delivered' && effective) {
    const row = await findByHandle(tx, effective);
    if (row) await insertAutoLog(tx, { influencerId: row.id, eventType: 'draft_delivered', draftId: before.id, draftTitle: title, authorId: actorId });
  }
}
```

라우트 수정 — `src/app/api/drafts/[id]/route.ts` PATCH 끝부분(기존 54-58행)을 교체:

```ts
  const sql = getSql();
  const before = await getDraft(sql, id);
  if (!before) return NextResponse.json({ error: `draft not found: ${id}` }, { status: 404 });
  await sql.begin(async (tx) => {
    await updateDraft(tx, id, {
      ...(body as { edited?: DraftContent; dismissedFlags?: string[]; status?: DraftStatus }),
      influencerHandle, // 정규화된 값으로 덮어쓴다 — body의 원문 그대로가 아니다(핸들만 저장 원칙)
    });
    await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle, status: body.status, actorId: gate.member.id });
  });
  return NextResponse.json(await getDraft(sql, id));
```

import에 `syncInfluencerOnDraftUpdate` 추가. `gate.member`는 requireMember 반환 그대로(`{member: Member}`).

- [ ] **Step 4: 테스트 통과 확인** — sync 테스트 + 기존 회귀: `node --import tsx --env-file-if-exists=.env --test src/lib/influencerSync.test.ts src/lib/draftStore.test.ts`
- [ ] **Step 5: Commit** — `feat(influencer): 원고 배정·전달 자동 로그 — updateDraft와 같은 트랜잭션 (스펙 §5)`

---

### Task 5: API 라우트 /api/influencers

**Files:**
- Create: `src/app/api/influencers/route.ts`, `src/app/api/influencers/[id]/route.ts`, `src/app/api/influencers/[id]/refresh/route.ts`, `src/app/api/influencers/[id]/logs/route.ts`, `src/app/api/influencers/[id]/logs/[logId]/route.ts`

**Interfaces:**
- Consumes: T3 스토어 전부, `makeClient`(getxapi), `parseXHandle`·`handleParseMessage`(xHandle), `requireAllowedUser`·`requireMember`(authGuard)
- Produces (T7가 소비하는 응답 계약):
  - `GET /api/influencers` → `InfluencerRow[]`
  - `POST /api/influencers` body `{handle: string}` → 200 `{created: boolean, renamed?: boolean, influencer: InfluencerRow}` | 400(형식) | 404(X에 없음) | 502(조회 실패)
  - `GET /api/influencers/[id]` → `InfluencerDetail` | 404
  - `PATCH /api/influencers/[id]` body `{note?: string, tags?: string[]}` → 갱신된 `InfluencerRow`
  - `DELETE /api/influencers/[id]` → `{ok: true}`
  - `POST /api/influencers/[id]/refresh` → `{status: 'ok', duplicateOf: string | null, influencer: InfluencerRow}` | `{status: 'handle_taken'}` | `{status: 'not_found'}` | 502
  - `POST /api/influencers/[id]/logs` body `{body: string, channel?: string}` → `InfluencerLogRow` | 400
  - `DELETE /api/influencers/[id]/logs/[logId]` → `{ok: true}` | 404(manual 아님/없음)

- [ ] **Step 1: 구현** (라우트는 스토어 호출만 — 로직 테스트는 T3에 있음. 게이트: 읽기 `requireAllowedUser`, 쓰기 `requireMember` — drafts 라우트 선례). 핵심 분기:

```ts
// POST /api/influencers — 등록. 한 요청 = 핸들 하나 (여러 줄은 클라이언트가 순차 호출, 스펙 §5)
const trimmed = String(body.handle ?? '').trim();
if (!trimmed) return NextResponse.json({ error: '핸들을 입력해 주세요' }, { status: 400 });
const parsed = parseXHandle(trimmed);
if (!parsed.ok) return NextResponse.json({ error: handleParseMessage(parsed.reason) }, { status: 400 });
const existing = await findByHandle(sql, parsed.handle);
if (existing) return NextResponse.json({ created: false, influencer: existing }); // 오류가 아니라 정보 (스펙 §6)
let info: UserInfo;
try { info = await makeClient().getUserInfo(parsed.handle); }
catch { return NextResponse.json({ error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 }); }
if (!info.id) return NextResponse.json({ error: 'X에서 이 핸들을 찾을 수 없어요' }, { status: 404 });
// 같은 x_user_id의 행이 이미 있으면 = 그 사람이 개명한 것 — 중복 행을 만들지 않고 개명 플로우 (스펙 §5-3과 동일 처리)
const twin = await sql`select id, handle from influencer where x_user_id = ${info.id}`;
if (twin.length) {
  await sql.begin(async (tx) => {
    await renameInfluencer(tx, { influencerId: twin[0].id, from: twin[0].handle, to: parsed.handle, actorId: gate.member.id });
    await applyProfileSnapshot(tx, twin[0].id, info);
  });
  return NextResponse.json({ created: false, renamed: true, influencer: await findInfluencerById(sql, twin[0].id) });
}
const { row } = await createInfluencer(sql, { handle: parsed.handle, createdBy: gate.member.id, snapshot: info });
return NextResponse.json({ created: true, influencer: row });
```

```ts
// POST /api/influencers/[id]/refresh — 갱신 + 개명·충돌 판정 (스펙 §5 refresh 3분기 + §7 경고)
const inf = await findInfluencerById(sql, id);
if (!inf) return NextResponse.json({ error: 'not found' }, { status: 404 });
let info: UserInfo;
try { info = await makeClient().getUserInfo(inf.handle); }
catch { return NextResponse.json({ error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 }); }
// v1은 id 기반 재발견 미지원(스펙 §5-3 후자) — 새 핸들 추적은 등록 화면에서 새 핸들을 추가하면 개명 플로우가 잡는다
if (!info.id) return NextResponse.json({ status: 'not_found' });
if (inf.xUserId && info.id !== inf.xUserId) return NextResponse.json({ status: 'handle_taken' }); // 덮어쓰지 않는다
const duplicateOf = await findDuplicateByXUserId(sql, info.id, inf.id); // §7: 경고 표시까지만
await applyProfileSnapshot(sql, inf.id, info);
return NextResponse.json({ status: 'ok', duplicateOf, influencer: await findInfluencerById(sql, id) });
```

```ts
// POST logs — body 필수·공백 거부, channel은 화이트리스트 밖이면 null 처리
// PATCH [id] — tags는 배열+전원 string 검증(아니면 400 '태그 형식이 올바르지 않아요'), note는 string 검증
// DELETE logs/[logId] — deleteManualLog false면 404 {error: '수동 기록만 지울 수 있어요'}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc 통과, 린트 경고 기준선(24) 초과 없음

- [ ] **Step 3: Commit** — `feat(influencer): /api/influencers 라우트 — 등록(개명 감지)·갱신·로그 (스펙 §5)`

---

### Task 6: 옵션 소스 승계 — 명부가 자동완성 후보가 된다

**Files:**
- Modify: `src/app/api/drafts/influencers/route.ts` (listInfluencerHandles → listOptions)
- Modify: `src/lib/draftStore.ts:151-163` (listInfluencerHandles 삭제 — 유일 호출부가 위 라우트)
- Modify: `src/lib/draftStore.test.ts` (listInfluencerHandles 테스트 블록 삭제 — grep으로 확인)
- Modify: `src/components/InfluencerField.tsx` (도움말 문구 — 옵션 소스가 바뀌면 기존 문구가 거짓이 된다, 스펙 §5)

**Interfaces:**
- Consumes: T3 `listOptions`
- Produces: 없음 (응답 형태 `InfluencerOption[]`·URL·호출부 불변 — 023이 가둔 교체 지점)

- [ ] **Step 1: 라우트 교체** — `listInfluencerHandles(getSql())` → `listOptions(getSql())`, import 변경, 상단 주석을 "명부 테이블 조회 — 2026-08-13 스펙으로 교체 완료"로 갱신.
- [ ] **Step 2: draftStore 정리** — `listInfluencerHandles` 함수(151-163행)와 `InfluencerOption` import 삭제. `grep -rn "listInfluencerHandles" src/` 로 잔존 참조 0 확인. draftStore.test.ts에 해당 테스트가 있으면 그 블록만 삭제.
- [ ] **Step 3: InfluencerField 문구** — 도움말 `X 프로필 주소를 그대로 붙여넣어도 돼요 — 이미 배정한 적 있는 계정이 아래에 제안됩니다` → `X 프로필 주소를 그대로 붙여넣어도 돼요 — 등록된 인플루언서가 아래에 제안됩니다`. datalist 위 주석의 "지금 후보가 등록된 인플루언서 명단이 아니라서" 문장도 현실에 맞게 갱신.
- [ ] **Step 4: 검증**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit** — `feat(influencer): 배정 자동완성 소스를 명부로 교체 — 응답 형태·호출부 불변 (023 교체 지점)`

---

### Task 7: UI — /influencers 2단 분할 + 사이드바

**Files:**
- Create: `src/app/influencers/layout.tsx`, `src/app/influencers/page.tsx`, `src/app/influencers/InfluencerProfile.tsx`, `src/app/influencers/AddInfluencersDialog.tsx`
- Modify: `src/components/Sidebar.tsx` (작업 그룹 — 콘텐츠 생성 아래에 `{ href: '/influencers', label: '인플루언서', Ic: PersonIcon }`), `src/components/XIcons.tsx` (PersonIcon 없으면 기존 아이콘들과 같은 형식으로 추가)

**구현 전 필독:** `src/app/clients/page.tsx`·`ClientDetail.tsx` (2단 분할·URL 동기화·빈 상태 관례), `src/components/InfoTip.tsx`, AGENTS.md UX 원칙. 스타일 토큰(text-ui, text-caption, x-border 등)은 clients 페이지에서 쓰는 것만 재사용.

**Interfaces:**
- Consumes: T5 응답 계약 전부, `relTime`, `apiFetch`, `InfluencerRow`·`InfluencerDetail`·`InfluencerLogRow` 타입(influencerStore에서 import)

- [ ] **Step 1: layout.tsx** — clients/layout.tsx와 동일하게 GlobalShell 래핑.
- [ ] **Step 2: page.tsx — 명부(왼쪽) + 프로필(오른쪽)**
  - clients 페이지의 Suspense + `useSearchParams` 관례. URL 파라미터는 `?i=<id>`.
  - 목록 행: 아바타(없으면 이니셜 원), 표시 이름(없으면 핸들만 — 미조회 상태를 1급으로), `@핸들`, 팔로워 수(없으면 표시 생략), 태그 칩, 마지막 기록 `relTime`, 원고 수. 클릭 → `?i=` 갱신.
  - 상단: 검색 입력(이름·핸들·태그 부분일치, 클라이언트 필터링), [인플루언서 추가] 버튼 → AddInfluencersDialog.
  - 빈 상태: "아직 등록된 인플루언서가 없어요 — 협업 중인 계정을 추가해 보세요" + 추가 버튼 (로딩 실패는 빈 상태로 위장하지 않기 — clients 관례 `loadErr`).
- [ ] **Step 3: AddInfluencersDialog.tsx** — textarea(여러 줄, 줄당 핸들/URL), 제출 시 **줄 단위 순차 `POST /api/influencers`** (스펙 §5 — 타임아웃 회피·줄별 진행). 줄마다 상태 표시: 등록됨 / 이미 명부에 있음 / 개명 감지(→ 새 핸들로 갱신됨) / 실패 사유(+재시도 버튼, 실패 줄만). 진행 중 dialog 닫기 방지 대신 "지금까지 처리된 계정은 등록된 상태로 남아요" 안내. 완료 후 목록 리로드.
- [ ] **Step 4: InfluencerProfile.tsx** — `GET /api/influencers/[id]`로 로드:
  - 헤더: 아바타·이름·`@핸들`(https://x.com/핸들 새 탭)·팔로워 수 + `profileRefreshedAt` 기준 "○일 전 기준" / null이면 "프로필 미조회" + [프로필 가져오기]. [프로필 갱신] 버튼(1회 API 호출임을 옆에 한 줄로 — 비용 opt-in 원칙). refresh 응답 분기: `handle_taken` → "이 핸들은 현재 다른 계정이 쓰고 있어요 — 기존 정보는 남겨뒀어요", `not_found` → "X에서 이 핸들을 찾을 수 없어요 — 개명했다면 새 핸들로 추가하면 이 기록에 이어져요", `duplicateOf` → "같은 계정이 @{duplicateOf}로도 등록돼 있어요 — 한쪽을 지워 정리할 수 있어요".
  - 고정 메모(textarea, blur 저장)·태그 편집(칩 + 입력, Enter 추가·IME `isComposing` 가드 — InfluencerField 선례) → `PATCH`.
  - 타임라인: 한 줄 입력 + 채널 select(선택: DM/라인/이메일/기타) → `POST logs`. 항목: manual = body·채널 뱃지·작성자·relTime + 삭제(×), auto = event_type별 문구("원고 배정 — {draftTitle}" / "배정 해제 — {draftTitle}" / "원고 전달됨 — {draftTitle}" / "핸들 변경 @{from} → @{to}") + draftTitle 클릭 시 `/generate?draft={draftId}` 링크(draftId null이면 텍스트만).
  - 원고 롤업: title·상태 뱃지(기존 상태 라벨 관례)·relTime, 클릭 → `/generate?draft={id}`.
  - 삭제: 프로필 하단 [명부에서 제거] — 인라인 확인("기록 {n}건도 함께 지워져요. 원고의 배정 표기는 남아요."), confirm() 금지.
- [ ] **Step 5: 사이드바 + 아이콘** — 위 Files 명세대로.
- [ ] **Step 6: 검증**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 통과. 화면 확인은 OAuth 게이팅으로 koo만 가능 — 커밋 후 메인 세션이 QA 항목을 정리해 전달.

- [ ] **Step 7: Commit** — `feat(influencer): /influencers 명부 — 2단 분할·일괄 추가·타임라인·롤업 (스펙 §3)`

---

### Task 8: generate 딥링크 — ?draft=<id> 확대 보기

**Files:**
- Modify: `src/app/generate/page.tsx` (진입점 A `?ref=` 이펙트 아래에 추가, 135행 부근)

**Interfaces:**
- Consumes: 기존 `peekId`/`setPeekId`(64행)·`loaded`·`draftsRef`
- Produces: T7 롤업 링크가 쓰는 `/generate?draft=<id>` 동작

- [ ] **Step 1: 이펙트 추가**

```ts
  // 진입점 B: /generate?draft=<id> — 인플루언서 프로필의 원고 롤업·로그에서 진입, 확대 보기로 연다.
  // 필터가 숨겨도 열린다 — peeked 파생이 필터 전 drafts를 보기 때문(101행).
  useEffect(() => {
    const target = searchParams.get('draft');
    if (!target || !loaded) return;
    if (draftsRef.current.some((d) => d.id === target)) setPeekId(target);
  }, [searchParams, loaded]);
```

- [ ] **Step 2: 검증** — `npx tsc --noEmit` 통과. (수동 확인은 T9에서 koo QA 목록에 포함.)
- [ ] **Step 3: Commit** — `feat(generate): ?draft= 딥링크 — 확대 보기로 진입 (인플루언서 롤업용)`

---

### Task 9: 통합 검증 (메인 세션)

- [ ] `npm test` 전체 (실 DB 4분) — 기존+신규 전부 PASS
- [ ] `npm run lint` — 기준선 24개 유지
- [ ] `npm run build` 통과
- [ ] koo QA 목록 작성: 명부 추가(단건·여러 줄·중복·개명)·프로필 갱신 3분기·메모/태그·수동 로그 추가/삭제·원고 배정→자동 로그·delivered→자동 로그·롤업 딥링크·사이드바 진입·빈 상태

## Self-Review 결과

- 스펙 커버리지: §2→T1·T3, §3→T7, §4 등록 3경로→T5(수동·여러 줄)/T4(배정 자동)/큐레이션 리스트는 T7 다이얼로그로 수행, §5→T4·T5·T6·T8, §6→T5·T7, §7→T5 refresh duplicateOf, §8→T3·T4 테스트, §9 백로그 = 구현 없음(의도). 갭 없음.
- 개명 처리: 스펙 §5-3의 "id 기반 조회 가능 여부 확인" → getxapi 클라이언트에 by-id 조회가 없어 후자(fallback)로 시작하되, **등록 시점 x_user_id 대조로 개명을 잡는 경로(T5 POST)를 추가** — 스펙 §5-3과 같은 플로우를 다른 트리거로 실행하는 것.
- 타입 일관성: `InfluencerRow`·`InfluencerLogRow`·응답 계약을 T3 Interfaces 블록에 고정, T4~T7이 동일 이름 참조.
