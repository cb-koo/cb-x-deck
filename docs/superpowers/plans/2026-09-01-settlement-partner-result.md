# 정산 프로덕트가 보낸 결과 기록·차액 확인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정산 프로덕트가 보낸 본문을 잃지 않게 남기고, 실지급액이 실제 송금액과 다르면 담당자가 확인하고 지나가게 한다.

**Architecture:** 새 표는 없다 — 기존 두 표에 칸 4개(`external_api_log.body`, `payment_request.diff_ack_at`·`diff_ack_by_name`)를 더한다. 차액 판정은 `settlementDisplay`의 파생값 하나에서만 나오고(목록 배지·필터·캠페인 표가 같은 값을 쓴다), 확인 행위는 기존 `PATCH /api/settlement/requests/[id]`에 `action`을 더해 처리한다. 호출 기록 유실은 `next/server`의 `after()`로 막는다.

**Tech Stack:** Next.js 16.2.10 (App Router, Route Handlers), postgres.js, node:test + tsx, Tailwind, Supabase Postgres(트랜잭션 모드 풀러)

**Spec:** `docs/superpowers/specs/2026-09-01-settlement-partner-result-design.md`

## Global Constraints

- **이 저장소의 Next.js는 훈련 데이터와 다르다.** 새 API를 쓰기 전 `node_modules/next/dist/docs/`의 해당 문서를 읽는다(`AGENTS.md`). `after()` 문서: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
- **UX 문구 규칙(`AGENTS.md`):** 내부어(`gross_krw`·`diff_ack`·`paid` 등)를 라벨에 쓰지 않는다. 숫자만 던지지 말고 판단까지 쓴다. 라벨과 값을 항상 일치시킨다(파생값 하나로 통일).
- **차액 = `paid_amount_krw` − `gross_krw`.** `amount_krw`(수수료 제외 순액)와 비교하지 않는다. 이것이 이 작업의 첫 항목이자 기존 결함 수정이다.
- **외부 API 계약은 한 글자도 바뀌지 않는다.** `toExternalItem`에 확인 필드를 넣지 않는다.
- **확인·확인 취소는 `payment_request.updated_at`을 건드리지 않는다.** 건드리면 그쪽 폴링에 무의미한 변경이 흘러간다.
- **테스트는 실 DB를 쓴다.** 픽스처 접두는 `'tst' + 용도 + process.pid`, `after()`에서 지운다(기존 관례).
- 단일 파일 테스트: `node --import tsx --env-file-if-exists=.env --test <파일>` (수 초). 전체: `npm test` (약 4분).
- 린트: `npm run lint` — **기준선 24개**(표 컨테이너 예외 2건 포함). 이보다 늘면 내 변경이 만든 것이다.
- 마이그레이션 번호는 **046**. 적용: `npm run migrate`(운영), `npm run migrate:staging`.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `migrations/046_settlement_partner_result.sql` | 칸 4개 추가 | 생성 |
| `src/lib/settlementDisplay.ts` | 정산 상태·금액 문구의 **유일한** 출처(순수) | 수정 |
| `src/lib/settlementDisplay.test.ts` | 위 순수 함수 검증 | 수정 |
| `src/lib/settlementStore.ts` | `payment_request` 읽기·쓰기 | 수정 |
| `src/lib/settlementStore.test.ts` | 스토어 규칙 검증(실 DB) | 수정 |
| `src/lib/campaignTaskStore.ts` | 캠페인 표 정산 배지 조회 | 수정 |
| `src/lib/externalApiLog.ts` | 호출 기록 DB 쓰기·읽기(서버 전용) | 수정 |
| `src/lib/externalApiLogAfter.ts` | **라우트 전용** 기록 예약 래퍼(`after()`) | 생성 |
| `src/lib/externalApiLog.test.ts` | 기록 저장·조회 검증 | 수정 |
| `src/lib/externalLogCopy.ts` | 호출 기록 화면 문구(순수, 클라이언트 안전) | 수정 |
| `src/app/api/external/settlement/requests/**` | 외부 API 라우트 3개 | 수정(import 경로·본문 전달) |
| `src/app/api/settlement/requests/[id]/route.ts` | 취소 + **차액 확인** action | 수정 |
| `src/app/api/settlement/external-log/route.ts` | 호출 기록 조회 + 필터 | 수정 |
| `src/lib/settlementApi.ts` | 화면용 fetch 래퍼 | 수정 |
| `src/app/settlement/RequestRow.tsx` | 요청 한 행 + 펼침 두 블록 | 수정 |
| `src/app/settlement/PartnerResultBlock.tsx` | **그쪽이 보낸 결과** 블록(펼침 하단) | 생성 |
| `src/app/settlement/RequestList.tsx` | 목록·필터·상단 요약 | 수정 |
| `src/app/settlement/ExternalLogTab.tsx` | 호출 기록 표 | 수정 |
| `src/content/updates.ts` | 업데이트 소식 | 수정 |

`PartnerResultBlock.tsx`를 따로 만드는 이유: `RequestRow.tsx`가 이미 100줄이 넘고, 이번에 붙는 블록은 자체 상태(확인 중 로딩·오류)를 갖는다. 한 파일에 넣으면 두 책임이 섞인다.

---

## Task 1: 차액 기준을 실제 송금액으로 바로잡기 (기존 결함)

지금 화면은 실지급액을 `amount_krw`(수수료 **제외** 순액)와 비교해, 정확히 일치한 지급을 차액 있는 것처럼 보여준다. 8/31 실제 건: `amount_krw` 30,000 · `gross_krw` 31,650 · 실지급 31,650 → 화면에는 `+1,650`으로 나온다.

**Files:**
- Modify: `src/lib/settlementDisplay.ts:63-79`
- Modify: `src/app/settlement/RequestRow.tsx:31`, `:61`
- Test: `src/lib/settlementDisplay.test.ts`

**Interfaces:**
- Consumes: `PaymentRequestRow.grossKrw: number`(이미 있음, 045 생성 컬럼에서 `Number()`로 변환됨)
- Produces: `paidText(grossKrw: number, paidAmountKrw: number): string`, `settlementDetail(s: StatusSource & { paidAmountKrw: number | null; paidAt: string | null; grossKrw: number }): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/settlementDisplay.test.ts` 맨 아래에 추가:

```ts
test('paidText — 실제 송금액과 비교한다(수수료를 차액으로 오해하지 않는다)', () => {
  // 8/31 실제 건: 순액 30,000 / 송금액 31,650 / 실지급 31,650 → 차액 없음
  assert.equal(paidText(31650, 31650), '실지급 31,650원');
  assert.equal(paidText(31650, 30000), '실지급 30,000원 (송금액 31,650원, −1,650)');
  assert.equal(paidText(31650, 33000), '실지급 33,000원 (송금액 31,650원, +1,350)');
});

test('settlementDetail — 지급 완료 줄도 송금액과 비교한다', () => {
  const s = { ...ext('paid'), paidAmountKrw: 31650, paidAt: '2026-08-31T10:59:00Z', grossKrw: 31650 };
  assert.ok(settlementDetail(s).includes('실지급 31,650원'));
  assert.ok(!settlementDetail(s).includes('송금액'), '차액이 없으면 비교값을 쓰지 않는다');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementDisplay.test.ts`
Expected: FAIL — `'실지급 31,650원 (요청 31,650원, +0)'`류 불일치 또는 타입 오류(`grossKrw` 없음)

- [ ] **Step 3: 순수 함수를 고친다**

`src/lib/settlementDisplay.ts`의 `paidText`·`settlementDetail`을 이렇게 바꾼다(인자 이름과 라벨을 함께 바꾼다):

```ts
// 그쪽 실지급액은 우리가 '실제로 보낸 금액'(gross_krw, 수수료 포함)과 비교한다.
// amount_krw(수수료 제외 순액)와 비교하면 수수료가 차액으로 오해된다 — 2026-09-01 수정.
export function paidText(grossKrw: number, paidAmountKrw: number): string {
  const diff = paidAmountKrw - grossKrw;
  return diff === 0
    ? `실지급 ${formatMoney(paidAmountKrw, 'KRW')}`
    : `실지급 ${formatMoney(paidAmountKrw, 'KRW')} (송금액 ${formatMoney(grossKrw, 'KRW')}, ${signed(diff)})`;
}

// 요청 내역 펼침의 '정산' 항목 한 줄
export function settlementDetail(s: StatusSource & { paidAmountKrw: number | null; paidAt: string | null; grossKrw: number }): string {
  if (!s.externalStatus) return '아직 정산 쪽에서 확인 전이에요';
  const when = kstDateTime(s.externalUpdatedAt);
  const memo = s.externalNote ? ` · 메모: ${s.externalNote}` : '';
  switch (s.externalStatus) {
    case 'received': return `정산 접수 · ${when}${memo}`;
    case 'scheduled': return `지급 예정 · ${when}${memo}`;
    case 'on_hold': return `보류 · ${when}${s.externalNote ? ` · ${s.externalNote}` : ''}`;
    case 'paid': return `지급 완료 · ${kstDateTime(s.paidAt ?? s.externalUpdatedAt)} · ${paidText(s.grossKrw, s.paidAmountKrw ?? 0)}${memo}`;
    case 'cancelled': return `정산에서 취소 · ${when}${memo}`;
  }
}
```

- [ ] **Step 4: 호출부를 고친다**

`src/app/settlement/RequestRow.tsx:31` — `r.amountKrw` → `r.grossKrw`:

```tsx
<div className="mt-1 pl-0 text-ui text-x-muted">마감 {r.deadlineOn} · 요청자 {r.requesterName}{paid && r.paidAmountKrw !== null && <> · {paidText(r.grossKrw, r.paidAmountKrw)}</>}</div>
```

`:61`의 `<Item k="정산" v={settlementDetail(r)} />`는 `PaymentRequestRow`에 `grossKrw`가 이미 있으므로 그대로 통과한다(Task 7에서 이 줄 자체를 없앤다).

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementDisplay.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 6: 커밋**

```bash
git add src/lib/settlementDisplay.ts src/lib/settlementDisplay.test.ts src/app/settlement/RequestRow.tsx
git commit -m "fix(settlement): 실지급 차액을 실제 송금액과 비교 — 수수료를 차액으로 오해하던 표시 수정"
```

---

## Task 2: 046 마이그레이션 + 스토어 필드

**Files:**
- Create: `migrations/046_settlement_partner_result.sql`
- Modify: `src/lib/settlementStore.ts:98-150`(`PaymentRequestRow`·`RRow`·`R_SELECT`·`toRequest`)
- Test: `src/lib/settlementStore.test.ts`

**Interfaces:**
- Produces: `PaymentRequestRow.diffAckAt: string | null`, `PaymentRequestRow.diffAckByName: string | null`, `external_api_log.body` 칸

- [ ] **Step 1: 마이그레이션을 쓴다**

`migrations/046_settlement_partner_result.sql`:

```sql
-- 046: 정산 프로덕트가 보낸 결과를 잃지 않게 한다 (스펙 2026-09-01-settlement-partner-result-design.md §3)
-- 새 표는 만들지 않는다 — 실지급액·지급 시각·메모·그쪽 상태는 041이 payment_request에 이미 넣었다.

-- 그쪽이 보낸 본문 원문(파싱 전). jsonb가 아니라 text다: JSON이 깨져 400으로 거부된 본문이야말로
-- 가장 보고 싶은 것인데 jsonb에는 들어가지 않는다. 4KB 상한은 앱에서 잘라 넣는다.
alter table external_api_log add column if not exists body text;

-- 차액 확인 — 실지급액이 실제 송금액(gross_krw)과 다를 때 담당자가 확인했다는 표시.
-- 사유 칸은 없다(koo 결정 09-01: 사유는 정산 쪽 메모만 쓴다). 확인한 사람은 이름 스냅샷만 남긴다(cancelled_by_name 선례).
alter table payment_request add column if not exists diff_ack_at timestamptz;
alter table payment_request add column if not exists diff_ack_by_name text;
```

- [ ] **Step 2: 마이그레이션을 적용한다**

```bash
npm run migrate
```

Expected: `046_settlement_partner_result.sql` 적용 성공 로그. 이미 적용된 파일은 건너뛴다.

- [ ] **Step 3: 실패하는 테스트를 쓴다**

`src/lib/settlementStore.test.ts` 맨 아래에 추가(파일 상단의 기존 픽스처 헬퍼를 그대로 쓴다 — 기존 테스트가 요청을 만드는 방식을 그 파일에서 확인하고 같은 방식으로 만든다):

```ts
test('046 — 차액 확인 칸이 요청 행에 실려 나온다(기본값 없음)', async () => {
  const { row } = await makeRequest();          // 이 파일의 기존 픽스처 헬퍼
  assert.equal(row.diffAckAt, null);
  assert.equal(row.diffAckByName, null);
});
```

> 픽스처 헬퍼 이름이 다르면 그 파일에서 쓰는 이름을 그대로 쓴다. 새 헬퍼를 만들지 않는다.

- [ ] **Step 4: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: FAIL — `diffAckAt`가 `PaymentRequestRow`에 없다는 타입 오류

- [ ] **Step 5: 스토어에 필드를 더한다**

`src/lib/settlementStore.ts` 네 곳:

```ts
// PaymentRequestRow — externalUpdatedAt 줄 뒤에
  externalUpdatedAt: string | null; influencerId: string; categoryOptionId: string;
  diffAckAt: string | null; diffAckByName: string | null;

// RRow — external_updated_at 줄 뒤에
  external_updated_at: Date | null; influencer_id: string; category_option_id: string;
  diff_ack_at: Date | null; diff_ack_by_name: string | null;

// R_SELECT — 마지막 select 줄에 두 칸 추가
         external_status, paid_amount_krw, paid_at, external_note, external_updated_at, influencer_id, category_option_id,
         diff_ack_at, diff_ack_by_name

// toRequest — 마지막 줄 뒤에
  externalUpdatedAt: iso(r.external_updated_at), influencerId: r.influencer_id, categoryOptionId: r.category_option_id,
  diffAckAt: iso(r.diff_ack_at), diffAckByName: r.diff_ack_by_name,
```

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add migrations/046_settlement_partner_result.sql src/lib/settlementStore.ts src/lib/settlementStore.test.ts
git commit -m "feat(settlement): 046 — 그쪽 본문 보관 칸과 차액 확인 칸"
```

---

## Task 3: 차액 확인 파생값 — 배지·필터·캠페인 표가 한 값을 쓴다

**Files:**
- Modify: `src/lib/settlementDisplay.ts`(`StatusSource`·`DisplayKey`·`keyOf`·`displayStatus`·`STATUS_GROUP_OPTIONS`·`inGroup`)
- Modify: `src/lib/campaignTaskStore.ts:311-325`(`SettlementBadge`·`settlementByTaskIds`)
- Test: `src/lib/settlementDisplay.test.ts`, `src/lib/settlementStore.test.ts`(배지)

**Interfaces:**
- Consumes: Task 2의 `diffAckAt`
- Produces: `paidDiff(s): number | null`, `needsDiffAck(s): boolean`, `DisplayKey`에 `'paid_diff'`, `StatusGroup`에 `'paid_diff'`, `SettlementBadge`에 `paidAmountKrw`·`grossKrw`·`diffAckAt`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/settlementDisplay.test.ts` — 먼저 파일 상단 헬퍼에 새 필드를 더한다:

```ts
const base: StatusSource = { status: 'requested', externalStatus: null, externalNote: null, externalUpdatedAt: null, createdAt: '2026-08-28T03:00:00Z', cancelledAt: null,
  paidAmountKrw: null, grossKrw: 31650, diffAckAt: null };
```

그리고 테스트를 추가한다:

```ts
const paidWith = (paidAmountKrw: number, diffAckAt: string | null = null): StatusSource =>
  ({ ...ext('paid'), paidAmountKrw, diffAckAt });

test('차액 확인 — 실지급액이 송금액과 다르고 미확인이면 확인 필요', () => {
  assert.equal(displayStatus(paidWith(30000), 'list').key, 'paid_diff');
  assert.equal(displayStatus(paidWith(30000), 'list').label, '지급 완료 · 차액 확인 필요');
  assert.equal(displayStatus(paidWith(30000), 'list').tone, 'warn');
  assert.equal(displayStatus(paidWith(30000), 'campaign').label, '정산 차액 확인 필요');
});

test('차액 확인 — 차액 0이거나 이미 확인했으면 그냥 지급 완료', () => {
  assert.equal(displayStatus(paidWith(31650), 'list').key, 'paid');
  assert.equal(displayStatus(paidWith(30000, '2026-09-01T05:00:00Z'), 'list').key, 'paid');
  assert.equal(displayStatus(paidWith(30000, '2026-09-01T05:00:00Z'), 'list').label, '지급 완료 8/29');
});

test('차액 확인 — 취소된 요청에는 뜨지 않는다', () => {
  const s = { ...paidWith(30000), status: 'cancelled' as const, cancelledAt: '2026-08-30T03:00:00Z' };
  assert.equal(displayStatus(s, 'list').key, 'cancelled');
});

test('차액 확인 — 지급 완료 필터에 차액 건도 포함된다', () => {
  assert.ok(inGroup('paid_diff', 'paid'), '차액 건도 지급 완료다 — 필터에서 사라지면 안 된다');
  assert.ok(inGroup('paid_diff', 'paid_diff'));
  assert.ok(!inGroup('paid', 'paid_diff'));
  assert.ok(inGroup('paid_diff', ''));
});

test('paidDiff / needsDiffAck', () => {
  assert.equal(paidDiff({ paidAmountKrw: null, grossKrw: 31650 }), null);
  assert.equal(paidDiff({ paidAmountKrw: 30000, grossKrw: 31650 }), -1650);
  assert.equal(needsDiffAck(paidWith(30000)), true);
  assert.equal(needsDiffAck(paidWith(31650)), false);
  assert.equal(needsDiffAck(ext('scheduled')), false);
});
```

`paidDiff`·`needsDiffAck`를 import 목록에 추가한다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementDisplay.test.ts`
Expected: FAIL — `paidDiff` 없음

- [ ] **Step 3: 파생값을 구현한다**

`src/lib/settlementDisplay.ts`:

```ts
export type DisplayKey = 'requested' | 'received' | 'scheduled' | 'on_hold' | 'paid' | 'paid_diff' | 'cancelled';

export interface StatusSource {
  status: SettlementBadgeStatus; externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  createdAt: string; cancelledAt: string | null;
  // 차액 판정 입력 — 그쪽 실지급액을 우리가 실제로 보낸 금액과 비교한다
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
}

// 차액 = 그쪽 실지급액 − 우리가 실제로 보낸 금액. 아직 지급 전이면 null.
export function paidDiff(s: Pick<StatusSource, 'paidAmountKrw' | 'grossKrw'>): number | null {
  return s.paidAmountKrw === null ? null : s.paidAmountKrw - s.grossKrw;
}

// 담당자 확인이 필요한가 — 지급 완료 + 차액 있음 + 아직 확인 안 함. 취소된 요청은 대상이 아니다.
export function needsDiffAck(s: StatusSource): boolean {
  if (s.status === 'cancelled' || s.externalStatus !== 'paid' || s.diffAckAt) return false;
  const d = paidDiff(s);
  return d !== null && d !== 0;
}

export function keyOf(s: StatusSource): DisplayKey {
  if (s.status === 'cancelled') return 'cancelled';
  switch (s.externalStatus) {
    case 'received': return 'received';
    case 'scheduled': return 'scheduled';
    case 'on_hold': return 'on_hold';
    case 'paid': return needsDiffAck(s) ? 'paid_diff' : 'paid';
    default: return 'requested';   // null, 또는 그쪽 cancelled인데 우리가 아직 requested(적용 직후엔 생기지 않는다)
  }
}
```

`displayStatus`의 switch에 케이스를 더한다(`paid` 케이스 바로 뒤):

```ts
    case 'paid_diff': {
      const d = paidDiff(s) ?? 0;
      const 적게많게 = d < 0 ? '적게' : '많게';
      return { key, tone: 'warn', label: campaign ? '정산 차액 확인 필요' : '지급 완료 · 차액 확인 필요',
               title: `요청한 송금액보다 ${Math.abs(d).toLocaleString('ko-KR')}원 ${적게많게} 지급됐어요 — 확인해 주세요` };
    }
```

필터:

```ts
export type StatusGroup = '' | 'active' | 'on_hold' | 'paid' | 'paid_diff' | 'cancelled';
export const STATUS_GROUP_OPTIONS: ReadonlyArray<{ value: StatusGroup; label: string }> = [
  { value: '', label: '상태 전체' }, { value: 'active', label: '진행 중' }, { value: 'on_hold', label: '보류' },
  { value: 'paid_diff', label: '차액 확인 필요' }, { value: 'paid', label: '지급 완료' }, { value: 'cancelled', label: '취소됨' },
];
export function inGroup(key: DisplayKey, g: StatusGroup): boolean {
  if (g === '') return true;
  if (g === 'active') return key === 'requested' || key === 'received' || key === 'scheduled';
  if (g === 'paid') return key === 'paid' || key === 'paid_diff';   // 차액 건도 지급 완료다
  return key === g;
}
```

- [ ] **Step 4: 캠페인 표 배지에 같은 입력을 넣는다**

`src/lib/campaignTaskStore.ts` — 안 넣으면 캠페인 표만 다른 판정을 하게 된다:

```ts
export interface SettlementBadge {
  status: SettlementBadgeStatus; createdAt: string; cancelledAt: string | null;
  externalStatus: ExternalStatus | null; externalNote: string | null; externalUpdatedAt: string | null;
  paidAmountKrw: number | null; grossKrw: number; diffAckAt: string | null;
}
```

조회의 select와 매핑에 세 칸을 더한다:

```ts
  const rows = await sql<Array<{ task_id: string; status: SettlementBadgeStatus; created_at: Date; cancelled_at: Date | null;
    external_status: ExternalStatus | null; external_note: string | null; external_updated_at: Date | null;
    paid_amount_krw: number | null; gross_krw: string | number; diff_ack_at: Date | null }>>`
    select distinct on (task_id) task_id, status, created_at, cancelled_at, external_status, external_note, external_updated_at,
           paid_amount_krw, gross_krw, diff_ack_at
      from payment_request where task_id in ${sql(ids)}
     order by task_id, (status = 'requested') desc, created_at desc`;
```

매핑 객체에 추가(`gross_krw`는 bigint라 문자열로 올 수 있다 — `Number()`로 변환한다):

```ts
    paidAmountKrw: r.paid_amount_krw, grossKrw: Number(r.gross_krw), diffAckAt: iso(r.diff_ack_at),
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementDisplay.test.ts`
Expected: PASS

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: PASS — 배지를 검증하는 기존 테스트가 새 필드로도 통과해야 한다

- [ ] **Step 6: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음. `TaskTable.tsx`는 `displayStatus(t.settlement, 'campaign')`을 부르므로 Step 4를 빠뜨리면 여기서 잡힌다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/settlementDisplay.ts src/lib/settlementDisplay.test.ts src/lib/campaignTaskStore.ts
git commit -m "feat(settlement): 차액 확인 필요를 파생값 하나로 — 목록 배지·필터·캠페인 표가 같은 판정을 쓴다"
```

---

## Task 4: 차액 확인·확인 취소 (스토어 + API)

**Files:**
- Modify: `src/lib/settlementStore.ts`(`ackDiff`·`unackDiff` 추가)
- Modify: `src/app/api/settlement/requests/[id]/route.ts`
- Modify: `src/lib/settlementApi.ts`
- Test: `src/lib/settlementStore.test.ts`

**Interfaces:**
- Produces:
  - `ackDiff(sql, id: string, by: { name: string }): Promise<PaymentRequestRow | 'not-found' | 'no-diff'>`
  - `unackDiff(sql, id: string): Promise<PaymentRequestRow | 'not-found'>`
  - `ackDiffApi(id: string): Promise<ApiResult<PaymentRequestRow>>`, `unackDiffApi(id: string)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/settlementStore.test.ts`에 추가:

```ts
test('차액 확인 — 확인·취소가 되고 updated_at을 건드리지 않는다', async () => {
  const { row } = await makeRequest();
  // 그쪽이 송금액보다 적게 지급한 상황을 만든다
  await applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: '2026-09-01T01:00:00Z', note: null,
    paidAmountKrw: row.grossKrw - 1650, paidAt: '2026-09-01T00:59:00Z', externalId: null });
  const before = (await getRequest(sql, row.id))!;

  const acked = await ackDiff(sql, row.id, { name: '박구건' });
  assert.notEqual(acked, 'not-found'); assert.notEqual(acked, 'no-diff');
  const a = acked as PaymentRequestRow;
  assert.ok(a.diffAckAt); assert.equal(a.diffAckByName, '박구건');
  assert.equal(a.updatedAt, before.updatedAt, '확인은 그쪽 폴링에 흘러가면 안 된다');

  const un = await unackDiff(sql, row.id) as PaymentRequestRow;
  assert.equal(un.diffAckAt, null); assert.equal(un.diffAckByName, null);
  assert.equal(un.updatedAt, before.updatedAt);
});

test('차액 확인 — 차액이 없으면 확인할 것이 없다', async () => {
  const { row } = await makeRequest();
  await applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: '2026-09-01T01:00:00Z', note: null,
    paidAmountKrw: row.grossKrw, paidAt: '2026-09-01T00:59:00Z', externalId: null });
  assert.equal(await ackDiff(sql, row.id, { name: '박구건' }), 'no-diff');
});
```

> `getRequest`가 그 파일에 없으면 `listRequests`로 그 행을 다시 읽는다 — 그 파일이 이미 쓰는 방법을 그대로 쓴다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: FAIL — `ackDiff` 없음

- [ ] **Step 3: 스토어 함수를 구현한다**

`src/lib/settlementStore.ts`에 추가(`applyExternalStatus` 근처):

```ts
// 차액 확인 — 우리 내부 표시다. updated_at을 건드리지 않는다(그쪽 폴링에 무의미한 변경이 흘러가면 안 된다).
// 사유는 받지 않는다(koo 결정 09-01: 사유는 정산 쪽 메모만 쓴다).
export async function ackDiff(sql: postgres.Sql, id: string, by: { name: string }): Promise<PaymentRequestRow | 'not-found' | 'no-diff'> {
  if (!isUuidLike(id)) return 'not-found';
  const [cur] = await sql<RRow[]>`${R_SELECT(sql)} where id = ${id}`;
  if (!cur) return 'not-found';
  const row = toRequest(cur);
  if (row.status === 'cancelled' || row.externalStatus !== 'paid' || row.paidAmountKrw === null || row.paidAmountKrw === row.grossKrw) return 'no-diff';
  await sql`update payment_request set diff_ack_at = now(), diff_ack_by_name = ${by.name} where id = ${id}`;
  const [saved] = await sql<RRow[]>`${R_SELECT(sql)} where id = ${id}`;
  return toRequest(saved);
}

export async function unackDiff(sql: postgres.Sql, id: string): Promise<PaymentRequestRow | 'not-found'> {
  if (!isUuidLike(id)) return 'not-found';
  const [cur] = await sql<RRow[]>`${R_SELECT(sql)} where id = ${id}`;
  if (!cur) return 'not-found';
  await sql`update payment_request set diff_ack_at = null, diff_ack_by_name = null where id = ${id}`;
  const [saved] = await sql<RRow[]>`${R_SELECT(sql)} where id = ${id}`;
  return toRequest(saved);
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: PASS

- [ ] **Step 5: API에 action을 더한다**

`src/app/api/settlement/requests/[id]/route.ts` — 새 라우트 파일을 만들지 않는다. 취소가 이미 이 패턴이다:

```ts
import { cancelRequest, ackDiff, unackDiff } from '@/lib/settlementStore';

// PATCH 본문 맨 앞에서 action을 갈라낸다 (기존 cancel 검사보다 앞)
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; reason?: unknown };

  if (body.action === 'ack-diff' || body.action === 'unack-diff') {
    const r = body.action === 'ack-diff'
      ? await ackDiff(getSql(), id, { name: gate.member.name })
      : await unackDiff(getSql(), id);
    if (r === 'not-found') return NextResponse.json({ error: '요청을 찾을 수 없어요 — 화면을 새로고침해 주세요' }, { status: 404 });
    if (r === 'no-diff') return NextResponse.json({ error: '확인할 차액이 없어요 — 화면을 새로고침해 주세요' }, { status: 409 });
    return NextResponse.json(r);
  }

  if (body.action !== 'cancel') return NextResponse.json({ error: '지원하지 않는 동작이에요' }, { status: 400 });
```

- [ ] **Step 6: 화면용 래퍼를 더한다**

`src/lib/settlementApi.ts` — `cancelRequestApi` 바로 아래:

```ts
export const ackDiffApi = (id: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'ack-diff' }));
export const unackDiffApi = (id: string) => call<PaymentRequestRow>(`/api/settlement/requests/${id}`, json('PATCH', { action: 'unack-diff' }));
```

- [ ] **Step 7: 타입 검사 + 커밋**

Run: `npx tsc --noEmit`
Expected: 오류 없음

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts src/app/api/settlement/requests/\[id\]/route.ts src/lib/settlementApi.ts
git commit -m "feat(settlement): 차액 확인·확인 취소 — 확인은 우리 내부 표시라 그쪽 폴링에 흘러가지 않는다"
```

---

## Task 5: 금액이 정정되면 확인이 풀린다

계약상 `paid → paid` 재전송으로 금액을 고칠 수 있다. 30,000원을 확인해 뒀는데 28,000원으로 정정되면 그 확인은 다른 금액에 대한 확인이다. 화면 규칙이 아니라 **상태를 적용하는 코드에서** 강제한다.

**Files:**
- Modify: `src/lib/settlementStore.ts`(`applyExternalStatus`의 update 문)
- Test: `src/lib/settlementStore.test.ts`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```ts
test('차액 확인 — 그쪽이 금액을 정정하면 확인이 풀린다', async () => {
  const { row } = await makeRequest();
  const paid = (krw: number, at: string) => applyExternalStatus(sql, row.id, { status: 'paid', updatedAt: at, note: null, paidAmountKrw: krw, paidAt: at, externalId: null });

  await paid(row.grossKrw - 1650, '2026-09-01T01:00:00Z');
  await ackDiff(sql, row.id, { name: '박구건' });

  // 같은 금액 재전송(더 늦은 시각) → 확인 유지
  await paid(row.grossKrw - 1650, '2026-09-01T02:00:00Z');
  assert.ok(((await listRequests(sql, { taskId: row.taskId! }))[0]).diffAckAt, '같은 금액이면 확인이 유지된다');

  // 다른 금액으로 정정 → 확인 해제
  await paid(row.grossKrw - 3000, '2026-09-01T03:00:00Z');
  const after2 = (await listRequests(sql, { taskId: row.taskId! }))[0];
  assert.equal(after2.diffAckAt, null, '금액이 바뀌면 이전 확인은 다른 금액에 대한 확인이다');
  assert.equal(after2.diffAckByName, null);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: FAIL — 정정 후에도 `diffAckAt`가 남아 있다

- [ ] **Step 3: 적용 코드를 고친다**

`applyExternalStatus`의 update 문에 두 칸을 조건부로 더한다. `c`는 잠금 후 읽은 이전 행이다:

```ts
    // 실지급액이 바뀌면 이전 차액 확인은 무효다(다른 금액에 대한 확인이었다). 사람이 잊지 않게 여기서 강제한다.
    const paidAmountChanged = u.paidAmountKrw !== c.paid_amount_krw;
    await tx`
      update payment_request
         set external_status = ${u.status}, paid_amount_krw = ${u.paidAmountKrw}, paid_at = ${u.paidAt}, external_note = ${u.note},
             external_updated_at = ${u.updatedAt}, external_id = coalesce(${u.externalId}, external_id),
             sent_at = coalesce(sent_at, now()), updated_at = now(),
             diff_ack_at = case when ${paidAmountChanged} then null else diff_ack_at end,
             diff_ack_by_name = case when ${paidAmountChanged} then null else diff_ack_by_name end
       where id = ${id}`;
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/settlementStore.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/settlementStore.ts src/lib/settlementStore.test.ts
git commit -m "feat(settlement): 실지급액이 정정되면 차액 확인을 자동으로 해제"
```

---

## Task 6: 그쪽이 보낸 본문 보관 + 기록 유실 막기

**Files:**
- Modify: `src/lib/externalApiLog.ts`
- Create: `src/lib/externalApiLogAfter.ts`
- Modify: `src/app/api/external/settlement/requests/route.ts`, `.../[id]/route.ts`, `.../[id]/status/route.ts`
- Test: `src/lib/externalApiLog.test.ts`

**Interfaces:**
- Produces:
  - `ExternalLogEvent.body?: string | null`
  - `recordExternalCall(ev: ExternalLogEvent): Promise<void>` (`externalApiLog.ts` — 가드 + 재시도 1회, 예외를 밖으로 던지지 않는다)
  - `recordExternalCallSafe(ev: ExternalLogEvent): void` (`externalApiLogAfter.ts` — 라우트 전용)
  - `ExternalLogRow.body: string | null` (`externalLogCopy.ts`)

**왜 파일을 나누나:** `after()`는 `next/server`에서 온다. `externalApiLog.ts`는 `node --test`에서 직접 import되므로, 그 파일에 Next 런타임 의존을 넣으면 테스트가 깨질 위험이 있다. 그래서 `after()`를 쓰는 얇은 래퍼만 새 파일에 두고 라우트가 그것을 import한다.

- [ ] **Step 1: `after()` 문서를 읽는다**

Run: `sed -n 1,60p node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`
확인할 것: Route Handler에서 사용 가능 · 응답이 실패해도 실행됨 · 라우트의 max duration 안에서 동작

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`src/lib/externalApiLog.test.ts`에 추가(`row()` 헬퍼에 `body: null`을 먼저 더한다):

```ts
test('본문 — 상태 전송 본문이 원문 그대로 남는다', async () => {
  const body = '{"status":"paid","updated_at":"2026-09-01T01:00:00Z","paid_amount_krw":31650}';
  await insertExternalLog(sql, { method: 'POST', path: P + '/body-ok', statusCode: 200, outcome: 'applied', sentStatus: 'paid', body });
  const [row] = await listExternalLog(sql, { limit: 1 });
  assert.equal(row.body, body);
});

test('본문 — 깨진 JSON도 원문 그대로 남는다(400으로 거부된 본문이 가장 보고 싶다)', async () => {
  const body = '{"status":"paid", 이건 JSON이 아니다';
  await insertExternalLog(sql, { method: 'POST', path: P + '/body-broken', statusCode: 400, outcome: 'bad-request', detail: 'body', body });
  const [row] = await listExternalLog(sql, { limit: 1 });
  assert.equal(row.body, body);
});

test('본문 — 4KB를 넘으면 잘리고 잘림 표시가 붙는다', async () => {
  await insertExternalLog(sql, { method: 'POST', path: P + '/body-long', statusCode: 200, outcome: 'applied', body: 'x'.repeat(5000) });
  const [row] = await listExternalLog(sql, { limit: 1 });
  assert.equal(row.body!.length, 4096);
  assert.ok(row.body!.endsWith('…(본문이 길어 여기서 잘렸어요)'));
});

test('recordExternalCall — EXTERNAL_API_LOG=off이면 아무것도 쓰지 않는다', async () => {
  const prev = process.env.EXTERNAL_API_LOG;
  process.env.EXTERNAL_API_LOG = 'off';
  try {
    await recordExternalCall({ method: 'GET', path: P + '/off-test', statusCode: 200, outcome: 'ok' });
    const rows = await listExternalLog(sql, { limit: 50 });
    assert.equal(rows.filter((r) => r.path === P + '/off-test').length, 0);
  } finally {
    if (prev === undefined) delete process.env.EXTERNAL_API_LOG; else process.env.EXTERNAL_API_LOG = prev;
  }
});
```

기존 `recordExternalCallSafe` 테스트는 지우고 위 테스트로 대체한다. import를 `recordExternalCall`로 바꾼다.

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/externalApiLog.test.ts`
Expected: FAIL — `listExternalLog(sql, { limit })` 시그니처 불일치, `body` 없음

- [ ] **Step 4: `externalApiLog.ts`를 고친다**

```ts
export interface ExternalLogEvent {
  method: string;
  path: string;
  requestId?: string | null;
  statusCode: number;
  outcome: ExternalOutcome;
  detail?: string | null;
  sentStatus?: string | null;
  query?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  body?: string | null;      // 그쪽이 보낸 본문 원문(파싱 전). 401은 넘기지 않는다.
}

const LIMITS = { path: 200, query: 200, detail: 300, userAgent: 200, ip: 100 };
const BODY_MAX = 4096;
const BODY_CUT = '…(본문이 길어 여기서 잘렸어요)';
function clipBody(s: string): string {
  return s.length <= BODY_MAX ? s : s.slice(0, BODY_MAX - BODY_CUT.length) + BODY_CUT;
}
```

`insertExternalLog`의 insert에 `body`를 더한다:

```ts
  const body = ev.body != null ? clipBody(ev.body) : null;
  await sql`
    insert into external_api_log (method, path, request_id, status_code, outcome, detail, sent_status, query, ip, user_agent, body)
    values (${ev.method}, ${path}, ${requestId}, ${ev.statusCode}, ${ev.outcome}, ${detail}, ${ev.sentStatus ?? null}, ${query}, ${ip}, ${userAgent}, ${body})`;
```

`recordExternalCallSafe`를 `recordExternalCall`로 바꾼다(예약은 새 파일이 맡는다):

```ts
// 기록의 실행부 — 예외를 밖으로 던지지 않는다. 실패해도 그쪽 호출은 성공해야 한다.
// 예약(응답 후 실행)은 externalApiLogAfter.ts가 맡는다. 부하 시 킬스위치: EXTERNAL_API_LOG=off.
export async function recordExternalCall(ev: ExternalLogEvent): Promise<void> {
  if (!process.env.PGHOST) return;
  if (process.env.EXTERNAL_API_LOG === 'off') return;
  const sql = getUsageSql();
  try {
    await insertExternalLog(sql, ev);
    return;
  } catch { /* 아래에서 한 번만 다시 시도한다 — 풀 소진·일시 오류가 대부분이다 */ }
  try {
    await new Promise((r) => setTimeout(r, 200));
    await insertExternalLog(sql, ev);
  } catch (e) {
    // 매번 남긴다 — 조용히 사라지면 "기록에 없다"를 근거로 잘못 판정하게 된다(2026-08-31 사고).
    console.error('[external_api_log] 호출 기록 실패 — 마이그레이션 043·046 적용 여부 확인:', (e as Error).message);
  }
}
```

`warnedRecordFailure` 변수를 지운다.

`listExternalLog`를 옵션 방식으로 바꾼다(Task 8이 필터를 쓴다):

```ts
export interface ExternalLogQuery { limit?: number; method?: 'GET' | 'POST'; rejectedOnly?: boolean; requestId?: string | null }

export async function listExternalLog(sql: postgres.Sql, q: ExternalLogQuery = {}): Promise<ExternalLogRow[]> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const requestId = q.requestId && isUuidLike(q.requestId) ? q.requestId : null;
  const rows = await sql<Array<{ /* 기존 필드들 */ body: string | null }>>`
    select l.id, l.at, l.method, l.path, l.request_id, l.status_code, l.outcome, l.detail, l.sent_status, l.query, l.ip, l.user_agent, l.body,
           p.influencer_handle, p.client_name, p.amount_gross, p.payout_currency
      from external_api_log l
      left join payment_request p on p.id = l.request_id
     where ${q.method ? sql`l.method = ${q.method}` : sql`true`}
       and ${q.rejectedOnly ? sql`l.status_code >= 400` : sql`true`}
       and ${requestId ? sql`l.request_id = ${requestId}` : sql`true`}
     order by l.at desc
     limit ${limit}`;
  // 매핑에 body: r.body 추가
}
```

기존 타입 목록에 `body: string | null`을 더하고, 매핑 객체에도 `body: r.body`를 더한다. `isUuidLike`는 이미 이 파일이 import한다.

- [ ] **Step 5: 라우트 전용 예약 래퍼를 만든다**

`src/lib/externalApiLogAfter.ts`:

```ts
import { after } from 'next/server';
import { recordExternalCall, type ExternalLogEvent } from './externalApiLog.ts';

// 라우트가 쓰는 기록 예약 래퍼.
//
// 왜 after()인가: 예전에는 응답을 보낸 뒤 기록을 백그라운드로 던져놓고 기다리지 않았다(void async IIFE).
// 이 서버는 요청마다 뜨고 지므로, 응답을 반환한 순간 함수가 정지될 수 있고 그러면 기록이 저장되기 전에
// 사라졌다(2026-08-31에 그쪽 커서를 받아 간 호출이 기록에 없던 원인으로 추정). after()는 응답을 막지 않으면서
// 플랫폼이 이 작업이 끝날 때까지 함수를 살려 준다 — Next 문서가 로깅을 이 함수의 대표 용도로 든다.
//
// 왜 파일을 나눴나: externalApiLog.ts는 node --test가 직접 import한다. 거기에 next/server 의존을 넣으면
// 테스트가 Next 런타임에 묶인다.
export function recordExternalCallSafe(ev: ExternalLogEvent): void {
  try {
    after(() => recordExternalCall(ev));
  } catch {
    // 요청 컨텍스트 밖(스크립트·테스트)에서 불린 경우 — 예전처럼 던져놓는다
    void recordExternalCall(ev);
  }
}
```

- [ ] **Step 6: 라우트 3개를 고친다**

세 파일 모두 import를 바꾼다:

```ts
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';
```

`src/app/api/external/settlement/requests/[id]/status/route.ts`는 본문을 함께 넘긴다. **본문을 두 번 읽을 수 없으므로 원문 문자열을 먼저 읽고 파싱한다:**

```ts
  const { id } = await ctx.params;
  const raw = await req.text().catch(() => '');
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  const parsed = parseStatusUpdate(body);
```

그리고 이 라우트의 `recordExternalCallSafe` 호출 4곳(400·404·409·200)에 `body: raw`를 더한다. **401 호출에는 더하지 않는다.**

- [ ] **Step 7: 테스트가 통과하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/externalApiLog.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: 오류 없음(`external-log` 라우트가 `listExternalLog(getSql(), 50)`을 부르고 있으면 여기서 잡힌다 — Task 8에서 고치므로, 이 태스크에서는 `listExternalLog(getSql(), { limit: 50 })`으로 최소 수정한다)

- [ ] **Step 8: 커밋**

```bash
git add src/lib/externalApiLog.ts src/lib/externalApiLogAfter.ts src/lib/externalApiLog.test.ts src/lib/externalLogCopy.ts src/app/api/external src/app/api/settlement/external-log
git commit -m "feat(settlement): 그쪽이 보낸 본문을 남기고, 응답 후 함수 정지로 기록이 유실되던 것을 after()로 막는다"
```

---

## Task 7: 요청 내역 펼침을 두 블록으로 + 확인 UI + 상단 요약

**Files:**
- Create: `src/app/settlement/PartnerResultBlock.tsx`
- Modify: `src/app/settlement/RequestRow.tsx`
- Modify: `src/app/settlement/RequestList.tsx`

**Interfaces:**
- Consumes: `paidDiff`·`needsDiffAck`·`paidText`(Task 1·3), `ackDiffApi`·`unackDiffApi`(Task 4)
- Produces: `<PartnerResultBlock r={row} onChanged={() => void} />`

- [ ] **Step 1: 블록 컴포넌트를 만든다**

`src/app/settlement/PartnerResultBlock.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';
import { kstDateTime } from '@/lib/datetime';
import { paidDiff, needsDiffAck } from '@/lib/settlementDisplay';
import { ackDiffApi, unackDiffApi } from '@/lib/settlementApi';

const EXT_LABEL: Record<string, string> = {
  received: '정산 접수', scheduled: '지급 예정', paid: '지급 완료', on_hold: '보류', cancelled: '정산에서 취소',
};

export function PartnerResultBlock({ r, onChanged }: { r: PaymentRequestRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!r.externalStatus) {
    return <p className="mt-3 border-t border-x-border pt-3 text-ui text-x-muted">아직 정산 쪽에서 확인 전이에요</p>;
  }

  const diff = paidDiff(r);
  const needsAck = needsDiffAck(r);

  async function run(kind: 'ack' | 'unack') {
    setBusy(true); setErr('');
    const res = kind === 'ack' ? await ackDiffApi(r.id) : await unackDiffApi(r.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onChanged();
  }

  return (
    <section className="mt-3 border-t border-x-border pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-ui font-semibold">정산 프로덕트가 보낸 결과</h3>
        <span className="text-ui text-x-muted">{kstDateTime(r.externalUpdatedAt)} 받음</span>
      </div>
      <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-x-secondary">처리 상태</dt>
        <dd>{EXT_LABEL[r.externalStatus] ?? r.externalStatus}</dd>

        {r.paidAmountKrw !== null && <>
          <dt className="text-x-secondary">실지급액</dt>
          <dd>{formatMoney(r.paidAmountKrw, 'KRW')}
            {diff !== null && diff !== 0 && (
              <span className="ml-2 text-amber-700">
                우리가 보낸 송금액 {formatMoney(r.grossKrw, 'KRW')}보다 {Math.abs(diff).toLocaleString('ko-KR')}원 {diff < 0 ? '적어요' : '많아요'}
              </span>
            )}
          </dd>
        </>}

        {r.paidAt && <><dt className="text-x-secondary">지급 시각</dt><dd>{kstDateTime(r.paidAt)}</dd></>}

        <dt className="text-x-secondary">메모</dt>
        <dd>{r.externalNote ?? <span className="text-x-muted">— 정산 쪽이 안 적었어요</span>}</dd>

        <dt className="text-x-secondary">그쪽 건 번호</dt>
        <dd>{r.externalId ?? <span className="text-x-muted">— 아직 보내오지 않아요</span>}</dd>
      </dl>

      {needsAck && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-ui text-amber-700">차액 확인이 필요해요</p>
            <Button onClick={() => void run('ack')} disabled={busy}>확인함</Button>
          </div>
          <p className="mt-1 text-ui text-x-muted">정산 쪽 조정 금액을 확인했다는 표시예요 — 사유는 정산 쪽 메모에만 있어요.</p>
        </div>
      )}

      {r.diffAckAt && diff !== null && diff !== 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-ui">
          <span className="text-x-secondary">차액 확인 · 확인함 · {r.diffAckByName} · {kstDateTime(r.diffAckAt)}</span>
          <Button onClick={() => void run('unack')} disabled={busy}>확인 취소</Button>
        </div>
      )}

      {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}

      <a href={`/settlement?tab=log&request=${r.id}`} className="mt-3 inline-block text-ui text-x-blue-text hover:underline">
        이 요청의 호출 기록 보기 →
      </a>
    </section>
  );
}
```

`Button`이 `@/components/ui`에서 오는지, `formatMoney`가 `@/lib/influencerPricing`에서 오는지는 `RequestRow.tsx`의 기존 import로 확인한다(같은 경로를 쓴다).

- [ ] **Step 2: `RequestRow`를 고친다**

- `<Item k="정산" v={settlementDetail(r)} />` 줄을 **지운다**.
- `증빙` Item의 `sub`에 안내를 더한다(기존 `proofUploadedLine`은 유지):

```tsx
              <Item k="증빙" v={ /* 기존 그대로 */ }
                    sub={<>{r.proof ? proofUploadedLine(r.proof.byName, r.proof.at) : null}
                          <div className="text-x-muted">정산에는 안 보내요 (우리 보관용)</div></>} />
```

- `</dl>` 바로 뒤에 블록을 넣는다:

```tsx
          </dl>
          <PartnerResultBlock r={r} onChanged={onChanged} />
```

- props에 `onChanged: () => void`를 더하고 import를 추가한다. `settlementDetail` import는 쓰지 않게 되면 지운다.

- [ ] **Step 3: `RequestList`에 상단 요약과 배선을 넣는다**

`filtered` 계산 아래에 추가:

```tsx
  // 차액 확인이 필요한 건 — 알림이 없으므로 화면 안에서 눈에 띄어야 한다(스펙 §6-5)
  const needAck = useMemo(() => (rows ?? []).filter((r) => needsDiffAck(r)), [rows]);
```

필터 줄 바로 아래(`<h2>` 앞)에:

```tsx
      {needAck.length > 0 && filter.status !== 'paid_diff' && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-ui text-amber-700">
          정산 금액이 요청과 다른 지급이 {needAck.length}건 있어요 — 확인해 주세요
          <button type="button" className="underline" onClick={() => setFilter({ ...filter, status: 'paid_diff' })}>보기</button>
        </p>
      )}
```

`RequestRow`에 `onChanged={() => void load()}`를 넘긴다. import에 `needsDiffAck`를 추가한다.

- [ ] **Step 4: 빌드와 린트를 확인한다**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 오류 없음. 린트 경고가 **24개를 넘지 않는다**(기준선).

- [ ] **Step 5: 화면을 실제로 확인한다**

Run: `npm run build && npm run start -- -p 3001`
브라우저에서 `http://127.0.0.1:3001/settlement?tab=requests` (`next dev`·`localhost` 금지 — 하이드레이션이 조용히 실패하고 프록시에 잡힌다)

확인할 것:
1. `@_ponchan78` ¥3,165 건이 **`지급 완료 8/31`(초록)** 으로 뜬다 — 차액이 없으므로 확인 요구가 없다
2. 그 행을 펼치면 아래 블록에 `실지급액 31,650원`(차액 문구 없음) · `메모 — 정산 쪽이 안 적었어요` · `그쪽 건 번호 — 아직 보내오지 않아요`가 보인다
3. 상단 노란 요약 줄이 **없다**(차액 건이 0건이므로)

- [ ] **Step 6: 커밋**

```bash
git add src/app/settlement/PartnerResultBlock.tsx src/app/settlement/RequestRow.tsx src/app/settlement/RequestList.tsx
git commit -m "feat(settlement): 요청 펼침을 '우리가 보낸 요청'과 '정산 프로덕트가 보낸 결과' 두 블록으로 + 차액 확인"
```

---

## Task 8: 호출 기록 탭 — 본문·필터·커서 사람 말

지금은 최근 50건 고정이라, 그쪽 폴링이 5분마다면 50건은 약 4시간치다. 상태 전송 몇 건이 목록 폴링 수백 건에 묻혀 본문을 남겨도 볼 수 없다.

**Files:**
- Modify: `src/lib/externalLogCopy.ts`
- Modify: `src/app/api/settlement/external-log/route.ts`
- Modify: `src/lib/settlementApi.ts`
- Modify: `src/app/settlement/ExternalLogTab.tsx`
- Test: `src/lib/externalApiLog.test.ts`(문구·커서 해석)

**Interfaces:**
- Produces: `describeCursor(query: string | null): string | null`, `fetchExternalLog(f: { method?: string; rejectedOnly?: boolean; request?: string })`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/lib/externalApiLog.test.ts`에 추가:

```ts
test('describeCursor — 그쪽이 보낸 커서를 사람 말로 푼다', () => {
  // 2026-08-31T14:19:10.791678Z 마이크로초 + 요청 id
  const raw = '1788185950791678:f65553e4-8c26-47c8-a6cf-3cbab28541e3';
  const cursor = Buffer.from(raw).toString('base64url');
  const out = describeCursor(`?cursor=${cursor}&limit=100`);
  assert.ok(out && out.includes('이후 바뀐 것'), out ?? '(null)');
  assert.ok(out.includes('8/31'), out);
  assert.equal(describeCursor(null), null);
  assert.equal(describeCursor('?limit=100'), null);
  assert.equal(describeCursor('?cursor=쓰레기'), null);
});

test('목록 조회 문구 — 커서가 있으면 어디부터 가져갔는지 말한다', () => {
  const cursor = Buffer.from('1788185950791678:f65553e4-8c26-47c8-a6cf-3cbab28541e3').toString('base64url');
  const line = describeExternalCall(row({ method: 'GET', path: '/api/external/settlement/requests', outcome: 'ok', detail: '0건', query: `?cursor=${cursor}` })).line;
  assert.ok(line.includes('이후 바뀐 것을 가져갔어요'), line);
  assert.ok(line.includes('새로 바뀐 게 없었어요'), line);
});

test('필터 — 상태 전송만 / 거부된 것만 / 요청별', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  await insertExternalLog(sql, { method: 'GET', path: P + '/f-get', statusCode: 200, outcome: 'ok' });
  await insertExternalLog(sql, { method: 'POST', path: P + '/f-post', statusCode: 400, outcome: 'bad-request', detail: 'status' });
  const posts = await listExternalLog(sql, { limit: 50, method: 'POST' });
  assert.ok(posts.every((r) => r.method === 'POST'));
  const rejected = await listExternalLog(sql, { limit: 50, rejectedOnly: true });
  assert.ok(rejected.every((r) => r.statusCode >= 400));
  const byReq = await listExternalLog(sql, { limit: 50, requestId: id });
  assert.ok(byReq.every((r) => r.requestId === id));
});
```

`describeCursor`를 import에 더한다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/externalApiLog.test.ts`
Expected: FAIL — `describeCursor` 없음

- [ ] **Step 3: 문구 함수를 구현한다**

`src/lib/externalLogCopy.ts` — 이 파일은 클라이언트 컴포넌트가 import하므로 `Buffer`를 쓸 수 없다. 양쪽에서 되는 디코더를 쓴다:

```ts
import { kstDateTime } from './datetime.ts';

// 그쪽 폴링 커서를 사람 말로 — 목록 조회 기록에는 요청 번호가 없어서(건수만 남는다)
// "어디부터 가져갔나"가 안 보인다. 커서에 그 정보가 이미 들어 있으므로 풀어서 보여준다.
// 브라우저·서버 양쪽에서 동작해야 한다(이 파일은 클라이언트 컴포넌트가 import한다).
function b64urlToString(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('binary');
  } catch { return null; }
}

export function describeCursor(query: string | null): string | null {
  const m = (query ?? '').match(/cursor=([^&]+)/);
  if (!m) return null;
  const raw = b64urlToString(decodeURIComponent(m[1]));
  if (!raw) return null;
  const i = raw.indexOf(':');
  if (i < 0) return null;
  const us = raw.slice(0, i);
  if (!/^\d{1,16}$/.test(us)) return null;
  return `${kstDateTime(new Date(Number(us) / 1000).toISOString())} 이후 바뀐 것`;
}
```

`ExternalLogRow`에 `body: string | null`을 더한다.

`describeExternalCall`의 목록 조회 분기를 고친다:

```ts
    case 'ok':
      if (!row.path.endsWith('/status') && row.path.endsWith('/requests')) {
        const from = describeCursor(row.query);
        const empty = row.detail === '0건';
        const what = from ? `${from}을 가져갔어요` : '요청 목록을 처음부터 가져갔어요';
        return { line: empty ? `${what} — 새로 바뀐 게 없었어요` : what, tone: 'ok' };
      }
      return { line: '요청 1건을 조회했어요', tone: 'ok' };
```

- [ ] **Step 4: 라우트와 화면을 배선한다**

`src/app/api/settlement/external-log/route.ts`:

```ts
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const q = new URL(req.url).searchParams;
  const method = q.get('method');
  return NextResponse.json({ rows: await listExternalLog(getSql(), {
    limit: 50,
    method: method === 'GET' || method === 'POST' ? method : undefined,
    rejectedOnly: q.get('rejectedOnly') === '1',
    requestId: q.get('request'),
  }) });
}
```

`src/lib/settlementApi.ts`:

```ts
export const fetchExternalLog = (f: { method?: 'GET' | 'POST'; rejectedOnly?: boolean; request?: string } = {}) => {
  const p = new URLSearchParams();
  if (f.method) p.set('method', f.method);
  if (f.rejectedOnly) p.set('rejectedOnly', '1');
  if (f.request) p.set('request', f.request);
  const qs = p.toString();
  return call<{ rows: ExternalLogRow[] }>(`/api/settlement/external-log${qs ? `?${qs}` : ''}`);
};
```

`src/app/settlement/ExternalLogTab.tsx`:
- `useSearchParams()`로 `request`를 읽어 초기 필터에 넣는다(요청 내역의 `이 요청의 호출 기록 보기 →` 링크가 이걸 채운다).
- 필터 UI를 표 위에 둔다:

```tsx
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className={SEL} value={f.method ?? ''} onChange={(e) => setF({ ...f, method: (e.target.value || undefined) as 'GET' | 'POST' | undefined })} aria-label="방식">
          <option value="">방식 전체</option>
          <option value="POST">상태 전송만</option>
          <option value="GET">가져가기만</option>
        </select>
        <label className="flex items-center gap-1 text-ui text-x-secondary">
          <input type="checkbox" checked={!!f.rejectedOnly} onChange={(e) => setF({ ...f, rejectedOnly: e.target.checked })} />
          거부된 것만
        </label>
        {f.request && <button type="button" className="text-ui underline" onClick={() => setF({ ...f, request: undefined })}>요청 하나만 보는 중 — 전체 보기</button>}
      </div>
```

- 필터가 바뀌면 다시 불러온다(`useEffect`의 의존성에 `f`를 넣는다).
- 펼침 항목 두 곳을 고친다:

```tsx
                            <Item k="정산 프로덕트가 보낸 상태" v={row.sentStatus ?? '—'} />
                            <Item k="정산 프로덕트가 보낸 내용" v={row.body
                              ? <pre className="overflow-x-auto whitespace-pre-wrap break-all text-ui">{prettyBody(row.body)}</pre>
                              : '—'} />
```

`dl`의 첫 열 폭을 `120px` → `176px`로 넓힌다(항목 이름이 길어졌다).

파일 안에 헬퍼를 둔다:

```tsx
// 본문은 원문 문자열이다(깨진 JSON도 그대로 저장한다) — 읽히면 줄을 맞추고, 아니면 원문 그대로 보여준다
function prettyBody(body: string): string {
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}
```

- 탭 설명 문구를 고친다:

```tsx
      <p className="mt-1 text-ui text-x-muted">8/31 이전 호출은 기록 기능 배포 전이라 남아 있지 않아요.</p>
```

- [ ] **Step 5: 테스트·빌드를 확인한다**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/externalApiLog.test.ts`
Expected: PASS

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 오류 없음, 린트 24개 이하

- [ ] **Step 6: 화면을 확인한다**

`http://127.0.0.1:3001/settlement?tab=log`
1. `상태 전송만`을 고르면 POST만 남고, 행을 펼치면 `정산 프로덕트가 보낸 내용`이 보인다(8/31 20:02 지급 완료 건은 본문 기록 배포 전이라 `—`)
2. 목록 조회 행의 내용이 `8/31 23:19 이후 바뀐 것을 가져갔어요 — 새로 바뀐 게 없었어요`처럼 나온다
3. 요청 내역에서 `이 요청의 호출 기록 보기 →`를 누르면 그 요청 것만 보이고 `전체 보기` 버튼이 뜬다

- [ ] **Step 7: 커밋**

```bash
git add src/lib/externalLogCopy.ts src/app/api/settlement/external-log/route.ts src/lib/settlementApi.ts src/app/settlement/ExternalLogTab.tsx src/lib/externalApiLog.test.ts
git commit -m "feat(settlement): 호출 기록에 본문·필터·커서 사람 말 — 상태 전송이 폴링에 묻히지 않게"
```

---

## Task 9: 전체 검증 + 업데이트 소식

**Files:**
- Modify: `src/content/updates.ts`

- [ ] **Step 1: 전체 테스트를 돌린다**

Run: `npm test`
Expected: 전부 통과(약 4분). 실패하면 그 파일만 다시 돌려 원인을 좁힌다.

- [ ] **Step 2: 업데이트 소식을 쓴다**

`src/content/updates.ts`의 `UPDATES` 배열 **맨 위**에 추가:

```ts
  {
    date: '2026-09-01', type: '개선',
    title: '정산 금액이 요청과 다르면 알려드려요',
    summary: '정산 쪽이 보낸 지급 금액을 우리가 실제로 보낸 금액과 맞춰 보고, 다르면 확인하고 넘어갈 수 있게 했어요. 지금까지는 수수료가 차액으로 잘못 계산돼 금액이 맞는 지급도 다르게 보였어요.',
    bullets: [
      '요청 내역에서 행을 펼치면 "우리가 보낸 요청"과 "정산 프로덕트가 보낸 결과"가 나뉘어 보여요 — 어느 값이 누구 것인지 헷갈리지 않아요',
      '금액이 다른 지급은 노란 배지로 뜨고, 확인하면 누가 언제 확인했는지 남아요. 정산 쪽이 금액을 고쳐 보내면 확인이 자동으로 풀려요',
      '조정 사유는 정산 쪽 메모에 있는 것을 그대로 보여드려요 — 안 적혀 있으면 비어 있다고 표시해요',
      '정산 쪽이 보낸 내용을 그대로 보관해요 — 예전에는 다음 상태가 오면 앞선 메모가 사라졌어요',
      '드물게 호출 기록이 빠질 수 있던 원인을 고쳤어요 — 이제 "기록에 없으면 안 온 것"이라고 믿을 수 있어요',
    ],
    link: { label: '정산 요청 내역', href: '/settlement?tab=requests' },
  },
```

- [ ] **Step 3: 업데이트 소식 형식 테스트를 돌린다**

Run: `node --import tsx --test src/lib/updates.test.ts`
Expected: PASS(날짜 형식·빈 문자열을 검사한다)

- [ ] **Step 4: 커밋**

```bash
git add src/content/updates.ts
git commit -m "docs(updates): 정산 금액 차액 확인·그쪽 응답 보관 소식"
```

- [ ] **Step 5: 스테이징에 적용해 확인한다**

```bash
npm run migrate:staging
npm run deploy:staging
```

Expected: 마이그레이션 046 적용, 스테이징 배포 성공. 스테이징 정산 화면에서 Task 7·8의 화면 확인을 한 번 더 한다(스테이징에는 슬랙 이관 42건이 있어 목록이 비지 않는다).

---

## Self-Review 결과

**스펙 커버리지**

| 스펙 § | 태스크 |
|---|---|
| §3 데이터(046) | Task 2 |
| §4 본문 기록 | Task 6 |
| §5 펼침 두 블록 | Task 7 |
| §6-1 차액 기준 수정 | Task 1 |
| §6-2 파생값·배지 | Task 3 |
| §6-3 정정 시 확인 해제 | Task 5 |
| §6-4 확인·확인 취소 | Task 4 |
| §6-5 상단 요약·필터 | Task 3(필터) · Task 7(요약) |
| §7 기록 유실 막기 | Task 6 |
| §8 호출 기록 탭 | Task 8 |
| §11 배포 순서 | Task 2(046) · Task 9(updates·스테이징) |

**타입 일관성 확인** — `paidText(grossKrw, paidAmountKrw)`(Task 1)를 Task 7의 `PartnerResultBlock`은 직접 부르지 않고 `paidDiff`로 계산한다(중복 문구를 피한다). `listExternalLog`는 Task 6에서 `(sql, ExternalLogQuery)`로 한 번만 바뀌고 Task 8이 같은 시그니처를 쓴다. `SettlementBadge`·`StatusSource`에 더하는 세 필드 이름(`paidAmountKrw`·`grossKrw`·`diffAckAt`)이 두 파일에서 같다.

**남은 판단 하나** — 목록 배지 문구 `지급 완료 · 차액 확인 필요`가 좁은 화면에서 길면 `지급 완료 · 차액 확인`으로 줄인다. Task 7 Step 5의 화면 확인에서 판단한다.
