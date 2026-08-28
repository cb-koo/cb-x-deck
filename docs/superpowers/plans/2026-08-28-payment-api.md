# 정산 프로덕트 연동 API — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 결제 요청(`payment_request`)을 그쪽 정산 프로덕트가 폴링 GET으로 가져가고, 그쪽 처리 상태·실지급액을 POST로 받아 요청 내역·캠페인 배지에 보이게 한다. 연동 개발용 스테이징(별도 Supabase·Vercel)을 만든다.

**Architecture:** 스냅샷 행은 불변, 외부 상태는 별도 컬럼(041). 인증은 Bearer 시크릿 헬퍼 하나. 직렬화(`toExternalItem`)·상태 파서·커서는 순수 모듈 `settlementExternal.ts`, DB 규칙은 `settlementStore.ts`, 화면 라벨은 순수 `settlementDisplay.ts` 한 곳에서 파생. 라우트는 얇게.

**Tech Stack:** Next.js(App Router, `node_modules/next/dist/docs/` 확인) · TypeScript · postgres.js(`sql` 태그, `sql.begin`) · node:test + tsx(실 DB) · Supabase(Postgres·Auth·Storage) · Vercel CLI 58.9.1.

**Spec:** `docs/superpowers/specs/2026-08-28-payment-api-design.md` — 각 작업에 §번호를 적었다. 애매하면 스펙이 우선.

## Global Constraints

- 마이그레이션은 **041** 하나, 모든 문장 멱등(`apply-migrations.sh`가 전 파일 재실행). 이벤트 제약 재생성은 `drop constraint if exists` + `add … not valid`.
- 테스트는 실 DB: 접두어 `const P = 'tstl' + process.pid`(파일마다 고유 접두어), `after()`에서 FK 순서로 삭제 후 `await sql.end()`. 단일 파일 실행: `node --import tsx --env-file-if-exists=.env --test <file>`.
- 전체: `npm test`(약 4분, 기준 858 pass/1 skip), `npm run lint`(기준선 경고 24개 — 새 경고 0), `npm run build`.
- 사용자 문구는 한국어·사용자 말(내부어 `external_status`·`on_hold`·`stale` 비노출). 라우트 파일은 HTTP 핸들러만 export(상수는 모듈 내부).
- import는 lib 안에서 상대경로 + `.ts` 확장자(`from './uuid.ts'`), app 쪽은 `@/lib/...`.
- 금액 필드는 이름만 바꿔 붙이지 않는다 — `amount_krw` / `payout.{net, fee_amount, gross, currency, rate_krw_per_jpy}` 분리 그대로.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 041은 프로덕션 DB에 **선적용해도 안전**(전부 nullable 추가·인덱스·트리거, paid 행 0건) — 실 DB 테스트를 위해 Task 1에서 적용한다(040도 같은 방식이었다).

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `migrations/041_payment_external.sql` | 외부 상태 컬럼·influencer_id·category_option_id·slack_id·paid 트리거·이벤트 | 1 |
| `scripts/apply-migrations.sh` | env 파일 인자 | 1 |
| `src/lib/externalAuth.ts` (+`.test.ts`) | Bearer 시크릿 비교 | 2 |
| `src/app/api/landing-events/route.ts` | 헬퍼로 교체 | 2 |
| `src/lib/settlementStore.ts` (+test) | 행 타입 확장·저장·취소 paid-locked·`cancelInTx`·export 조회·`applyExternalStatus` | 3, 5 |
| `src/lib/campaignTaskStore.ts`, `src/lib/campaignStore.ts` | 배지 조회 확장 | 3 |
| `src/lib/settlementExternal.ts` (+test) | 커서·상태 파서·직렬화 | 4 |
| `src/app/api/external/settlement/requests/route.ts`, `[id]/route.ts`, `[id]/status/route.ts` | 외부 API | 6 |
| `src/app/api/settlement/requests/[id]/route.ts` | paid-locked 409 | 6 |
| `src/lib/settlementDisplay.ts` (+test) | 라벨·그룹·실지급 문구 | 7 |
| `src/app/settlement/RequestRow.tsx`, `RequestList.tsx`, `src/app/campaigns/TaskTable.tsx`, `src/app/influencers/Timeline.tsx`, `src/lib/influencerStore.ts` | 화면 | 8 |
| `scripts/stagingGuard.ts`, `setup-staging.ts`, `seed-staging.ts`, `deploy-staging.sh`, `smoke-external-api.ts`, `package.json` | 스테이징·스모크 | 9 |
| `docs/api/settlement-external-api.md`, `src/content/updates.ts` | 그쪽 문서·업데이트 소식 | 10 |
| (인프라) Supabase·Vercel 스테이징 생성, env, 적용·배포·시드·스모크 | 11 (메인 세션이 직접) |

---

### Task 1: 마이그레이션 041 + apply-migrations env 인자

**Files:**
- Create: `migrations/041_payment_external.sql`
- Modify: `scripts/apply-migrations.sh`
- Modify: `package.json` (scripts `migrate:staging`)

**Interfaces:**
- Produces: `payment_request.external_status|paid_amount_krw|paid_at|external_note|external_updated_at|influencer_id|category_option_id`, `member.slack_id`, 트리거 `payment_request_guard_paid`(메시지 `paid-locked`), `influencer_log` 이벤트 `payment_paid`.

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 041: 정산 프로덕트 연동(스펙 2026-08-28-payment-api-design §4) — 요청 스냅샷은 그대로, 외부 상태는 옆 칸.
-- apply-migrations.sh가 전 파일을 재실행하므로 모든 문장은 멱등.

-- §4-1 외부 상태 컬럼
alter table payment_request add column if not exists external_status text;          -- null = 그쪽이 아직 안 봄
alter table payment_request drop constraint if exists payment_request_external_status_check;
alter table payment_request add constraint payment_request_external_status_check
  check (external_status is null or external_status in ('received','scheduled','paid','on_hold','cancelled'));
alter table payment_request add column if not exists paid_amount_krw int;            -- 실제 지급 원화 확정치
alter table payment_request add column if not exists paid_at timestamptz;
alter table payment_request add column if not exists external_note text;             -- 보류 사유·차액 설명·취소 이유 한 줄
alter table payment_request drop constraint if exists payment_request_external_note_len;
alter table payment_request add constraint payment_request_external_note_len
  check (external_note is null or char_length(external_note) <= 500);
alter table payment_request add column if not exists external_updated_at timestamptz; -- 그쪽이 찍은 변경 시각(순서 보장)
alter table payment_request drop constraint if exists payment_request_paid_fields;
alter table payment_request add constraint payment_request_paid_fields
  check (external_status is distinct from 'paid' or (paid_amount_krw is not null and paid_at is not null));

-- §4-1 인플 UUID 스냅샷(개명 뒤에도 조인) · 분류 옵션 코드
alter table payment_request add column if not exists influencer_id uuid references influencer(id) on delete set null;
alter table payment_request add column if not exists category_option_id text;
create index if not exists idx_payment_request_influencer on payment_request (influencer_id);
update payment_request r set influencer_id = i.id
  from influencer i where r.influencer_id is null and lower(i.handle) = lower(r.influencer_handle);

-- §5-2 폴링 커서
create index if not exists idx_payment_request_updated on payment_request (updated_at, id);

-- §4-2 지급 완료는 종점 — 다른 쓰기 경로가 생겨도 우리 status 변경(취소)을 막는 마지막 벽
create or replace function payment_request_guard_paid() returns trigger language plpgsql as $$
begin
  if old.external_status = 'paid' and new.status is distinct from old.status then
    raise exception 'paid-locked';
  end if;
  return new;
end $$;
drop trigger if exists payment_request_guard_paid on payment_request;
create trigger payment_request_guard_paid before update on payment_request
  for each row execute function payment_request_guard_paid();

-- §4-4 요청자 Slack ID(값은 SQL로 채움, 화면 없음)
alter table member add column if not exists slack_id text;

-- §4-5 인플 활동 기록 이벤트 추가 — 제약 이름은 036·040과 동일(drop + add), not valid 관례(040 주석 참조)
alter table influencer_log drop constraint if exists influencer_log_event_type_check;
alter table influencer_log add constraint influencer_log_event_type_check
  check (event_type in ('draft_assigned','draft_unassigned','draft_delivered','handle_changed','pricing_changed',
                        'payment_method_changed','payment_requested','payment_cancelled','payment_paid')) not valid;
```

- [ ] **Step 2: apply-migrations.sh에 env 파일 인자**

```bash
#!/usr/bin/env bash
# 사용: scripts/apply-migrations.sh [env파일]  — 기본 .env(프로덕션), 스테이징은 .env.staging
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || { echo "env 파일이 없어요: $ENV_FILE" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
echo "== target: ${PGHOST:-?} ($ENV_FILE)"
for f in migrations/*.sql; do
  echo "== applying $f"
  psql -v ON_ERROR_STOP=1 -f "$f"
done
echo "== done"
```

`package.json` scripts에 추가: `"migrate:staging": "bash scripts/apply-migrations.sh .env.staging"`.

- [ ] **Step 3: 프로덕션 DB에 적용(전 파일 재실행 — 멱등 확인 겸)**

Run: `npm run migrate 2>&1 | tail -5`
Expected: `== applying migrations/041_payment_external.sql` … `== done`, 오류 없음. 두 번 실행해도 같은 결과.

- [ ] **Step 4: 컬럼·트리거 확인**

Run: `set -a; source .env; set +a; psql -Atc "select column_name from information_schema.columns where table_name='payment_request' and column_name in ('external_status','paid_amount_krw','paid_at','external_note','external_updated_at','influencer_id','category_option_id') order by 1; select tgname from pg_trigger where tgname='payment_request_guard_paid'; select count(*) from payment_request where influencer_id is not null;"`
Expected: 컬럼 7개, 트리거 1개, 백필 건수 = 기존 요청 중 핸들 일치 건수(현재 1 또는 0).

- [ ] **Step 5: 커밋**

```bash
git add migrations/041_payment_external.sql scripts/apply-migrations.sh package.json
git commit -m "feat(settlement): 041 외부 상태 컬럼·인플 UUID 스냅샷·분류 코드·slack_id·paid 종점 트리거 + migrate env 인자

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Bearer 시크릿 헬퍼 `externalAuth.ts` + landing-events 교체

**Files:**
- Create: `src/lib/externalAuth.ts`, `src/lib/externalAuth.test.ts`
- Modify: `src/app/api/landing-events/route.ts:10-17`

**Interfaces:**
- Produces: `bearerMatches(header: string | null, secret: string | undefined): boolean`, `bearerAuthorized(req: Request, envName: string): boolean`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/externalAuth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerMatches } from './externalAuth.ts';

test('bearerMatches — 시크릿이 비어 있으면 어떤 헤더도 통과 못 한다(닫힌 API)', () => {
  assert.equal(bearerMatches('Bearer abc', undefined), false);
  assert.equal(bearerMatches('Bearer abc', ''), false);
});
test('bearerMatches — 정확히 일치만 통과', () => {
  assert.equal(bearerMatches('Bearer s3cret', 's3cret'), true);
  assert.equal(bearerMatches('Bearer s3cre', 's3cret'), false);    // 길이 다름
  assert.equal(bearerMatches('Bearer S3cret', 's3cret'), false);   // 대소문자
  assert.equal(bearerMatches('s3cret', 's3cret'), false);          // Bearer 접두어 없음
  assert.equal(bearerMatches(null, 's3cret'), false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/externalAuth.test.ts`
Expected: FAIL — `Cannot find module './externalAuth.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/externalAuth.ts
// 서버↔서버 공유 시크릿(Bearer). 사람이 아니라 서버가 부르는 라우트(landing-events, external/settlement)가 쓴다.
// env가 비어 있으면 '열린 API'가 아니라 '닫힌 API'다. 비교는 상수 시간.
import { timingSafeEqual } from 'node:crypto';

export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = header && header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearerAuthorized(req: Request, envName: string): boolean {
  return bearerMatches(req.headers.get('authorization'), process.env[envName]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/externalAuth.test.ts`
Expected: 2 pass.

- [ ] **Step 5: landing-events 라우트 교체**

`src/app/api/landing-events/route.ts`에서 `import { timingSafeEqual } from 'node:crypto';`와 `function authorized(req)…` 블록(주석 포함)을 지우고:

```ts
import { bearerAuthorized } from '@/lib/externalAuth';
// 브릿지 서버 → 우리. 사람이 아니라 서버가 부르므로 세션 게이트(requireMember)가 아니라 공유 시크릿이다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §수집 API
```
POST 첫 줄을 `if (!bearerAuthorized(req, 'LANDING_EVENTS_SECRET')) return new NextResponse(null, { status: 401 });`로.

- [ ] **Step 6: 타입·린트**

Run: `npx tsc --noEmit -p . 2>&1 | head -5 && npm run lint 2>&1 | tail -3`
Expected: 타입 오류 없음, 경고 수 기준선(24) 유지.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/externalAuth.ts src/lib/externalAuth.test.ts src/app/api/landing-events/route.ts
git commit -m "refactor(auth): Bearer 시크릿 비교를 externalAuth 헬퍼로 — landing-events가 사용, 외부 정산 API가 공유

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 스토어 행 확장 — 외부 필드·influencer_id·category_option_id·paid-locked·배지 확장

**Files:**
- Modify: `src/lib/settlementStore.ts` (`PaymentRequestRow`:97-105, `RRow`/`R_SELECT`/`toRequest`:114-138, `createRequests` 검증 루프·insert:143-218, `cancelRequest`:220-242)
- Modify: `src/lib/campaignTaskStore.ts:302-311` (`settlementByTaskIds`)
- Modify: `src/lib/campaignStore.ts:37` (`CampaignTaskItem.settlement` 타입), import 줄 8
- Test: `src/lib/settlementStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ExternalStatus = 'received' | 'scheduled' | 'paid' | 'on_hold' | 'cancelled';
  export const EXTERNAL_STATUSES: readonly ExternalStatus[];
  // PaymentRequestRow에 추가:
  externalStatus: ExternalStatus | null; paidAmountKrw: number | null; paidAt: string | null; externalNote: string | null;
  externalUpdatedAt: string | null; influencerId: string | null; categoryOptionId: string | null;
  cancelRequest(...): Promise<PaymentRequestRow | 'not-found' | 'already-cancelled' | 'paid-locked'>
  // 내부(export 안 함): cancelInTx(tx, id, by: { id: string | null; name: string }, reason: string): Promise<PaymentRequestRow>
  // campaignTaskStore:
  export interface SettlementBadge { status: SettlementBadgeStatus; createdAt: string; cancelledAt: string | null;
    externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null }
  settlementByTaskIds(sql, ids): Promise<Map<string, SettlementBadge>>
  ```
  `ExternalStatus`는 **campaignTaskStore.ts에 정의**하고 settlementStore가 re-export한다(순환 방지 — settlementStore→campaignTaskStore 방향은 이미 있다).

- [ ] **Step 1: 실패하는 테스트 추가** (`settlementStore.test.ts` 끝에)

```ts
test('생성 — influencer_id·category_option_id 스냅샷 저장, 외부 필드는 null로 시작', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라X');
  const camp = await createCampaign(sql, base(c.id, c.name, 'x', 'visit'));
  const inf = await influencerWithPaypal(H('ext'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('ext'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/e/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  assert.equal(row.influencerId, inf.id);
  assert.equal(row.categoryOptionId, 'fee');
  assert.equal(row.externalStatus, null); assert.equal(row.paidAmountKrw, null); assert.equal(row.externalUpdatedAt, null);
  const badge = (await settlementByTaskIds(sql, [t.id])).get(t.id)!;
  assert.equal(badge.externalStatus, null); assert.equal(badge.cancelledAt, null);
});

test('취소 — 그쪽이 지급 완료한 요청은 paid-locked, 트리거가 우회 UPDATE도 막는다', async () => {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라Y');
  const camp = await createCampaign(sql, base(c.id, c.name, 'y', 'visit'));
  await influencerWithPaypal(H('pd'));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H('pd'), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/p/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  await sql`update payment_request set external_status = 'paid', paid_amount_krw = 29700, paid_at = now(), external_updated_at = now() where id = ${row.id}`;
  assert.equal(await cancelRequest(sql, row.id, '실수', m), 'paid-locked');
  await assert.rejects(sql`update payment_request set status = 'cancelled' where id = ${row.id}`, /paid-locked/);
  const badge = (await settlementByTaskIds(sql, [t.id])).get(t.id)!;
  assert.equal(badge.externalStatus, 'paid');
});
```
`SETTLEMENT_DEFAULTS.categories`의 id는 `src/lib/settlementSettings.ts:15-` 를 열어 실제 값(`promo-rt`/`fee`/`info-post`)을 확인하고 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts 2>&1 | tail -20`
Expected: 새 테스트 2개 FAIL(`influencerId` undefined / `paid-locked`가 아니라 row 반환).

- [ ] **Step 3: campaignTaskStore — 타입·배지 확장**

`src/lib/campaignTaskStore.ts:302-311`을 교체:
```ts
export type SettlementBadgeStatus = 'requested' | 'cancelled';
// 그쪽(정산 프로덕트) 상태 — payment_request.external_status(041). null = 그쪽이 아직 안 봄.
export type ExternalStatus = 'received' | 'scheduled' | 'paid' | 'on_hold' | 'cancelled';
export const EXTERNAL_STATUSES: readonly ExternalStatus[] = ['received', 'scheduled', 'paid', 'on_hold', 'cancelled'];
export interface SettlementBadge {
  status: SettlementBadgeStatus; createdAt: string; cancelledAt: string | null;
  externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
}
export async function settlementByTaskIds(sql: postgres.Sql, taskIds: string[]): Promise<Map<string, SettlementBadge>> {
  const ids = taskIds.filter(isUuidLike);
  if (!ids.length) return new Map();
  const rows = await sql<Array<{ task_id: string; status: SettlementBadgeStatus; created_at: Date; cancelled_at: Date | null;
    external_status: ExternalStatus | null; external_note: string | null; external_updated_at: Date | null }>>`
    select distinct on (task_id) task_id, status, created_at, cancelled_at, external_status, external_note, external_updated_at
      from payment_request where task_id in ${sql(ids)}
     order by task_id, (status = 'requested') desc, created_at desc`;
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  return new Map(rows.map((r) => [r.task_id, {
    status: r.status, createdAt: new Date(r.created_at).toISOString(), cancelledAt: iso(r.cancelled_at),
    externalStatus: r.external_status, externalNote: r.external_note, externalUpdatedAt: iso(r.external_updated_at),
  }]));
}
```
`src/lib/campaignStore.ts`: import에 `type SettlementBadge` 추가(`SettlementBadgeStatus` 대신), 37행을 `settlement: SettlementBadge | null;`로.

- [ ] **Step 4: settlementStore — 타입·SELECT·매핑**

import 줄 14를 `import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';`로. `PaymentRequestRow`에 추가:
```ts
  externalStatus: ExternalStatus | null; paidAmountKrw: number | null; paidAt: string | null; externalNote: string | null;
  externalUpdatedAt: string | null; influencerId: string | null; categoryOptionId: string | null;
```
`RRow`에 추가: `external_status: ExternalStatus | null; paid_amount_krw: number | null; paid_at: Date | null; external_note: string | null; external_updated_at: Date | null; influencer_id: string | null; category_option_id: string | null;`
`R_SELECT` 컬럼 목록 끝(`note, created_at, updated_at` 뒤)에 `, external_status, paid_amount_krw, paid_at, external_note, external_updated_at, influencer_id, category_option_id` 추가.
`toRequest`에 추가:
```ts
  externalStatus: r.external_status, paidAmountKrw: r.paid_amount_krw, paidAt: iso(r.paid_at), externalNote: r.external_note,
  externalUpdatedAt: iso(r.external_updated_at), influencerId: r.influencer_id, categoryOptionId: r.category_option_id,
```
마지막 re-export 줄을 `export { settlementByTaskIds, EXTERNAL_STATUSES, type SettlementBadgeStatus, type SettlementBadge, type ExternalStatus } from './campaignTaskStore.ts';`로.

- [ ] **Step 5: createRequests — 두 컬럼 저장**

`prepared` 타입에 `cat: { id: string }` 추가: `Array<{ item: CreateItemInput; cand: SettlementCandidate; r: CandRow; cat: { id: string } }>`; `prepared.push({ item, cand, r, cat });`. 트랜잭션 루프 `for (const { item, cand, r, cat } of prepared)`. insert 컬럼 목록 끝에 `, influencer_id, category_option_id`, values 끝에 `, ${r.influencer_id}, ${cat.id}`.

- [ ] **Step 6: cancelRequest — paid-locked + cancelInTx 공유**

`cancelRequest` 위에 내부 함수:
```ts
// 취소 한 경로 — 사람(요청 내역)과 그쪽(정산 프로덕트 '취소' 수신)이 같은 함수를 쓴다. 호출자가 for update 잠금·상태 판정을 끝낸 뒤 부른다.
async function cancelInTx(tx: postgres.Sql, id: string, by: { id: string | null; name: string }, reason: string): Promise<PaymentRequestRow> {
  await tx`
    update payment_request set status = 'cancelled', cancelled_at = now(), cancelled_by = ${by.id}, cancelled_by_name = ${by.name},
           cancel_reason = ${reason}, updated_at = now()
     where id = ${id}`;
  const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
  const row = toRequest(saved);
  const infId = row.influencerId ?? (await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${row.influencerHandle})`)[0]?.id ?? null;
  if (infId) {
    const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType, reason };
    await insertAutoLog(tx, { influencerId: infId, eventType: 'payment_cancelled', draftId: null, draftTitle: null, payload, authorId: by.id });
  }
  return row;
}
```
`cancelRequest` 본문:
```ts
export async function cancelRequest(
  sql: postgres.Sql, id: string, reason: string, member: { id: string; name: string },
): Promise<PaymentRequestRow | 'not-found' | 'already-cancelled' | 'paid-locked'> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id} for update`;
    if (!cur.length) return 'not-found';
    if (cur[0].status === 'cancelled') return 'already-cancelled';
    if (cur[0].external_status === 'paid') return 'paid-locked';   // §4-2 — 트리거가 마지막 벽, 여기서는 화면 문구용 판정
    return cancelInTx(tx, id, member, reason);
  });
}
```

- [ ] **Step 7: 통과 확인 + 전체 스토어 테스트**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts 2>&1 | tail -8`
Expected: 전부 pass(기존 + 2). `npx tsc --noEmit -p .` 오류 없음(`campaignStore` 타입 포함).

- [ ] **Step 8: 커밋**

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/lib/campaignTaskStore.ts src/lib/campaignStore.ts
git commit -m "feat(settlement): 요청 행에 외부 상태·인플 UUID·분류 코드, 취소 paid-locked, 배지에 그쪽 상태

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: 순수 모듈 `settlementExternal.ts` — 커서·상태 파서·직렬화

**Files:**
- Create: `src/lib/settlementExternal.ts`, `src/lib/settlementExternal.test.ts`

**Interfaces:**
- Consumes: `PaymentRequestRow`, `ExternalStatus`, `EXTERNAL_STATUSES`(Task 3).
- Produces:
  ```ts
  export const EXTERNAL_API_VERSION = 1; export const LIST_LIMIT_DEFAULT = 100; export const LIST_LIMIT_MAX = 500;
  export interface Cursor { updatedAtUs: string; id: string }           // µs 정수 문자열 + uuid
  export function encodeCursor(c: Cursor): string; export function decodeCursor(s: string): Cursor | null;
  export function clampLimit(raw: string | null): number;
  export interface ExportRow { row: PaymentRequestRow; updatedAtUs: string; requester: { email: string | null; slackId: string | null } }
  export function toExternalItem(e: ExportRow): ExternalItem;            // §5-3 모양(snake_case)
  export interface StatusUpdate { status: ExternalStatus; updatedAt: string; note: string | null; paidAmountKrw: number | null; paidAt: string | null; externalId: string | null }
  export type StatusParse = { ok: true; update: StatusUpdate } | { ok: false; field: string; error: string };
  export function parseStatusUpdate(body: unknown): StatusParse;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/settlementExternal.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, clampLimit, toExternalItem, parseStatusUpdate, type ExportRow } from './settlementExternal.ts';
import type { PaymentRequestRow } from './settlementStore.ts';

const ID = '11111111-2222-4333-8444-555555555555';
test('커서 — 왕복, 깨진 값은 null', () => {
  const s = encodeCursor({ updatedAtUs: '1756368000123456', id: ID });
  assert.deepEqual(decodeCursor(s), { updatedAtUs: '1756368000123456', id: ID });
  assert.equal(decodeCursor('not-base64!!'), null);
  assert.equal(decodeCursor(Buffer.from('abc:def').toString('base64url')), null);      // µs가 숫자 아님
  assert.equal(decodeCursor(Buffer.from('123:nope').toString('base64url')), null);     // uuid 아님
});
test('limit — 기본 100, 최대 500, 잘못된 값은 기본', () => {
  assert.equal(clampLimit(null), 100); assert.equal(clampLimit('50'), 50); assert.equal(clampLimit('9999'), 500);
  assert.equal(clampLimit('0'), 100); assert.equal(clampLimit('abc'), 100);
});

const row: PaymentRequestRow = {
  id: ID, taskId: 't', campaignId: 'c', campaignName: '캠', clientId: 'cl', clientName: '마인드피부과', influencerHandle: 'sawada_k', taskType: 'post',
  category: '마케팅비 > 원고료', categoryDefault: null, itemText: '항목', purposeText: '목적', amountKrw: 30000, costCurrency: 'KRW', payoutCurrency: 'JPY',
  rateKrwPerJpy: 10, amountNet: 3000, fee: { mode: 'grossUp', percent: 5 }, feeAmount: 158, amountGross: 3158, deadlineOn: '2026-08-29', referenceUrl: null,
  paymentMethod: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypalId: 'keiko' }, requesterMemberId: 'm', requesterName: '모에카',
  status: 'requested', cancelledAt: null, cancelledByName: null, cancelReason: null, sentAt: null, externalId: null, note: '',
  createdAt: '2026-08-28T00:00:00.000Z', updatedAt: '2026-08-28T00:00:00.000Z',
  externalStatus: null, paidAmountKrw: null, paidAt: null, externalNote: null, externalUpdatedAt: null, influencerId: 'inf', categoryOptionId: 'fee',
};
test('toExternalItem — 금액 분리·snake_case·되비침 null', () => {
  const e: ExportRow = { row, updatedAtUs: '1', requester: { email: 'a@b.c', slackId: null } };
  const it = toExternalItem(e);
  assert.equal(it.request_id, ID); assert.equal(it.revision, 0); assert.equal(it.status, 'requested');
  assert.equal(it.amount_krw, 30000); assert.equal(it.cost_currency, 'KRW');
  assert.deepEqual(it.payout, { currency: 'JPY', net: 3000, fee: { mode: 'grossUp', percent: 5 }, fee_amount: 158, gross: 3158, rate_krw_per_jpy: 10 });
  assert.deepEqual(it.influencer, { id: 'inf', handle: 'sawada_k' });
  assert.deepEqual(it.clinic, { id: 'cl', name: '마인드피부과' });
  assert.deepEqual(it.category, { code: 'fee', label: '마케팅비 > 원고료' });
  assert.deepEqual(it.payment_method, { type: 'paypal', holder: 'KEIKO', currency: 'JPY', paypal_id: 'keiko' });
  assert.deepEqual(it.requester, { name: '모에카', email: 'a@b.c', slack_id: null });
  assert.equal(it.cancelled, null);
  assert.deepEqual(it.settlement, { status: null, paid_amount_krw: null, paid_at: null, note: null, updated_at: null, external_id: null });
  assert.equal(it.deadline, '2026-08-29'); assert.equal(it.reference_url, null);
});
test('toExternalItem — 취소·지급 완료 되비침', () => {
  const r2: PaymentRequestRow = { ...row, status: 'cancelled', cancelledAt: '2026-08-29T01:00:00.000Z', cancelledByName: '정산 프로덕트', cancelReason: '중복',
    externalStatus: 'paid', paidAmountKrw: 29700, paidAt: '2026-08-30T05:00:00.000Z', externalNote: '환율', externalUpdatedAt: '2026-08-30T05:00:00.000Z', externalId: 'X-1', requesterMemberId: null };
  const it = toExternalItem({ row: r2, updatedAtUs: '1', requester: { email: null, slackId: null } });
  assert.equal(it.revision, 1);
  assert.deepEqual(it.cancelled, { at: '2026-08-29T01:00:00.000Z', by_name: '정산 프로덕트', reason: '중복' });
  assert.deepEqual(it.settlement, { status: 'paid', paid_amount_krw: 29700, paid_at: '2026-08-30T05:00:00.000Z', note: '환율', updated_at: '2026-08-30T05:00:00.000Z', external_id: 'X-1' });
});

test('parseStatusUpdate — 정상·정규화', () => {
  const r = parseStatusUpdate({ status: 'paid', updated_at: '2026-08-30T05:00:00Z', paid_amount_krw: 29700, paid_at: '2026-08-30T05:00:00+09:00', note: ' 환율 ', external_id: 'X-1' });
  assert.ok(r.ok);
  assert.deepEqual(r.update, { status: 'paid', updatedAt: '2026-08-30T05:00:00.000Z', paidAmountKrw: 29700, paidAt: '2026-08-29T20:00:00.000Z', note: '환율', externalId: 'X-1' });
  const h = parseStatusUpdate({ status: 'on_hold', updated_at: '2026-08-29T00:00:00Z', note: '계좌 확인' });
  assert.ok(h.ok); assert.equal(h.update.paidAmountKrw, null); assert.equal(h.update.externalId, null);
});
test('parseStatusUpdate — 거절 사유는 필드 단위', () => {
  const bad = (body: unknown, field: string) => { const r = parseStatusUpdate(body); assert.ok(!r.ok); assert.equal(r.field, field); };
  bad(null, 'body'); bad([], 'body');
  bad({ updated_at: '2026-08-29T00:00:00Z' }, 'status');
  bad({ status: 'done', updated_at: '2026-08-29T00:00:00Z' }, 'status');
  bad({ status: 'received' }, 'updated_at');
  bad({ status: 'received', updated_at: 'yesterday' }, 'updated_at');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: 100 }, 'paid_at');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: -1, paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'paid', updated_at: '2026-08-29T00:00:00Z', paid_amount_krw: 1.5, paid_at: '2026-08-29T00:00:00Z' }, 'paid_amount_krw');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', note: 'x'.repeat(501) }, 'note');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', external_id: 'x'.repeat(101) }, 'external_id');
  bad({ status: 'received', updated_at: '2026-08-29T00:00:00Z', note: 5 }, 'note');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementExternal.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// src/lib/settlementExternal.ts
// 그쪽(정산 프로덕트) API 계약의 순수 부분 — 커서·상태 파서·직렬화. DB 없음.
// 설계: docs/superpowers/specs/2026-08-28-payment-api-design.md §5·§6. 그쪽 전달 문서: docs/api/settlement-external-api.md
import type { PaymentRequestRow } from './settlementStore.ts';            // 타입만 — 값 import면 settlementStore↔settlementExternal 순환
import { EXTERNAL_STATUSES, type ExternalStatus } from './campaignTaskStore.ts';
import { isUuidLike } from './uuid.ts';
import type { PaymentFee } from './influencerPayment.ts';

export const EXTERNAL_API_VERSION = 1;
export const LIST_LIMIT_DEFAULT = 100;
export const LIST_LIMIT_MAX = 500;
const NOTE_MAX = 500;
const EXTERNAL_ID_MAX = 100;

// ── 커서: (updated_at 마이크로초 정수, id) — ISO(ms)로 만들면 같은 ms의 다음 행이 다시 나와 무한 반복될 수 있다 ──
export interface Cursor { updatedAtUs: string; id: string }
export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.updatedAtUs}:${c.id}`).toString('base64url');
}
export function decodeCursor(s: string): Cursor | null {
  let raw: string;
  try { raw = Buffer.from(s, 'base64url').toString('utf8'); } catch { return null; }
  const i = raw.indexOf(':');
  if (i < 0) return null;
  const us = raw.slice(0, i), id = raw.slice(i + 1);
  if (!/^\d{1,19}$/.test(us) || !isUuidLike(id)) return null;
  return { updatedAtUs: us, id };
}
export function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) return LIST_LIMIT_DEFAULT;
  return Math.min(n, LIST_LIMIT_MAX);
}

// ── 직렬화(§5-3) — GET 목록·GET 단건·POST 응답이 전부 이 함수 하나를 쓴다 ──
export interface ExportRow { row: PaymentRequestRow; updatedAtUs: string; requester: { email: string | null; slackId: string | null } }
export interface ExternalItem {
  request_id: string; revision: 0 | 1; status: 'requested' | 'cancelled'; created_at: string; updated_at: string;
  cancelled: { at: string | null; by_name: string | null; reason: string | null } | null;
  task_id: string | null;
  campaign: { id: string | null; name: string }; clinic: { id: string | null; name: string };
  influencer: { id: string | null; handle: string };
  task_type: PaymentRequestRow['taskType'];
  category: { code: string | null; label: string };
  item: string; purpose: string;
  amount_krw: number; cost_currency: PaymentRequestRow['costCurrency'];
  payout: { currency: PaymentRequestRow['payoutCurrency']; net: number; fee: PaymentFee | null; fee_amount: number; gross: number; rate_krw_per_jpy: number };
  deadline: string; reference_url: string | null;
  payment_method: Record<string, string>;
  requester: { name: string; email: string | null; slack_id: string | null };
  note: string;
  settlement: { status: ExternalStatus | null; paid_amount_krw: number | null; paid_at: string | null; note: string | null; updated_at: string | null; external_id: string | null };
}
const SNAKE_PM: Record<string, string> = { type: 'type', holder: 'holder', currency: 'currency', email: 'email', paypalId: 'paypal_id', identifier: 'identifier', bank: 'bank', branch: 'branch', account: 'account' };
export function toExternalItem(e: ExportRow): ExternalItem {
  const r = e.row;
  const pm: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.paymentMethod)) if (typeof v === 'string' && SNAKE_PM[k]) pm[SNAKE_PM[k]] = v;
  return {
    request_id: r.id, revision: r.status === 'cancelled' ? 1 : 0, status: r.status, created_at: r.createdAt, updated_at: r.updatedAt,
    cancelled: r.status === 'cancelled' ? { at: r.cancelledAt, by_name: r.cancelledByName, reason: r.cancelReason } : null,
    task_id: r.taskId,
    campaign: { id: r.campaignId, name: r.campaignName }, clinic: { id: r.clientId, name: r.clientName },
    influencer: { id: r.influencerId, handle: r.influencerHandle },
    task_type: r.taskType,
    category: { code: r.categoryOptionId, label: r.category },
    item: r.itemText, purpose: r.purposeText,
    amount_krw: r.amountKrw, cost_currency: r.costCurrency,
    payout: { currency: r.payoutCurrency, net: r.amountNet, fee: r.fee, fee_amount: r.feeAmount, gross: r.amountGross, rate_krw_per_jpy: r.rateKrwPerJpy },
    deadline: r.deadlineOn, reference_url: r.referenceUrl,
    payment_method: pm,
    requester: { name: r.requesterName, email: e.requester.email, slack_id: e.requester.slackId },
    note: r.note,
    settlement: { status: r.externalStatus, paid_amount_krw: r.paidAmountKrw, paid_at: r.paidAt, note: r.externalNote, updated_at: r.externalUpdatedAt, external_id: r.externalId },
  };
}

// ── 상태 수신 본문(§6-1) — 첫 오류에서 멈추고 어느 필드인지 알려준다(landingEvent 파서 관례) ──
export interface StatusUpdate { status: ExternalStatus; updatedAt: string; note: string | null; paidAmountKrw: number | null; paidAt: string | null; externalId: string | null }
export type StatusParse = { ok: true; update: StatusUpdate } | { ok: false; field: string; error: string };
const bad = (field: string, error: string): StatusParse => ({ ok: false, field, error });
function isoOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
function optStr(o: Record<string, unknown>, k: string, max: number): string | null | StatusParse {
  const v = o[k];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return bad(k, '문자열이어야 해요');
  const t = v.trim();
  if (t.length > max) return bad(k, `${max}자를 넘어요`);
  return t.length ? t : null;
}
const isParse = (v: unknown): v is StatusParse => typeof v === 'object' && v !== null && 'ok' in (v as object);
export function parseStatusUpdate(body: unknown): StatusParse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('body', 'JSON 객체여야 해요');
  const o = body as Record<string, unknown>;
  const status = o.status;
  if (typeof status !== 'string' || !EXTERNAL_STATUSES.includes(status as ExternalStatus)) return bad('status', `${EXTERNAL_STATUSES.join('·')} 중 하나여야 해요`);
  const updatedAt = isoOf(o.updated_at);
  if (!updatedAt) return bad('updated_at', 'ISO 8601 시각이어야 해요');
  const note = optStr(o, 'note', NOTE_MAX); if (isParse(note)) return note;
  const externalId = optStr(o, 'external_id', EXTERNAL_ID_MAX); if (isParse(externalId)) return externalId;
  let paidAmountKrw: number | null = null, paidAt: string | null = null;
  if (status === 'paid') {
    const a = o.paid_amount_krw;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 0) return bad('paid_amount_krw', '지급 완료에는 0 이상의 정수 원화 금액이 필요해요');
    paidAmountKrw = a;
    paidAt = isoOf(o.paid_at);
    if (!paidAt) return bad('paid_at', '지급 완료에는 ISO 8601 지급 시각이 필요해요');
  }
  return { ok: true, update: { status: status as ExternalStatus, updatedAt, note, paidAmountKrw, paidAt, externalId } };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementExternal.test.ts`
Expected: 6 pass.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/settlementExternal.ts src/lib/settlementExternal.test.ts
git commit -m "feat(settlement): 외부 API 순수 모듈 — 커서(µs)·상태 수신 파서·직렬화 한 함수

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 스토어 — `listForExport`·`getForExport`·`applyExternalStatus`

**Files:**
- Modify: `src/lib/settlementStore.ts` (끝부분에 추가)
- Test: `src/lib/settlementStore.test.ts`

**Interfaces:**
- Consumes: `Cursor`, `ExportRow`, `StatusUpdate`(Task 4), `cancelInTx`(Task 3).
- Produces:
  ```ts
  export async function listForExport(sql, cursor: Cursor | null, limit: number): Promise<ExportRow[]>
  export async function getForExport(sql, id: string): Promise<ExportRow | null>
  export type ApplyResult =
    | { kind: 'applied' | 'stale'; row: PaymentRequestRow }
    | { kind: 'conflict'; code: 'request-cancelled' | 'paid-locked'; row: PaymentRequestRow }
    | 'not-found';
  export async function applyExternalStatus(sql, id: string, u: StatusUpdate): Promise<ApplyResult>
  ```

- [ ] **Step 1: 실패하는 테스트** (`settlementStore.test.ts` 끝에; import에 `listForExport, getForExport, applyExternalStatus` 추가, `import { encodeCursor, decodeCursor } from './settlementExternal.ts';`)

```ts
async function requestFor(handle: string, campSuffix: string) {
  const m = await ensureMember();
  const c = await createClient(sql, P + '클라' + campSuffix);
  const camp = await createCampaign(sql, base(c.id, c.name, campSuffix, 'visit'));
  await influencerWithPaypal(H(handle));
  const [t] = await createTasks(sql, camp.id, { ...tin, type: 'post', items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/r/status/1' });
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, '2026-08-28')).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [row] = await createRequests(sql, [itemOf(cand, fee.sendAs)], m, '2026-08-28');
  return { row, task: t, member: m };
}
const at = (s: string) => new Date(s).toISOString();
const upd = (status: 'received' | 'scheduled' | 'paid' | 'on_hold' | 'cancelled', updatedAt: string, extra: Partial<{ note: string; paidAmountKrw: number; paidAt: string; externalId: string }> = {}) => ({
  status, updatedAt: at(updatedAt), note: extra.note ?? null, paidAmountKrw: extra.paidAmountKrw ?? null, paidAt: extra.paidAt ? at(extra.paidAt) : null, externalId: extra.externalId ?? null,
});

test('listForExport — 같은 시각에 갱신된 3건이 limit 2로 두 페이지에 빠짐없이, 커서는 µs 단위', async () => {
  const a = await requestFor('ex1', 'e1'); const b = await requestFor('ex2', 'e2'); const c = await requestFor('ex3', 'e3');
  const ids = new Set([a.row.id, b.row.id, c.row.id]);
  await sql`update payment_request set updated_at = '2030-01-01T00:00:00.000001Z' where id in ${sql([...ids])}`;   // 미래 시각 — 다른 테스트 행보다 뒤
  const startCursor = decodeCursor(encodeCursor({ updatedAtUs: String(Date.parse('2030-01-01T00:00:00Z') * 1000), id: '00000000-0000-0000-0000-000000000000' }))!;
  const p1 = await listForExport(sql, startCursor, 2);
  assert.equal(p1.length, 2);
  const c1 = { updatedAtUs: p1[1].updatedAtUs, id: p1[1].row.id };
  assert.equal(c1.updatedAtUs.endsWith('000001'), true);
  const p2 = await listForExport(sql, c1, 2);
  assert.equal(p2.length, 1);
  const got = new Set([...p1, ...p2].map((e) => e.row.id));
  assert.deepEqual(got, ids);
  assert.equal(p1[0].requester.email, null);   // 테스트 멤버는 이메일 없음
  const one = await getForExport(sql, a.row.id);
  assert.equal(one?.row.id, a.row.id);
  assert.equal(await getForExport(sql, 'nope'), null);
});

test('applyExternalStatus — 규칙표: 첫 수신 sent_at, stale 무시, paid 로그, paid 정정, paid 이후 다른 상태 409', async () => {
  const { row, member } = await requestFor('ap1', 'a1');
  const r1 = await applyExternalStatus(sql, row.id, upd('received', '2026-08-29T00:00:00Z', { externalId: 'X-9' }));
  assert.equal(r1 !== 'not-found' && r1.kind, 'applied');
  const after1 = (r1 as { row: typeof row }).row;
  assert.equal(after1.externalStatus, 'received'); assert.ok(after1.sentAt); assert.equal(after1.externalId, 'X-9');
  const sentAt = after1.sentAt;
  const stale = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-08-28T23:00:00Z'));
  assert.equal(stale !== 'not-found' && stale.kind, 'stale');
  assert.equal((stale as { row: typeof row }).row.externalStatus, 'received');
  const same = await applyExternalStatus(sql, row.id, upd('received', '2026-08-29T00:00:00Z'));   // 같은 본문 재전송
  assert.equal(same !== 'not-found' && same.kind, 'stale');
  const paid = await applyExternalStatus(sql, row.id, upd('paid', '2026-08-30T00:00:00Z', { paidAmountKrw: 29700, paidAt: '2026-08-30T00:00:00Z', note: '환율' }));
  assert.equal(paid !== 'not-found' && paid.kind, 'applied');
  const p = (paid as { row: typeof row }).row;
  assert.equal(p.paidAmountKrw, 29700); assert.equal(p.externalNote, '환율'); assert.equal(p.sentAt, sentAt);   // sent_at은 1회
  const logs = await sql<Array<{ event_type: string; payload: { paidAmountKrw?: number } }>>`
    select event_type, payload from influencer_log where influencer_id = ${row.influencerId!} and event_type = 'payment_paid'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.paidAmountKrw, 29700);
  const fix = await applyExternalStatus(sql, row.id, upd('paid', '2026-08-30T01:00:00Z', { paidAmountKrw: 29800, paidAt: '2026-08-30T00:00:00Z' }));
  assert.equal(fix !== 'not-found' && fix.kind, 'applied');
  assert.equal((fix as { row: typeof row }).row.paidAmountKrw, 29800);
  assert.equal((await sql`select count(*)::int as n from influencer_log where influencer_id = ${row.influencerId!} and event_type = 'payment_paid'`)[0].n, 1);   // 정정은 로그 안 남김
  const back = await applyExternalStatus(sql, row.id, upd('scheduled', '2026-08-30T02:00:00Z'));
  assert.equal(back !== 'not-found' && back.kind, 'conflict'); assert.equal((back as { code: string }).code, 'paid-locked');
  assert.equal(await cancelRequest(sql, row.id, '늦음', member), 'paid-locked');
  assert.equal(await applyExternalStatus(sql, '00000000-0000-0000-0000-000000000000', upd('received', '2026-08-29T00:00:00Z')), 'not-found');
  assert.equal(await applyExternalStatus(sql, 'x', upd('received', '2026-08-29T00:00:00Z')), 'not-found');
});

test('applyExternalStatus — 그쪽 취소는 우리 취소(정산 프로덕트·사유), 우리가 취소한 건에 다른 상태는 409, 취소 ack는 적용', async () => {
  const a = await requestFor('ap2', 'a2');
  const r = await applyExternalStatus(sql, a.row.id, upd('cancelled', '2026-08-29T00:00:00Z', { note: '중복 요청' }));
  assert.equal(r !== 'not-found' && r.kind, 'applied');
  const row = (r as { row: typeof a.row }).row;
  assert.equal(row.status, 'cancelled'); assert.equal(row.cancelledByName, '정산 프로덕트'); assert.equal(row.cancelReason, '중복 요청'); assert.equal(row.externalStatus, 'cancelled');
  const logs = await sql<Array<{ payload: { reason?: string } }>>`select payload from influencer_log where influencer_id = ${row.influencerId!} and event_type = 'payment_cancelled'`;
  assert.equal(logs.length, 1); assert.equal(logs[0].payload.reason, '중복 요청');
  // 취소된 작업은 다시 후보에 나온다
  const cands = await listCandidates(sql, SETTLEMENT_DEFAULTS, a.member.id, '2026-08-28');
  assert.ok(cands.some((x) => x.taskId === a.task.id));

  const b = await requestFor('ap3', 'a3');
  await cancelRequest(sql, b.row.id, '우리 취소', b.member);
  const conflict = await applyExternalStatus(sql, b.row.id, upd('scheduled', '2026-08-29T00:00:00Z'));
  assert.equal(conflict !== 'not-found' && conflict.kind, 'conflict'); assert.equal((conflict as { code: string }).code, 'request-cancelled');
  const ack = await applyExternalStatus(sql, b.row.id, upd('cancelled', '2026-08-29T00:00:00Z'));
  assert.equal(ack !== 'not-found' && ack.kind, 'applied');
  assert.equal((ack as { row: typeof b.row }).row.cancelReason, '우리 취소');   // 우리 취소 기록은 그대로
});
```
`after()`의 삭제 목록은 그대로(요청은 `influencer_handle like P%`, 로그는 인플 기준으로 지워진다).

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts 2>&1 | tail -20`
Expected: 새 테스트 3개 FAIL(export 없음).

- [ ] **Step 3: 구현** (`settlementStore.ts` 마지막 re-export 줄 위에; import에 `import type { Cursor, ExportRow, StatusUpdate } from './settlementExternal.ts';` 추가 — 타입만이라 순환 무해)

```ts
// ── 그쪽(정산 프로덕트) 연동(스펙 payment-api §5·§6) ──
// 커서 조회: (updated_at, id) 오름차순. 커서의 µs 정수를 정수 연산으로 timestamptz로 되돌려 인덱스를 그대로 탄다.
async function exportRows(sql: postgres.Sql, ids: string[], usById: Map<string, string>): Promise<ExportRow[]> {
  if (!ids.length) return [];
  const rows = await sql<RRow[]>`${R_SELECT(sql)} where id in ${sql(ids)}`;
  const memberIds = [...new Set(rows.map((r) => r.requester_member_id).filter((x): x is string => !!x))];
  const members = memberIds.length
    ? await sql<Array<{ id: string; email: string | null; slack_id: string | null }>>`select id, email, slack_id from member where id in ${sql(memberIds)}`
    : [];
  const mem = new Map(members.map((m) => [m.id, m]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is RRow => !!r).map((r) => {
    const m = r.requester_member_id ? mem.get(r.requester_member_id) : undefined;
    return { row: toRequest(r), updatedAtUs: usById.get(r.id) ?? '0', requester: { email: m?.email ?? null, slackId: m?.slack_id ?? null } };
  });
}
export async function listForExport(sql: postgres.Sql, cursor: Cursor | null, limit: number): Promise<ExportRow[]> {
  const page = await sql<Array<{ id: string; us: string }>>`
    select id, (extract(epoch from updated_at) * 1000000)::bigint::text as us
      from payment_request
     where ${cursor
       ? sql`(updated_at, id) > (to_timestamp(${cursor.updatedAtUs}::bigint / 1000000) + (${cursor.updatedAtUs}::bigint % 1000000) * interval '1 microsecond', ${cursor.id}::uuid)`
       : sql`true`}
     order by updated_at, id
     limit ${limit}`;
  return exportRows(sql, page.map((p) => p.id), new Map(page.map((p) => [p.id, p.us])));
}
export async function getForExport(sql: postgres.Sql, id: string): Promise<ExportRow | null> {
  if (!isUuidLike(id)) return null;
  const page = await sql<Array<{ id: string; us: string }>>`
    select id, (extract(epoch from updated_at) * 1000000)::bigint::text as us from payment_request where id = ${id}`;
  const [row] = await exportRows(sql, page.map((p) => p.id), new Map(page.map((p) => [p.id, p.us])));
  return row ?? null;
}

export type ApplyResult =
  | { kind: 'applied' | 'stale'; row: PaymentRequestRow }
  | { kind: 'conflict'; code: 'request-cancelled' | 'paid-locked'; row: PaymentRequestRow }
  | 'not-found';
// §6-2 규칙표. 한 트랜잭션, for update 잠금. 순서: stale → 우리 취소 충돌 → paid 종점 → 적용.
export async function applyExternalStatus(sql: postgres.Sql, id: string, u: StatusUpdate): Promise<ApplyResult> {
  if (!isUuidLike(id)) return 'not-found';
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    const cur = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id} for update`;
    if (!cur.length) return 'not-found';
    const c = cur[0];
    if (c.external_updated_at && new Date(u.updatedAt).getTime() <= new Date(c.external_updated_at).getTime()) return { kind: 'stale', row: toRequest(c) };
    if (c.status === 'cancelled' && u.status !== 'cancelled') return { kind: 'conflict', code: 'request-cancelled', row: toRequest(c) };
    if (c.external_status === 'paid' && u.status !== 'paid') return { kind: 'conflict', code: 'paid-locked', row: toRequest(c) };
    if (u.status === 'cancelled' && c.status === 'requested') {
      await cancelInTx(tx, id, { id: null, name: '정산 프로덕트' }, u.note ?? '정산에서 취소');
    }
    await tx`
      update payment_request
         set external_status = ${u.status}, paid_amount_krw = ${u.paidAmountKrw}, paid_at = ${u.paidAt}, external_note = ${u.note},
             external_updated_at = ${u.updatedAt}, external_id = coalesce(${u.externalId}, external_id),
             sent_at = coalesce(sent_at, now()), updated_at = now()
       where id = ${id}`;
    const [saved] = await tx<RRow[]>`${R_SELECT(tx)} where id = ${id}`;
    const row = toRequest(saved);
    if (u.status === 'paid' && c.external_status !== 'paid') {
      const infId = row.influencerId ?? (await tx<Array<{ id: string }>>`select id from influencer where lower(handle) = lower(${row.influencerHandle})`)[0]?.id ?? null;
      if (infId) {
        const payload: PaymentLogPayload = { requestId: row.id, amountGross: row.amountGross, currency: row.payoutCurrency, taskType: row.taskType, paidAmountKrw: u.paidAmountKrw ?? undefined };
        await insertAutoLog(tx, { influencerId: infId, eventType: 'payment_paid', draftId: null, draftTitle: null, payload, authorId: null });
      }
    }
    return { kind: 'applied', row };
  });
}
```
`src/lib/influencerStore.ts`: `InfluencerAutoEvent`에 `| 'payment_paid'`, `PaymentLogPayload`에 `paidAmountKrw?: number` 추가(문구는 Task 8).

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts 2>&1 | tail -8`
Expected: 전부 pass. `npx tsc --noEmit -p .` 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/lib/influencerStore.ts
git commit -m "feat(settlement): 외부 export 커서 조회·단건, 상태 수신 적용 규칙(stale·취소 충돌·paid 종점·그쪽 취소=우리 취소)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 라우트 — 외부 GET 목록·단건·POST 상태, 내부 PATCH paid-locked

**Files:**
- Create: `src/app/api/external/settlement/requests/route.ts`, `src/app/api/external/settlement/requests/[id]/route.ts`, `src/app/api/external/settlement/requests/[id]/status/route.ts`
- Modify: `src/app/api/settlement/requests/[id]/route.ts`

**Interfaces:**
- Consumes: `bearerAuthorized`(Task 2), `decodeCursor/encodeCursor/clampLimit/toExternalItem/parseStatusUpdate/EXTERNAL_API_VERSION`(Task 4), `listForExport/getForExport/applyExternalStatus`(Task 5).

- [ ] **Step 1: GET 목록**

```ts
// src/app/api/external/settlement/requests/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { decodeCursor, encodeCursor, clampLimit, toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { listForExport } from '@/lib/settlementStore';

// 그쪽(정산 프로덕트)이 폴링으로 가져간다 — 사람이 아니라 서버가 부르므로 세션 게이트가 아니라 공유 시크릿.
// 설계: docs/superpowers/specs/2026-08-28-payment-api-design.md §5. 그쪽 문서: docs/api/settlement-external-api.md
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';

export async function GET(req: Request) {
  if (!bearerAuthorized(req, ENV)) return new NextResponse(null, { status: 401, headers: NO_STORE });
  const url = new URL(req.url);
  const rawCursor = url.searchParams.get('cursor');
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) return NextResponse.json({ error: 'cursor 값을 해석할 수 없어요 — 응답의 next_cursor를 그대로 보내 주세요', field: 'cursor' }, { status: 400, headers: NO_STORE });
  const limit = clampLimit(url.searchParams.get('limit'));
  const rows = await listForExport(getSql(), cursor, limit);
  const last = rows.at(-1);
  return NextResponse.json({
    version: EXTERNAL_API_VERSION,
    items: rows.map(toExternalItem),
    next_cursor: last ? encodeCursor({ updatedAtUs: last.updatedAtUs, id: last.row.id }) : rawCursor,
    has_more: rows.length === limit,
  }, { headers: NO_STORE });
}
```

- [ ] **Step 2: GET 단건**

```ts
// src/app/api/external/settlement/requests/[id]/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { getForExport } from '@/lib/settlementStore';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bearerAuthorized(req, ENV)) return new NextResponse(null, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const row = await getForExport(getSql(), id);
  if (!row) return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ version: EXTERNAL_API_VERSION, item: toExternalItem(row) }, { headers: NO_STORE });
}
```

- [ ] **Step 3: POST 상태**

```ts
// src/app/api/external/settlement/requests/[id]/status/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { parseStatusUpdate, toExternalItem, EXTERNAL_API_VERSION } from '@/lib/settlementExternal';
import { applyExternalStatus, getForExport } from '@/lib/settlementStore';

// 그쪽 처리 상태·실지급액 수신(스펙 §6). 규칙 판정은 스토어(applyExternalStatus), 여기는 HTTP 매핑만.
const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';
const CONFLICT_MESSAGE = {
  'request-cancelled': '이 요청은 취소됐어요 — 다시 가져가 확인해 주세요',
  'paid-locked': '이미 지급 완료된 요청이에요',
} as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!bearerAuthorized(req, ENV)) return new NextResponse(null, { status: 401, headers: NO_STORE });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = parseStatusUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400, headers: NO_STORE });
  const sql = getSql();
  const r = await applyExternalStatus(sql, id, parsed.update);
  if (r === 'not-found') return NextResponse.json({ error: '요청을 찾을 수 없어요' }, { status: 404, headers: NO_STORE });
  const exp = await getForExport(sql, id);
  const item = exp ? toExternalItem(exp) : null;
  if (r.kind === 'conflict') return NextResponse.json({ error: CONFLICT_MESSAGE[r.code], code: r.code, request: item }, { status: 409, headers: NO_STORE });
  return NextResponse.json({ version: EXTERNAL_API_VERSION, applied: r.kind === 'applied', reason: r.kind === 'stale' ? 'stale' : undefined, request: item }, { headers: NO_STORE });
}
```

- [ ] **Step 4: 내부 PATCH — paid-locked 409**

`src/app/api/settlement/requests/[id]/route.ts`의 `already-cancelled` 줄 다음에:
```ts
  if (r === 'paid-locked') return NextResponse.json({ error: '지급 완료된 요청은 취소할 수 없어요 — 정산 담당자에게 알려 주세요' }, { status: 409 });
```

- [ ] **Step 5: 빌드로 라우트 확인 + 로컬 스모크**

Run: `npm run build 2>&1 | grep -E "external/settlement|error" | head`
Expected: 세 라우트가 `ƒ` 동적 라우트로 나열, 오류 없음.

로컬 스모크(프로덕션 DB, 읽기만): `.env`에 `SETTLEMENT_API_KEY=localtest` 임시 추가 후 `npx next start -p 3001 &` → `curl -s -H "Authorization: Bearer localtest" "http://127.0.0.1:3001/api/external/settlement/requests?limit=2" | head -c 600` → `version`, `items`, `next_cursor`, `has_more` 확인. 키 없이 호출 → 401. 끝나면 서버 종료·`.env`의 임시 줄 제거(`.env`는 git 밖).

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/external src/app/api/settlement/requests
git commit -m "feat(settlement): 외부 API 라우트 — 폴링 GET 목록·단건, 상태 POST(400/404/409), 내부 취소 paid-locked 409

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 순수 `settlementDisplay.ts` — 상태 라벨 한 곳

**Files:**
- Create: `src/lib/settlementDisplay.ts`, `src/lib/settlementDisplay.test.ts`

**Interfaces:**
- Consumes: `SettlementBadgeStatus`, `ExternalStatus`(Task 3), `kstMonthDay`(`./datetime.ts`), `formatMoney`(`./influencerPricing.ts`).
- Produces:
  ```ts
  export type DisplayKey = 'requested' | 'received' | 'scheduled' | 'on_hold' | 'paid' | 'cancelled';
  export type DisplayTone = 'blue' | 'warn' | 'done' | 'gray';
  export interface StatusSource { status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null; createdAt: string; cancelledAt: string | null }
  export interface StatusDisplay { key: DisplayKey; label: string; tone: DisplayTone; title: string }
  export function displayStatus(s: StatusSource, where: 'list' | 'campaign'): StatusDisplay;
  export const TONE_CLASS: Record<DisplayTone, string>;
  export type StatusGroup = '' | 'active' | 'on_hold' | 'paid' | 'cancelled';
  export const STATUS_GROUP_OPTIONS: ReadonlyArray<{ value: StatusGroup; label: string }>;
  export function inGroup(key: DisplayKey, g: StatusGroup): boolean;
  export function paidText(amountKrw: number, paidAmountKrw: number): string;   // '실지급 ₩29,700 (요청 ₩30,000, −300)'
  export function settlementDetail(s: StatusSource & { paidAmountKrw: number | null; paidAt: string | null; amountKrw: number }): string;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/settlementDisplay.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, inGroup, paidText, settlementDetail, type StatusSource } from './settlementDisplay.ts';

const base: StatusSource = { status: 'requested', externalStatus: null, externalNote: null, externalUpdatedAt: null, createdAt: '2026-08-28T03:00:00Z', cancelledAt: null };
const ext = (externalStatus: StatusSource['externalStatus'], note: string | null = null): StatusSource => ({ ...base, externalStatus, externalNote: note, externalUpdatedAt: '2026-08-29T03:00:00Z' });

test('displayStatus — 우리·그쪽 조합 → 라벨 하나(요청 내역)', () => {
  assert.deepEqual([displayStatus(base, 'list').key, displayStatus(base, 'list').label, displayStatus(base, 'list').tone], ['requested', '요청됨 8-28', 'blue']);
  assert.equal(displayStatus(ext('received'), 'list').label, '정산 접수 8-29');
  assert.equal(displayStatus(ext('scheduled'), 'list').label, '지급 예정');
  const hold = displayStatus(ext('on_hold', '계좌번호 다시 확인해 주세요 — 지점 코드가 없어요'), 'list');
  assert.equal(hold.key, 'on_hold'); assert.equal(hold.tone, 'warn'); assert.equal(hold.label, '보류 · 계좌번호 다시 확인해 주세요 — …');
  assert.equal(displayStatus(ext('on_hold'), 'list').label, '보류');
  const paid = displayStatus(ext('paid'), 'list');
  assert.equal(paid.label, '지급 완료 8-29'); assert.equal(paid.tone, 'done');
  const cancelled = displayStatus({ ...ext('cancelled'), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list');
  assert.equal(cancelled.label, '취소됨 8-30'); assert.equal(cancelled.tone, 'gray');
  // 우리가 취소했고 그쪽 상태가 뭐든 취소가 이긴다
  assert.equal(displayStatus({ ...ext('scheduled'), status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'list').key, 'cancelled');
});
test('displayStatus — 캠페인 표 라벨', () => {
  assert.equal(displayStatus(base, 'campaign').label, '정산 요청됨 8-28');
  assert.equal(displayStatus(ext('received'), 'campaign').label, '정산 접수 8-29');
  assert.equal(displayStatus(ext('scheduled'), 'campaign').label, '지급 예정');
  assert.equal(displayStatus(ext('on_hold', '계좌'), 'campaign').label, '정산 보류 — 확인 필요');
  assert.equal(displayStatus(ext('paid'), 'campaign').label, '지급 완료 8-29');
  assert.equal(displayStatus({ ...base, status: 'cancelled', cancelledAt: '2026-08-30T03:00:00Z' }, 'campaign').label, '취소됨');
});
test('inGroup — 진행 중은 요청됨·접수·지급 예정', () => {
  assert.ok(inGroup('requested', 'active') && inGroup('received', 'active') && inGroup('scheduled', 'active'));
  assert.ok(!inGroup('on_hold', 'active') && !inGroup('paid', 'active') && !inGroup('cancelled', 'active'));
  assert.ok(inGroup('on_hold', 'on_hold') && inGroup('paid', 'paid') && inGroup('cancelled', 'cancelled'));
  assert.ok(inGroup('paid', ''));
});
test('paidText — 차이 해석까지', () => {
  assert.equal(paidText(30000, 29700), '실지급 ₩29,700 (요청 ₩30,000, −300)');
  assert.equal(paidText(30000, 30300), '실지급 ₩30,300 (요청 ₩30,000, +300)');
  assert.equal(paidText(30000, 30000), '실지급 ₩30,000');
});
test('settlementDetail — 펼침 한 줄', () => {
  assert.equal(settlementDetail({ ...base, paidAmountKrw: null, paidAt: null, amountKrw: 30000 }), '아직 정산 쪽에서 확인 전이에요');
  assert.match(settlementDetail({ ...ext('on_hold', '계좌 확인'), paidAmountKrw: null, paidAt: null, amountKrw: 30000 }), /^보류 · .+ · 계좌 확인$/);
  assert.match(settlementDetail({ ...ext('paid', '환율'), paidAmountKrw: 29700, paidAt: '2026-08-30T05:10:00Z', amountKrw: 30000 }), /^지급 완료 · .+ · 실지급 ₩29,700 \(요청 ₩30,000, −300\) · 메모: 환율$/);
  assert.match(settlementDetail({ ...ext('scheduled'), paidAmountKrw: null, paidAt: null, amountKrw: 30000 }), /^지급 예정 · /);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementDisplay.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

```ts
// src/lib/settlementDisplay.ts
// 정산 상태 표시는 한 자리, 파생값 하나(UX 원칙 4) — 요청 내역 배지·필터·캠페인 표 배지·펼침 문구가 전부 여기서 나온다.
// 우리 상태(requested/cancelled) × 그쪽 상태(external_status) → 라벨. 내부어(on_hold 등)는 밖으로 나가지 않는다.
import type { SettlementBadgeStatus, ExternalStatus } from './campaignTaskStore.ts';
import { kstMonthDay, kstDateTime } from './datetime.ts';
import { formatMoney } from './influencerPricing.ts';

export type DisplayKey = 'requested' | 'received' | 'scheduled' | 'on_hold' | 'paid' | 'cancelled';
export type DisplayTone = 'blue' | 'warn' | 'done' | 'gray';
export interface StatusSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  createdAt: string; cancelledAt: string | null;
}
export interface StatusDisplay { key: DisplayKey; label: string; tone: DisplayTone; title: string }

export const TONE_CLASS: Record<DisplayTone, string> = {
  blue: 'bg-x-blue/10 text-x-blue-text',
  warn: 'bg-amber-50 text-amber-700',      // 신호등 🟡 톤(readinessView)
  done: 'bg-emerald-50 text-emerald-700',  // 🟢
  gray: 'bg-x-surface text-x-secondary',
};

const NOTE_PREVIEW = 20;
const preview = (note: string | null) => (note ? (note.length > NOTE_PREVIEW ? `${note.slice(0, NOTE_PREVIEW)}…` : note) : null);

export function keyOf(s: Pick<StatusSource, 'status' | 'externalStatus'>): DisplayKey {
  if (s.status === 'cancelled') return 'cancelled';
  switch (s.externalStatus) {
    case 'received': return 'received';
    case 'scheduled': return 'scheduled';
    case 'on_hold': return 'on_hold';
    case 'paid': return 'paid';
    default: return 'requested';   // null, 또는 그쪽 cancelled인데 우리가 아직 requested(적용 직후엔 생기지 않는다)
  }
}

export function displayStatus(s: StatusSource, where: 'list' | 'campaign'): StatusDisplay {
  const key = keyOf(s);
  const extDay = kstMonthDay(s.externalUpdatedAt);
  const campaign = where === 'campaign';
  switch (key) {
    case 'requested': return { key, tone: 'blue', label: `${campaign ? '정산 ' : ''}요청됨 ${kstMonthDay(s.createdAt)}`, title: campaign ? '정산 요청됨 — 클릭하면 요청 내역으로' : '정산 쪽에서 아직 확인 전' };
    case 'received': return { key, tone: 'blue', label: `정산 접수 ${extDay}`, title: '정산 쪽이 요청을 접수했어요' };
    case 'scheduled': return { key, tone: 'blue', label: '지급 예정', title: '정산 쪽이 지급을 예정해 두었어요' };
    case 'on_hold': {
      const p = preview(s.externalNote);
      return { key, tone: 'warn', label: campaign ? '정산 보류 — 확인 필요' : (p ? `보류 · ${p}` : '보류'), title: s.externalNote ?? '정산 쪽이 보류했어요' };
    }
    case 'paid': return { key, tone: 'done', label: `지급 완료 ${extDay}`, title: '지급이 끝났어요' };
    case 'cancelled': return { key, tone: 'gray', label: campaign ? '취소됨' : `취소됨 ${kstMonthDay(s.cancelledAt)}`, title: '요청이 취소됐어요' };
  }
}

export type StatusGroup = '' | 'active' | 'on_hold' | 'paid' | 'cancelled';
export const STATUS_GROUP_OPTIONS: ReadonlyArray<{ value: StatusGroup; label: string }> = [
  { value: '', label: '상태 전체' }, { value: 'active', label: '진행 중' }, { value: 'on_hold', label: '보류' }, { value: 'paid', label: '지급 완료' }, { value: 'cancelled', label: '취소됨' },
];
export function inGroup(key: DisplayKey, g: StatusGroup): boolean {
  if (g === '') return true;
  if (g === 'active') return key === 'requested' || key === 'received' || key === 'scheduled';
  return key === g;
}

const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('ko-KR')}` : `−${Math.abs(n).toLocaleString('ko-KR')}`);
export function paidText(amountKrw: number, paidAmountKrw: number): string {
  const diff = paidAmountKrw - amountKrw;
  return diff === 0 ? `실지급 ${formatMoney(paidAmountKrw, 'KRW')}` : `실지급 ${formatMoney(paidAmountKrw, 'KRW')} (요청 ${formatMoney(amountKrw, 'KRW')}, ${signed(diff)})`;
}

// 요청 내역 펼침의 '정산' 항목 한 줄
export function settlementDetail(s: StatusSource & { paidAmountKrw: number | null; paidAt: string | null; amountKrw: number }): string {
  if (!s.externalStatus) return '아직 정산 쪽에서 확인 전이에요';
  const when = kstDateTime(s.externalUpdatedAt);
  const memo = s.externalNote ? ` · 메모: ${s.externalNote}` : '';
  switch (s.externalStatus) {
    case 'received': return `정산 접수 · ${when}${memo}`;
    case 'scheduled': return `지급 예정 · ${when}${memo}`;
    case 'on_hold': return `보류 · ${when}${s.externalNote ? ` · ${s.externalNote}` : ''}`;
    case 'paid': return `지급 완료 · ${kstDateTime(s.paidAt ?? s.externalUpdatedAt)} · ${paidText(s.amountKrw, s.paidAmountKrw ?? 0)}${memo}`;
    case 'cancelled': return `정산에서 취소 · ${when}${memo}`;
  }
}
```
`kstDateTime`이 `src/lib/datetime.ts:33`에 있음 — 시그니처 `(iso: string | null) => string` 확인 후 사용. `formatMoney(30000,'KRW')`가 `₩30,000` 형식인지 `influencerPricing.ts`에서 확인(다르면 테스트 기대값을 실제 형식으로 맞춘다 — 함수를 새로 만들지 않는다).

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementDisplay.test.ts`
Expected: 5 pass.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/settlementDisplay.ts src/lib/settlementDisplay.test.ts
git commit -m "feat(settlement): 상태 표시 파생 함수 한 곳 — 우리×그쪽 상태 → 라벨·톤·그룹·실지급 문구

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 화면 — 요청 내역·캠페인 배지·활동 기록

**Files:**
- Modify: `src/app/settlement/RequestRow.tsx`, `src/app/settlement/RequestList.tsx`, `src/app/campaigns/TaskTable.tsx:173-178`, `src/app/influencers/Timeline.tsx:63-72, 85-87`

**Interfaces:**
- Consumes: `displayStatus, TONE_CLASS, STATUS_GROUP_OPTIONS, inGroup, keyOf, paidText, settlementDetail, type StatusGroup`(Task 7), `PaymentRequestRow` 외부 필드(Task 3), `SettlementBadge`(Task 3), `PaymentLogPayload.paidAmountKrw`(Task 5).

- [ ] **Step 1: RequestRow — 배지·둘째 줄·정산 항목·취소 버튼**

import 추가: `import { displayStatus, TONE_CLASS, paidText, settlementDetail } from '@/lib/settlementDisplay';`
함수 첫 줄들:
```tsx
  const cancelled = r.status === 'cancelled';
  const paid = r.externalStatus === 'paid';
  const st = displayStatus(r, 'list');
```
상태 배지 `<span className={`rounded-full … ${cancelled ? … : …}`}>…</span>`를:
```tsx
          <span className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${TONE_CLASS[st.tone]}`} title={st.title}>{st.label}</span>
```
둘째 줄:
```tsx
        <div className="mt-1 pl-0 text-ui text-x-muted">마감 {r.deadlineOn} · 요청자 {r.requesterName}{paid && r.paidAmountKrw !== null && <> · {paidText(r.amountKrw, r.paidAmountKrw)}</>}</div>
```
`<Item k="메모" …/>` 다음 줄에:
```tsx
            <Item k="정산" v={settlementDetail(r)} />
```
취소 버튼 줄을:
```tsx
            {!cancelled && (paid
              ? <span className="text-x-secondary">지급 완료된 요청은 취소할 수 없어요 — 정산 담당자에게 알려 주세요</span>
              : <Button onClick={onCancel}>취소</Button>)}
```

- [ ] **Step 2: RequestList — 상태 필터를 그룹으로**

import: `import { STATUS_GROUP_OPTIONS, inGroup, keyOf, type StatusGroup } from '@/lib/settlementDisplay';` (`RequestStatus` import 제거)
filter 타입 `status: StatusGroup`. `filtered`의 상태 조건을 `&& inGroup(keyOf(r), filter.status)`로. select를:
```tsx
        <select className={SEL} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as StatusGroup })} aria-label="상태">
          {STATUS_GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
```

- [ ] **Step 3: TaskTable 배지**

import 추가: `import { displayStatus, TONE_CLASS } from '@/lib/settlementDisplay';` (`kstMonthDay`가 다른 곳에서 안 쓰이면 import 정리). 173-178을:
```tsx
                        {t.settlement && (() => { const st = displayStatus(t.settlement, 'campaign'); return (
                          <Link href={`/settlement?tab=requests&task=${t.id}`} className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${TONE_CLASS[st.tone]}`} title={st.title}>{st.label}</Link>
                        ); })()}
```

- [ ] **Step 4: Timeline — payment_paid**

`case 'payment_cancelled'` 블록 뒤에:
```tsx
    case 'payment_paid': {
      const p = l.payload as PaymentLogPayload | null;
      if (!p) return <>지급 완료</>;
      return <>지급 완료 · {formatMoney(p.amountGross, p.currency)}{typeof p.paidAmountKrw === 'number' ? <> → 실지급 {formatMoney(p.paidAmountKrw, 'KRW')}</> : null}</>;
    }
```
`groupText`에 `case 'payment_paid': return \`지급 완료 ${n}건\`;`. Timeline이 이벤트 종류를 필터/아이콘 등 다른 `Record<InfluencerAutoEvent, …>`에서 쓰면 타입 오류가 알려준다 — 그 자리에도 `payment_paid`를 채운다.

- [ ] **Step 5: 타입·린트·빌드·전체 테스트**

Run: `npx tsc --noEmit -p . && npm run lint 2>&1 | tail -2 && npm run build 2>&1 | tail -3`
Expected: 오류 0, 린트 경고 기준선 유지, 빌드 성공.
Run: `npm test 2>&1 | tail -6`
Expected: 기존 858 + 새 테스트 전부 pass, fail 0.

- [ ] **Step 6: 화면 확인(로컬, 프로덕션 DB 읽기)**

`npm run build && npx next start -p 3001` → 127.0.0.1:3001/settlement?tab=requests — 기존 요청 1건이 `요청됨 8-28`로 보이고 펼치면 `정산  아직 정산 쪽에서 확인 전이에요`, 필터에 5옵션. 캠페인 상세의 배지가 `정산 요청됨 8-28` 그대로. 종료.

- [ ] **Step 7: 커밋**

```bash
git add src/app/settlement/RequestRow.tsx src/app/settlement/RequestList.tsx src/app/campaigns/TaskTable.tsx src/app/influencers/Timeline.tsx
git commit -m "feat(settlement): 그쪽 처리 상태를 요청 내역·캠페인 배지·활동 기록에 — 라벨 한 곳 파생, 지급 완료 건 취소 문구

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: 스테이징 스크립트 — 가드·셋업·시드·배포·스모크

**Files:**
- Create: `scripts/stagingGuard.ts`, `scripts/setup-staging.ts`, `scripts/seed-staging.ts`, `scripts/deploy-staging.sh`, `scripts/smoke-external-api.ts`
- Modify: `package.json` scripts

**Interfaces:**
- Consumes: `createClient`(`clientStore.ts:43`), `createCampaign`(`campaignStore.ts:143`), `createTasks/updateTask`(`campaignTaskStore.ts:110,138`), `createInfluencer/updatePaymentMethods`(`influencerStore.ts:156,413`), `listCandidates/createRequests/cancelRequest`, `SETTLEMENT_DEFAULTS`. 시그니처는 `src/lib/settlementStore.test.ts:36-110`의 사용례를 그대로 따른다.
- `.env.staging`에 추가 변수: `STAGING_DB_REF=<staging project ref>`, `STAGING_VERCEL_PROJECT_ID=prj_…`, `STAGING_VERCEL_ORG_ID=team_MQ62JGhU2pkfGiuqMpvdvaY0`.

- [ ] **Step 1: 가드**

```ts
// scripts/stagingGuard.ts
// 스테이징 전용 스크립트의 첫 줄 — 대상 DB가 스테이징 프로젝트가 아니면 즉시 종료. 프로덕션에는 돌 수 없다(스펙 §3-3).
export function assertStaging(): void {
  const ref = process.env.STAGING_DB_REF ?? '';
  const host = process.env.PGHOST ?? '';
  const url = process.env.SUPABASE_URL ?? '';
  if (!ref || (!host.includes(ref) && !url.includes(ref))) {
    console.error(`스테이징이 아니에요 — STAGING_DB_REF(${ref || '없음'})가 PGHOST/SUPABASE_URL에 없어요. .env.staging으로 실행하세요.`);
    process.exit(2);
  }
  if (host.includes('xdwtehjlxsnntsuizxba') || url.includes('xdwtehjlxsnntsuizxba')) {   // 프로덕션 ref — 이중 벽
    console.error('프로덕션 DB예요 — 중단합니다.');
    process.exit(2);
  }
}
```

- [ ] **Step 2: 셋업(Storage 버킷)**

```ts
// scripts/setup-staging.ts — 마이그레이션이 만들지 않는 것: Storage 버킷(원고 이미지). 멱등.
import { createClient } from '@supabase/supabase-js';
import { assertStaging } from './stagingGuard.ts';
import { DRAFT_MEDIA_BUCKET } from '../src/lib/draftMedia.ts';

assertStaging();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: buckets, error } = await supabase.storage.listBuckets();
if (error) { console.error(error.message); process.exit(1); }
if (buckets.some((b) => b.name === DRAFT_MEDIA_BUCKET)) console.log(`버킷 있음: ${DRAFT_MEDIA_BUCKET}`);
else {
  const r = await supabase.storage.createBucket(DRAFT_MEDIA_BUCKET, { public: false });
  if (r.error) { console.error(r.error.message); process.exit(1); }
  console.log(`버킷 생성: ${DRAFT_MEDIA_BUCKET}`);
}
```
`DRAFT_MEDIA_BUCKET`이 `src/lib/draftMedia.ts:9`에 export 되어 있음. 프로덕션 버킷이 public인지 콘솔에서 확인해 같은 값으로.

- [ ] **Step 3: 시드**

```ts
// scripts/seed-staging.ts — 가짜 데이터(스펙 §3-3). 전부 seed_ 접두어, 재실행 시 지우고 다시. 요청은 실제 createRequests로.
import { getSql } from '../src/lib/db.ts';
import { assertStaging } from './stagingGuard.ts';
import { createClient } from '../src/lib/clientStore.ts';
import { createCampaign } from '../src/lib/campaignStore.ts';
import { createTasks, updateTask } from '../src/lib/campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { SETTLEMENT_DEFAULTS } from '../src/lib/settlementSettings.ts';
import { listCandidates, createRequests, cancelRequest, type CreateItemInput } from '../src/lib/settlementStore.ts';
import type { PaymentMethodInput } from '../src/lib/influencerPayment.ts';

assertStaging();
const sql = getSql();
const S = 'seed_';

async function wipe() {
  await sql`delete from payment_request where influencer_handle like ${S + '%'}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${S + '%'})`;
  await sql`delete from campaign where name like ${S + '%'}`;
  await sql`delete from client where name like ${S + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${S + '%'})`;
  await sql`delete from influencer where handle like ${S + '%'}`;
  await sql`delete from member where email like ${S + '%'}`;
}

const METHODS: Array<{ handle: string; pm: PaymentMethodInput }> = [
  { handle: S + 'sakura_p', pm: { type: 'paypal', holder: 'SAKURA TEST', currency: 'JPY', email: 'seed_sakura@example.com', fee: { mode: 'grossUp', percent: 5 } } },
  { handle: S + 'yuki_pp', pm: { type: 'paypay', holder: 'YUKI TEST', currency: 'JPY', identifier: 'seed-paypay-0000' } },
  { handle: S + 'hana_jp', pm: { type: 'bank', holder: 'HANA TEST', currency: 'JPY', bank: 'テスト銀行', branch: '000', account: '0000000', fee: { mode: 'fixed', amount: 165 } } },
  { handle: S + 'minji_kr', pm: { type: 'bank', holder: '민지 테스트', currency: 'KRW', bank: '테스트은행', account: '000-0000-0000' } },
  { handle: S + 'rin_p', pm: { type: 'paypal', holder: 'RIN TEST', currency: 'JPY', paypalId: 'seedrin' } },
  { handle: S + 'aoi_kr', pm: { type: 'bank', holder: '아오이 테스트', currency: 'KRW', bank: '테스트은행', account: '111-1111-1111' } },
];
// PaymentMethodType 값('paypal'|'paypay'|'bank' 등)은 src/lib/influencerPayment.ts의 실제 타입에 맞춘다.

await wipe();
const [m1] = await sql<Array<{ id: string; name: string }>>`insert into member (name, color, email) values ('시드 모에카', '#1d9bf0', ${S + 'moeka@example.com'}) returning id, name`;
await sql`insert into member (name, color, email, slack_id) values ('시드 권오윤', '#f91880', ${S + 'oyun@example.com'}, 'U000SEED')`;
const clients = await Promise.all(['seed_마인드피부과', 'seed_라온성형외과', 'seed_봄빛의원'].map((n) => createClient(sql, n)));
for (const { handle, pm } of METHODS) {
  const { row } = await createInfluencer(sql, { handle, createdBy: null });
  await updatePaymentMethods(sql, row.id, { kind: 'add', input: pm, makeDefault: true }, null);
}
const camp1 = await createCampaign(sql, { clientId: clients[0].id, clientName: clients[0].name, name: S + '8월 방문협찬', nameEn: 'seed-visit-aug', startsOn: '2026-08-24', endsOn: '2026-08-30', kind: 'visit', note: '', createdBy: null });
const camp2 = await createCampaign(sql, { clientId: clients[1].id, clientName: clients[1].name, name: S + '여름 프로모션', nameEn: 'seed-summer-promo', startsOn: '2026-08-24', endsOn: '2026-09-06', kind: 'content', note: '', createdBy: null });
const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
const posts = await createTasks(sql, camp1.id, { ...tin, type: 'post', items: METHODS.slice(0, 4).map((m, i) => ({ handle: m.handle, cost: { amount: 200000 + i * 10000, currency: 'KRW' } })) });
const rts = await createTasks(sql, camp2.id, { ...tin, type: 'rt', items: METHODS.map((m, i) => ({ handle: m.handle, cost: { amount: 30000 + i * 1000, currency: 'KRW' } })) });
for (const [i, t] of [...posts, ...rts].entries()) {
  await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: `https://x.com/${S}${i}/status/${1000 + i}` });
}
const cands = await listCandidates(sql, SETTLEMENT_DEFAULTS, m1.id, '2026-08-28');
const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
const promo = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'promo-rt')!;
const pick = cands.filter((c) => c.influencerHandle.startsWith(S) && c.money && c.method).slice(0, 6);
const items: CreateItemInput[] = pick.map((c) => ({
  taskId: c.taskId, category: c.taskType === 'rt' ? promo.sendAs : fee.sendAs, deadlineOn: c.deadlineDefault, referenceUrl: c.referenceDefault,
  expected: { amountGross: c.money!.amountGross, payoutCurrency: c.money!.payoutCurrency, paymentMethodId: c.method!.id },
}));
const created = await createRequests(sql, items, { id: m1.id, name: m1.name }, '2026-08-28');
await cancelRequest(sql, created[4].id, '금액 착오 — 다시 요청 예정', { id: m1.id, name: m1.name });
await cancelRequest(sql, created[5].id, '인플루언서 요청으로 취소', { id: m1.id, name: m1.name });
console.log(`시드 완료 — 클라 ${clients.length} · 인플 ${METHODS.length} · 작업 ${posts.length + rts.length} · 요청 ${created.length}(취소 2)`);
await sql.end();
```
`createCampaign`·`createTasks` 입력 모양은 `settlementStore.test.ts:36-39`의 `base`/`tin`과 동일하게 맞춘다(타입 오류가 알려준다). 옵션 id(`fee`/`promo-rt`)는 `settlementSettings.ts`에서 확인.

- [ ] **Step 4: 배포 스크립트**

```bash
#!/usr/bin/env bash
# 스테이징 배포 — 링크 파일(.vercel/project.json)에 의존하지 않고 프로젝트 ID를 env로 고정한다(엉뚱한 프로젝트 배포 방지, 스펙 §3-2).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env.staging; set +a
: "${STAGING_VERCEL_PROJECT_ID:?.env.staging에 STAGING_VERCEL_PROJECT_ID가 필요해요}"
: "${STAGING_VERCEL_ORG_ID:?.env.staging에 STAGING_VERCEL_ORG_ID가 필요해요}"
if [ "$STAGING_VERCEL_PROJECT_ID" = "prj_CoEqjNZytAqwaXXdgAxw2SgiEL34" ]; then echo "프로덕션 프로젝트 ID예요 — 중단" >&2; exit 2; fi
export VERCEL_ORG_ID="$STAGING_VERCEL_ORG_ID" VERCEL_PROJECT_ID="$STAGING_VERCEL_PROJECT_ID"
echo "== deploy → staging project $VERCEL_PROJECT_ID"
npx vercel@58.9.1 --prod --yes --scope clinic-bridge
```
`chmod +x scripts/deploy-staging.sh`.

- [ ] **Step 5: 스모크**

```ts
// scripts/smoke-external-api.ts — 사용: node --import tsx scripts/smoke-external-api.ts <BASE_URL> <API_KEY>
// 스테이징에서 외부 API 계약을 처음부터 끝까지 한 번 돈다(스펙 §9). 마지막 표에서 ✗가 하나라도 있으면 exit 1.
const [base, key] = process.argv.slice(2);
if (!base || !key) { console.error('사용: smoke-external-api.ts <BASE_URL> <API_KEY>'); process.exit(2); }
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
type Row = { step: string; expect: string; got: string; ok: boolean };
const rows: Row[] = [];
const check = (step: string, expect: number, got: number, extra = '') => rows.push({ step, expect: String(expect), got: `${got}${extra ? ' ' + extra : ''}`, ok: expect === got });

const r0 = await fetch(`${base}/api/external/settlement/requests?limit=2`);
check('키 없음 → 401', 401, r0.status);
const r1 = await fetch(`${base}/api/external/settlement/requests?limit=2`, { headers: H });
const j1 = await r1.json();
check('목록 1페이지', 200, r1.status, `items=${j1.items?.length} has_more=${j1.has_more}`);
const r2 = await fetch(`${base}/api/external/settlement/requests?limit=2&cursor=${encodeURIComponent(j1.next_cursor)}`, { headers: H });
const j2 = await r2.json();
check('커서 이어받기', 200, r2.status, `items=${j2.items?.length}`);
const target = j1.items?.find((it: { status: string; settlement: { status: string | null } }) => it.status === 'requested' && !it.settlement.status) ?? j1.items?.[0];
if (!target) { console.error('요청이 없어요 — 먼저 npm run seed:staging'); process.exit(1); }
const id = target.request_id;
const r3 = await fetch(`${base}/api/external/settlement/requests/${id}`, { headers: H });
check('단건', 200, r3.status);
const now = new Date().toISOString();
const post = (body: unknown) => fetch(`${base}/api/external/settlement/requests/${id}/status`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const r4 = await post({ status: 'received', updated_at: now, external_id: 'SMOKE-1' });
check('received 적용', 200, r4.status, `applied=${(await r4.json()).applied}`);
const r5 = await post({ status: 'received', updated_at: now, external_id: 'SMOKE-1' });
check('같은 본문 재전송 → applied:false', 200, r5.status, `applied=${(await r5.json()).applied}`);
const r6 = await post({ status: 'paid', updated_at: new Date(Date.now() + 1000).toISOString(), paid_at: now });
check('paid인데 금액 없음 → 400', 400, r6.status, `field=${(await r6.json()).field}`);
const r7 = await post({ status: 'paid', updated_at: new Date(Date.now() + 2000).toISOString(), paid_amount_krw: target.amount_krw - 300, paid_at: now, note: '스모크 — 환율 차이' });
check('paid 적용', 200, r7.status);
const r8 = await post({ status: 'scheduled', updated_at: new Date(Date.now() + 3000).toISOString() });
check('paid 이후 다른 상태 → 409', 409, r8.status, `code=${(await r8.json()).code}`);
const r9 = await fetch(`${base}/api/external/settlement/requests/00000000-0000-0000-0000-000000000000`, { headers: H });
check('없는 id → 404', 404, r9.status);

console.table(rows.map((r) => ({ 단계: r.step, 기대: r.expect, 결과: r.got, 판정: r.ok ? '✓' : '✗' })));
console.log(`대상 요청: ${id} — 스테이징 요청 내역에서 '지급 완료' 배지·실지급 차이(−300)를 확인하세요.`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
```

- [ ] **Step 6: package.json scripts**

```json
"migrate:staging": "bash scripts/apply-migrations.sh .env.staging",
"setup:staging": "node --import tsx --env-file=.env.staging scripts/setup-staging.ts",
"seed:staging": "node --import tsx --env-file=.env.staging scripts/seed-staging.ts",
"deploy:staging": "bash scripts/deploy-staging.sh",
"smoke:external": "node --import tsx scripts/smoke-external-api.ts"
```
(`migrate:staging`은 Task 1에서 넣었으면 중복 추가하지 않는다.)

- [ ] **Step 7: 타입 확인 + 가드 동작 확인(프로덕션 env로 실행하면 종료해야 한다)**

Run: `npx tsc --noEmit -p . && node --import tsx --env-file-if-exists=.env scripts/seed-staging.ts; echo "exit=$?"`
Expected: 타입 오류 0. 시드는 `스테이징이 아니에요 …` 출력 후 `exit=2` — **프로덕션에 아무것도 쓰지 않는다**. `psql -Atc "select count(*) from client where name like 'seed_%'"` → 0.

- [ ] **Step 8: 커밋**

```bash
git add scripts/stagingGuard.ts scripts/setup-staging.ts scripts/seed-staging.ts scripts/deploy-staging.sh scripts/smoke-external-api.ts package.json
git commit -m "chore(staging): 스테이징 가드·Storage 셋업·가짜 데이터 시드·ID 고정 배포·외부 API 스모크 스크립트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: 그쪽 전달 문서 + 업데이트 소식

**Files:**
- Create: `docs/api/settlement-external-api.md`
- Modify: `src/content/updates.ts`(맨 위에 2건)

- [ ] **Step 1: 문서 작성** — 스펙 §5·§6·§11을 그쪽 개발자가 읽는 문장으로. 구성(각 절에 실제 내용):
  1. 개요·용어(우리가 원본, 그쪽은 미러; 스테이징 URL `https://cb-x-deck-staging.vercel.app`, 운영 URL `https://cb-x-deck.vercel.app`; 키는 1:1 채널로 전달, 회전 = 교체·재배포)
  2. 인증 `Authorization: Bearer <key>`; 실패 401 본문 없음
  3. `GET /api/external/settlement/requests` — 파라미터·응답 봉투·폴링 절차(커서 항상 저장, has_more면 즉시 다음, 아니면 다음 주기(권장 5분); 첫 호출은 cursor 없이 전량)·멱등(request_id upsert)·정렬 기준은 updated_at, revision은 정렬용 아님
  4. `GET /api/external/settlement/requests/{request_id}`
  5. Item 필드표(스펙 §5-3 그대로 + 각 필드 한 줄 설명; `payer`/`cc` 없음; `amount_krw`는 우리 확정값(환율 = 우리 설정 스냅샷); `payout.gross`가 실제 송금액)
  6. `POST /api/external/settlement/requests/{request_id}/status` — 본문 표·규칙표(§6-2를 그쪽 시점으로: 200 applied / 200 applied:false stale / 400 field / 404 / 409 request-cancelled / 409 paid-locked)·그쪽 의무(§6-3)
  7. 상태 뜻(received 접수 · scheduled 지급예정 · paid 완료 · on_hold 보류(사유를 note에) · cancelled 취소) — 수정 요청은 on_hold + note
  8. 버저닝(`version: 1`, 파손 변경은 `/v2`) · 문의 채널은 운영 결정
  9. curl 예시 3개(목록·상태 POST·409)

- [ ] **Step 2: updates.ts 2건** (맨 위, 날짜는 머지 예정일 — 머지 시 조정)

```ts
  {
    date: '2026-09-01', type: '개선',
    title: '정산 요청이 어디까지 처리됐는지 배지로 볼 수 있어요',
    summary: '정산팀이 그쪽 프로그램에서 상태를 바꾸면 우리 요청 내역과 캠페인 작업 표의 배지가 따라 바뀌어요. 담당자가 따로 할 일은 없어요.',
    bullets: [
      '요청됨 → 정산 접수 → 지급 예정 → 지급 완료 순서로 바뀌고, 지급 완료면 실제 지급 금액과 요청 금액의 차이가 함께 보여요',
      '정산팀이 문제를 발견하면 "보류"와 이유가 노란 배지로 떠요 — 확인 후 취소하고 다시 요청하면 돼요',
      '지급이 끝난 요청은 취소할 수 없어요(버튼 대신 안내 문장) — 정산 담당자에게 알려 주세요',
      '상태 필터에 진행 중·보류·지급 완료가 생겼어요',
    ],
    link: { label: '정산', href: '/settlement?tab=requests' },
  },
  {
    date: '2026-09-01', type: '내부',
    title: '정산 프로그램이 결제 요청을 가져가고 처리 상태를 알려 주는 연결 통로를 만들었어요',
    summary: '결제 요청을 정산 프로그램이 주기적으로 가져가고, 처리 상태와 실제 지급액을 우리에게 돌려줘요. 담당자가 하는 일은 그대로(요청 만들기까지)예요.',
    bullets: [
      '연습용 서버(스테이징)가 생겼어요 — 앞으로 새 기능은 실데이터에 손대지 않고 먼저 확인해요',
      '요청에 인플루언서 고유 ID와 분류 코드가 함께 저장돼 이름이 바뀌어도 정산 쪽 집계가 이어져요',
    ],
  },
```

- [ ] **Step 3: 검증·커밋**

Run: `node --import tsx --test src/lib/updates.test.ts && npx tsc --noEmit -p .`
Expected: pass.
```bash
git add docs/api/settlement-external-api.md src/content/updates.ts
git commit -m "docs(payment-api): 그쪽 전달용 외부 API 문서 + 업데이트 소식 2건(개선·내부)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 스테이징 인프라 생성·적용·시드·스모크 (메인 세션이 직접 — 서브에이전트 아님)

**Files:** `.env.staging`(git 밖) · Vercel 프로젝트 · Supabase 프로젝트

- [ ] **Step 1: Supabase 스테이징 프로젝트** — `supabase projects create cb-x-deck-staging --org-id jlsetstofdcgpahulhjh --region ap-southeast-1 --db-password "$(openssl rand -base64 24)"`(비밀번호 즉시 `.env.staging`에). 완료 후 `supabase projects api-keys --project-ref <ref>`로 anon·service_role 키.
- [ ] **Step 2: `.env.staging` 작성** — `.env`를 복사해 `PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT(6543 트랜잭션 풀러)`, `SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL/SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY`를 스테이징 값으로, `SETTLEMENT_API_KEY=$(openssl rand -hex 32)`(새 값), `STAGING_DB_REF=<ref>`, `STAGING_VERCEL_ORG_ID=team_MQ62JGhU2pkfGiuqMpvdvaY0`. 외부 서비스 키는 그대로.
- [ ] **Step 3: DB** — `npm run migrate:staging` → `npm run setup:staging` → `npm run seed:staging`.
- [ ] **Step 4: Vercel 프로젝트** — `vercel project add cb-x-deck-staging --scope clinic-bridge` → `vercel project ls`로 ID 확인 → `.env.staging`에 `STAGING_VERCEL_PROJECT_ID`. 환경 변수 등록: `.env.staging`의 앱 변수(PG*, SUPABASE*, SETTLEMENT_API_KEY, 외부 서비스 키)를 `VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… vercel env add <NAME> production --scope clinic-bridge`로(값은 stdin). `vercel.json`의 `regions: ["sin1"]`은 그대로 적용된다.
- [ ] **Step 5: 배포** — `npm run deploy:staging` → 출력 URL을 `vercel alias set <url> cb-x-deck-staging.vercel.app`.
- [ ] **Step 6: koo 콘솔(스펙 §3-4)** — ① 조직 플랜 확인 ② 스테이징 프로젝트 Auth → Google 제공자 켜기(기존 클라이언트 ID·시크릿) ③ Google Cloud OAuth 클라이언트에 `https://<ref>.supabase.co/auth/v1/callback` 추가 ④ Data API 비활성. Supabase Auth의 Site URL·Redirect URLs에 `https://cb-x-deck-staging.vercel.app/**`.
- [ ] **Step 7: 스모크** — `npm run smoke:external -- https://cb-x-deck-staging.vercel.app <SETTLEMENT_API_KEY>` → 표 전부 ✓. koo가 스테이징에 로그인해 요청 내역에서 `지급 완료` 배지·실지급 차이 확인(QA).
- [ ] **Step 8: 메모리 갱신** — `cb-x-deck-payment-api`에 스테이징 ref·URL·명령, `cb-x-deck-verification-loop`에 "QA는 스테이징에서" 추가.

---

## 자기 검토

- 스펙 대응: §3 → Task 1(마이그레이션 인자)·9·11 / §4 → 1·3·5 / §5 → 2·4·5·6 / §6 → 4·5·6 / §7 → 7·8 / §8 파일표 전부 배정 / §9 → 각 작업 테스트 + Task 9 스모크 / §10 → 10·11 / §11·§12 문서.
- 타입 일관성: `ExternalStatus`·`EXTERNAL_STATUSES`·`SettlementBadge`는 campaignTaskStore 정의·settlementStore re-export; `ExportRow`·`Cursor`·`StatusUpdate`는 settlementExternal 정의·store가 type import; `cancelInTx`는 export 안 함(Task 3·5 같은 파일).
- 순환 import: settlementStore → settlementExternal(type only) ← 없음(settlementExternal은 settlementStore에서 `EXTERNAL_STATUSES`를 값 import) — 값 import가 순환이 되므로 **settlementExternal은 `EXTERNAL_STATUSES`·`ExternalStatus`를 `./campaignTaskStore.ts`에서 직접 import**한다(Task 4 코드의 import 두 줄을 그렇게 고쳐 쓴다). settlementDisplay도 campaignTaskStore에서.
