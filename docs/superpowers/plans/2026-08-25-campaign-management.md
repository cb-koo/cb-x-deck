# 캠페인 관리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클라이언트 1 × 기간 1 동안 나가는 원고 묶음을 "캠페인"으로 묶어, 진행(밀림 우선)·성과·비용(통화별)·계획(원고 추가·배정·예정일)을 매일 여는 운영 화면 하나에서 고친다.

**Architecture:** 새 엔티티 `campaign` + `campaign_influencer_cost`(추가 비용·메모만), `draft`에 `campaign_id·scheduled_on·cost` 3컬럼. 진행 단계·밀림·캠페인 상태·인플 목록·합계는 **저장하지 않고** `src/lib/campaignJudgment.ts` 순수 함수로 서버·클라가 같이 계산한다. 원고 편집은 전부 기존 `PATCH /api/drafts/[id]` 하나를 그대로 탄다(값은 하나 — 캠페인 전용 배정 경로 없음). 화면은 `/campaigns` 목록+상세(master-detail), 상세는 표가 기본이고 주간 달력으로 전환.

**Tech Stack:** Next.js 16.2(App Router) · postgres.js · node:test + tsx(실 DB) · Tailwind v4 토큰. **새 의존성 0.**

**스펙:** `docs/superpowers/specs/2026-08-25-campaign-management-design.md` (모든 결정의 근거 — §번호는 이 문서를 가리킨다)

## Global Constraints

- **이 리포의 Next.js(16.2.10)는 훈련 데이터와 다르다** — 라우트/페이지 코드 전 `node_modules/next/dist/docs/` 확인(AGENTS.md). 이 워크트리에 그 폴더가 없으면 `npm install` 후 확인하고, 그래도 없으면 기존 파일의 관례를 그대로 따른다: 라우트 `ctx: { params: Promise<{ id: string }> }` + `await ctx.params`, `useSearchParams`는 `<Suspense>` 안, `<Link onNavigate={...}>`, `history.replaceState`는 라우터와 통합됨(generate/page.tsx 주석).
- **UX 원칙 6개(AGENTS.md)** — 라벨은 이득 언어(내부 개념어 금지), 행동 전 기대 설정(한 줄 도움말), 숫자엔 판단 서술, 라벨-값 일치, 기술 값은 맥락으로 감쌈, 비용 액션 opt-in.
- **가독성 기준(스펙 §3-2, 하드)**: 본문 15px(`text-content`) · 보조 ≥13px(`text-ui`) · **12px 미만 금지(단위 라벨 `text-[12px]` 제외 — 기존 `text-caption`=11px는 캠페인 UI에서 쓰지 않는다)** · 표 행 ≥48px(`h-12` 또는 `py-3`) · 섹션 간격 28~32px(`mt-7`/`mt-8`) · 요약 숫자 24~26px(`text-[26px]`) + 라벨은 아래 13px.
- **통화는 합치지 않는다(§2-4)** — 모든 합계는 `MoneyByCurrency`(통화별), 표기는 `formatMoneyBy(m)` → `360,000원 · 95,000엔`(단일 금액은 `formatAmount(amount, currency)` = `influencerPricing.formatMoney` 재수출). 통화 변경 시 금액 변환 없음(도움말 한 줄).
- **값은 하나(§2-5)** — 인플 배정은 `draft.influencer_handle`, 캠페인 소속은 `draft.campaign_id`, 예정일·비용은 `draft.scheduled_on/cost`. 캠페인 화면·DraftCard·/generate 표가 전부 같은 컬럼을 `PATCH /api/drafts/[id]`로 고친다. 캠페인 전용 배정 API를 만들지 않는다.
- **패치 규칙(§2-3)** — `campaign_id·scheduled_on·cost`(및 bulk `campaignId`)는 `case when {patch.x !== undefined} then {value} else x end`: `undefined`=건드리지 않음 · `null`=지움 · 값=설정. `coalesce` 금지(지움 표현 불가).
- **파생값 정의(§2-4)** — 콘텐츠 단계 = `draft.status` 5종 + **게시됨**(`exists(tracked_post where draft_id=…)`, status는 바꾸지 않음) · **밀림** = `scheduled_on < 오늘(서울)` and 미게시 and `status ≠ unused` · **준비 중** = `draft+review+approved`(합성 라벨, `campaignJudgment`에만 정의) · **N**(게시됨 n/N) = 캠페인 원고 수 **미사용 제외**(밀림과 같은 모집단) · **기간 밖** = `scheduled_on ∉ [starts_on, ends_on]`(경고만) · **캠페인 상태** = 오늘<starts_on 예정 / 안 진행 중 / 오늘>ends_on 종료(수동 없음). "오늘"은 `kstToday()`.
- **마이그레이션 번호 033** — main은 032까지(032 = 협찬 단가·계정 분석, 이 브랜치에 머지 완료·`migrations/032_influencer_pricing_analysis.sql` 존재). `influencer.pricing` 컬럼은 **032가 만든다** — 033에 pricing DDL을 넣지 않는다. `scripts/apply-migrations.sh`가 전 파일을 재적용하므로 모든 문장 멱등(`if not exists`).
- `date` 컬럼은 항상 `to_char(col, 'YYYY-MM-DD')`로 읽는다(briefingStore 관례) — postgres.js가 Date로 돌려주면 시간대가 하루 민다. 날짜 산술은 `'YYYY-MM-DD'` 문자열(date-only 계열, `datetime.ts`).
- 비용 리터럴은 **지역 정의하지 않는다** — `src/lib/campaignCost.ts`가 `src/lib/influencerPricing.ts`(머지된 032 라이브러리)의 `Currency`·`PriceType`·`PRICE_TYPES`·`PRICE_TYPE_LABEL`·`CURRENCY_LABEL`·`Pricing`·`normalizeCurrency`·`formatMoney`를 import/재수출한다(`COST_TYPES`=`PRICE_TYPES`, `CostType`=`PriceType`, `formatAmount`=`formatMoney`). `influencer.pricing` 모양은 `Pricing` 타입 그대로 `{currency?: 'KRW'|'JPY', rt?, quoteRt?, post?, visit?}` — 통화는 pricing 레벨 하나, 기본 KRW(`normalizeCurrency`).
- 금액은 0 이상 정수만(§7). 오류 문구: 기간 역순 `종료일이 시작일보다 앞이에요` · 영문 코드는 `campaignMessage` 재사용 · 캠페인 미존재 `?id=` → 토스트 + 첫 캠페인 선택.
- 인증: 읽기 `requireAllowedUser`, 쓰기 `requireMember`(`@/lib/authGuard`). 워크스페이스 FK 없음(전 워크스페이스 공유 설계).
- 테스트: `npm test`(실 DB, 약 4분, `--test-concurrency=1`). 개발 중 단일 파일: `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>.test.ts`. 라우트 하네스 없음 → 라우트는 스토어 테스트 + koo 화면 QA(`npm run build && npm run start -- -p 3001`, `http://127.0.0.1:3001`).
- 린트 기준선 **24개** 유지(`npm run lint` 경고 수가 늘면 안 됨). 커밋 메시지는 한국어, `feat(campaign): …`.
- 주석은 리포 관례대로 한국어로 **왜**를 쓴다(무엇은 코드가 말한다).

---

## 파일 구조 (생성/수정 지도)

| 파일 | 책임 | Task |
|---|---|---|
| `migrations/033_campaign.sql` | 스키마(§2) | 1 |
| `src/lib/campaignCost.ts` (+test) | 통화·유형은 `influencerPricing.ts` 재수출, 금액/추가비용 검증, 통화별 합계·표기(`formatMoneyBy`), 단가 제안 | 1 |
| `src/lib/campaignJudgment.ts` (+test) | 단계·밀림·기간 밖·캠페인 상태·준비 중·요약·정렬·인플 목록·이름/코드 제안·주 계산·`isDateOnlyString` | 2 |
| `src/lib/draftStore.ts` (+`draftStore.campaign.test.ts`) | DraftRow 5필드 + `left join campaign`, case-when 패치, `listDraftsByCampaign`, `listUnassignedDrafts` | 3 |
| `src/lib/draftTypes.ts`, `src/lib/influencerStore.ts` | `InfluencerOption.pricing`(비용 제안 소스) | 3 |
| `src/lib/campaignStore.ts` (+test) | CRUD·목록(파생 수·합계)·상세(lateral 성과)·비용 upsert·인플 참여 캠페인 | 4 |
| `src/lib/draftFieldPatch.ts` (+test), `src/app/api/drafts/[id]/route.ts`, `src/app/api/drafts/route.ts`, `src/app/api/drafts/manual/route.ts`, `src/lib/generate.ts` | 원고 PATCH(단건·bulk) 새 필드, 생성 경로 `campaignId` | 5 |
| `src/lib/campaignInput.ts` (+test), `src/app/api/campaigns/route.ts`, `src/app/api/campaigns/[id]/route.ts` | 캠페인 입력 검증 + GET/POST, GET/PATCH/DELETE | 6 |
| `src/app/api/campaigns/[id]/influencers/[handle]/route.ts`, `src/app/api/campaigns/[id]/drafts/route.ts`, `src/lib/campaignApi.ts` (+test), `src/components/CostPopover.tsx`, `src/components/ScheduledOnField.tsx` | 추가 비용 PUT, 원고 후보 GET(추가는 Task 5의 bulk PATCH `campaignId`), 클라 fetch 헬퍼, 공용 비용·예정일 입력 | 7 |
| `src/lib/campaignTableView.ts` (+test), `src/app/campaigns/ContentTable.tsx`, `SummaryCards.tsx` | 표·카드 표시 문자열(순수) · 콘텐츠 표(6열) · 요약 카드 4 | 8 |
| `src/lib/campaignCostEdit.ts` (+test), `src/app/campaigns/InfluencerCostTable.tsx`, `AddDraftsModal.tsx` | 추가 비용 배열 편집(순수) · 인플별 비용 표(+추가 비용 다이얼로그·메모) · 원고 추가 모달 | 9 |
| `src/app/campaigns/CampaignHeader.tsx`, `CampaignDetail.tsx`, `useCampaignDraftActions.ts`, `LinkPostModal.tsx` | 헤더 인라인 수정·삭제 확인 · 상세 컨테이너(로드·낙관적 갱신·DraftCard 모달) · 게시물 연결 | 10 |
| `src/lib/campaignView.ts` (+test), `src/app/campaigns/page.tsx`, `layout.tsx`, `CampaignList.tsx`, `CampaignCreateModal.tsx`, `src/components/Sidebar.tsx`, `src/components/XIcons.tsx` | 목록 그룹·선택 규칙(순수) · 목록+상세 셸, 생성 모달, 사이드바 | 11 |
| `src/lib/draftCampaignOptions.ts` (+test), `src/components/DraftCampaignField.tsx`, `DraftCard.tsx`, `TrackingLinkSection.tsx`, `LinkCreateModal.tsx` | DraftCard 캠페인 칸(`campaign` prop 객체) · 트래킹 링크 `campaignCode` prefill | 12 |
| `src/app/generate/page.tsx`, `src/components/DraftWriteModal.tsx`, `DraftTable.tsx`, `DraftFilterBar.tsx`, `src/lib/draftUi.ts` (+test) | `?campaign=` 딥링크·배너·생성/직접쓰기 campaignId · 표 캠페인 열+필터 | 13 |
| `src/lib/influencerStore.ts` (+test), `src/app/influencers/CampaignSection.tsx`, `InfluencerProfile.tsx` | 핸들 변경 시 비용 행 이관+병합 · "참여 캠페인" 섹션 | 14 |
| `src/lib/campaignCalendar.ts` (+test), `src/app/campaigns/WeekCalendar.tsx`, `CampaignDetail.tsx`, `page.tsx` | 주간 달력 + [표\|주간 달력] 세그먼트 + 캠페인 화면 DraftCard `campaign` prop 배선 | 15 |

## 병렬 그룹 · 모델 배정

| Task | 내용 | Parallel group | Suggested model |
|---|---|---|---|
| 1 | 마이그레이션 033 + `campaignCost.ts` | G1 (순차 1번째) | sonnet |
| 2 | `campaignJudgment.ts` | G1 (순차 2번째) | opus |
| 3 | draftStore 확장 + InfluencerOption.pricing | G1 (순차 3번째) | opus |
| 4 | `campaignStore.ts` | G1 (순차 4번째) | opus |
| 5 | 원고 PATCH/생성 라우트 새 필드 | G2 (G1 후, G3와 병렬) | sonnet |
| 6 | 캠페인 입력 검증 + `/api/campaigns`, `/api/campaigns/[id]` | G3 (G1 후, G2와 병렬) | opus |
| 7 | 인플 비용 PUT · 원고 후보 GET · `campaignApi.ts` · CostPopover · ScheduledOnField | G3 (Task 6 후) | sonnet |
| 8 | ContentTable + SummaryCards | G4 (G2+G3 후, Task 9와 병렬) | opus |
| 9 | InfluencerCostTable + AddDraftsModal | G4 (G2+G3 후, Task 8과 병렬) | sonnet |
| 10 | CampaignHeader + CampaignDetail 컨테이너 + useCampaignDraftActions | G4 (Task 8·9 후) | opus |
| 11 | page/layout/CampaignList/CampaignCreateModal/Sidebar | G4 (Task 10 후) | sonnet |
| 12 | DraftCampaignField · DraftCard `campaign` prop · 트래킹 링크 campaignCode prefill | G5 (G2+G3 후, G4와 병렬) | opus |
| 13 | /generate 배선(`?campaign=`·배너·생성/직접쓰기) + DraftTable 캠페인 열·필터 | G5 (Task 12 후) | opus |
| 14 | renameInfluencer 비용 행 이관·병합 + 인플 프로필 "참여 캠페인" | G5 (G2+G3 후, Task 12·13과 병렬) | sonnet |
| 15 | 주간 달력 + 세그먼트 전환 | G6 (전부 끝난 뒤) | opus |

---

### Task 1: 마이그레이션 033 + `src/lib/campaignCost.ts` (통화·유형·검증·합계)

**Parallel group:** G1 (첫 번째, 순차)
**Suggested model:** sonnet

**Files:**
- Create: `migrations/033_campaign.sql`
- Create: `src/lib/campaignCost.ts`
- Test: `src/lib/campaignCost.test.ts`

**Interfaces:**
- Consumes: `src/lib/influencerPricing.ts`(머지된 032 라이브러리) — `Currency`, `PriceType`, `PRICE_TYPES`, `PRICE_TYPE_LABEL`, `CURRENCY_LABEL`, `Pricing`, `normalizeCurrency`, `formatMoney`. 테이블 `influencer`(024, `pricing`은 032), `draft`(014~025), `client`(001/029), `member`.
- Produces (Task 2~15가 사용):
  - 테이블 `campaign`, `campaign_influencer_cost`, `draft.campaign_id/scheduled_on/cost`
  - 재수출: `type Currency`, `type PriceType`, `type Pricing`, `CURRENCY_LABEL`, `normalizeCurrency`, `COST_TYPES`(=`PRICE_TYPES`), `COST_TYPE_LABEL`(=`PRICE_TYPE_LABEL`), `formatAmount(amount: number, currency: Currency): string`(=`formatMoney`, `'360,000원'`)
  - `type CostType = PriceType`(캠페인 쪽 이름), `CURRENCIES: readonly Currency[]`(`['KRW','JPY']` — influencerPricing은 목록을 내보내지 않는다), `isCurrency(v): v is Currency`, `isCostType(v): v is CostType`
  - `interface DraftCost { type: CostType; amount: number; currency: Currency }`
  - `interface ExtraCost { label: string; amount: number; currency: Currency }`
  - `type MoneyByCurrency = Partial<Record<Currency, number>>`
  - `type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }`
  - `AMOUNT_MESSAGE`, `parseAmount(v: unknown): number | null`
  - `parseDraftCost(v: unknown): Parsed<DraftCost | null>` (null = 지움 허용)
  - `parseExtraCosts(v: unknown): Parsed<ExtraCost[]>`
  - `sumMoney(items: ReadonlyArray<{ amount: number; currency: Currency }>): MoneyByCurrency`
  - `mergeMoney(...parts: MoneyByCurrency[]): MoneyByCurrency`
  - `moneyParts(m: MoneyByCurrency): Array<{ currency: Currency; amount: number }>`
  - `formatMoneyBy(m: MoneyByCurrency): string` → `'360,000원 · 95,000엔'` / 비면 `'—'`
  - `suggestDraftCost(pricing: Pricing | null | undefined, type: CostType): DraftCost | null`

- [ ] **Step 1: 마이그레이션 파일 작성** (`migrations/033_campaign.sql`)

```sql
-- 033: 캠페인 관리 — campaign · campaign_influencer_cost · draft 3컬럼
-- 설계: docs/superpowers/specs/2026-08-25-campaign-management-design.md §2
-- main은 032까지(032 = 협찬 단가·계정 분석 — influencer.pricing은 그쪽이 만든다) → 033.
-- scripts/apply-migrations.sh가 전 파일을 다시 돌므로 모든 문장이 재실행 안전해야 한다.

-- 캠페인 = 클라이언트 1 × 기간 1 동안 나가는 원고의 묶음(§0).
-- 상태·인플 목록·합계는 저장하지 않고 계산한다(§2-4) — 저장하면 원고 배정과 어긋나는 값이 생긴다(§10).
create table if not exists campaign (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references client(id) on delete set null,
  client_name text,                                   -- 스냅샷(014 관례) — 클라 삭제 후에도 표시 유지
  name        text not null,                          -- 화면 이름. 기본 제안 '{클라} {M월 N주}', 수정 가능
  name_en     text not null,                          -- 영문 코드(checkCampaign 규칙) → 트래킹 링크 utm_campaign 기본값
  starts_on   date not null,                          -- 서울 기준 날짜(DateOnly). 읽을 때 to_char 필수(시간대 시프트 방지)
  ends_on     date not null,
  kind        text check (kind in ('content', 'visit', 'seeding')), -- null 허용. 표시·필터용, 로직 분기 없음
  note        text not null default '',
  created_by  uuid references member(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),     -- 트리거 없음 — 스토어가 updated_at = now() 수동 갱신(clientStore 관례)
  constraint campaign_period_check check (ends_on >= starts_on)
);
create index if not exists idx_campaign_client on campaign (client_id);
create index if not exists idx_campaign_starts on campaign (starts_on desc);

-- 명단이 아니다(§2-2) — 캠페인×핸들에 붙는 추가 비용·메모의 저장소. 행은 처음 적을 때 생긴다.
-- 인플 목록 자체는 원고의 influencer_handle에서 파생한다(§2-4).
create table if not exists campaign_influencer_cost (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references campaign(id) on delete cascade,
  influencer_handle text not null,                    -- 핸들 자연키(023 관례), 사용자가 친 표기 보존
  extra_costs       jsonb not null default '[]',      -- [{label: string, amount: int ≥ 0, currency: 'KRW'|'JPY'}]
  note              text not null default '',         -- 이 캠페인에서 이 사람에 대한 한 줄
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- 핸들은 대소문자 무관 — 표기는 보존하되 같은 캠페인 안의 중복은 소문자 기준으로 막는다(influencer 관례)
create unique index if not exists idx_cic_campaign_handle_lower
  on campaign_influencer_cost (campaign_id, lower(influencer_handle));

-- 원고가 캠페인의 단위(§0). 원고는 캠페인보다 오래 산다 → 캠페인 삭제 시 set null(예정일·비용은 원고에 남는다).
alter table draft add column if not exists campaign_id uuid references campaign(id) on delete set null;
alter table draft add column if not exists scheduled_on date;   -- 게시 예정일(서울). null = 미정
alter table draft add column if not exists cost jsonb;          -- {type, amount, currency}. null = 없음
create index if not exists idx_draft_campaign on draft (campaign_id);
```

- [ ] **Step 2: DB에 적용** (리포 관례 — `.env`가 가리키는 단일 DB. 이 워크트리에 `.env`가 없으면 `vercel env pull .env --environment=production` — 메모리 `cb-x-deck-env-from-vercel`)

```bash
set -a; source .env; set +a; psql -v ON_ERROR_STOP=1 -f migrations/033_campaign.sql
```

Expected: `CREATE TABLE` ×2, `CREATE INDEX` ×4, `ALTER TABLE` ×3, 오류 없음. 두 번 실행해도 같은 결과(멱등). 이어서 `psql -c "\d influencer" | grep pricing`으로 032의 `pricing jsonb` 컬럼이 이미 있는지 확인한다(없으면 `npm run migrate`로 전체 재적용).

- [ ] **Step 3: 실패하는 테스트 작성** (`src/lib/campaignCost.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES, COST_TYPES, COST_TYPE_LABEL, AMOUNT_MESSAGE,
  parseAmount, parseDraftCost, parseExtraCosts,
  sumMoney, mergeMoney, moneyParts, formatAmount, formatMoneyBy, suggestDraftCost,
} from './campaignCost.ts';
import { PRICE_TYPES, PRICE_TYPE_LABEL } from './influencerPricing.ts';

test('1) 리터럴은 influencerPricing과 한 벌 — 재수출이 같은 객체를 가리킨다(문자열 두 벌 금지)', () => {
  assert.equal(COST_TYPES, PRICE_TYPES);
  assert.equal(COST_TYPE_LABEL, PRICE_TYPE_LABEL);
  assert.deepEqual([...CURRENCIES], ['KRW', 'JPY']);
  assert.deepEqual([...COST_TYPES], ['rt', 'quoteRt', 'post', 'visit']);
});

test('2) parseAmount — 0 이상 정수만, 콤마 문자열은 받고 소수·음수·빈 값은 거절', () => {
  assert.equal(parseAmount(0), 0);
  assert.equal(parseAmount(30000), 30000);
  assert.equal(parseAmount('30,000'), 30000);   // 입력칸 값은 문자열이다
  assert.equal(parseAmount(' 12 '), 12);
  assert.equal(parseAmount(-1), null);
  assert.equal(parseAmount(1.5), null);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
});

test('3) parseDraftCost — null은 지움, 세 필드 검증, 오류 문구가 비어 있지 않다', () => {
  assert.deepEqual(parseDraftCost(null), { ok: true, value: null });
  assert.deepEqual(parseDraftCost({ type: 'post', amount: '50000', currency: 'JPY' }),
    { ok: true, value: { type: 'post', amount: 50000, currency: 'JPY' } });
  const badType = parseDraftCost({ type: 'gift', amount: 1, currency: 'KRW' });
  assert.equal(badType.ok, false);
  const badAmount = parseDraftCost({ type: 'rt', amount: -5, currency: 'KRW' });
  assert.equal(badAmount.ok, false);
  if (!badAmount.ok) assert.equal(badAmount.message, AMOUNT_MESSAGE);
  assert.equal(parseDraftCost({ type: 'rt', amount: 1, currency: 'USD' }).ok, false);
  assert.equal(parseDraftCost('x').ok, false);
});

test('4) parseExtraCosts — 항목명 공백 트림·필수, 배열 아니면 거절', () => {
  const ok = parseExtraCosts([{ label: ' 교통비 ', amount: 20000, currency: 'KRW' }]);
  assert.deepEqual(ok, { ok: true, value: [{ label: '교통비', amount: 20000, currency: 'KRW' }] });
  assert.deepEqual(parseExtraCosts([]), { ok: true, value: [] });
  assert.equal(parseExtraCosts([{ label: '  ', amount: 1, currency: 'KRW' }]).ok, false);
  assert.equal(parseExtraCosts({ label: 'x' }).ok, false);
});

test('5) 통화별 합계 — 통화 간 합산 금지, 원→엔 고정 순서, 비면 —', () => {
  const m = sumMoney([
    { amount: 300000, currency: 'KRW' }, { amount: 60000, currency: 'KRW' }, { amount: 95000, currency: 'JPY' },
  ]);
  assert.deepEqual(m, { KRW: 360000, JPY: 95000 });
  assert.deepEqual(mergeMoney({ KRW: 1 }, { JPY: 2 }, { KRW: 3 }), { KRW: 4, JPY: 2 });
  assert.deepEqual(moneyParts({ JPY: 5, KRW: 1 }), [{ currency: 'KRW', amount: 1 }, { currency: 'JPY', amount: 5 }]);
  assert.equal(formatAmount(360000, 'KRW'), '360,000원');           // = influencerPricing.formatMoney
  assert.equal(formatMoneyBy({ KRW: 360000, JPY: 95000 }), '360,000원 · 95,000엔');
  assert.equal(formatMoneyBy({}), '—');
  assert.equal(formatMoneyBy({ KRW: 0 }), '0원'); // 0은 값이다 — '없음'과 다르다
});

test('6) suggestDraftCost — pricing[type]이 있을 때만, 통화는 pricing 레벨 하나(normalizeCurrency, 기본 KRW)', () => {
  assert.deepEqual(suggestDraftCost({ post: 50000, currency: 'JPY' }, 'post'), { type: 'post', amount: 50000, currency: 'JPY' });
  assert.deepEqual(suggestDraftCost({ rt: 100000 }, 'rt'), { type: 'rt', amount: 100000, currency: 'KRW' });
  assert.equal(suggestDraftCost({ rt: 100000 }, 'visit'), null);   // 그 유형 금액이 없으면 제안 없음
  assert.equal(suggestDraftCost({ rt: null }, 'rt'), null);        // 단가 지움(null)도 제안 없음
  assert.equal(suggestDraftCost({}, 'post'), null);
  assert.equal(suggestDraftCost(null, 'post'), null);
  assert.equal(suggestDraftCost(undefined, 'post'), null);         // 명부에 없는 핸들(InfluencerOption 없음)
  assert.equal(suggestDraftCost({ post: 1.5 }, 'post'), null);     // jsonb는 모양을 보증하지 않는다 — 정수 아니면 제안 없음
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCost.test.ts`
Expected: FAIL — `Cannot find module './campaignCost.ts'`

- [ ] **Step 5: 구현** (`src/lib/campaignCost.ts`)

```ts
// 캠페인 비용의 순수 로직 — 입력 검증, 통화별 합계, 표기, 단가 제안.
// 통화·유형 리터럴과 단일 금액 표기는 influencerPricing.ts(032 협찬 단가)의 것을 그대로 쓴다 — 같은 문자열을
// 두 벌 두면 한쪽만 고쳐지는 드리프트가 나고, 인플 프로필의 단가 칸과 캠페인 비용 칸이 다른 말을 하게 된다(스펙 §2-3).
// 서버(라우트 검증)와 브라우저(팝오버·표)가 같은 함수를 쓴다.
import { PRICE_TYPES, normalizeCurrency, formatMoney, type Currency, type PriceType, type Pricing } from './influencerPricing.ts';

export {
  PRICE_TYPES as COST_TYPES, PRICE_TYPE_LABEL as COST_TYPE_LABEL, CURRENCY_LABEL, normalizeCurrency,
  formatMoney as formatAmount,   // 단일 금액 '360,000원' — 이름을 바꿔 내보내는 이유: 아래 formatMoneyBy(통화별 병기)와 헷갈리지 않게
  type Currency, type PriceType, type Pricing,
} from './influencerPricing.ts';
export type CostType = PriceType; // 캠페인 쪽 이름 — 원고 비용의 '유형'은 곧 단가 유형이다

// influencerPricing은 통화 목록을 내보내지 않는다(내부 상수) — 표·카드가 그리는 고정 순서(원 → 엔)로 여기서 든다.
export const CURRENCIES: readonly Currency[] = ['KRW', 'JPY'];

export interface DraftCost { type: CostType; amount: number; currency: Currency }
export interface ExtraCost { label: string; amount: number; currency: Currency }
// 통화별 합계 — 키가 없는 통화는 0이 아니라 '해당 없음'. 통화 간 합산은 어디서도 하지 않는다(스펙 §2-4).
export type MoneyByCurrency = Partial<Record<Currency, number>>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };
export const AMOUNT_MESSAGE = '금액은 0 이상의 정수로 입력해 주세요';
export const CURRENCY_MESSAGE = '통화는 원(KRW) 또는 엔(JPY)만 고를 수 있어요';
export const COST_TYPE_MESSAGE = '비용 유형 값이 올바르지 않아요';
export const EXTRA_LABEL_MESSAGE = '추가 비용 항목 이름을 입력해 주세요';

export function isCurrency(v: unknown): v is Currency {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);
}
export function isCostType(v: unknown): v is CostType {
  return typeof v === 'string' && (PRICE_TYPES as readonly string[]).includes(v);
}

// 0 이상 정수만(단가 검증 parsePricingPatch 규칙과 동일, 스펙 §7). 문자열('30,000')도 받는다 — 입력칸 값은 문자열이다.
export function parseAmount(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
  return n;
}

// null = 지움(허용) · 객체 = 세 필드 검증. undefined('건드리지 않음')는 호출부(라우트)가 먼저 걸러낸다.
export function parseDraftCost(v: unknown): Parsed<DraftCost | null> {
  if (v === null) return { ok: true, value: null };
  if (!v || typeof v !== 'object') return { ok: false, message: '비용 형식이 올바르지 않아요' };
  const o = v as { type?: unknown; amount?: unknown; currency?: unknown };
  if (!isCostType(o.type)) return { ok: false, message: COST_TYPE_MESSAGE };
  const amount = parseAmount(o.amount);
  if (amount === null) return { ok: false, message: AMOUNT_MESSAGE };
  if (!isCurrency(o.currency)) return { ok: false, message: CURRENCY_MESSAGE };
  return { ok: true, value: { type: o.type, amount, currency: o.currency } };
}

export function parseExtraCosts(v: unknown): Parsed<ExtraCost[]> {
  if (!Array.isArray(v)) return { ok: false, message: '추가 비용 형식이 올바르지 않아요' };
  const out: ExtraCost[] = [];
  for (const item of v) {
    const o = (item ?? {}) as { label?: unknown; amount?: unknown; currency?: unknown };
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) return { ok: false, message: EXTRA_LABEL_MESSAGE };
    const amount = parseAmount(o.amount);
    if (amount === null) return { ok: false, message: AMOUNT_MESSAGE };
    if (!isCurrency(o.currency)) return { ok: false, message: CURRENCY_MESSAGE };
    out.push({ label, amount, currency: o.currency });
  }
  return { ok: true, value: out };
}

export function sumMoney(items: ReadonlyArray<{ amount: number; currency: Currency }>): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const it of items) out[it.currency] = (out[it.currency] ?? 0) + it.amount;
  return out;
}

export function mergeMoney(...parts: MoneyByCurrency[]): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const p of parts) {
    for (const c of CURRENCIES) {
      const v = p[c];
      if (v !== undefined) out[c] = (out[c] ?? 0) + v;
    }
  }
  return out;
}

// 통화 고정 순서(원 → 엔)로 존재하는 것만 — 표·카드가 같은 순서로 그린다
export function moneyParts(m: MoneyByCurrency): Array<{ currency: Currency; amount: number }> {
  return CURRENCIES.filter((c) => m[c] !== undefined).map((c) => ({ currency: c, amount: m[c] as number }));
}

// '360,000원 · 95,000엔' — 통화 병기, 합치지 않는다. 비어 있으면 '—'(값 없음 관례). 단일 금액은 formatAmount(재수출).
export function formatMoneyBy(m: MoneyByCurrency): string {
  const parts = moneyParts(m);
  return parts.length ? parts.map((p) => formatMoney(p.amount, p.currency)).join(' · ') : '—';
}

// 인플루언서 단가(influencer.pricing, Pricing 타입)에서 제안. 통화는 유형별이 아니라 pricing 레벨 하나,
// 없으면 KRW — normalizeCurrency가 프로필 단가 칸과 같은 규칙이다(리뷰 Blocking 3).
// pricing이 없거나({}·undefined) 그 유형 금액이 없으면 제안 없음(null) — 빈칸으로 둔다(스펙 §3-2 비용 셀).
// jsonb 원본이라 모양을 100% 믿지 않는다 — 정수 검증(parseAmount)을 한 번 더 거친다.
export function suggestDraftCost(pricing: Pricing | null | undefined, type: CostType): DraftCost | null {
  if (!pricing) return null;
  const amount = parseAmount(pricing[type]);
  if (amount === null) return null;
  return { type, amount, currency: normalizeCurrency(pricing) };
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCost.test.ts`
Expected: PASS 6건

- [ ] **Step 7: Commit**

```bash
git add migrations/033_campaign.sql src/lib/campaignCost.ts src/lib/campaignCost.test.ts
git commit -m "feat(campaign): 스키마 033(campaign·인플 추가비용·draft 3컬럼) + 비용 순수 로직(influencerPricing 재수출·통화별 합계·검증·단가 제안)"
```

---

### Task 2: `src/lib/campaignJudgment.ts` — 판정 순수 함수(단계·밀림·기간 밖·상태·준비 중·요약·정렬·인플 목록·제안·주 계산)

**Parallel group:** G1 (두 번째, Task 1 후)
**Suggested model:** opus

**Files:**
- Create: `src/lib/campaignJudgment.ts`
- Test: `src/lib/campaignJudgment.test.ts`

**Interfaces:**
- Consumes: `STATUS_LABEL`, `DraftStatus` (`./draftStatus.ts`) · `checkCampaign` (`./trackingLink.ts`) · `sumMoney`, `mergeMoney`, `DraftCost`, `ExtraCost`, `MoneyByCurrency`, `CostType` (Task 1)
- Produces (Task 4·8·9·10·11·12·13·14·15가 사용):
  - `isDateOnlyString(v: unknown): v is string`(`'YYYY-MM-DD'`만 — Task 5·6 라우트 검증이 공유. 두 태스크가 병렬이라 여기 둔다) · `addDays(date: string, n: number): string` · `daysBetweenDates(from: string, to: string): number` · `weekStartOf(date: string): string`(월요일) · `weekDays(weekStart: string): string[]`(7개) · `initialWeekStart(startsOn, endsOn, today): string` · `nextWeekRange(today): { startsOn: string; endsOn: string }` · `formatDateKo(date: string): string`(`'8/26 수'`)
  - `type CampaignStatus = 'upcoming' | 'active' | 'ended'`, `CAMPAIGN_STATUS_LABEL`, `campaignStatus(startsOn, endsOn, today): CampaignStatus`
  - `CAMPAIGN_KINDS`, `type CampaignKind = 'content' | 'visit' | 'seeding'`, `CAMPAIGN_KIND_LABEL`, `isCampaignKind(v: unknown): v is CampaignKind`, `defaultCostType(kind: CampaignKind | null): CostType`
  - `type ContentStage = DraftStatus | 'published'`, `STAGE_LABEL`, `interface StageInput { status: DraftStatus; published: boolean; scheduledOn: string | null }`, `contentStage(d): ContentStage`, `isOverdue(d, today): boolean`, `isOutOfRange(scheduledOn, startsOn, endsOn): boolean`
  - `PREPARING_STATUSES`, `PREPARING_LABEL = '준비 중'`, `isPreparing(d): boolean`
  - `type StageFilter = 'all' | 'preparing' | 'delivered' | 'published'`, `STAGE_FILTER_LABEL`, `matchesStageFilter(d, f): boolean`
  - `interface CampaignSummary { total; published; delivered; preparing; overdue }`, `summarizeStages(items: StageInput[], today): CampaignSummary`
  - `interface PerfInput { published: boolean; perf: { views: number | null; likes: number | null } | null; linkClicks: number | null }`, `interface PerfSummary { publishedCount; views: number | null; likes: number | null; linkClicks: number | null }`, `summarizePerf(items: PerfInput[]): PerfSummary`
  - `type ContentSortKey = 'default' | 'scheduled' | 'stage' | 'influencer'`, `CONTENT_SORT_LABEL`, `interface SortInput extends StageInput { influencerHandle: string | null; createdAt: string }`, `sortContent<T extends SortInput>(items: T[], key, today): T[]`
  - `interface CostInput { influencerHandle: string | null; status: DraftStatus; cost: DraftCost | null }`, `interface CostRowInput { influencerHandle: string; extraCosts: ExtraCost[]; note: string }`, `interface InfluencerLine { handle: string | null; contentCount: number; contentCost: MoneyByCurrency; extraCosts: ExtraCost[]; extraCost: MoneyByCurrency; subtotal: MoneyByCurrency; note: string; hasCostRow: boolean }`, `deriveInfluencers(drafts: CostInput[], costRows: CostRowInput[]): InfluencerLine[]`, `campaignTotal(lines: InfluencerLine[]): MoneyByCurrency`
  - `suggestCampaignName(clientName: string, startsOn: string): string` · `suggestCampaignCode(clientNameEn: string, startsOn: string): string`

스펙 모호점 해소(이 계획의 결정): ① 미사용(`unused`) 원고는 게시됨 여부와 무관하게 요약 N·인플 콘텐츠 수·비용 합계에서 제외한다(단계 칩은 게시됨이면 게시됨을 표시). ② 인플 목록에 **미배정 원고 묶음**(`handle: null`)을 원고가 있을 때만 한 줄 추가한다 — 그래야 "캠페인 합계 = 인플 소계 합"이 실제로 성립한다(미배정 원고 비용이 합계에서 사라지지 않는다). ③ 비용 제안의 유형은 캠페인 유형에서 파생: `visit` → `'visit'`, 그 외 → `'post'`.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignJudgment.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDateOnlyString, addDays, daysBetweenDates, weekStartOf, weekDays, initialWeekStart, nextWeekRange, formatDateKo,
  campaignStatus, defaultCostType,
  contentStage, isOverdue, isOutOfRange, isPreparing, matchesStageFilter, summarizeStages, summarizePerf,
  sortContent, deriveInfluencers, campaignTotal, suggestCampaignName, suggestCampaignCode,
  type StageInput, type SortInput,
} from './campaignJudgment.ts';

const T = '2026-08-27'; // 목요일

test('1) 날짜 산술 — 시간대 시프트 없음, 월요일 시작 주, 월/연 경계', () => {
  assert.equal(isDateOnlyString('2026-08-26'), true);
  assert.equal(isDateOnlyString('2026-08-26T00:00:00Z'), false); // 시각이 붙으면 date 컬럼이 하루 민다
  assert.equal(isDateOnlyString('2026-8-26'), false);
  assert.equal(isDateOnlyString('2026-13-40'), false);           // 형식은 맞아도 달력에 없는 날
  assert.equal(isDateOnlyString(null), false);
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(daysBetweenDates('2026-08-26', T), 1);
  assert.equal(daysBetweenDates(T, '2026-08-26'), -1);
  assert.equal(weekStartOf(T), '2026-08-24');            // 목 → 월
  assert.equal(weekStartOf('2026-08-30'), '2026-08-24'); // 일 → 그 주 월(다음 주 아님)
  assert.equal(weekStartOf('2026-08-24'), '2026-08-24');
  assert.deepEqual(weekDays('2026-08-24').at(-1), '2026-08-30');
  assert.equal(weekDays('2026-08-24').length, 7);
  assert.deepEqual(nextWeekRange(T), { startsOn: '2026-08-31', endsOn: '2026-09-06' });
  assert.equal(formatDateKo('2026-08-26'), '8/26 수');
});

test('2) 달력 초기 주 — 오늘이 기간 안이면 오늘의 주, 밖이면 시작일의 주', () => {
  assert.equal(initialWeekStart('2026-08-24', '2026-09-06', T), '2026-08-24');
  assert.equal(initialWeekStart('2026-09-07', '2026-09-13', T), '2026-09-07');
  assert.equal(initialWeekStart('2026-08-03', '2026-08-09', T), '2026-08-03'); // 종료된 캠페인
});

test('3) 캠페인 상태 — 기간에서만 파생(경계 포함)', () => {
  assert.equal(campaignStatus('2026-08-28', '2026-09-03', T), 'upcoming');
  assert.equal(campaignStatus('2026-08-27', '2026-08-27', T), 'active');  // 하루짜리, 오늘
  assert.equal(campaignStatus('2026-08-20', '2026-08-26', T), 'ended');
  assert.equal(defaultCostType('visit'), 'visit');
  assert.equal(defaultCostType('content'), 'post');
  assert.equal(defaultCostType(null), 'post');
});

const d = (o: Partial<StageInput>): StageInput => ({ status: 'draft', published: false, scheduledOn: null, ...o });

test('4) 단계·밀림·기간 밖·준비 중 — 게시됨이 status를 이긴다, 미사용은 밀림이 아니다', () => {
  assert.equal(contentStage(d({ status: 'draft', published: true })), 'published');
  assert.equal(contentStage(d({ status: 'delivered' })), 'delivered');
  assert.equal(isOverdue(d({ scheduledOn: '2026-08-26' }), T), true);
  assert.equal(isOverdue(d({ scheduledOn: T }), T), false);                        // 오늘은 아직 안 밀림
  assert.equal(isOverdue(d({ scheduledOn: '2026-08-26', published: true }), T), false);
  assert.equal(isOverdue(d({ scheduledOn: '2026-08-26', status: 'unused' }), T), false);
  assert.equal(isOverdue(d({ scheduledOn: null }), T), false);
  assert.equal(isOutOfRange('2026-09-07', '2026-08-24', '2026-09-06'), true);
  assert.equal(isOutOfRange('2026-09-06', '2026-08-24', '2026-09-06'), false);
  assert.equal(isOutOfRange(null, '2026-08-24', '2026-09-06'), false);
  assert.equal(isPreparing(d({ status: 'approved' })), true);
  assert.equal(isPreparing(d({ status: 'approved', published: true })), false);
  assert.equal(isPreparing(d({ status: 'delivered' })), false);
  assert.equal(matchesStageFilter(d({ status: 'review' }), 'preparing'), true);
  assert.equal(matchesStageFilter(d({ status: 'delivered', published: true }), 'delivered'), false); // 게시됨은 전달됨 필터에 안 걸림
  assert.equal(matchesStageFilter(d({ status: 'delivered', published: true }), 'published'), true);
  assert.equal(matchesStageFilter(d({ status: 'unused' }), 'all'), true);
});

test('5) 요약 — N은 미사용 제외, 게시됨/전달됨/준비 중/밀림이 같은 모집단', () => {
  const s = summarizeStages([
    d({ status: 'draft', scheduledOn: '2026-08-25' }),            // 준비 중 + 밀림
    d({ status: 'review' }),                                      // 준비 중
    d({ status: 'delivered', scheduledOn: '2026-08-26' }),        // 전달됨 + 밀림
    d({ status: 'delivered', published: true, scheduledOn: '2026-08-25' }), // 게시됨(밀림 아님)
    d({ status: 'unused', scheduledOn: '2026-08-20' }),           // 제외
  ], T);
  assert.deepEqual(s, { total: 4, published: 1, delivered: 1, preparing: 2, overdue: 2 });
  assert.deepEqual(summarizeStages([], T), { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0 });
});

test('6) 성과 합계 — 스냅샷 없으면 null 유지(0으로 위장 금지), 링크 클릭은 미게시 원고 것도 합산', () => {
  const p = summarizePerf([
    { published: true, perf: { views: 12400, likes: 300 }, linkClicks: 96 },
    { published: true, perf: { views: null, likes: null }, linkClicks: null },
    { published: false, perf: null, linkClicks: 4 },
  ]);
  assert.deepEqual(p, { publishedCount: 2, views: 12400, likes: 300, linkClicks: 100 });
  assert.deepEqual(summarizePerf([{ published: true, perf: { views: null, likes: null }, linkClicks: null }]),
    { publishedCount: 1, views: null, likes: null, linkClicks: null });
});

const s = (o: Partial<SortInput>): SortInput => ({ status: 'draft', published: false, scheduledOn: null, influencerHandle: null, createdAt: '2026-08-20T00:00:00Z', ...o });

test('7) 기본 정렬 — 밀린 것 → 예정일 오름차순 → 예정일 없음 → 미사용 맨 아래', () => {
  const rows = [
    s({ status: 'unused', scheduledOn: '2026-08-01', createdAt: 'a' }),
    s({ scheduledOn: null, createdAt: 'b' }),
    s({ scheduledOn: '2026-08-29', createdAt: 'c' }),
    s({ scheduledOn: '2026-08-25', createdAt: 'd' }),                 // 밀림
    s({ scheduledOn: '2026-08-28', createdAt: 'e' }),
    s({ scheduledOn: '2026-08-26', published: true, createdAt: 'f' }), // 게시됨 — 밀림 아님, 예정일 순
  ];
  assert.deepEqual(sortContent(rows, 'default', T).map((r) => r.createdAt), ['d', 'f', 'e', 'c', 'b', 'a']);
  assert.deepEqual(sortContent(rows, 'scheduled', T).map((r) => r.createdAt), ['d', 'f', 'e', 'c', 'b', 'a']);
  const byInf = sortContent([s({ influencerHandle: 'Zed', createdAt: 'z' }), s({ influencerHandle: 'amy', createdAt: 'y' }), s({ createdAt: 'x' })], 'influencer', T);
  assert.deepEqual(byInf.map((r) => r.createdAt), ['y', 'z', 'x']); // 미배정은 뒤
  const byStage = sortContent([s({ status: 'delivered', createdAt: 'p' }), s({ status: 'draft', createdAt: 'q' }), s({ published: true, createdAt: 'r' })], 'stage', T);
  assert.deepEqual(byStage.map((r) => r.createdAt), ['q', 'p', 'r']);
  assert.notEqual(sortContent(rows, 'default', T), rows); // 원본 불변(새 배열)
});

test('8) 인플 목록 파생 — 소문자 합집합, 비용 행만 있어도 나옴, 미배정 묶음, 통화별 소계·합계', () => {
  const lines = deriveInfluencers([
    { influencerHandle: 'Hana', status: 'delivered', cost: { type: 'post', amount: 300000, currency: 'KRW' } },
    { influencerHandle: 'hana', status: 'draft', cost: { type: 'rt', amount: 60000, currency: 'KRW' } },
    { influencerHandle: 'hana', status: 'unused', cost: { type: 'rt', amount: 999999, currency: 'KRW' } }, // 제외
    { influencerHandle: 'Yuki', status: 'approved', cost: { type: 'post', amount: 95000, currency: 'JPY' } },
    { influencerHandle: null, status: 'draft', cost: { type: 'post', amount: 1000, currency: 'KRW' } },
    { influencerHandle: 'Yuki', status: 'draft', cost: null },
  ], [
    { influencerHandle: 'HANA', extraCosts: [{ label: '교통비', amount: 20000, currency: 'KRW' }], note: '패키지' },
    { influencerHandle: 'ghost', extraCosts: [{ label: '선물', amount: 5000, currency: 'JPY' }], note: '' },
  ]);
  assert.deepEqual(lines.map((l) => l.handle), ['Hana', 'Yuki', 'ghost', null]); // 원고 많은 순 → 사전순, 미배정 맨 뒤
  const hana = lines[0];
  assert.equal(hana.contentCount, 2);
  assert.deepEqual(hana.contentCost, { KRW: 360000 });
  assert.deepEqual(hana.extraCost, { KRW: 20000 });
  assert.deepEqual(hana.subtotal, { KRW: 380000 });
  assert.equal(hana.note, '패키지');
  assert.equal(hana.hasCostRow, true);
  const ghost = lines[2];
  assert.equal(ghost.contentCount, 0);              // "배정 원고 없음" 표시 근거
  assert.deepEqual(ghost.subtotal, { JPY: 5000 });
  assert.equal(lines[3].contentCount, 1);
  assert.deepEqual(campaignTotal(lines), { KRW: 381000, JPY: 100000 });
  assert.deepEqual(deriveInfluencers([{ influencerHandle: null, status: 'unused', cost: null }], []), []); // 미배정+미사용만이면 줄 없음
});

test('9) 이름·코드 제안 — {클라} {M월 N주}, {영문 소문자}-{YYYYMMDD}, 영문 없으면 날짜만, 규칙 위반 문자 제거', () => {
  assert.equal(suggestCampaignName('리프팅클리닉', '2026-08-24'), '리프팅클리닉 8월 4주');
  assert.equal(suggestCampaignName('  ', '2026-09-01'), '9월 1주');
  assert.equal(suggestCampaignName('A', '2026-08-07'), 'A 8월 1주');
  assert.equal(suggestCampaignName('A', '2026-08-08'), 'A 8월 2주');
  assert.equal(suggestCampaignCode('Lifting Clinic', '2026-08-24'), 'lifting-clinic-20260824');
  assert.equal(suggestCampaignCode('', '2026-08-24'), '20260824');
  assert.equal(suggestCampaignCode('클리닉', '2026-08-24'), '20260824'); // 비영문만이면 날짜만
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignJudgment.test.ts`
Expected: FAIL — `Cannot find module './campaignJudgment.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignJudgment.ts`)

```ts
// 캠페인 판정의 순수 함수 — 단계 승격·밀림·기간 밖·캠페인 상태·준비 중·요약·정렬·인플 목록·이름/코드 제안·주 계산.
// 서버 요약(campaignStore)과 클라 표시(/campaigns·DraftCard)가 같은 함수를 쓴다(influencerJudgment 선례) —
// 드리프트 = 카드마다 다른 숫자. DB 접근 없음. '오늘'은 인자(kstToday())로 받아 테스트가 결정적으로 검증한다.
// 날짜는 전부 'YYYY-MM-DD'(datetime.ts의 date-only 계열) — 시간대 시프트를 하지 않는다.
import { STATUS_LABEL, type DraftStatus } from './draftStatus.ts';
import { checkCampaign } from './trackingLink.ts';
import { sumMoney, mergeMoney, type CostType, type DraftCost, type ExtraCost, type MoneyByCurrency } from './campaignCost.ts';

const DAY_MS = 86_400_000;

// ─────────────────────────── 날짜 산술(date-only) ───────────────────────────
// 라우트 입력 가드 — date 컬럼엔 달력일만. 시각이 붙은 ISO를 받으면 postgres가 서울 자정 전후로 하루를 민다(DateOnly 관례).
// 형식 + 실제 달력에 있는 날인지(왕복 일치)까지 본다 — '2026-13-40'은 정규식은 통과하지만 Date가 다른 날로 바꿔버린다.
export function isDateOnlyString(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}
// 'YYYY-MM-DD'를 UTC 자정으로 읽어 일수만 더한다 — 달력일 문자열의 산술일 뿐, 시간대 변환이 아니다(kstDayRange 관례).
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
}
export function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS);
}
// 월요일 시작(한국 업무 주). getUTCDay는 일=0이라 (dow+6)%7이 월요일까지의 거리다.
export function weekStartOf(date: string): string {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}
export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}
// 달력 초기 주 — 오늘이 기간 안이면 오늘의 주, 아니면 시작 주(스펙 §3-2 주간 달력)
export function initialWeekStart(startsOn: string, endsOn: string, today: string): string {
  return weekStartOf(today >= startsOn && today <= endsOn ? today : startsOn);
}
// 새 캠페인 기본 기간 = 다음 월~일(스펙 §3-3)
export function nextWeekRange(today: string): { startsOn: string; endsOn: string } {
  const startsOn = addDays(weekStartOf(today), 7);
  return { startsOn, endsOn: addDays(startsOn, 6) };
}
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
/** '8/26 수' — 표 예정일 칸·달력 헤더·밀림 문구. */
export function formatDateKo(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${DOW_KO[d.getUTCDay()]}`;
}

// ─────────────────────────── 캠페인 상태·유형 ───────────────────────────
// 기간에서 파생, 수동 상태 없음(라벨-값 일치, 스펙 §10)
export type CampaignStatus = 'upcoming' | 'active' | 'ended';
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = { upcoming: '예정', active: '진행 중', ended: '종료' };
export function campaignStatus(startsOn: string, endsOn: string, today: string): CampaignStatus {
  if (today < startsOn) return 'upcoming';
  if (today > endsOn) return 'ended';
  return 'active';
}

// 유형은 표시·필터용 속성 — 로직 분기는 비용 제안의 기본 유형 하나뿐(스펙 §2-1)
export const CAMPAIGN_KINDS = ['content', 'visit', 'seeding'] as const;
export type CampaignKind = typeof CAMPAIGN_KINDS[number];
export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = { content: '콘텐츠 의뢰', visit: '방문 협찬', seeding: '시딩' };
export function isCampaignKind(v: unknown): v is CampaignKind {
  return typeof v === 'string' && (CAMPAIGN_KINDS as readonly string[]).includes(v);
}
// 인플 배정 시 비용을 제안할 때 어느 단가를 볼지 — 방문협찬이면 방문 단가, 나머지는 게시 단가
export function defaultCostType(kind: CampaignKind | null): CostType {
  return kind === 'visit' ? 'visit' : 'post';
}

// ─────────────────────────── 콘텐츠 단계 ───────────────────────────
// draft.status 5종 + 게시됨(tracked_post 존재). 게시됨이면 status와 무관하게 게시됨 — status 값은 바꾸지 않는다(§2-4).
export type ContentStage = DraftStatus | 'published';
export const STAGE_LABEL: Record<ContentStage, string> = { ...STATUS_LABEL, published: '게시됨' };
export interface StageInput { status: DraftStatus; published: boolean; scheduledOn: string | null }
export function contentStage(d: StageInput): ContentStage {
  return d.published ? 'published' : d.status;
}

// 밀림 = 예정일 < 오늘 and 미게시 and 미사용 아님. 미사용은 요약 모집단(N)에서도 빠진다 — 같은 모집단이어야 라벨-값이 맞는다.
export function isOverdue(d: StageInput, today: string): boolean {
  return d.scheduledOn !== null && d.scheduledOn < today && !d.published && d.status !== 'unused';
}
// 기간 밖 — 경고 표시만, 저장 차단 없음(§2-4)
export function isOutOfRange(scheduledOn: string | null, startsOn: string, endsOn: string): boolean {
  return scheduledOn !== null && (scheduledOn < startsOn || scheduledOn > endsOn);
}

// 준비 중 = 초안·검수 대기·사용 확정(미게시). STATUS_LABEL에 없는 합성 라벨이라 정의를 여기 한 곳에 둔다 —
// 칩·카드·필터가 전부 이 함수를 쓴다(§2-4).
export const PREPARING_STATUSES: readonly DraftStatus[] = ['draft', 'review', 'approved'];
export const PREPARING_LABEL = '준비 중';
export function isPreparing(d: StageInput): boolean {
  return !d.published && PREPARING_STATUSES.includes(d.status);
}

export type StageFilter = 'all' | 'preparing' | 'delivered' | 'published';
export const STAGE_FILTERS: readonly StageFilter[] = ['all', 'preparing', 'delivered', 'published'];
export const STAGE_FILTER_LABEL: Record<StageFilter, string> = {
  all: '전체', preparing: PREPARING_LABEL, delivered: STATUS_LABEL.delivered, published: STAGE_LABEL.published,
};
export function matchesStageFilter(d: StageInput, f: StageFilter): boolean {
  if (f === 'all') return true;
  if (f === 'preparing') return isPreparing(d);
  if (f === 'published') return d.published;
  return !d.published && d.status === 'delivered';
}

// ─────────────────────────── 요약 카드 ───────────────────────────
// N = 미사용 제외 원고 수. 게시됨 n / N, 보조 '전달됨 a · 준비 중 b', 밀림 — 전부 같은 모집단(§2-4).
export interface CampaignSummary { total: number; published: number; delivered: number; preparing: number; overdue: number }
export function summarizeStages(items: StageInput[], today: string): CampaignSummary {
  const s: CampaignSummary = { total: 0, published: 0, delivered: 0, preparing: 0, overdue: 0 };
  for (const d of items) {
    if (d.status === 'unused') continue; // 미사용은 표에 흐리게 남고 요약에서만 빠진다
    s.total += 1;
    if (d.published) s.published += 1;
    else if (d.status === 'delivered') s.delivered += 1;
    else if (isPreparing(d)) s.preparing += 1;
    if (isOverdue(d, today)) s.overdue += 1;
  }
  return s;
}

// 성과 합계 — 스냅샷이 하나도 없으면 null(0으로 위장하지 않는다, 스펙 §7 "성과 스냅샷 없음 → —").
// 링크 클릭은 게시 여부와 무관하게 캠페인 원고들의 tracking_link 합(§5).
export interface PerfInput { published: boolean; perf: { views: number | null; likes: number | null } | null; linkClicks: number | null }
export interface PerfSummary { publishedCount: number; views: number | null; likes: number | null; linkClicks: number | null }
export function summarizePerf(items: PerfInput[]): PerfSummary {
  const out: PerfSummary = { publishedCount: 0, views: null, likes: null, linkClicks: null };
  const add = (k: 'views' | 'likes' | 'linkClicks', v: number | null) => { if (v !== null) out[k] = (out[k] ?? 0) + v; };
  for (const it of items) {
    if (it.published) out.publishedCount += 1;
    add('views', it.perf?.views ?? null);
    add('likes', it.perf?.likes ?? null);
    add('linkClicks', it.linkClicks);
  }
  return out;
}

// ─────────────────────────── 콘텐츠 표 정렬 ───────────────────────────
export type ContentSortKey = 'default' | 'scheduled' | 'stage' | 'influencer';
export const CONTENT_SORT_LABEL: Record<ContentSortKey, string> = {
  default: '밀린 것 먼저', scheduled: '예정일', stage: '단계', influencer: '인플루언서',
};
export interface SortInput extends StageInput { influencerHandle: string | null; createdAt: string }
const STAGE_ORDER: Record<ContentStage, number> = { draft: 0, review: 1, approved: 2, delivered: 3, published: 4, unused: 5 };
// 기본: 밀린 것 → 예정일 오름차순 → 예정일 없음 → 미사용 맨 아래(§3-2). 어느 키든 미사용은 맨 아래 —
// 흐리게 그리는 행이 중간에 끼면 표가 얼룩진다. 원본은 바꾸지 않는다.
export function sortContent<T extends SortInput>(items: T[], key: ContentSortKey, today: string): T[] {
  const bySchedule = (a: T, b: T): number => {
    if (a.scheduledOn === b.scheduledOn) return a.createdAt.localeCompare(b.createdAt);
    if (a.scheduledOn === null) return 1;
    if (b.scheduledOn === null) return -1;
    return a.scheduledOn.localeCompare(b.scheduledOn);
  };
  return [...items].sort((a, b) => {
    const u = Number(a.status === 'unused') - Number(b.status === 'unused');
    if (u !== 0) return u;
    if (key === 'default') {
      const o = Number(isOverdue(b, today)) - Number(isOverdue(a, today));
      return o !== 0 ? o : bySchedule(a, b);
    }
    if (key === 'scheduled') return bySchedule(a, b);
    if (key === 'stage') return (STAGE_ORDER[contentStage(a)] - STAGE_ORDER[contentStage(b)]) || bySchedule(a, b);
    const ha = (a.influencerHandle ?? '').toLowerCase();
    const hb = (b.influencerHandle ?? '').toLowerCase();
    if (ha === hb) return bySchedule(a, b);
    if (!ha) return 1;
    if (!hb) return -1;
    return ha.localeCompare(hb);
  });
}

// ─────────────────────────── 인플루언서 목록·비용 ───────────────────────────
export interface CostInput { influencerHandle: string | null; status: DraftStatus; cost: DraftCost | null }
export interface CostRowInput { influencerHandle: string; extraCosts: ExtraCost[]; note: string }
export interface InfluencerLine {
  handle: string | null;      // null = 미배정 원고 묶음 — 원고가 있을 때만 한 줄(비용이 합계에서 증발하지 않게)
  contentCount: number;       // 미사용 제외(요약 N과 같은 모집단)
  contentCost: MoneyByCurrency;
  extraCosts: ExtraCost[];
  extraCost: MoneyByCurrency;
  subtotal: MoneyByCurrency;  // 콘텐츠 비용 + 추가 비용, 통화별
  note: string;
  hasCostRow: boolean;        // campaign_influencer_cost 행 존재 — 원고 0이면 "배정 원고 없음" 표시 근거(§2-4)
}
// 인플 목록 = 원고 핸들 집합(소문자 중복 제거) ∪ 비용 행 핸들(§2-4). 표기는 원고에서 먼저 본 것, 없으면 비용 행 표기.
export function deriveInfluencers(drafts: CostInput[], costRows: CostRowInput[]): InfluencerLine[] {
  type Bucket = { handle: string | null; drafts: CostInput[]; row: CostRowInput | null };
  const byKey = new Map<string, Bucket>();
  const keyOf = (h: string | null) => (h ? h.toLowerCase() : '');
  for (const d of drafts) {
    if (d.status === 'unused') continue;
    const k = keyOf(d.influencerHandle);
    const b = byKey.get(k) ?? { handle: d.influencerHandle, drafts: [], row: null };
    b.drafts.push(d);
    byKey.set(k, b);
  }
  for (const r of costRows) {
    const k = keyOf(r.influencerHandle);
    const b = byKey.get(k) ?? { handle: r.influencerHandle, drafts: [], row: null };
    b.row = r;
    byKey.set(k, b);
  }
  const lines: InfluencerLine[] = [];
  for (const [k, b] of byKey) {
    if (k === '' && b.drafts.length === 0) continue;
    const contentCost = sumMoney(b.drafts.flatMap((d) => (d.cost ? [d.cost] : [])));
    const extraCosts = b.row?.extraCosts ?? [];
    const extraCost = sumMoney(extraCosts);
    lines.push({
      handle: b.handle, contentCount: b.drafts.length, contentCost, extraCosts, extraCost,
      subtotal: mergeMoney(contentCost, extraCost), note: b.row?.note ?? '', hasCostRow: b.row !== null,
    });
  }
  // 배정 원고 많은 사람 먼저 → 핸들 사전순, 미배정 묶음은 맨 아래
  return lines.sort((a, b) => {
    if (a.handle === null) return 1;
    if (b.handle === null) return -1;
    return (b.contentCount - a.contentCount) || a.handle.toLowerCase().localeCompare(b.handle.toLowerCase());
  });
}
// 캠페인 합계 = 인플 소계의 통화별 합(§2-4) — 미배정 묶음이 줄로 들어 있어 원고 비용 전체와 일치한다
export function campaignTotal(lines: InfluencerLine[]): MoneyByCurrency {
  return mergeMoney(...lines.map((l) => l.subtotal));
}

// ─────────────────────────── 이름·코드 제안(§2-1) ───────────────────────────
// '{클라} {M월 N주}' — N주 = 시작일이 그 달의 몇 번째 7일 구간인지(1~5). 제안일 뿐, 모달에서 수정한다.
export function suggestCampaignName(clientName: string, startsOn: string): string {
  const month = Number(startsOn.slice(5, 7));
  const week = Math.floor((Number(startsOn.slice(8, 10)) - 1) / 7) + 1;
  const base = `${month}월 ${week}주`;
  const name = clientName.trim();
  return name ? `${name} ${base}` : base;
}
// '{클라 영문 소문자}-{YYYYMMDD}', 영문명이 없으면 '{YYYYMMDD}'. checkCampaign 규칙(영어·숫자·._-, 공백→하이픈)으로
// 정리하므로 제안값은 항상 검사를 통과한다 — 통과 못 하는 경우(이론상 없음)엔 날짜만 남긴다.
export function suggestCampaignCode(clientNameEn: string, startsOn: string): string {
  const ymd = startsOn.replace(/-/g, '');
  const en = clientNameEn.trim().toLowerCase().replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const code = en ? `${en}-${ymd}` : ymd;
  const check = checkCampaign(code);
  return check.ok ? check.campaign : ymd;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignJudgment.test.ts`
Expected: PASS 9건

- [ ] **Step 5: 오타 점검** — 사용자 대면 라벨 `CAMPAIGN_KIND_LABEL.content`는 `'콘텐츠 의뢰'`다. `grep -n "콘텍츠" src/lib/campaignJudgment.ts src/lib/campaignJudgment.test.ts`가 0건이어야 한다(흔한 오타 — 화면 라벨에 그대로 나간다).

- [ ] **Step 6: Commit**

```bash
git add src/lib/campaignJudgment.ts src/lib/campaignJudgment.test.ts
git commit -m "feat(campaign): 판정 순수 함수 — 단계 승격·밀림·기간 밖·캠페인 상태·준비 중·요약·정렬·인플 목록·이름/코드 제안·주 계산"
```

---

### Task 3: `draftStore.ts` 확장 — DraftRow 5필드 + `left join campaign` + case-when 패치 + 캠페인 조회 2종 (+ `InfluencerOption.pricing`)

**Parallel group:** G1 (세 번째, Task 2 후)
**Suggested model:** opus

**Files:**
- Modify: `src/lib/draftStore.ts` (DraftRow 25-43 · Row 45-58 · toRow 60-81 · SELECT 83-90 · insertDraft 92-116 · updateDraft 136-164 · updateDraftsBulk 169-180 · 끝에 함수 2개 추가)
- Modify: `src/lib/draftTypes.ts:13` (`InfluencerOption`)
- Modify: `src/lib/influencerStore.ts:297-302` (`listOptions` — main 머지 후 위치. 현재 `select handle, display_name`만 뽑고 pricing은 뽑지 않는다 → 아래 Step 5로 확장. `Pricing` 타입은 이 파일 7행에서 이미 import돼 있다)
- Test: `src/lib/draftStore.campaign.test.ts` (새 파일 — 기존 `draftStore.test.ts`의 정리 쿼리를 건드리지 않기 위해 분리)

**Interfaces:**
- Consumes: 테이블 `campaign`, `draft.campaign_id/scheduled_on/cost` (Task 1) · `parseDraftCost`, `DraftCost` (Task 1)
- Produces (Task 4·5·7·8·10·12·13이 사용):
  - `DraftRow`에 추가: `campaignId: string | null; campaignName: string | null; campaignCode: string | null; scheduledOn: string | null; cost: DraftCost | null`
  - `insertDraft(sql, input)` — `input.campaignId?: string | null` 추가
  - `updateDraft(sql, id, patch)` — `patch.campaignId?: string | null; patch.scheduledOn?: string | null; patch.cost?: DraftCost | null` 추가(case when)
  - `updateDraftsBulk(sql, ids, patch)` — `patch.campaignId?: string | null` 추가
  - `listDraftsByCampaign(sql, campaignId: string): Promise<DraftRow[]>` — 예정일 오름차순(null 마지막)·생성순
  - `listUnassignedDrafts(sql, clientId: string | null, limit = 200): Promise<DraftRow[]>` — `campaign_id is null`이고 클라가 같은 원고(clientId null이면 클라 없는 원고), 최신순
  - `InfluencerOption.pricing?: Pricing`(`./influencerPricing.ts` 타입) — 비용 제안 소스(`/api/drafts/influencers`가 그대로 내려준다; `suggestDraftCost(option.pricing, type)`에 바로 넣는다)

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/draftStore.campaign.test.ts`)

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import {
  insertDraft, getDraft, updateDraft, updateDraftsBulk, listDraftsByCampaign, listUnassignedDrafts,
} from './draftStore.ts';
import { createClient } from './clientStore.ts';
import type { DraftContent } from './draftTypes.ts';

const sql = getSql();
const P = 'tdcp' + process.pid;
const content: DraftContent = { posts: [{ text: '캠페인 원고', media: [] }] };

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

// campaignStore는 다음 Task — 여기서는 033 스키마만 직접 쓴다
async function mkCampaign(clientId: string, clientName: string, suffix: string): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into campaign (client_id, client_name, name, name_en, starts_on, ends_on)
    values (${clientId}, ${clientName}, ${P + suffix}, ${'c-' + P.toLowerCase() + suffix}, '2026-08-24', '2026-08-30')
    returning id`;
  return rows[0].id;
}
const mkDraft = (clientId: string | null, clientName: string | null, extra: { campaignId?: string | null } = {}) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, ...extra,
  });

test('1) 새 필드 — 캠페인 없으면 전부 null, insertDraft(campaignId)면 name/name_en이 조인으로 파생된다', async () => {
  const c = await createClient(sql, P + '클라');
  const camp = await mkCampaign(c.id, c.name, 'a');
  const plain = await getDraft(sql, await mkDraft(c.id, c.name));
  assert.equal(plain!.campaignId, null);
  assert.equal(plain!.campaignName, null);
  assert.equal(plain!.campaignCode, null);
  assert.equal(plain!.scheduledOn, null);
  assert.equal(plain!.cost, null);
  const inCamp = await getDraft(sql, await mkDraft(c.id, c.name, { campaignId: camp }));
  assert.equal(inCamp!.campaignId, camp);
  assert.equal(inCamp!.campaignName, P + 'a');
  assert.equal(inCamp!.campaignCode, 'c-' + P.toLowerCase() + 'a');
});

test('2) updateDraft — 세 필드 설정·null=지움·undefined=유지, 예정일은 문자열 그대로 왕복(시간대 시프트 없음)', async () => {
  const c = await createClient(sql, P + '클라2');
  const camp = await mkCampaign(c.id, c.name, 'b');
  const id = await mkDraft(c.id, c.name);
  await updateDraft(sql, id, {
    campaignId: camp, scheduledOn: '2026-08-26', cost: { type: 'post', amount: 300000, currency: 'KRW' },
  });
  const set = await getDraft(sql, id);
  assert.equal(set!.campaignId, camp);
  assert.equal(set!.scheduledOn, '2026-08-26');           // Date가 아니라 'YYYY-MM-DD' 문자열 — 8/25로 밀리면 to_char 누락
  assert.deepEqual(set!.cost, { type: 'post', amount: 300000, currency: 'KRW' });

  await updateDraft(sql, id, { title: P + '제목' });       // 다른 필드만 건드리면 셋은 유지(undefined)
  const kept = await getDraft(sql, id);
  assert.equal(kept!.campaignId, camp);
  assert.equal(kept!.scheduledOn, '2026-08-26');
  assert.deepEqual(kept!.cost, set!.cost);

  await updateDraft(sql, id, { campaignId: null, scheduledOn: null, cost: null }); // null = 지움(coalesce였다면 불가능)
  const cleared = await getDraft(sql, id);
  assert.equal(cleared!.campaignId, null);
  assert.equal(cleared!.campaignName, null);
  assert.equal(cleared!.scheduledOn, null);
  assert.equal(cleared!.cost, null);
  assert.equal(cleared!.title, P + '제목');               // 무관한 필드는 그대로
});

test('3) updateDraftsBulk campaignId — 일괄 설정·해제, status·influencer는 건드리지 않는다', async () => {
  const c = await createClient(sql, P + '클라3');
  const camp = await mkCampaign(c.id, c.name, 'c');
  const ids = [await mkDraft(c.id, c.name), await mkDraft(c.id, c.name)];
  await updateDraft(sql, ids[0], { status: 'review', influencerHandle: 'hana_kim' });
  await updateDraftsBulk(sql, ids, { campaignId: camp });
  for (const id of ids) assert.equal((await getDraft(sql, id))!.campaignId, camp);
  const first = await getDraft(sql, ids[0]);
  assert.equal(first!.status, 'review');
  assert.equal(first!.influencerHandle, 'hana_kim');
  await updateDraftsBulk(sql, [ids[1]], { campaignId: null });
  assert.equal((await getDraft(sql, ids[1]))!.campaignId, null);
  assert.equal((await getDraft(sql, ids[0]))!.campaignId, camp); // 대상 밖은 유지
});

test('4) listDraftsByCampaign(예정일 순, 없음 마지막)·listUnassignedDrafts(클라 기준 미소속만)', async () => {
  const c = await createClient(sql, P + '클라4');
  const other = await createClient(sql, P + '클라4b');
  const camp = await mkCampaign(c.id, c.name, 'd');
  const late = await mkDraft(c.id, c.name, { campaignId: camp });
  const early = await mkDraft(c.id, c.name, { campaignId: camp });
  const none = await mkDraft(c.id, c.name, { campaignId: camp });
  await updateDraft(sql, late, { scheduledOn: '2026-08-29' });
  await updateDraft(sql, early, { scheduledOn: '2026-08-25' });
  const free = await mkDraft(c.id, c.name);
  await mkDraft(other.id, other.name);           // 다른 클라 — 후보에 안 나온다
  const noClient = await mkDraft(null, null);

  assert.deepEqual((await listDraftsByCampaign(sql, camp)).map((d) => d.id), [early, late, none]);
  const cands = await listUnassignedDrafts(sql, c.id);
  assert.deepEqual(cands.map((d) => d.id), [free]);           // 소속 원고·다른 클라 제외
  assert.ok((await listUnassignedDrafts(sql, null)).some((d) => d.id === noClient)); // 클라 없는 캠페인 → 클라 없는 원고
});

test('5) 캠페인 삭제 → campaign_id null(FK set null), 예정일·비용은 원고에 남는다', async () => {
  const c = await createClient(sql, P + '클라5');
  const camp = await mkCampaign(c.id, c.name, 'e');
  const id = await mkDraft(c.id, c.name, { campaignId: camp });
  await updateDraft(sql, id, { scheduledOn: '2026-08-27', cost: { type: 'rt', amount: 100, currency: 'JPY' } });
  await sql`delete from campaign where id = ${camp}`;
  const d = await getDraft(sql, id);
  assert.ok(d, '원고는 지워지지 않는다');
  assert.equal(d!.campaignId, null);
  assert.equal(d!.scheduledOn, '2026-08-27');
  assert.deepEqual(d!.cost, { type: 'rt', amount: 100, currency: 'JPY' });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.campaign.test.ts`
Expected: FAIL — `listDraftsByCampaign is not a function`(또는 TS 컴파일 오류 `campaignId`가 insertDraft 입력에 없음)

- [ ] **Step 3: `draftStore.ts` 수정** — 아래 블록을 각 자리에 그대로 적용

import 추가(파일 상단, `hashSource` import 아래):
```ts
import { parseDraftCost, type DraftCost } from './campaignCost.ts';
```

`DraftRow`의 `influencerHandle` 줄 아래에 추가:
```ts
  // 캠페인 소속(스펙 §2-3) — null = 없음. 원고는 캠페인보다 오래 산다(캠페인 삭제 시 set null).
  // campaignName/Code는 표시·트래킹 링크 utm_campaign 제안용 파생 필드 — SELECT()의 left join 한 번으로 전 경로가 받는다.
  campaignId: string | null;
  campaignName: string | null;
  campaignCode: string | null;   // campaign.name_en
  scheduledOn: string | null;    // 'YYYY-MM-DD'(서울). null = 미정. to_char로 읽는다 — Date로 받으면 하루 민다
  cost: DraftCost | null;        // {type, amount, currency}. 통화는 어디서도 합치지 않는다
```

`Row` 타입의 `influencer_handle` 줄 아래에 추가:
```ts
  campaign_id: string | null; campaign_name: string | null; campaign_code: string | null;
  scheduled_on: string | null; cost: unknown;
```

`toRow` 위에 헬퍼 추가, `toRow` 반환 객체의 `influencerHandle` 줄 아래에 필드 추가:
```ts
// jsonb는 모양을 보증하지 않는다 — 검증을 통과한 것만 값으로, 아니면 null(linkStore.toDaily 관례)
function costOf(v: unknown): DraftCost | null {
  const p = parseDraftCost(v ?? null);
  return p.ok ? p.value : null;
}
```
```ts
    campaignId: r.campaign_id, campaignName: r.campaign_name, campaignCode: r.campaign_code,
    scheduledOn: r.scheduled_on, cost: costOf(r.cost),
```

`SELECT` 전체 교체:
```ts
const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.title, d.ko_title, d.ko_title_hash,
         d.dismissed_flags, d.status, d.influencer_handle, d.batch_id, d.variant_index, d.model, d.created_at,
         d.campaign_id, c.name as campaign_name, c.name_en as campaign_code,
         to_char(d.scheduled_on, 'YYYY-MM-DD') as scheduled_on, d.cost,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by
    left join campaign c on c.id = d.campaign_id`;
```

`insertDraft` — 입력 타입에 추가하고 insert 문에 컬럼·값 추가:
```ts
  // /generate?campaign= 경로(스펙 §4-1)에서 생성·직접 쓰기 원고가 바로 소속되도록. 생략(undefined)이면 null.
  campaignId?: string | null;
```
```ts
    insert into draft (client_id, client_name, procedure_names, direction, format,
                       reference_mode, refs, content, model, created_by, batch_id, variant_index, translation,
                       ko_title, ko_title_hash, title, campaign_id)
    values (${input.clientId}, ${input.clientName}, ${sql.json(input.procedureNames)},
            ${input.direction}, ${input.format}, ${input.referenceMode},
            ${sql.json(input.refs as never)}, ${sql.json(input.content as never)},
            ${input.model}, ${input.memberId}, ${input.batchId ?? null}, ${input.variantIndex ?? null},
            ${input.translation ? sql.json(input.translation as never) : null},
            ${input.koTitle ?? null}, ${input.koTitleHash ?? null}, ${input.title ?? null}, ${input.campaignId ?? null})
    returning id`;
```

`updateDraft` — patch 타입에 세 줄 추가, SQL의 `influencer_handle = case ... end` 뒤에 세 컬럼 추가(마지막 `end` 뒤 콤마 주의):
```ts
           // 캠페인 관련 3필드(스펙 §2-3) — influencer_handle과 같은 case when 3값 규칙.
           // undefined = 건드리지 않음 · null = 지움(캠페인에서 빼기·예정일 지움·비용 지움) · 값 = 설정
           campaignId?: string | null;
           scheduledOn?: string | null;   // 'YYYY-MM-DD'
           cost?: DraftCost | null;
```
```ts
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end,
      -- 아래 셋도 coalesce가 아니다: "캠페인에서 빼기·예정일 지움·비용 지움"은 null을 저장해야 한다(§2-3)
      campaign_id = case when ${patch.campaignId !== undefined}
                      then ${patch.campaignId ?? null}::uuid
                      else campaign_id end,
      scheduled_on = case when ${patch.scheduledOn !== undefined}
                       then ${patch.scheduledOn ?? null}::date
                       else scheduled_on end,
      cost = case when ${patch.cost !== undefined}
               then ${patch.cost ? sql.json(patch.cost as never) : null}::jsonb
               else cost end
    where id = ${id}`;
```

`updateDraftsBulk` — patch 타입과 SQL:
```ts
export async function updateDraftsBulk(
  sql: postgres.Sql, ids: string[],
  patch: { status?: DraftStatus; influencerHandle?: string | null; campaignId?: string | null },
): Promise<void> {
  if (ids.length === 0) return; // any(빈 배열)은 0건을 맞히지만, 쿼리를 안 쏘는 편이 정직하다
  await sql`update draft set
      status = coalesce(${patch.status ?? null}, status),
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end,
      -- 캠페인 일괄 소속·해제(스펙 §4-1 '기존 원고 고르기' 여러 개 체크 = 한 문장)
      campaign_id = case when ${patch.campaignId !== undefined}
                      then ${patch.campaignId ?? null}::uuid
                      else campaign_id end
    where id = any(${ids}::uuid[])`;
}
```

파일 끝에 추가:
```ts
// 캠페인 상세의 원고 목록 — 예정일 오름차순(없음은 뒤), 같은 날은 생성순. 표의 최종 순서(밀림 우선 등)는
// campaignJudgment.sortContent가 정한다 — 여기는 안정적인 기본 순서만 보장한다.
export async function listDraftsByCampaign(sql: postgres.Sql, campaignId: string): Promise<DraftRow[]> {
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where d.campaign_id = ${campaignId}
    order by d.scheduled_on asc nulls last, d.created_at asc, d.variant_index asc nulls first`;
  return rows.map(toRow);
}

// '기존 원고 고르기' 후보(스펙 §4-1) — 그 클라이언트의 캠페인 미소속 원고만. 다른 캠페인 소속은 나오지 않는다(§7).
// 클라이언트가 삭제된 캠페인(client_id null)은 클라 없는 원고를 후보로 본다.
export async function listUnassignedDrafts(
  sql: postgres.Sql, clientId: string | null, limit = 200,
): Promise<DraftRow[]> {
  const byClient = clientId === null ? sql`and d.client_id is null` : sql`and d.client_id = ${clientId}`;
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where d.campaign_id is null ${byClient}
    order by d.created_at desc, d.variant_index asc nulls first
    limit ${limit}`;
  return rows.map(toRow);
}
```

- [ ] **Step 4: `InfluencerOption`에 pricing 추가** (`src/lib/draftTypes.ts:13`)

파일 상단 import에 한 줄 추가(`draftTypes.ts`는 지금 `./types.ts`만 import한다 — `influencerPricing.ts`는 import가 없는 순수 모듈이라 순환이 생기지 않는다):
```ts
import type { Pricing } from './influencerPricing.ts';
```
13행 교체:
```ts
// pricing: 인플 단가(influencer.pricing, 032) — 캠페인 비용 제안 소스(campaignCost.suggestDraftCost).
// 자동완성 후보를 받는 화면이 배정 직후 그대로 제안에 쓴다. 없으면(명부에 없는 핸들) 제안 없음.
export interface InfluencerOption { handle: string; name?: string; pricing?: Pricing }
```

- [ ] **Step 5: `listOptions`가 pricing을 내려준다** (`src/lib/influencerStore.ts:297-302` 교체 — 현재 코드는 `select handle, display_name from influencer order by lower(handle)`만 한다)

```ts
// 배정 자동완성 후보 — 명부가 기준이다(과거 배정 이력에서 긁어모으던 listInfluencerHandles의 후신).
// pricing도 함께 — 캠페인 비용 제안(스펙 §3-2 비용 셀)이 배정 직후 단가를 알아야 한다. 컬럼은 032(pricing jsonb not null default '{}').
export async function listOptions(sql: postgres.Sql): Promise<InfluencerOption[]> {
  const rows = await sql<Array<{ handle: string; display_name: string | null; pricing: Pricing | null }>>`
    select handle, display_name, pricing from influencer order by lower(handle)`;
  return rows.map((r) => ({ handle: r.handle, name: r.display_name ?? undefined, pricing: r.pricing ?? undefined }));
}
```
`Pricing`은 이 파일 7행 `import { diffPricing, mergePricing, type Pricing, type PricingChange } from './influencerPricing.ts';`에 이미 있다 — import를 추가하지 않는다.

- [ ] **Step 6: 테스트 통과 + 기존 테스트 회귀 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftStore.campaign.test.ts src/lib/draftStore.test.ts src/lib/influencerStore.test.ts src/lib/linkStore.test.ts`
Expected: 전부 PASS(새 5건 + 기존 건들). `npx tsc --noEmit -p .` 오류 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/draftStore.ts src/lib/draftStore.campaign.test.ts src/lib/draftTypes.ts src/lib/influencerStore.ts
git commit -m "feat(campaign): draftStore 확장 — campaignId·예정일·비용 5필드(left join campaign), case-when 패치, 캠페인 조회 2종, InfluencerOption.pricing"
```

---

### Task 4: `src/lib/campaignStore.ts` — CRUD · 목록(파생 수·통화별 합계) · 상세(lateral 성과) · 추가 비용 upsert · 인플 참여 캠페인

**Parallel group:** G1 (네 번째, Task 3 후)
**Suggested model:** opus

**Files:**
- Create: `src/lib/campaignStore.ts`
- Test: `src/lib/campaignStore.test.ts`

**Interfaces:**
- Consumes: Task 1 스키마·`ExtraCost`·`MoneyByCurrency`·`sumMoney`·`mergeMoney`·`parseExtraCosts` · Task 2 `CampaignKind`, `CampaignSummary`, `summarizeStages`, `InfluencerLine`, `deriveInfluencers` · Task 3 `DraftRow`, `listDraftsByCampaign` · `kstToday`(`./datetime.ts`)
- Produces (Task 5·6·7·8·10·11·12·13·14가 사용):
  - `interface CampaignRow { id: string; clientId: string | null; clientName: string | null; name: string; nameEn: string; startsOn: string; endsOn: string; kind: CampaignKind | null; note: string; createdAt: string; updatedAt: string; draftCount: number; total: MoneyByCurrency }`
  - `interface CampaignPerf { postCount: number; views: number | null; likes: number | null }`
  - `interface CampaignDraftItem extends DraftRow { published: boolean; perf: CampaignPerf | null; linkClicks: number | null }`
  - `interface InfluencerCostRow { id: string; campaignId: string; influencerHandle: string; extraCosts: ExtraCost[]; note: string; updatedAt: string }`
  - `interface CampaignDetail { campaign: CampaignRow; drafts: CampaignDraftItem[]; costRows: InfluencerCostRow[]; summary: CampaignSummary; influencers: InfluencerLine[]; today: string }`
  - `interface InfluencerCampaignItem { id: string; name: string; startsOn: string; endsOn: string; contentCount: number; subtotal: MoneyByCurrency }`
  - `createCampaign(sql, input: { clientId: string; clientName: string; name: string; nameEn: string; startsOn: string; endsOn: string; kind: CampaignKind | null; note: string; createdBy: string | null }): Promise<CampaignRow>`
  - `listCampaigns(sql): Promise<CampaignRow[]>` — `starts_on desc, created_at desc`
  - `getCampaign(sql, id): Promise<CampaignRow | null>`
  - `updateCampaign(sql, id, patch: { name?: string; nameEn?: string; startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string }): Promise<void>` — `kind`만 case when(null=지움)
  - `deleteCampaign(sql, id): Promise<boolean>`
  - `getCampaignDetail(sql, id, today?: string): Promise<CampaignDetail | null>`
  - `upsertInfluencerCost(sql, campaignId, handle, patch: { extraCosts?: ExtraCost[]; note?: string }): Promise<InfluencerCostRow>`
  - `listInfluencerCampaigns(sql, handle): Promise<InfluencerCampaignItem[]>`
  - re-export: `CampaignKind`, `CAMPAIGN_KINDS`, `CAMPAIGN_KIND_LABEL` (Task 2에서)

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignStore.test.ts`)

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient, deleteClient } from './clientStore.ts';
import { insertDraft, updateDraft, getDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  createCampaign, listCampaigns, getCampaign, updateCampaign, deleteCampaign,
  getCampaignDetail, upsertInfluencerCost, listInfluencerCampaigns,
} from './campaignStore.ts';

const sql = getSql();
const P = 'tcmp' + process.pid;
const content: DraftContent = { posts: [{ text: '캠페인 스토어', media: [] }] };
const T = '2026-08-27';

after(async () => {
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;            // 스냅샷 cascade
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;                    // 비용 행 cascade
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

const mkDraft = (clientId: string | null, clientName: string | null, campaignId: string | null) =>
  insertDraft(sql, {
    clientId, clientName, procedureNames: [], direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null, campaignId,
  });
const base = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: null, note: '', createdBy: null,
});

test('1) 생성 → 조회 — 날짜 문자열 왕복·기본값·목록 포함·파생 수 0·합계 {}', async () => {
  const c = await createClient(sql, P + '클라1');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'a'), kind: 'content', note: '메모' });
  assert.equal(row.startsOn, '2026-08-24');
  assert.equal(row.endsOn, '2026-08-30');
  assert.equal(row.kind, 'content');
  assert.equal(row.note, '메모');
  assert.equal(row.clientName, c.name);
  assert.equal(row.draftCount, 0);
  assert.deepEqual(row.total, {});
  assert.ok((await listCampaigns(sql)).some((x) => x.id === row.id));
  assert.equal((await getCampaign(sql, row.id))!.name, P + 'a');
  assert.equal(await getCampaign(sql, '00000000-0000-0000-0000-000000000000'), null);
});

test('2) 기간 역순은 DB check가 막는다(라우트 검증의 최후 방어)', async () => {
  const c = await createClient(sql, P + '클라2');
  await assert.rejects(() => createCampaign(sql, { ...base(c.id, c.name, 'b'), startsOn: '2026-08-30', endsOn: '2026-08-24' }));
});

test('3) 수정 — 부분 패치, kind null=지움, updated_at 갱신', async () => {
  const c = await createClient(sql, P + '클라3');
  const row = await createCampaign(sql, { ...base(c.id, c.name, 'c'), kind: 'visit' });
  await updateCampaign(sql, row.id, { name: P + 'c2', endsOn: '2026-09-06' });
  const got = await getCampaign(sql, row.id);
  assert.equal(got!.name, P + 'c2');
  assert.equal(got!.endsOn, '2026-09-06');
  assert.equal(got!.startsOn, '2026-08-24');
  assert.equal(got!.kind, 'visit');                          // undefined = 유지
  assert.ok(got!.updatedAt > row.updatedAt);
  await updateCampaign(sql, row.id, { kind: null });
  assert.equal((await getCampaign(sql, row.id))!.kind, null); // null = 지움
});

test('4) 목록 파생 — 콘텐츠 수(미사용 제외)·통화별 합계(콘텐츠 비용 + 추가 비용, 미사용 비용 제외)', async () => {
  const c = await createClient(sql, P + '클라4');
  const row = await createCampaign(sql, base(c.id, c.name, 'd'));
  const d1 = await mkDraft(c.id, c.name, row.id);
  const d2 = await mkDraft(c.id, c.name, row.id);
  const d3 = await mkDraft(c.id, c.name, row.id);
  await updateDraft(sql, d1, { cost: { type: 'post', amount: 300000, currency: 'KRW' }, influencerHandle: 'hana' });
  await updateDraft(sql, d2, { cost: { type: 'post', amount: 95000, currency: 'JPY' }, influencerHandle: 'yuki' });
  await updateDraft(sql, d3, { status: 'unused', cost: { type: 'post', amount: 777777, currency: 'KRW' } });
  await upsertInfluencerCost(sql, row.id, 'hana', { extraCosts: [{ label: '교통비', amount: 20000, currency: 'KRW' }] });
  const got = await getCampaign(sql, row.id);
  assert.equal(got!.draftCount, 2);
  assert.deepEqual(got!.total, { KRW: 320000, JPY: 95000 });
  const listed = (await listCampaigns(sql)).find((x) => x.id === row.id);
  assert.deepEqual(listed!.total, got!.total);              // 목록·단건이 같은 정의
});

test('5) 상세 — 게시됨(tracked_post)·성과 lateral 합(게시물 여러 개 SUM)·링크 클릭 합·요약·인플 목록', async () => {
  const c = await createClient(sql, P + '클라5');
  const row = await createCampaign(sql, base(c.id, c.name, 'e'));
  const pub = await mkDraft(c.id, c.name, row.id);
  const plain = await mkDraft(c.id, c.name, row.id);
  await updateDraft(sql, pub, { influencerHandle: 'hana', status: 'delivered', scheduledOn: '2026-08-25' });
  await updateDraft(sql, plain, { influencerHandle: 'yuki', scheduledOn: '2026-08-26' }); // 밀림
  // 게시물 2개가 한 원고에 — 각 최신 스냅샷을 합산해야 한다(tracked_post는 tweet_id만 unique)
  for (const [i, views] of [[1, 1000], [2, 2000]] as Array<[number, number]>) {
    const tp = await sql<Array<{ id: string }>>`
      insert into tracked_post (tweet_id, author_handle, text, source) values (${P + 'tw' + i}, 'hana', 't', 'manual') returning id`;
    await sql`update tracked_post set draft_id = ${pub} where id = ${tp[0].id}`;
    await sql`insert into post_metric_snapshot (tracked_post_id, views, likes, captured_at) values (${tp[0].id}, ${views - 500}, 1, now() - interval '1 hour')`;
    await sql`insert into post_metric_snapshot (tracked_post_id, views, likes, captured_at) values (${tp[0].id}, ${views}, 10, now())`; // 최신
  }
  const link = await sql<Array<{ id: string }>>`
    insert into tracking_link (code, landing_url, long_url, short_url, shortio_link_id, utm_campaign, influencer_handle, draft_id)
    values (${P.slice(-6)}, 'https://c.example.com/', 'https://c.example.com/?x', 'https://cb.link/x', 'lnk', ${P + 'utm'}, 'hana', ${plain}) returning id`;
  await sql`insert into link_click_snapshot (tracking_link_id, total_clicks, human_clicks) values (${link[0].id}, 96, 90)`;

  const detail = await getCampaignDetail(sql, row.id, T);
  assert.ok(detail);
  assert.equal(detail!.today, T);
  const p = detail!.drafts.find((d) => d.id === pub)!;
  assert.equal(p.published, true);
  assert.deepEqual(p.perf, { postCount: 2, views: 3000, likes: 20 });   // 최신 스냅샷만, 게시물 합
  assert.equal(p.linkClicks, null);
  const q = detail!.drafts.find((d) => d.id === plain)!;
  assert.equal(q.published, false);
  assert.equal(q.perf, null);
  assert.equal(q.linkClicks, 96);                                        // 미게시 원고의 링크 클릭도 실린다(요약 합계용)
  assert.deepEqual(detail!.summary, { total: 2, published: 1, delivered: 0, preparing: 1, overdue: 1 });
  assert.deepEqual(detail!.influencers.map((l) => l.handle), ['hana', 'yuki']);
  assert.equal(detail!.costRows.length, 0);
  assert.equal(await getCampaignDetail(sql, '00000000-0000-0000-0000-000000000000', T), null);
});

test('6) 추가 비용 upsert — 처음엔 insert, 다음엔 부분 갱신(대소문자 무관 같은 행), 원고 0이어도 인플 목록에 나온다', async () => {
  const c = await createClient(sql, P + '클라6');
  const row = await createCampaign(sql, base(c.id, c.name, 'f'));
  const first = await upsertInfluencerCost(sql, row.id, 'Ghost', { note: '아직 원고 없음' });
  assert.deepEqual(first.extraCosts, []);
  assert.equal(first.note, '아직 원고 없음');
  const second = await upsertInfluencerCost(sql, row.id, 'ghost', { extraCosts: [{ label: '선물', amount: 5000, currency: 'JPY' }] });
  assert.equal(second.id, first.id);                      // 같은 행
  assert.equal(second.influencerHandle, 'Ghost');         // 표기는 처음 것 보존
  assert.equal(second.note, '아직 원고 없음');            // undefined = 유지
  assert.deepEqual(second.extraCosts, [{ label: '선물', amount: 5000, currency: 'JPY' }]);
  const detail = await getCampaignDetail(sql, row.id, T);
  const line = detail!.influencers.find((l) => l.handle === 'Ghost')!;
  assert.equal(line.contentCount, 0);
  assert.equal(line.hasCostRow, true);
  assert.deepEqual(line.subtotal, { JPY: 5000 });
});

test('7) 클라 삭제 → client_id null·client_name 스냅샷 유지 / 캠페인 삭제 → 원고 보존·비용 행 cascade', async () => {
  const c = await createClient(sql, P + '클라7');
  const row = await createCampaign(sql, base(c.id, c.name, 'g'));
  const d = await mkDraft(c.id, c.name, row.id);
  await upsertInfluencerCost(sql, row.id, 'hana', { note: 'x' });
  await deleteClient(sql, c.id);
  const after1 = await getCampaign(sql, row.id);
  assert.equal(after1!.clientId, null);
  assert.equal(after1!.clientName, c.name);
  assert.equal(await deleteCampaign(sql, row.id), true);
  assert.equal(await deleteCampaign(sql, row.id), false);
  assert.ok(await getDraft(sql, d), '원고는 남는다');
  assert.equal((await getDraft(sql, d))!.campaignId, null);
  const cic = await sql`select id from campaign_influencer_cost where campaign_id = ${row.id}`;
  assert.equal(cic.length, 0);
});

test('8) 인플 참여 캠페인 — 원고 배정 또는 비용 행이 있는 캠페인, 콘텐츠 n·소계(통화별)', async () => {
  const c = await createClient(sql, P + '클라8');
  const a = await createCampaign(sql, base(c.id, c.name, 'h1'));
  const b = await createCampaign(sql, { ...base(c.id, c.name, 'h2'), startsOn: '2026-09-07', endsOn: '2026-09-13' });
  const none = await createCampaign(sql, base(c.id, c.name, 'h3'));
  const h = P + 'Mina';
  const d1 = await mkDraft(c.id, c.name, a.id);
  await updateDraft(sql, d1, { influencerHandle: h.toUpperCase(), cost: { type: 'post', amount: 100000, currency: 'KRW' } });
  await upsertInfluencerCost(sql, a.id, h, { extraCosts: [{ label: '교통', amount: 10000, currency: 'KRW' }] });
  await upsertInfluencerCost(sql, b.id, h, { note: '예정' });
  const items = await listInfluencerCampaigns(sql, h.toLowerCase());
  assert.deepEqual(items.map((i) => i.id), [b.id, a.id]);   // 시작일 내림차순
  assert.ok(!items.some((i) => i.id === none.id));
  const ia = items.find((i) => i.id === a.id)!;
  assert.equal(ia.contentCount, 1);
  assert.deepEqual(ia.subtotal, { KRW: 110000 });
  assert.deepEqual(items.find((i) => i.id === b.id)!.subtotal, {});
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts`
Expected: FAIL — `Cannot find module './campaignStore.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignStore.ts`)

```ts
import type postgres from 'postgres';
import type { DraftRow } from './draftStore.ts';
import { listDraftsByCampaign } from './draftStore.ts';
import { kstToday } from './datetime.ts';
import {
  parseExtraCosts, sumMoney, mergeMoney, isCurrency, type ExtraCost, type MoneyByCurrency,
} from './campaignCost.ts';
import {
  summarizeStages, deriveInfluencers, type CampaignKind, type CampaignSummary, type InfluencerLine,
} from './campaignJudgment.ts';

export { CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind } from './campaignJudgment.ts';

// 캠페인 = 클라이언트 1 × 기간 1 동안 나가는 원고 묶음(스펙 §0). 상태·인플 목록·합계는 저장하지 않는다 —
// 목록엔 SQL 집계(draft_count·통화별 합계)만 붙이고, 상세의 판정은 campaignJudgment 순수 함수가 한다(서버·클라 동일).
export interface CampaignRow {
  id: string; clientId: string | null; clientName: string | null;
  name: string; nameEn: string;
  startsOn: string; endsOn: string;    // 'YYYY-MM-DD'(서울) — to_char로 읽는다
  kind: CampaignKind | null; note: string;
  createdAt: string; updatedAt: string; // ISO
  draftCount: number;                   // 파생: 미사용 제외 원고 수(요약 N과 같은 모집단)
  total: MoneyByCurrency;               // 파생: 콘텐츠 비용(미사용 제외) + 추가 비용, 통화별
}

export interface CampaignPerf { postCount: number; views: number | null; likes: number | null }
// 상세 표의 한 행 — DraftRow + 게시됨 판정 + 성과. 게시됨 = tracked_post.draft_id 존재(§2-4).
export interface CampaignDraftItem extends DraftRow {
  published: boolean;
  perf: CampaignPerf | null;       // 게시됨일 때만. 최신 스냅샷(lateral) 게시물별 SUM. 스냅샷 없으면 views/likes null
  linkClicks: number | null;       // tracking_link 최신 스냅샷 합 — 게시 여부와 무관(요약 카드 합계용, §5)
}

export interface InfluencerCostRow {
  id: string; campaignId: string; influencerHandle: string;
  extraCosts: ExtraCost[]; note: string; updatedAt: string;
}

export interface CampaignDetail {
  campaign: CampaignRow;
  drafts: CampaignDraftItem[];
  costRows: InfluencerCostRow[];
  summary: CampaignSummary;        // summarizeStages(drafts, today) — 클라도 같은 함수로 재계산한다
  influencers: InfluencerLine[];   // deriveInfluencers(drafts, costRows)
  today: string;                   // 판정에 쓴 '오늘'(서울) — 클라가 같은 기준으로 다시 그릴 수 있게 함께 내려준다
}

export interface InfluencerCampaignItem {
  id: string; name: string; startsOn: string; endsOn: string;
  contentCount: number; subtotal: MoneyByCurrency;
}

type CRow = {
  id: string; client_id: string | null; client_name: string | null; name: string; name_en: string;
  starts_on: string; ends_on: string; kind: CampaignKind | null; note: string;
  created_at: Date; updated_at: Date; draft_count: string | number;
};
type TotalRow = { campaign_id: string; currency: string; amount: string | number };
type CicRow = { id: string; campaign_id: string; influencer_handle: string; extra_costs: unknown; note: string; updated_at: Date };

// jsonb 모양은 보증되지 않는다 — 검증 통과분만(draftStore.costOf와 같은 태도)
function extraCostsOf(v: unknown): ExtraCost[] {
  const p = parseExtraCosts(v ?? []);
  return p.ok ? p.value : [];
}

const toCic = (r: CicRow): InfluencerCostRow => ({
  id: r.id, campaignId: r.campaign_id, influencerHandle: r.influencer_handle,
  extraCosts: extraCostsOf(r.extra_costs), note: r.note, updatedAt: new Date(r.updated_at).toISOString(),
});

// 목록·단건이 같은 정의를 쓴다(드리프트 방지). draft_count는 미사용 제외 — 요약 카드 N과 같은 모집단(§2-4).
const SELECT = (sql: postgres.Sql) => sql`
  select c.id, c.client_id, c.client_name, c.name, c.name_en,
         to_char(c.starts_on, 'YYYY-MM-DD') as starts_on, to_char(c.ends_on, 'YYYY-MM-DD') as ends_on,
         c.kind, c.note, c.created_at, c.updated_at,
         (select count(*) from draft d where d.campaign_id = c.id and d.status <> 'unused') as draft_count
    from campaign c`;

// 통화별 합계 — 콘텐츠 비용(미사용 제외) + 추가 비용을 SQL에서 통화별로 묶는다. 통화 간 합산은 하지 않는다.
// 캠페인 수는 소수라 목록 1회 + 합계 1회의 두 쿼리로 충분하다.
async function totalsFor(sql: postgres.Sql, ids: string[]): Promise<Map<string, MoneyByCurrency>> {
  const out = new Map<string, MoneyByCurrency>();
  if (ids.length === 0) return out;
  const rows = await sql<TotalRow[]>`
    select campaign_id, currency, sum(amount) as amount from (
      select d.campaign_id, d.cost->>'currency' as currency, (d.cost->>'amount')::bigint as amount
        from draft d
       where d.campaign_id = any(${ids}::uuid[]) and d.cost is not null and d.status <> 'unused'
      union all
      select cic.campaign_id, e->>'currency', (e->>'amount')::bigint
        from campaign_influencer_cost cic, jsonb_array_elements(cic.extra_costs) e
       where cic.campaign_id = any(${ids}::uuid[])
    ) t group by campaign_id, currency`;
  for (const r of rows) {
    if (!isCurrency(r.currency)) continue; // 알 수 없는 통화는 합계에 섣불리 넣지 않는다
    const m = out.get(r.campaign_id) ?? {};
    m[r.currency] = (m[r.currency] ?? 0) + Number(r.amount); // sum(bigint)는 문자열로 온다
    out.set(r.campaign_id, m);
  }
  return out;
}

async function toRows(sql: postgres.Sql, rows: CRow[]): Promise<CampaignRow[]> {
  const totals = await totalsFor(sql, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, clientId: r.client_id, clientName: r.client_name, name: r.name, nameEn: r.name_en,
    startsOn: r.starts_on, endsOn: r.ends_on, kind: r.kind, note: r.note,
    createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
    draftCount: Number(r.draft_count),
    total: totals.get(r.id) ?? {},
  }));
}

export async function createCampaign(sql: postgres.Sql, input: {
  clientId: string; clientName: string; name: string; nameEn: string;
  startsOn: string; endsOn: string; kind: CampaignKind | null; note: string; createdBy: string | null;
}): Promise<CampaignRow> {
  const ins = await sql<Array<{ id: string }>>`
    insert into campaign (client_id, client_name, name, name_en, starts_on, ends_on, kind, note, created_by)
    values (${input.clientId}, ${input.clientName}, ${input.name}, ${input.nameEn},
            ${input.startsOn}::date, ${input.endsOn}::date, ${input.kind}, ${input.note}, ${input.createdBy})
    returning id`;
  return (await getCampaign(sql, ins[0].id)) as CampaignRow;
}

export async function listCampaigns(sql: postgres.Sql): Promise<CampaignRow[]> {
  // 최근 기간이 위 — 그룹(진행 중/예정/종료)은 클라가 campaignStatus로 나눈다
  const rows = await sql<CRow[]>`${SELECT(sql)} order by c.starts_on desc, c.created_at desc`;
  return toRows(sql, rows);
}

export async function getCampaign(sql: postgres.Sql, id: string): Promise<CampaignRow | null> {
  const rows = await sql<CRow[]>`${SELECT(sql)} where c.id = ${id}`;
  return rows.length ? (await toRows(sql, rows))[0] : null;
}

export async function updateCampaign(
  sql: postgres.Sql, id: string,
  patch: { name?: string; nameEn?: string; startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string },
): Promise<void> {
  // kind만 case when — null이 '유형 없음'이라는 뜻을 갖는 유일한 필드(draftStore.influencer_handle과 같은 구조)
  await sql`update campaign set
      name = coalesce(${patch.name ?? null}, name),
      name_en = coalesce(${patch.nameEn ?? null}, name_en),
      starts_on = coalesce(${patch.startsOn ?? null}::date, starts_on),
      ends_on = coalesce(${patch.endsOn ?? null}::date, ends_on),
      kind = case when ${patch.kind !== undefined} then ${patch.kind ?? null}::text else kind end,
      note = coalesce(${patch.note ?? null}, note),
      updated_at = now()
    where id = ${id}`;
}

// 원고는 지우지 않는다 — draft.campaign_id는 FK set null, 비용 행은 cascade(스펙 §2-5)
export async function deleteCampaign(sql: postgres.Sql, id: string): Promise<boolean> {
  const del = await sql`delete from campaign where id = ${id} returning id`;
  return del.length > 0;
}

type PerfRow = { draft_id: string; post_count: number; views: string | number | null; likes: string | number | null };
type ClickRow = { draft_id: string; clicks: string | number | null };

export async function getCampaignDetail(
  sql: postgres.Sql, id: string, today: string = kstToday(),
): Promise<CampaignDetail | null> {
  const campaign = await getCampaign(sql, id);
  if (!campaign) return null;
  const drafts = await listDraftsByCampaign(sql, id);

  // 게시됨 + 성과: 원고에 게시물이 여러 개면(tracked_post는 tweet_id만 unique) 각 게시물의 최신 스냅샷을 합산한다(§2-4).
  // 최신 1건은 lateral(trackingStore 관례). 스냅샷이 없는 게시물은 sum에서 null로 빠진다.
  const perfRows = await sql<PerfRow[]>`
    select tp.draft_id, count(tp.id)::int as post_count, sum(s.views) as views, sum(s.likes) as likes
      from tracked_post tp
      left join lateral (
        select views, likes from post_metric_snapshot where tracked_post_id = tp.id
        order by captured_at desc limit 1
      ) s on true
     where tp.draft_id in (select d.id from draft d where d.campaign_id = ${id})
     group by tp.draft_id`;
  // 링크 클릭: 원고에 링크가 여럿이면(tracking_link는 draft_id 인덱스만) 최신 스냅샷 합(§5)
  const clickRows = await sql<ClickRow[]>`
    select l.draft_id, sum(s.total_clicks) as clicks
      from tracking_link l
      left join lateral (
        select total_clicks from link_click_snapshot where tracking_link_id = l.id
        order by captured_at desc limit 1
      ) s on true
     where l.draft_id in (select d.id from draft d where d.campaign_id = ${id})
     group by l.draft_id`;
  const perfMap = new Map(perfRows.map((r) => [r.draft_id, r]));
  const clickMap = new Map(clickRows.map((r) => [r.draft_id, r]));
  const num = (v: string | number | null) => (v === null ? null : Number(v)); // sum(bigint)는 문자열

  const items: CampaignDraftItem[] = drafts.map((d) => {
    const p = perfMap.get(d.id);
    const c = clickMap.get(d.id);
    return {
      ...d,
      published: p !== undefined,
      perf: p ? { postCount: p.post_count, views: num(p.views), likes: num(p.likes) } : null,
      linkClicks: c ? num(c.clicks) : null,
    };
  });

  const cic = await sql<CicRow[]>`
    select id, campaign_id, influencer_handle, extra_costs, note, updated_at
      from campaign_influencer_cost where campaign_id = ${id} order by lower(influencer_handle)`;
  const costRows = cic.map(toCic);

  return {
    campaign, drafts: items, costRows,
    summary: summarizeStages(items, today),
    influencers: deriveInfluencers(items, costRows),
    today,
  };
}

// 추가 비용·메모 upsert — 행은 처음 적을 때 생긴다(§2-2). 표현식 유니크(campaign_id, lower(handle))로 충돌을 잡고,
// 부분 패치(undefined=유지)는 coalesce로. 표기는 처음 저장된 것을 보존한다(ensureInfluencer 관례).
export async function upsertInfluencerCost(
  sql: postgres.Sql, campaignId: string, handle: string,
  patch: { extraCosts?: ExtraCost[]; note?: string },
): Promise<InfluencerCostRow> {
  const rows = await sql<CicRow[]>`
    insert into campaign_influencer_cost (campaign_id, influencer_handle, extra_costs, note)
    values (${campaignId}, ${handle}, ${sql.json((patch.extraCosts ?? []) as never)}, ${patch.note ?? ''})
    on conflict (campaign_id, (lower(influencer_handle))) do update set
      extra_costs = coalesce(${patch.extraCosts ? sql.json(patch.extraCosts as never) : null}, campaign_influencer_cost.extra_costs),
      note = coalesce(${patch.note ?? null}, campaign_influencer_cost.note),
      updated_at = now()
    returning id, campaign_id, influencer_handle, extra_costs, note, updated_at`;
  return toCic(rows[0]);
}

// 인플루언서 프로필 "참여 캠페인"(§5) — 원고가 배정됐거나 비용 행이 있는 캠페인. 조회만, 로그 없음.
export async function listInfluencerCampaigns(sql: postgres.Sql, handle: string): Promise<InfluencerCampaignItem[]> {
  const lower = handle.toLowerCase();
  const drafts = await sql<Array<{ campaign_id: string; status: string; cost: unknown }>>`
    select campaign_id, status, cost from draft
     where campaign_id is not null and lower(influencer_handle) = ${lower}`;
  const cic = await sql<Array<{ campaign_id: string; extra_costs: unknown }>>`
    select campaign_id, extra_costs from campaign_influencer_cost where lower(influencer_handle) = ${lower}`;
  const ids = [...new Set([...drafts.map((d) => d.campaign_id), ...cic.map((c) => c.campaign_id)])];
  if (ids.length === 0) return [];
  const camps = await sql<Array<{ id: string; name: string; starts_on: string; ends_on: string }>>`
    select id, name, to_char(starts_on, 'YYYY-MM-DD') as starts_on, to_char(ends_on, 'YYYY-MM-DD') as ends_on
      from campaign where id = any(${ids}::uuid[]) order by starts_on desc, created_at desc`;
  return camps.map((c) => {
    const mine = drafts.filter((d) => d.campaign_id === c.id && d.status !== 'unused');
    const costs = mine.flatMap((d) => {
      const o = d.cost as { amount?: unknown; currency?: unknown } | null;
      return o && typeof o.amount === 'number' && isCurrency(o.currency) ? [{ amount: o.amount, currency: o.currency }] : [];
    });
    const extra = cic.filter((x) => x.campaign_id === c.id).flatMap((x) => extraCostsOf(x.extra_costs));
    return {
      id: c.id, name: c.name, startsOn: c.starts_on, endsOn: c.ends_on,
      contentCount: mine.length, subtotal: mergeMoney(sumMoney(costs), sumMoney(extra)),
    };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignStore.test.ts`
Expected: PASS 8건

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaignStore.ts src/lib/campaignStore.test.ts
git commit -m "feat(campaign): campaignStore — CRUD·목록 파생(콘텐츠 수·통화별 합계)·상세(게시됨·lateral 성과 SUM·링크 클릭)·추가 비용 upsert·인플 참여 캠페인"
```

---

### Task 5: 원고 PATCH(단건·bulk)·생성 라우트 — `campaignId · scheduledOn · cost` 수용

**Parallel group:** G2 (G1 후, G3와 병렬 — Task 6·7과 파일이 겹치지 않는다)
**Suggested model:** sonnet

**Files:**
- Create: `src/lib/draftFieldPatch.ts`
- Test: `src/lib/draftFieldPatch.test.ts`
- Modify: `src/app/api/drafts/[id]/route.ts:1-11`(import) · `:26-28`(body 타입) · `:40-42`(검증 자리) · `:66-91`(트랜잭션·응답)
- Modify: `src/app/api/drafts/route.ts:1-12`(import) · `:32-60`(POST) · `:86-120`(bulk PATCH)
- Modify: `src/app/api/drafts/manual/route.ts:1-6`(import) · `:14-15`(body) · `:33-44`(insert)
- Modify: `src/lib/generate.ts:25-30`(`GenerateRequest`) · `:114-124`(`insertOne`)

**Interfaces:**
- Consumes: `parseDraftCost`, `DraftCost`, `Parsed`(Task 1) · `isDateOnlyString`(Task 2) · `updateDraft`/`updateDraftsBulk`/`insertDraft`의 `campaignId·scheduledOn·cost`(Task 3) · `getCampaign`(Task 4) · `isUuidLike`(`@/lib/uuid`) · `normalizeInfluencerPatch`(`@/lib/influencerPatch`, 기존) · `syncInfluencerOnDraftUpdate`(기존 — handle·status만 읽으므로 새 필드에 무영향)
- Produces (Task 7·10·12·13·15가 사용):
  - `PATCH /api/drafts/[id]` body: 기존 필드 + `campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null` — 응답은 기존과 같은 `DraftRow`(Task 3 확장분 포함). 없는 캠페인 → 400 `CAMPAIGN_NOT_FOUND_MESSAGE`
  - `PATCH /api/drafts`(bulk) body: `{ ids: string[]; status?; influencerHandle?; campaignId?: string | null }` — 응답 `{ ok: true, updated: number }`. 세 필드 전부 없으면 400 `'바꿀 내용이 없어요'`
  - `POST /api/drafts`·`POST /api/drafts/manual` body: `campaignId?: string | null` — 만들어진 원고가 그 캠페인 소속으로 저장(시안 N개면 전부)
  - `interface DraftFieldPatch { campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null }`
  - `parseDraftFieldPatch(body: unknown): Parsed<DraftFieldPatch>` — 있는 키만 값에 실린다(undefined 키 없음 → 라우트가 그대로 spread)
  - `CAMPAIGN_ID_MESSAGE`, `SCHEDULED_ON_MESSAGE`, `CAMPAIGN_NOT_FOUND_MESSAGE`
  - `GenerateRequest.campaignId?: string | null`

스펙 모호점 해소(이 계획의 결정): 생성 POST는 캠페인의 클라이언트와 body.clientId가 같은지 **검사하지 않는다** — `/generate?campaign=`이 클라를 자동 선택하지만(Task 13) 사용자가 바꿀 수 있고, 스펙 §4-2는 "클라이언트 없는 원고는 전체 캠페인"을 허용하므로 서버가 막을 근거가 없다. 존재 여부만 확인한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/draftFieldPatch.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDraftFieldPatch, CAMPAIGN_ID_MESSAGE, SCHEDULED_ON_MESSAGE,
} from './draftFieldPatch.ts';
import { AMOUNT_MESSAGE } from './campaignCost.ts';

const UUID = '11111111-2222-4333-8444-555555555555';

test('1) 빈 body → 키 없는 패치(전부 건드리지 않음)', () => {
  assert.deepEqual(parseDraftFieldPatch({}), { ok: true, value: {} });
  assert.deepEqual(parseDraftFieldPatch(null), { ok: true, value: {} });   // 객체가 아니면 빈 패치 — 라우트가 다른 필드 검증을 이어간다
  assert.deepEqual(parseDraftFieldPatch('x'), { ok: true, value: {} });
});

test('2) campaignId — uuid 또는 null(캠페인에서 빼기)만', () => {
  assert.deepEqual(parseDraftFieldPatch({ campaignId: UUID }), { ok: true, value: { campaignId: UUID } });
  assert.deepEqual(parseDraftFieldPatch({ campaignId: null }), { ok: true, value: { campaignId: null } });
  const bad = parseDraftFieldPatch({ campaignId: 'abc' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, CAMPAIGN_ID_MESSAGE);
  assert.equal(parseDraftFieldPatch({ campaignId: 3 }).ok, false);
});

test('3) scheduledOn — YYYY-MM-DD 또는 null, 시각이 붙은 ISO·빈 문자열은 거절', () => {
  assert.deepEqual(parseDraftFieldPatch({ scheduledOn: '2026-08-26' }), { ok: true, value: { scheduledOn: '2026-08-26' } });
  assert.deepEqual(parseDraftFieldPatch({ scheduledOn: null }), { ok: true, value: { scheduledOn: null } });
  const bad = parseDraftFieldPatch({ scheduledOn: '2026-08-26T00:00:00Z' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, SCHEDULED_ON_MESSAGE);
  assert.equal(parseDraftFieldPatch({ scheduledOn: '' }).ok, false);     // 지움은 null로만 — ''를 조용히 null로 바꾸지 않는다
});

test('4) cost — parseDraftCost에 위임(문구 그대로), 셋이 함께 와도 각각 검증', () => {
  const ok = parseDraftFieldPatch({
    campaignId: UUID, scheduledOn: '2026-08-26', cost: { type: 'post', amount: '300,000', currency: 'KRW' },
  });
  assert.deepEqual(ok, { ok: true, value: {
    campaignId: UUID, scheduledOn: '2026-08-26', cost: { type: 'post', amount: 300000, currency: 'KRW' },
  } });
  assert.deepEqual(parseDraftFieldPatch({ cost: null }), { ok: true, value: { cost: null } });
  const bad = parseDraftFieldPatch({ cost: { type: 'post', amount: -1, currency: 'KRW' } });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.message, AMOUNT_MESSAGE);
  assert.equal(parseDraftFieldPatch({ cost: 'x' }).ok, false);
});

test('5) 관계없는 키는 무시 — status·title 등은 각 라우트가 따로 검증한다', () => {
  assert.deepEqual(parseDraftFieldPatch({ status: 'review', title: 'x', ids: [UUID] }), { ok: true, value: {} });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftFieldPatch.test.ts`
Expected: FAIL — `Cannot find module './draftFieldPatch.ts'`

- [ ] **Step 3: 구현** (`src/lib/draftFieldPatch.ts`)

```ts
// 원고 라우트가 공유하는 캠페인 3필드 검증 — 단건 PATCH·bulk PATCH·생성 POST·직접 쓰기 POST 네 곳이 같은 규칙을 써야 한다
// (influencerPatch.ts와 같은 이유: 복사해 두면 한쪽만 고쳐지는 드리프트). DB 접근 없음.
// undefined = 건드리지 않음 · null = 지움 · 값 = 설정(스펙 §2-3) — 결과 객체엔 '온 키'만 실려 라우트가 그대로 spread한다.
import { parseDraftCost, type DraftCost, type Parsed } from './campaignCost.ts';
import { isDateOnlyString } from './campaignJudgment.ts';
import { isUuidLike } from './uuid.ts';

export interface DraftFieldPatch { campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null }

export const CAMPAIGN_ID_MESSAGE = '캠페인 값이 올바르지 않아요';
export const SCHEDULED_ON_MESSAGE = '예정일은 YYYY-MM-DD 날짜여야 해요';
// 라우트가 존재 확인(getCampaign) 실패 시 쓰는 문구 — FK 위반(23503)을 500으로 흘리지 않는다
export const CAMPAIGN_NOT_FOUND_MESSAGE = '캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요. 목록을 새로고침해 주세요';

export function parseDraftFieldPatch(body: unknown): Parsed<DraftFieldPatch> {
  const out: DraftFieldPatch = {};
  if (!body || typeof body !== 'object') return { ok: true, value: out };
  const b = body as { campaignId?: unknown; scheduledOn?: unknown; cost?: unknown };
  if (b.campaignId !== undefined) {
    // uuid 형식이 아니면 DB에서 22P02(캐스팅 오류)로 터진다 — 여기서 400으로 끊는다(uuid.ts 관례)
    if (b.campaignId !== null && !(typeof b.campaignId === 'string' && isUuidLike(b.campaignId))) {
      return { ok: false, message: CAMPAIGN_ID_MESSAGE };
    }
    out.campaignId = b.campaignId as string | null;
  }
  if (b.scheduledOn !== undefined) {
    // date 컬럼엔 달력일만 — 시각이 붙으면 서울 자정 전후로 하루가 민다. ''는 null로 바꿔주지 않는다(지움은 명시적으로)
    if (b.scheduledOn !== null && !isDateOnlyString(b.scheduledOn)) return { ok: false, message: SCHEDULED_ON_MESSAGE };
    out.scheduledOn = b.scheduledOn as string | null;
  }
  if (b.cost !== undefined) {
    const c = parseDraftCost(b.cost);
    if (!c.ok) return { ok: false, message: c.message };
    out.cost = c.value;
  }
  return { ok: true, value: out };
}

```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftFieldPatch.test.ts`
Expected: PASS 5건

- [ ] **Step 5: 단건 PATCH 라우트** (`src/app/api/drafts/[id]/route.ts`)

import 두 줄 추가(11행 `syncInfluencerOnDraftUpdate` import 아래):
```ts
import { parseDraftFieldPatch, CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/draftFieldPatch';
import { getCampaign } from '@/lib/campaignStore';
```

26-28행 body 타입 교체:
```ts
  const body = (await req.json().catch(() => ({}))) as
    { edited?: DraftContent; dismissedFlags?: string[]; status?: string;
      influencerHandle?: string | null; title?: string | null;
      campaignId?: unknown; scheduledOn?: unknown; cost?: unknown }; // 캠페인 3필드(스펙 §2-3) — 검증은 parseDraftFieldPatch
```

42행 `const influencerHandle = inf.value;` 바로 아래에 추가:
```ts
  // 캠페인 3필드 — undefined=건드리지 않음 · null=지움 · 값=설정. 네 라우트가 공유하는 한 함수로 형식을 확정한다.
  const fields = parseDraftFieldPatch(body);
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: 400 });
```

66-91행(`const sql = getSql();`부터 마지막 `return NextResponse.json(await getDraft(sql, id));`까지) 교체:
```ts
  const sql = getSql();
  const result = await sql.begin(async (tx0): Promise<'ok' | 'no-draft' | 'no-campaign'> => {
    const tx = tx0 as unknown as postgres.Sql; // 저장소 선례: generate.ts:127
    // 동시 PATCH가 스테일 스냅샷으로 로그를 쓰지 않도록 행을 잠그고 읽는다 (리뷰 반영)
    await tx`select id from draft where id = ${id} for update`;
    const before = await getDraft(tx, id);
    if (!before) return 'no-draft';
    // 소속시킬 캠페인이 살아 있는지 — 그 사이 다른 사람이 지웠을 수 있다. FK 위반(23503)을 500으로 흘리지 않고 400 문구로 말한다.
    if (fields.value.campaignId && !(await getCampaign(tx, fields.value.campaignId))) return 'no-campaign';
    // body를 통째로 펼치지 않는다. 그렇게 하면 요청 본문의 아무 키나 updateDraft의 patch로 흘러가
    // 클라이언트가 history·translation·koTitle 같은 서버 소관 필드를 직접 세팅할 수 있다. format이
    // 특히 위험하다 — 본문과 어긋난 값이 저장되면 다시쓰기가 손으로 늘린 칸을 잘라낸다(설계 §E).
    // 받을 필드를 여기서 하나씩 명시한다.
    await updateDraft(tx, id, {
      ...(body.edited !== undefined ? { edited: body.edited } : {}),
      ...(body.dismissedFlags !== undefined ? { dismissedFlags: body.dismissedFlags } : {}),
      ...(body.status !== undefined ? { status: body.status as DraftStatus } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      influencerHandle, // 정규화된 값으로 덮어쓴다 — body의 원문 그대로가 아니다(핸들만 저장 원칙)
      ...(derivedFormat ? { format: derivedFormat } : {}),
      ...fields.value, // campaignId·scheduledOn·cost — 검증을 통과한, 실제로 온 키만 들어 있다
    });
    await syncInfluencerOnDraftUpdate(tx, { before, influencerHandle, status: body.status as string | undefined, actorId: gate.member.id });
    return 'ok';
  });
  if (result === 'no-campaign') return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 400 });
  if (result === 'no-draft') {
    return NextResponse.json({ error: '원고를 찾을 수 없어요 — 다른 사람이 삭제했을 수 있어요' }, { status: 404 });
  }
  return NextResponse.json(await getDraft(sql, id));
```

- [ ] **Step 6: bulk PATCH + 생성 POST** (`src/app/api/drafts/route.ts`)

import 두 줄 추가(12행 `LIST_CAP` import 아래):
```ts
import { parseDraftFieldPatch, CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/draftFieldPatch';
import { getCampaign } from '@/lib/campaignStore';
```

POST — 36행 `const body = ...` 아래, 기존 `MODES` 검증 위에 추가하고, `generateDraft` 호출에 `campaignId` 한 줄 추가:
```ts
  // 캠페인 소속(스펙 §4-1 /generate?campaign=) — 형식·존재를 여기서 확정하고 generateDraft엔 검증된 값만 넘긴다.
  // 시안을 N개 만들면 전부 그 캠페인 소속이다(형제 시안 중 하나만 남길지는 사용자가 캠페인 화면에서 정리한다).
  const fields = parseDraftFieldPatch({ campaignId: (body as { campaignId?: unknown }).campaignId });
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: 400 });
  const campaignId = fields.value.campaignId ?? null;
  if (campaignId && !(await getCampaign(sql, campaignId))) {
    return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 400 });
  }
```
```ts
    const ids = await generateDraft(sql, {
      clientId: body.clientId ?? null,
      procedureIds: body.procedureIds ?? [],
      refTweetIds: body.refTweetIds ?? [],
      mode: body.mode ?? 'off',
      direction: body.direction ?? '',
      format: body.format === 'thread' ? 'thread' : 'single',
      constraintsOn: !!body.constraintsOn,
      count: body.count,
      memberId: gate.member.id, // 클라이언트 body 무시 — 위조 차단(브리핑 관례)
      campaignId,               // 위에서 존재까지 확인한 값
    });
```

bulk PATCH(86-120행) 전체 교체:
```ts
export async function PATCH(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const body = (await req.json().catch(() => ({}))) as
    { ids?: unknown; status?: unknown; influencerHandle?: string | null; campaignId?: unknown };
  const parsed = parseIds(body.ids);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (body.status !== undefined && !isDraftStatus(body.status)) {
    return NextResponse.json({ error: '상태 값이 올바르지 않아요' }, { status: 400 });
  }
  const inf = normalizeInfluencerPatch(body.influencerHandle);
  if (!inf.ok) return NextResponse.json({ error: inf.message }, { status: 400 });
  // bulk는 캠페인 3필드 중 campaignId만 받는다(스펙 §6) — 예정일·비용 일괄은 범위 밖. 캠페인 화면 '기존 원고 고르기'와
  // DraftCard 캠페인 칸이 이 한 문장을 쓴다(50건 = 커넥션 1개).
  const fields = parseDraftFieldPatch({ campaignId: body.campaignId });
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: 400 });
  const campaignId = fields.value.campaignId;
  // 셋 다 없으면 바꿀 게 없다 — campaignId만 보낸 요청이 거절되던 결함(리뷰 Blocking 4)을 여기서 함께 고친다
  if (body.status === undefined && inf.value === undefined && campaignId === undefined) {
    return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  }
  const sql = getSql();
  if (campaignId && !(await getCampaign(sql, campaignId))) {
    return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 400 });
  }
  // 갱신과 자동 로그(influencerSync)를 같은 트랜잭션에 — 단건 PATCH와 같은 원칙(스펙 §5).
  // UPDATE는 여전히 한 문장이고, 로그 insert N개는 같은 커넥션 위의 짧은 문장들이라
  // updateDraftsBulk가 피하려던 "커넥션 N개 동시 점유"와는 다르다.
  await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql; // 저장소 선례: generate.ts:127
    const befores = await getDraftsByIdsForUpdate(tx, parsed.ids);
    await updateDraftsBulk(tx, parsed.ids, {
      status: body.status as DraftStatus | undefined,
      ...(inf.value !== undefined ? { influencerHandle: inf.value } : {}),
      ...(campaignId !== undefined ? { campaignId } : {}),
    });
    for (const before of befores) {
      await syncInfluencerOnDraftUpdate(tx, {
        before, influencerHandle: inf.value,
        status: body.status as string | undefined, actorId: gate.member.id,
      });
    }
  });
  return NextResponse.json({ ok: true, updated: parsed.ids.length });
}
```

- [ ] **Step 7: 직접 쓰기 POST** (`src/app/api/drafts/manual/route.ts`)

import 추가(6행 아래):
```ts
import { parseDraftFieldPatch, CAMPAIGN_NOT_FOUND_MESSAGE } from '@/lib/draftFieldPatch';
import { getCampaign } from '@/lib/campaignStore';
```
14-15행 body 타입 교체:
```ts
  const body = (await req.json().catch(() => ({}))) as
    { posts?: unknown; title?: unknown; clientId?: string | null; procedureIds?: unknown; campaignId?: unknown };
```
33행(`// 공백 트림, ...` 주석) 위에 추가:
```ts
  // /generate?campaign= 배너가 켜진 채 직접 쓰면 그 캠페인 소속으로 — "제목만 있는 미작성 칸"도 이 경로(스펙 §4-1)
  const fields = parseDraftFieldPatch({ campaignId: body.campaignId });
  if (!fields.ok) return NextResponse.json({ error: fields.message }, { status: 400 });
  const campaignId = fields.value.campaignId ?? null;
  if (campaignId && !(await getCampaign(sql, campaignId))) {
    return NextResponse.json({ error: CAMPAIGN_NOT_FOUND_MESSAGE }, { status: 400 });
  }
```
`insertDraft` 호출의 `title,` 줄 아래에 추가:
```ts
    campaignId,
```

- [ ] **Step 8: `generate.ts`** — `GenerateRequest`에 필드 추가(25-30행), `insertOne`에 전달(114-124행)

```ts
export interface GenerateRequest {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat;
  constraintsOn: boolean; memberId: string | null;
  count?: number; // 시안 수 (1~5, 기본 1) — 라우트가 범위 검증
  campaignId?: string | null; // /generate?campaign= 경로 — 만든 시안 전부 그 캠페인 소속(스펙 §4-1). 라우트가 존재까지 검증한 값
}
```
`insertOne`의 `koTitleHash:` 줄 아래에 한 줄:
```ts
    campaignId: req.campaignId ?? null,
```

- [ ] **Step 9: 타입·기존 테스트·린트 확인**

Run: `npx tsc --noEmit -p .`
Expected: 오류 0

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftFieldPatch.test.ts src/lib/generate.test.ts src/lib/draftStore.campaign.test.ts`
Expected: 전부 PASS(generate.test는 LLM 목 — campaignId 미지정 경로가 그대로 통과해야 한다)

Run: `npm run lint`
Expected: 경고 24개(기준선 유지), 오류 0

- [ ] **Step 10: Commit**

```bash
git add src/lib/draftFieldPatch.ts src/lib/draftFieldPatch.test.ts 'src/app/api/drafts/[id]/route.ts' src/app/api/drafts/route.ts src/app/api/drafts/manual/route.ts src/lib/generate.ts
git commit -m "feat(campaign): 원고 라우트에 campaignId·예정일·비용 수용 — 단건/bulk PATCH(400 가드 확장)·생성/직접쓰기 POST, 검증은 draftFieldPatch 한 곳"
```

---

### Task 6: 캠페인 입력 검증 `campaignInput.ts` + `GET/POST /api/campaigns` + `GET/PATCH/DELETE /api/campaigns/[id]`

**Parallel group:** G3 (G1 후, G2와 병렬)
**Suggested model:** opus

**Files:**
- Create: `src/lib/campaignInput.ts`
- Test: `src/lib/campaignInput.test.ts`
- Create: `src/app/api/campaigns/route.ts`
- Create: `src/app/api/campaigns/[id]/route.ts`

**Interfaces:**
- Consumes: `checkCampaign`, `campaignMessage`(`./trackingLink.ts`, 기존 — 트래킹 링크 utm_campaign과 같은 규칙) · `isCampaignKind`, `isDateOnlyString`, `CampaignKind`(Task 2) · `Parsed`(Task 1) · `isUuidLike`(`./uuid.ts`) · `listCampaigns`, `createCampaign`, `getCampaign`, `getCampaignDetail`, `updateCampaign`, `deleteCampaign`(Task 4) · `getClientWithProcedures`(`@/lib/clientStore`) · `requireAllowedUser`/`requireMember`(`@/lib/authGuard`)
- Produces (Task 7·10·11이 사용):
  - `interface CampaignCreateInput { clientId: string; name: string; nameEn: string; startsOn: string; endsOn: string; kind: CampaignKind | null; note: string }`
  - `interface CampaignPatchInput { name?: string; nameEn?: string; startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string }`
  - `parseCampaignCreate(body: unknown): Parsed<CampaignCreateInput>` · `parseCampaignPatch(body: unknown): Parsed<CampaignPatchInput>` · `checkPeriod(startsOn: string, endsOn: string): string | null`(위반 문구 또는 null — 모달·헤더가 즉시 피드백에 재사용)
  - 문구 상수: `PERIOD_MESSAGE = '종료일이 시작일보다 앞이에요'`, `NAME_MESSAGE`, `CLIENT_MESSAGE`, `DATE_MESSAGE`, `KIND_MESSAGE`, `NOTE_MESSAGE`, `NAME_MAX = 80`, `NOTE_MAX = 2000`
  - `GET /api/campaigns` → `CampaignRow[]`(starts_on desc) · `POST /api/campaigns`(body `CampaignCreateInput`) → `CampaignRow`
  - `GET /api/campaigns/[id]` → `CampaignDetail` · `PATCH /api/campaigns/[id]`(body `CampaignPatchInput`) → `CampaignRow` · `DELETE /api/campaigns/[id]` → `{ ok: true; deleted: boolean }`
  - 오류: 캠페인 미존재/uuid 아님 → 404 `'캠페인을 찾을 수 없어요'` · 클라 미존재 → 400 `'클라이언트를 찾을 수 없어요 — 목록을 새로고침해 주세요'` · 검증 위반 → 400 + 위 문구

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignInput.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCampaignCreate, parseCampaignPatch, checkPeriod,
  PERIOD_MESSAGE, NAME_MESSAGE, CLIENT_MESSAGE, DATE_MESSAGE, KIND_MESSAGE, NOTE_MESSAGE, NAME_MAX,
} from './campaignInput.ts';
import { campaignMessage } from './trackingLink.ts';

const CLIENT = '11111111-2222-4333-8444-555555555555';
const ok = {
  clientId: CLIENT, name: ' 리프팅 8월 4주 ', nameEn: 'lifting 20260824',
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: 'content', note: ' 메모 ',
};
const msg = (p: { ok: true } | { ok: false; message: string }) => (p.ok ? null : p.message);

test('1) 생성 — 트림·코드 정규화(공백→하이픈, checkCampaign)·유형·메모. 빈 유형·빈 메모는 null·\'\'', () => {
  assert.deepEqual(parseCampaignCreate(ok), { ok: true, value: {
    clientId: CLIENT, name: '리프팅 8월 4주', nameEn: 'lifting-20260824',
    startsOn: '2026-08-24', endsOn: '2026-08-30', kind: 'content', note: '메모',
  } });
  const noKind = parseCampaignCreate({ ...ok, kind: '', note: undefined });
  assert.ok(noKind.ok);
  if (noKind.ok) { assert.equal(noKind.value.kind, null); assert.equal(noKind.value.note, ''); }
  const nullKind = parseCampaignCreate({ ...ok, kind: null });
  if (nullKind.ok) assert.equal(nullKind.value.kind, null);
});

test('2) 생성 — 필수·형식 위반은 사용자 문구로(첫 위반 하나만), 하루짜리 기간 허용', () => {
  assert.equal(msg(parseCampaignCreate({ ...ok, clientId: 'abc' })), CLIENT_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, name: '  ' })), NAME_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, name: 'x'.repeat(NAME_MAX + 1) })), `캠페인 이름은 ${NAME_MAX}자까지 쓸 수 있어요`);
  assert.equal(msg(parseCampaignCreate({ ...ok, nameEn: '리프팅' })), campaignMessage('not-ascii'));
  assert.equal(msg(parseCampaignCreate({ ...ok, nameEn: '' })), campaignMessage('empty'));
  assert.equal(msg(parseCampaignCreate({ ...ok, startsOn: '2026-08-24T00:00:00Z' })), DATE_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, endsOn: '2026-8-30' })), DATE_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, startsOn: '2026-08-31' })), PERIOD_MESSAGE); // 종료 < 시작
  assert.equal(msg(parseCampaignCreate({ ...ok, kind: 'party' })), KIND_MESSAGE);
  assert.equal(msg(parseCampaignCreate({ ...ok, note: 3 })), NOTE_MESSAGE);
  assert.equal(msg(parseCampaignCreate(null)), CLIENT_MESSAGE);                          // 빈 body는 첫 필수 항목부터
  assert.equal(checkPeriod('2026-08-24', '2026-08-24'), null);                            // 같은 날 = 하루짜리, DB check와 같은 경계
  assert.equal(checkPeriod('2026-08-25', '2026-08-24'), PERIOD_MESSAGE);
});

test('3) 수정 — 온 키만 검증, kind null·\'\'=지움, 양쪽 날짜가 다 오면 순서 검사, 모르는 키는 무시', () => {
  assert.deepEqual(parseCampaignPatch({}), { ok: true, value: {} });
  assert.deepEqual(parseCampaignPatch({ name: ' 새 이름 ' }), { ok: true, value: { name: '새 이름' } });
  assert.deepEqual(parseCampaignPatch({ kind: null }), { ok: true, value: { kind: null } });
  assert.deepEqual(parseCampaignPatch({ kind: '' }), { ok: true, value: { kind: null } });
  assert.deepEqual(parseCampaignPatch({ kind: 'visit' }), { ok: true, value: { kind: 'visit' } });
  assert.deepEqual(parseCampaignPatch({ nameEn: 'Clinic A' }), { ok: true, value: { nameEn: 'Clinic-A' } });
  assert.deepEqual(parseCampaignPatch({ endsOn: '2026-09-06' }), { ok: true, value: { endsOn: '2026-09-06' } }); // 한쪽만 — 순서는 라우트가 기존값과 합쳐 본다
  assert.equal(msg(parseCampaignPatch({ startsOn: '2026-09-07', endsOn: '2026-09-06' })), PERIOD_MESSAGE);
  assert.equal(msg(parseCampaignPatch({ name: '' })), NAME_MESSAGE);
  assert.equal(msg(parseCampaignPatch({ note: 3 })), NOTE_MESSAGE);
  assert.deepEqual(parseCampaignPatch({ clientId: CLIENT, note: '' }), { ok: true, value: { note: '' } }); // 클라 변경은 범위 밖 — 키가 값에 실리지 않는다
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignInput.test.ts`
Expected: FAIL — `Cannot find module './campaignInput.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignInput.ts`)

```ts
// 캠페인 라우트 입력 검증 — 순수(DB 없음). 생성·수정이 같은 규칙을 쓴다: 이름 필수·영문 코드는 트래킹 링크의
// checkCampaign(공백→하이픈, 영어·숫자·._-)·기간은 달력일 문자열·유형은 화이트리스트. 서버가 최종 근거이고,
// 생성 모달·헤더 인라인 수정(Task 10·11)은 같은 함수로 즉시 피드백을 만든다 — 문구가 두 벌이 되지 않게.
import { checkCampaign, campaignMessage } from './trackingLink.ts';
import { isCampaignKind, isDateOnlyString, type CampaignKind } from './campaignJudgment.ts';
import { isUuidLike } from './uuid.ts';
import type { Parsed } from './campaignCost.ts';

export interface CampaignCreateInput {
  clientId: string; name: string; nameEn: string; startsOn: string; endsOn: string;
  kind: CampaignKind | null; note: string;
}
export interface CampaignPatchInput {
  name?: string; nameEn?: string; startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string;
}

export const NAME_MAX = 80;    // 원고 제목과 같은 상한(drafts/[id] 라우트) — 목록 한 줄에 들어가는 길이
export const NOTE_MAX = 2000;
export const PERIOD_MESSAGE = '종료일이 시작일보다 앞이에요';
export const NAME_MESSAGE = '캠페인 이름을 입력해 주세요';
export const CLIENT_MESSAGE = '클라이언트를 골라 주세요';
export const DATE_MESSAGE = '기간은 YYYY-MM-DD 날짜로 입력해 주세요';
export const KIND_MESSAGE = '유형 값이 올바르지 않아요';
export const NOTE_MESSAGE = '메모 형식이 올바르지 않아요';

function fail<T>(message: string): Parsed<T> { return { ok: false, message }; }

// 같은 날(하루짜리)은 허용 — DB check(ends_on >= starts_on)와 같은 경계. 위반이면 문구, 아니면 null.
export function checkPeriod(startsOn: string, endsOn: string): string | null {
  return endsOn < startsOn ? PERIOD_MESSAGE : null;
}

function parseName(v: unknown): Parsed<string> {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) return fail(NAME_MESSAGE);
  if (name.length > NAME_MAX) return fail(`캠페인 이름은 ${NAME_MAX}자까지 쓸 수 있어요`);
  return { ok: true, value: name };
}
// 영문 코드 = 트래킹 링크 utm_campaign 기본값이 되므로 그쪽 규칙 그대로(리뷰: 문구도 campaignMessage 재사용)
function parseNameEn(v: unknown): Parsed<string> {
  const c = checkCampaign(typeof v === 'string' ? v : '');
  return c.ok ? { ok: true, value: c.campaign } : fail(campaignMessage(c.reason));
}
function parseDate(v: unknown): Parsed<string> {
  return isDateOnlyString(v) ? { ok: true, value: v } : fail(DATE_MESSAGE);
}
// ''와 null은 둘 다 '유형 없음' — select의 빈 option 값이 ''라서 모달이 그대로 보낸다
function parseKind(v: unknown): Parsed<CampaignKind | null> {
  if (v === null || v === '') return { ok: true, value: null };
  return isCampaignKind(v) ? { ok: true, value: v } : fail(KIND_MESSAGE);
}
function parseNote(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return fail(NOTE_MESSAGE);
  const note = v.trim();
  return note.length > NOTE_MAX ? fail(`메모는 ${NOTE_MAX}자까지 쓸 수 있어요`) : { ok: true, value: note };
}

export function parseCampaignCreate(body: unknown): Parsed<CampaignCreateInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.clientId !== 'string' || !isUuidLike(b.clientId)) return fail(CLIENT_MESSAGE);
  const name = parseName(b.name);          if (!name.ok) return fail(name.message);
  const nameEn = parseNameEn(b.nameEn);    if (!nameEn.ok) return fail(nameEn.message);
  const startsOn = parseDate(b.startsOn);  if (!startsOn.ok) return fail(startsOn.message);
  const endsOn = parseDate(b.endsOn);      if (!endsOn.ok) return fail(endsOn.message);
  const period = checkPeriod(startsOn.value, endsOn.value); if (period) return fail(period);
  const kind = parseKind(b.kind ?? null);  if (!kind.ok) return fail(kind.message);
  const note = parseNote(b.note ?? '');    if (!note.ok) return fail(note.message);
  return { ok: true, value: {
    clientId: b.clientId, name: name.value, nameEn: nameEn.value,
    startsOn: startsOn.value, endsOn: endsOn.value, kind: kind.value, note: note.value,
  } };
}

// undefined = 건드리지 않음. 모르는 키(clientId 등)는 무시 — 클라이언트 변경은 범위 밖(스펙 §3-3 수정 항목: 이름·기간·유형·코드·메모).
export function parseCampaignPatch(body: unknown): Parsed<CampaignPatchInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: CampaignPatchInput = {};
  if (b.name !== undefined)     { const p = parseName(b.name);       if (!p.ok) return fail(p.message); out.name = p.value; }
  if (b.nameEn !== undefined)   { const p = parseNameEn(b.nameEn);   if (!p.ok) return fail(p.message); out.nameEn = p.value; }
  if (b.startsOn !== undefined) { const p = parseDate(b.startsOn);   if (!p.ok) return fail(p.message); out.startsOn = p.value; }
  if (b.endsOn !== undefined)   { const p = parseDate(b.endsOn);     if (!p.ok) return fail(p.message); out.endsOn = p.value; }
  if (b.kind !== undefined)     { const p = parseKind(b.kind);       if (!p.ok) return fail(p.message); out.kind = p.value; }
  if (b.note !== undefined)     { const p = parseNote(b.note);       if (!p.ok) return fail(p.message); out.note = p.value; }
  // 양쪽이 다 왔을 때만 여기서 순서를 본다 — 한쪽만 오면 라우트가 기존 값과 합쳐 checkPeriod를 부른다
  if (out.startsOn !== undefined && out.endsOn !== undefined) {
    const period = checkPeriod(out.startsOn, out.endsOn);
    if (period) return fail(period);
  }
  return { ok: true, value: out };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignInput.test.ts`
Expected: PASS 3건

- [ ] **Step 5: 목록·생성 라우트** (`src/app/api/campaigns/route.ts` 생성)

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { listCampaigns, createCampaign } from '@/lib/campaignStore';
import { parseCampaignCreate } from '@/lib/campaignInput';
import { getClientWithProcedures } from '@/lib/clientStore';

// 목록 — 그룹(진행 중/예정/종료)은 클라가 campaignStatus로 나눈다. 서버는 파생 수·통화별 합계만 붙인다(스펙 §6).
export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listCampaigns(getSql()));
}

export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const parsed = parseCampaignCreate(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  // 클라 이름은 스냅샷(014 관례) — 지금 이름을 서버가 박제한다. 그 사이 지워졌으면 FK 위반을 500으로 흘리지 않고 400.
  const client = await getClientWithProcedures(sql, parsed.value.clientId);
  if (!client) {
    return NextResponse.json({ error: '클라이언트를 찾을 수 없어요 — 목록을 새로고침해 주세요' }, { status: 400 });
  }
  const row = await createCampaign(sql, {
    ...parsed.value, clientName: client.client.name,
    createdBy: gate.member.id, // 클라이언트 body 무시 — 위조 차단(drafts POST 관례)
  });
  return NextResponse.json(row);
}
```

- [ ] **Step 6: 상세·수정·삭제 라우트** (`src/app/api/campaigns/[id]/route.ts` 생성)

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign, getCampaignDetail, updateCampaign, deleteCampaign } from '@/lib/campaignStore';
import { parseCampaignPatch, checkPeriod } from '@/lib/campaignInput';

// campaign.id는 uuid — 형식 아닌 값은 "없음"이 아니라 캐스팅 오류(22P02 → 500)라 조회 전에 404로 끊는다(influencers/[id] 관례)
const notFound = () => NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });

// 상세 = 캠페인 + 원고(게시됨·성과) + 비용 행 + 요약 + 인플 목록 + today(스펙 §6) — 판정 기준 '오늘'을 함께 내려
// 클라가 같은 기준으로 다시 그린다(캠페인 화면의 낙관적 갱신이 서버와 다른 날짜로 밀림을 판정하면 안 된다).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const detail = await getCampaignDetail(getSql(), id);
  if (!detail) return notFound();
  return NextResponse.json(detail);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  const parsed = parseCampaignPatch(await req.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const sql = getSql();
  const cur = await getCampaign(sql, id);
  if (!cur) return notFound();
  // 한쪽 날짜만 바뀌면 기존 값과 합쳐 순서를 본다 — DB check가 최후 방어지만 사용자에겐 500이 아니라 문구가 가야 한다.
  // 기간을 줄여 예정일이 기간 밖이 되는 원고는 막지 않는다 — 카드·행에 '기간 밖' 경고만(스펙 §3-3).
  const period = checkPeriod(parsed.value.startsOn ?? cur.startsOn, parsed.value.endsOn ?? cur.endsOn);
  if (period) return NextResponse.json({ error: period }, { status: 400 });
  await updateCampaign(sql, id, parsed.value);
  return NextResponse.json(await getCampaign(sql, id));
}

// 원고는 지우지 않는다(FK set null, 예정일·비용은 원고에 남는다) — 확인 다이얼로그는 클라 몫(스펙 §3-3).
// 이미 없어도 ok:true·deleted:false — 삭제는 멱등(influencers DELETE 관례).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  return NextResponse.json({ ok: true, deleted: await deleteCampaign(getSql(), id) });
}
```

- [ ] **Step 7: 타입·린트 확인** (라우트 하네스 없음 — 스토어 테스트(Task 4)가 저장 동작을, 여기선 컴파일과 린트를 확인한다)

Run: `npx tsc --noEmit -p .`
Expected: 오류 0

Run: `npm run lint`
Expected: 경고 24개, 오류 0

- [ ] **Step 8: Commit**

```bash
git add src/lib/campaignInput.ts src/lib/campaignInput.test.ts src/app/api/campaigns/route.ts 'src/app/api/campaigns/[id]/route.ts'
git commit -m "feat(campaign): 캠페인 입력 검증(이름·영문 코드·기간·유형·메모) + /api/campaigns GET·POST, /api/campaigns/[id] GET·PATCH·DELETE"
```

---

### Task 7: 인플 추가 비용 PUT · 원고 후보 GET · `campaignApi.ts`(브라우저 fetch 헬퍼) · `CostPopover` · `ScheduledOnField`

**Parallel group:** G3 (Task 6 후)
**Suggested model:** sonnet

**Files:**
- Create: `src/app/api/campaigns/[id]/influencers/[handle]/route.ts`
- Create: `src/app/api/campaigns/[id]/drafts/route.ts`
- Create: `src/lib/campaignApi.ts`
- Test: `src/lib/campaignApi.test.ts`
- Create: `src/components/CostPopover.tsx`
- Create: `src/components/ScheduledOnField.tsx`

**Interfaces:**
- Consumes: `parseExtraCosts`, `ExtraCost`, `DraftCost`, `CostType`, `Currency`, `COST_TYPES`, `COST_TYPE_LABEL`, `CURRENCIES`, `CURRENCY_LABEL`, `AMOUNT_MESSAGE`, `parseAmount`, `formatAmount`(Task 1) · `formatDateKo`(Task 2) · `getCampaign`, `upsertInfluencerCost`, `CampaignRow`, `CampaignDetail`, `InfluencerCostRow`(Task 4) · `listUnassignedDrafts`, `DraftRow`(Task 3) · `CampaignCreateInput`, `CampaignPatchInput`(Task 6) · `PATCH /api/drafts/[id]`·bulk body(Task 5 — 런타임 계약만, 컴파일 의존 없음) · `parseXHandle`, `handleParseMessage`(`@/lib/xHandle`) · `TrackedPostRow`(`@/lib/trackingStore`) · `apiFetch`
- Produces (Task 8·9·10·11·12·13·15가 사용):
  - `PUT /api/campaigns/[id]/influencers/[handle]` body `{ extraCosts?: ExtraCost[]; note?: string }` → `InfluencerCostRow`(둘 다 없으면 400 `'바꿀 내용이 없어요'`)
  - `GET /api/campaigns/[id]/drafts` → `DraftRow[]`(그 캠페인 클라이언트의 미소속 원고, 최신순 200건)
  - `type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number }` · `toApiResult<T>(r: Response): Promise<ApiResult<T>>`
  - `fetchCampaigns()`, `fetchCampaignDetail(id)`, `createCampaignApi(input: CampaignCreateInput)`, `patchCampaignApi(id, patch: CampaignPatchInput)`, `deleteCampaignApi(id)`, `putInfluencerCostApi(campaignId, handle, patch)`, `fetchCandidateDrafts(campaignId)`
  - `interface DraftPatchBody { status?: DraftStatus; influencerHandle?: string | null; title?: string; edited?: DraftContent; dismissedFlags?: string[]; campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null }` · `patchDraftApi(id, body: DraftPatchBody): Promise<ApiResult<DraftRow>>` · `bulkCampaignApi(ids: string[], campaignId: string | null)` · `deleteDraftApi(id)` · `rewriteDraftApi(id, baseIndex, feedback)` · `regenPostApi(id, index)` · `registerTrackedPostApi(url)` · `linkTrackedPostDraftApi(trackedPostId, draftId)`
  - `<CostPopover value suggestion defaultType onChange compact? />` · `<ScheduledOnField value overdueDays outOfRange onChange compact? />`

스펙 모호점 해소(이 계획의 결정): "기존 원고 고르기 → 여러 개 체크 → 한 문장 update"는 **새 POST를 만들지 않고** Task 5가 확장한 `PATCH /api/drafts {ids, campaignId}`를 쓴다(스펙 §6 API 표에 정확히 그 한 줄만 있다). 이 태스크의 `/drafts` 라우트는 후보 GET만.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignApi.test.ts` — Node 20+의 전역 `Response`로 응답 해석만 검증. 나머지 함수는 URL·메서드 조립일 뿐이라 타입이 검증한다)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toApiResult } from './campaignApi.ts';

test('1) 2xx → ok:true + 본문 그대로', async () => {
  const r = new Response(JSON.stringify({ id: 'x', total: { KRW: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await toApiResult<{ id: string }>(r), { ok: true, data: { id: 'x', total: { KRW: 1 } } });
});

test('2) 4xx/5xx → 서버 문구 그대로(넘겨짚지 않음), 본문이 JSON이 아니면 상태코드 문구', async () => {
  const bad = new Response(JSON.stringify({ error: '종료일이 시작일보다 앞이에요' }), { status: 400 });
  assert.deepEqual(await toApiResult(bad), { ok: false, error: '종료일이 시작일보다 앞이에요', status: 400 });
  const html = new Response('<html>Bad Gateway</html>', { status: 502 });
  assert.deepEqual(await toApiResult(html), { ok: false, error: '오류 502', status: 502 });
  const empty = new Response(null, { status: 404 });
  assert.deepEqual(await toApiResult(empty), { ok: false, error: '오류 404', status: 404 });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignApi.test.ts`
Expected: FAIL — `Cannot find module './campaignApi.ts'`

- [ ] **Step 3: `campaignApi.ts` 구현**

```ts
// 브라우저 전용 fetch 헬퍼 — /campaigns·DraftCard·/generate가 같은 요청 함수를 쓴다(오류 문구 추출을 한 곳에).
// 성공/실패를 한 모양(ApiResult)으로 돌려 호출부가 try/catch 없이 ok만 본다 — 낙관적 갱신·롤백 코드가 짧아진다.
import { apiFetch } from './apiFetch.ts';
import type { DraftRow } from './draftStore.ts';
import type { DraftStatus } from './draftStatus.ts';
import type { DraftContent } from './draftTypes.ts';
import type { CampaignRow, CampaignDetail, InfluencerCostRow } from './campaignStore.ts';
import type { CampaignCreateInput, CampaignPatchInput } from './campaignInput.ts';
import type { ExtraCost, DraftCost } from './campaignCost.ts';
import type { TrackedPostRow } from './trackingStore.ts';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

// 서버가 준 오류 문구를 그대로 쓴다 — 원인을 넘겨짚지 않는다(profileShared.errOf 관례). 본문이 깨져도 상태코드는 남긴다.
export async function toApiResult<T>(r: Response): Promise<ApiResult<T>> {
  const body: unknown = await r.json().catch(() => null);
  if (r.ok) return { ok: true, data: body as T };
  const error = (body as { error?: string } | null)?.error ?? `오류 ${r.status}`;
  return { ok: false, error, status: r.status };
}

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// 네트워크 예외도 같은 모양으로 — status 0. 401은 apiFetch가 /login으로 보내고 throw하므로 여기까지 오지 않는다.
async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    return await toApiResult<T>(await apiFetch(input, init));
  } catch {
    return { ok: false, error: '네트워크 오류가 났어요 — 연결을 확인하고 다시 시도해 주세요', status: 0 };
  }
}

// ── 캠페인 ──
export const fetchCampaigns = () => call<CampaignRow[]>('/api/campaigns');
export const fetchCampaignDetail = (id: string) => call<CampaignDetail>(`/api/campaigns/${id}`);
export const createCampaignApi = (input: CampaignCreateInput) => call<CampaignRow>('/api/campaigns', json('POST', input));
export const patchCampaignApi = (id: string, patch: CampaignPatchInput) => call<CampaignRow>(`/api/campaigns/${id}`, json('PATCH', patch));
export const deleteCampaignApi = (id: string) => call<{ ok: true; deleted: boolean }>(`/api/campaigns/${id}`, { method: 'DELETE' });
export const putInfluencerCostApi = (campaignId: string, handle: string, patch: { extraCosts?: ExtraCost[]; note?: string }) =>
  call<InfluencerCostRow>(`/api/campaigns/${campaignId}/influencers/${encodeURIComponent(handle)}`, json('PUT', patch));
export const fetchCandidateDrafts = (campaignId: string) => call<DraftRow[]>(`/api/campaigns/${campaignId}/drafts`);

// ── 원고(기존 라우트 — 값은 하나, 캠페인 전용 경로 없음 §2-5) ──
export interface DraftPatchBody {
  status?: DraftStatus; influencerHandle?: string | null; title?: string; edited?: DraftContent; dismissedFlags?: string[];
  campaignId?: string | null; scheduledOn?: string | null; cost?: DraftCost | null;
}
export const patchDraftApi = (id: string, body: DraftPatchBody) => call<DraftRow>(`/api/drafts/${id}`, json('PATCH', body));
// 일괄 소속·해제 — 50건도 커넥션 1개(updateDraftsBulk). '기존 원고 고르기'와 DraftCard 캠페인 칸의 이동이 쓴다.
export const bulkCampaignApi = (ids: string[], campaignId: string | null) =>
  call<{ ok: true; updated: number }>('/api/drafts', json('PATCH', { ids, campaignId }));
export const deleteDraftApi = (id: string) => call<{ ok: true }>(`/api/drafts/${id}`, { method: 'DELETE' });
export const rewriteDraftApi = (id: string, baseIndex: number, feedback: string) =>
  call<DraftRow>(`/api/drafts/${id}/rewrite`, json('POST', { baseIndex, ...(feedback ? { feedback } : {}) }));
export const regenPostApi = (id: string, index: number) => call<DraftRow>(`/api/drafts/${id}/regen-post`, json('POST', { index }));

// ── 게시물 연결(스펙 §3-2 단계 셀 옆) — 등록 POST(url만 받는다) 뒤 PATCH로 draft_id를 붙인다. 두 라우트 다 기존.
export const registerTrackedPostApi = (url: string) => call<{ created: boolean; row: TrackedPostRow }>('/api/tracking', json('POST', { url }));
export const linkTrackedPostDraftApi = (trackedPostId: string, draftId: string | null) =>
  call<TrackedPostRow>(`/api/tracking/${trackedPostId}`, json('PATCH', { draftId }));
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignApi.test.ts`
Expected: PASS 2건

- [ ] **Step 5: 추가 비용 PUT 라우트** (`src/app/api/campaigns/[id]/influencers/[handle]/route.ts` 생성)

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { parseExtraCosts, type ExtraCost } from '@/lib/campaignCost';
import { getCampaign, upsertInfluencerCost } from '@/lib/campaignStore';

const notFound = () => NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });

// 캠페인×핸들의 추가 비용·메모 upsert(스펙 §2-2 — 행은 처음 적을 때 생긴다). 인플 목록 자체는 원고에서 파생되므로
// 이 라우트는 '명단에 추가'가 아니다 — 원고 0인 핸들에 비용을 적으면 표에 "배정 원고 없음"으로 드러난다(§2-4).
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; handle: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id, handle } = await ctx.params;
  if (!isUuidLike(id)) return notFound();
  // 핸들은 서버 정규화(parseXHandle)를 한 번 더 — 원고 배정과 같은 표기 규칙이어야 lower 조인이 맞아떨어진다
  const parsedHandle = parseXHandle(handle);
  if (!parsedHandle.ok) return NextResponse.json({ error: handleParseMessage(parsedHandle.reason) }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { extraCosts?: unknown; note?: unknown };
  const patch: { extraCosts?: ExtraCost[]; note?: string } = {};
  if (body.extraCosts !== undefined) {
    const p = parseExtraCosts(body.extraCosts);
    if (!p.ok) return NextResponse.json({ error: p.message }, { status: 400 });
    patch.extraCosts = p.value;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string') return NextResponse.json({ error: '메모 형식이 올바르지 않아요' }, { status: 400 });
    patch.note = body.note.trim();
  }
  if (patch.extraCosts === undefined && patch.note === undefined) {
    return NextResponse.json({ error: '바꿀 내용이 없어요' }, { status: 400 });
  }
  const sql = getSql();
  if (!(await getCampaign(sql, id))) return notFound();
  return NextResponse.json(await upsertInfluencerCost(sql, id, parsedHandle.handle, patch));
}
```

- [ ] **Step 6: 원고 후보 GET 라우트** (`src/app/api/campaigns/[id]/drafts/route.ts` 생성)

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { getCampaign } from '@/lib/campaignStore';
import { listUnassignedDrafts } from '@/lib/draftStore';

// '기존 원고 고르기' 후보(스펙 §4-1) — 그 캠페인 클라이언트의 캠페인 미소속 원고만. 다른 캠페인 소속은 나오지 않는다(§7).
// 추가 자체는 PATCH /api/drafts {ids, campaignId}(Task 5) — 여기서 쓰기 경로를 하나 더 만들지 않는다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });
  const sql = getSql();
  const campaign = await getCampaign(sql, id);
  if (!campaign) return NextResponse.json({ error: '캠페인을 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(await listUnassignedDrafts(sql, campaign.clientId));
}
```

- [ ] **Step 7: `CostPopover.tsx`** — 유형·금액·통화 팝오버(표 셀·카드 도구층 공용)

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COST_TYPES, COST_TYPE_LABEL, CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, parseAmount, formatAmount,
  type DraftCost, type CostType, type Currency,
} from '@/lib/campaignCost';

// 원고 비용(유형·금액·통화 한 벌) — 팝오버에서 고친다(스펙 §3-2 비용 셀). 저장은 부모 몫(낙관적 갱신·롤백은 호출부 훅).
// InfluencerChip과 같은 골격(body 포털·좌표 고정·바깥 클릭/Esc 닫기) — 표 셀·카드 도구층 어디서 열려도 overflow에 잘리지 않는다.
// 단가 제안(suggestion)은 '비어 있을 때 열면 그 값으로 시작'만 한다 — 사람이 적은 값을 덮지 않는다(§3-2).
const POP_W = 300;
const POP_H = 250;

export function CostPopover({ value, suggestion, defaultType, onChange, compact }: {
  value: DraftCost | null;
  suggestion: DraftCost | null;   // 배정된 인플의 단가에서 온 제안(suggestDraftCost) — 없으면 null
  defaultType: CostType;          // 캠페인 유형에서 파생(defaultCostType) — 값도 제안도 없을 때 유형 초기값
  onChange: (next: DraftCost | null) => void;
  compact?: boolean;              // 표 셀 = 글자만(테두리 없음, 15px), 카드 도구층 = 칩(32px, 13px)
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [type, setType] = useState<CostType>(defaultType);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('KRW');
  const [err, setErr] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  // 앵커의 화면 좌표에 고정 + 화면 경계 클램프 + 아래 공간이 없으면 위로(InfluencerChip.place와 같은 계산)
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - POP_W - 8));
    const below = r.bottom + 4;
    const flip = below + POP_H > window.innerHeight && r.top - POP_H - 4 > 0;
    setPos({ top: flip ? r.top - POP_H - 4 : below, left });
  }, []);
  const close = useCallback(() => {
    if (popRef.current?.contains(document.activeElement)) btnRef.current?.focus();
    setOpen(false);
  }, []);

  function openPop() {
    const start = value ?? suggestion;   // 비어 있으면 제안으로 시작 — 저장을 눌러야 값이 된다(자동 저장 아님)
    setType(start?.type ?? defaultType);
    setAmount(start ? String(start.amount) : '');
    setCurrency(start?.currency ?? 'KRW');
    setErr(null); place(); setOpen(true);
  }
  function save() {
    const n = parseAmount(amount);
    if (n === null) { setErr(AMOUNT_MESSAGE); return; }
    const next: DraftCost = { type, amount: n, currency };
    // 바뀐 게 없으면 부모를 부르지 않는다 — 같은 값으로 PATCH를 한 번 더 보낼 이유가 없다(InfluencerChip 관례)
    if (!value || value.type !== next.type || value.amount !== next.amount || value.currency !== next.currency) onChange(next);
    close();
  }
  function clear() { if (value) onChange(null); close(); }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    // capture로 받아 전파를 끊는다 — 카드 peek 오버레이의 Esc 리스너까지 한 번에 닫히지 않게(InfluencerChip 관례)
    const onKey = (e: KeyboardEvent) => { if (e.key !== 'Escape' || e.isComposing) return; e.stopPropagation(); close(); };
    const onMove = () => place();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, close, place]);

  const label = value ? `${formatAmount(value.amount, value.currency)} · ${COST_TYPE_LABEL[value.type]}` : null;
  const trigger = value
    ? (compact ? formatAmount(value.amount, value.currency) : label)
    : suggestion
      ? <span className="text-x-blue-text">제안 {formatAmount(suggestion.amount, suggestion.currency)}</span>
      : (compact ? <span className="text-x-muted">비용 없음</span> : '+ 비용');

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (open ? close() : openPop())}
              aria-haspopup="dialog" aria-expanded={open}
              aria-label={value ? `비용 ${label} — 바꾸기` : '비용 입력하기'}
              title={value ? '이 원고의 콘텐츠 비용 — 눌러서 바꾸기'
                           : suggestion ? '배정된 인플루언서의 단가에서 제안한 값이에요 — 눌러서 확인하고 저장'
                           : '이 원고 하나의 콘텐츠 비용을 적어요'}
              className={compact
                ? 'text-content tabular-nums hover:underline'
                : `inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-ui ${
                    value ? 'border-x-border-strong text-x-text hover:bg-x-hover'
                          : 'border-dashed border-x-border-strong text-x-muted hover:bg-x-hover hover:text-x-secondary'}`}>
        {trigger}
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="콘텐츠 비용" style={{ top: pos.top, left: pos.left, width: POP_W }}
             onClick={(e) => e.stopPropagation()}
             className="fixed z-50 rounded-xl border border-x-border-strong bg-white p-3 shadow-lg">
          <p className="text-ui font-bold">콘텐츠 비용</p>
          <p className="mt-0.5 text-ui text-x-muted">이 원고 하나에 드는 비용이에요 — 인플루언서별 소계와 캠페인 합계에 바로 반영돼요</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-ui text-x-secondary">유형
              <select value={type} onChange={(e) => setType(e.target.value as CostType)}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-content outline-none focus:border-x-blue">
                {COST_TYPES.map((t) => <option key={t} value={t}>{COST_TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="block text-ui text-x-secondary">통화
              <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-content outline-none focus:border-x-blue">
                {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]} ({c})</option>)}
              </select>
            </label>
          </div>
          <label className="mt-2 block text-ui text-x-secondary">금액
            <input inputMode="numeric" value={amount} autoFocus
                   onChange={(e) => { setAmount(e.target.value); setErr(null); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) save(); }}
                   placeholder="300000"
                   className="mt-0.5 w-full rounded-md border border-x-border-strong px-2 py-1.5 text-content tabular-nums outline-none focus:border-x-blue" />
          </label>
          <p className="mt-1 text-ui text-x-muted">통화를 바꿔도 금액은 그대로예요 — 환산하지 않아요</p>
          {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            {value && <button type="button" onClick={clear} className="text-ui text-x-secondary hover:text-red-600">비용 지우기</button>}
            <button type="button" onClick={close} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5">취소</button>
            <button type="button" onClick={save} className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover">저장</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
```

- [ ] **Step 8: `ScheduledOnField.tsx`** — 예정일 한 칸(보이는 글자 + 투명 date 입력 덮기)

```tsx
'use client';
import { useId } from 'react';
import { formatDateKo } from '@/lib/campaignJudgment';

// 예정일 한 칸 — '8/26 수 · 1일 지남'을 보여주고, 누르면 그 자리에서 날짜를 고른다. DraftStatusChip의 '보이는 칩 + 투명 select'와
// 같은 골격으로 네이티브 date 입력을 투명하게 덮어 클릭 한 번에 달력이 뜬다. 지움은 옆의 ✕(null 저장, 스펙 §2-3 null=지움).
// 밀림(overdueDays)·기간 밖(outOfRange) 판정은 호출부가 campaignJudgment로 계산해 넘긴다 — 이 칸은 게시됨 여부를 모른다.
export function ScheduledOnField({ value, overdueDays, outOfRange, onChange, compact }: {
  value: string | null;          // 'YYYY-MM-DD' | null
  overdueDays: number | null;    // isOverdue면 daysBetweenDates(value, today), 아니면 null
  outOfRange: boolean;           // 캠페인 기간 밖 — 경고 표시만, 저장 차단 없음(§2-4)
  onChange: (next: string | null) => void;
  compact?: boolean;             // 표 셀 = 글자(15px), 카드 도구층 = 칩(32px, 13px)
}) {
  const id = useId();
  const tone = overdueDays ? 'font-bold text-red-700' : value ? 'text-x-text' : 'text-x-muted';
  const box = compact
    ? `text-content ${tone}`
    : `h-8 rounded-lg border bg-white px-2.5 text-ui ${value ? 'border-x-border-strong' : 'border-dashed border-x-border-strong'} ${tone}`;
  return (
    <span className="inline-flex items-center gap-1">
      <label htmlFor={id} title={value ? '게시 예정일 — 눌러서 바꾸기' : '게시 예정일을 정하면 밀림 여부를 알려줘요'}
             className={`relative inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 hover:bg-x-hover ${box}`}>
        <span className="tabular-nums">{value ? formatDateKo(value) : (compact ? '예정일 없음' : '+ 예정일')}</span>
        {overdueDays ? <span className="font-normal">· {overdueDays}일 지남</span> : null}
        {outOfRange && <span className="rounded bg-amber-100 px-1 text-ui font-normal text-amber-800" title="캠페인 기간 밖 날짜예요 — 저장은 되지만 표시로 알려요">기간 밖</span>}
        <input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}
               aria-label="게시 예정일" className="absolute inset-0 w-full cursor-pointer opacity-0" />
      </label>
      {value && (
        <button type="button" onClick={() => onChange(null)} aria-label="예정일 지우기"
                title="예정일 지우기 — 달력의 '예정일 없음' 열로 가요"
                className="rounded-full p-1 text-x-muted hover:bg-red-50 hover:text-red-600">✕</button>
      )}
    </span>
  );
}
```

- [ ] **Step 9: 타입·린트 확인**

Run: `npx tsc --noEmit -p .`
Expected: 오류 0

Run: `npm run lint`
Expected: 경고 24개, 오류 0(두 컴포넌트 모두 `useEffect` 안 동기 setState가 없어야 한다 — `react-hooks/set-state-in-effect`가 기준선을 늘리지 않게)

- [ ] **Step 10: Commit**

```bash
git add 'src/app/api/campaigns/[id]/influencers/[handle]/route.ts' 'src/app/api/campaigns/[id]/drafts/route.ts' src/lib/campaignApi.ts src/lib/campaignApi.test.ts src/components/CostPopover.tsx src/components/ScheduledOnField.tsx
git commit -m "feat(campaign): 인플 추가 비용 PUT·원고 후보 GET + 브라우저 fetch 헬퍼(campaignApi) + 공용 비용 팝오버·예정일 칸"
```

---

### Task 8: `campaignTableView.ts`(표시 문자열) + `ContentTable.tsx`(콘텐츠 표 6열) + `SummaryCards.tsx`(요약 카드 4)

**Parallel group:** G4 (G2+G3 후, Task 9와 병렬 — Task 9 파일을 import하지 않는다)
**Suggested model:** opus

**Files:**
- Create: `src/lib/campaignTableView.ts`
- Test: `src/lib/campaignTableView.test.ts`
- Create: `src/app/campaigns/SummaryCards.tsx`
- Create: `src/app/campaigns/ContentTable.tsx`

**Interfaces:**
- Consumes: `CampaignDraftItem`, `CampaignRow`(Task 4) · `sortContent`, `matchesStageFilter`, `isOverdue`, `isOutOfRange`, `daysBetweenDates`, `formatDateKo`, `defaultCostType`, `STAGE_FILTERS`, `STAGE_FILTER_LABEL`, `CONTENT_SORT_LABEL`, `ContentSortKey`, `StageFilter`, `StageInput`, `CampaignSummary`, `PerfSummary`(Task 2) · `suggestDraftCost`, `moneyParts`, `formatAmount`, `COST_TYPE_LABEL`, `DraftCost`, `MoneyByCurrency`(Task 1) · `CostPopover`, `ScheduledOnField`(Task 7) · `DraftStatusChip`, `InfluencerChip`(기존) · `draftLabel`(`@/lib/draftViews`) · `InfluencerOption`(Task 3)
- Produces (Task 10·15가 사용):
  - `overdueDays(d: StageInput, today): number | null` · `scheduledOnLabel(d, today): string`(`'8/26 수 · 1일 지남'`) · `contentSubline(d: { cost; format }): string`(`'투고 · 단문'`) · `perfLabel(d): string`(`'조회 12,400 · 링크 96'`/`'—'`) · `handleInitial(handle): string` · `overdueJudgment(n): string` · `publishedSub(s: CampaignSummary): string` · `perfSub(p: PerfSummary): string`
  - `<SummaryCards summary={CampaignSummary} perf={PerfSummary} total={MoneyByCurrency} />`
  - `<ContentTable rows campaign today influencerOptions sort onSortChange filter onFilterChange onOpenDraft onChangeStatus onAssignInfluencer onChangeScheduledOn onChangeCost onRemoveFromCampaign onLinkPost />` — 콜백 시그니처는 Step 5 코드의 props 타입이 정의

스펙 모호점 해소(이 계획의 결정): 콘텐츠 셀 보조줄의 "유형"은 **원고 비용의 유형**(RT·인용RT·투고·방문협찬 — `cost.type`)이다. 비용이 없으면 유형을 생략하고 `단문/스레드`만 쓴다. 캠페인 유형(content/visit/seeding)은 헤더에 이미 있어 행마다 반복하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignTableView.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overdueDays, scheduledOnLabel, contentSubline, perfLabel, handleInitial, overdueJudgment, publishedSub, perfSub,
} from './campaignTableView.ts';

const T = '2026-08-27';

test('1) 밀림 일수·예정일 문구 — 게시됨·미사용·오늘·없음은 밀림 아님(campaignJudgment.isOverdue 그대로)', () => {
  assert.equal(overdueDays({ status: 'draft', published: false, scheduledOn: '2026-08-26' }, T), 1);
  assert.equal(overdueDays({ status: 'delivered', published: false, scheduledOn: '2026-08-20' }, T), 7);
  assert.equal(overdueDays({ status: 'draft', published: true, scheduledOn: '2026-08-20' }, T), null);
  assert.equal(overdueDays({ status: 'unused', published: false, scheduledOn: '2026-08-20' }, T), null);
  assert.equal(overdueDays({ status: 'draft', published: false, scheduledOn: T }, T), null);
  assert.equal(overdueDays({ status: 'draft', published: false, scheduledOn: null }, T), null);
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: '2026-08-26' }, T), '8/26 수 · 1일 지남');
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: '2026-08-29' }, T), '8/29 토');
  assert.equal(scheduledOnLabel({ status: 'draft', published: false, scheduledOn: null }, T), '예정일 없음');
});

test('2) 보조줄·성과·이니셜', () => {
  assert.equal(contentSubline({ cost: { type: 'post', amount: 1, currency: 'KRW' }, format: 'single' }), '투고 · 단문');
  assert.equal(contentSubline({ cost: { type: 'quoteRt', amount: 1, currency: 'JPY' }, format: 'thread' }), '인용RT · 스레드');
  assert.equal(contentSubline({ cost: null, format: 'thread' }), '스레드');
  assert.equal(perfLabel({ published: true, perf: { views: 12400 }, linkClicks: 96 }), '조회 12,400 · 링크 96');
  assert.equal(perfLabel({ published: true, perf: { views: 12400 }, linkClicks: null }), '조회 12,400');
  assert.equal(perfLabel({ published: true, perf: { views: null }, linkClicks: null }), '조회 —');   // 스냅샷 없음 → —(0으로 위장 금지, §7)
  assert.equal(perfLabel({ published: false, perf: null, linkClicks: 4 }), '—');                    // 미게시는 링크 클릭이 있어도 — (성과 열은 게시된 것의 것)
  assert.equal(handleInitial('@hana_kim'), 'H');
  assert.equal(handleInitial('yuki'), 'Y');
});

test('3) 요약 카드 보조 문구 — 숫자에 판단을 붙인다(UX 원칙 3), 값 없음은 —', () => {
  assert.equal(overdueJudgment(0), '밀린 콘텐츠가 없어요');
  assert.equal(overdueJudgment(2), '예정일 지났는데 아직 안 올라감');
  assert.equal(publishedSub({ total: 4, published: 1, delivered: 1, preparing: 2, overdue: 0 }), '전달됨 1 · 준비 중 2');
  assert.equal(perfSub({ publishedCount: 2, views: 12400, likes: 300, linkClicks: 100 }), '게시 2건 · 좋아요 300 · 링크 클릭 100');
  assert.equal(perfSub({ publishedCount: 0, views: null, likes: null, linkClicks: null }), '게시 0건 · 좋아요 — · 링크 클릭 —');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTableView.test.ts`
Expected: FAIL — `Cannot find module './campaignTableView.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignTableView.ts`)

```ts
// 콘텐츠 표·요약 카드·달력 카드가 쓰는 표시 문자열 — 컴포넌트가 아니라 여기 두어 테스트로 고정한다.
// 라벨-값 일치(AGENTS 원칙 4)는 대개 문구에서 깨진다: 판정은 campaignJudgment, 문구는 여기, 그리기는 컴포넌트.
import {
  isOverdue, daysBetweenDates, formatDateKo,
  type StageInput, type CampaignSummary, type PerfSummary,
} from './campaignJudgment.ts';
import { COST_TYPE_LABEL, type DraftCost } from './campaignCost.ts';

/** 밀림이면 며칠 지났는지, 아니면 null — 게시됨·미사용·예정일 없음·오늘 이후는 전부 null(isOverdue와 같은 모집단) */
export function overdueDays(d: StageInput, today: string): number | null {
  return isOverdue(d, today) ? daysBetweenDates(d.scheduledOn as string, today) : null;
}

/** '8/26 수 · 1일 지남' | '8/29 토' | '예정일 없음' — 표 셀·달력 카드가 같은 문구 */
export function scheduledOnLabel(d: StageInput, today: string): string {
  if (!d.scheduledOn) return '예정일 없음';
  const od = overdueDays(d, today);
  return od ? `${formatDateKo(d.scheduledOn)} · ${od}일 지남` : formatDateKo(d.scheduledOn);
}

/** 콘텐츠 셀 보조줄 '투고 · 단문' — 유형은 비용 유형(없으면 생략). 캠페인 유형은 헤더에 있어 행마다 반복하지 않는다. */
export function contentSubline(d: { cost: DraftCost | null; format: 'single' | 'thread' }): string {
  return [d.cost ? COST_TYPE_LABEL[d.cost.type] : null, d.format === 'thread' ? '스레드' : '단문']
    .filter(Boolean).join(' · ');
}

const num = (n: number | null) => (n === null ? '—' : n.toLocaleString('ko-KR'));

/** 성과 셀 — 게시됨 행만 '조회 12,400 · 링크 96'. 스냅샷 없으면 '조회 —'(0으로 위장하지 않는다, 스펙 §7). 미게시는 '—'. */
export function perfLabel(d: { published: boolean; perf: { views: number | null } | null; linkClicks: number | null }): string {
  if (!d.published) return '—';
  const parts = [`조회 ${num(d.perf?.views ?? null)}`];
  if (d.linkClicks !== null) parts.push(`링크 ${num(d.linkClicks)}`);
  return parts.join(' · ');
}

/** 인플 아바타 이니셜(InfluencerProfile.Avatar와 같은 규칙 — 프로필 사진은 여기까지 안 내려온다) */
export function handleInitial(handle: string): string {
  return handle.replace(/^@/, '').slice(0, 1).toUpperCase();
}

// 요약 카드 보조 문구(스펙 §3-2) — 숫자만 던지지 않고 판단을 붙인다(UX 원칙 3)
export function overdueJudgment(n: number): string {
  return n === 0 ? '밀린 콘텐츠가 없어요' : '예정일 지났는데 아직 안 올라감';
}
export function publishedSub(s: CampaignSummary): string {
  return `전달됨 ${s.delivered} · 준비 중 ${s.preparing}`;
}
export function perfSub(p: PerfSummary): string {
  return `게시 ${p.publishedCount}건 · 좋아요 ${num(p.likes)} · 링크 클릭 ${num(p.linkClicks)}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignTableView.test.ts`
Expected: PASS 3건

- [ ] **Step 5: `SummaryCards.tsx`**

```tsx
'use client';
import type { ReactNode } from 'react';
import type { CampaignSummary, PerfSummary } from '@/lib/campaignJudgment';
import { moneyParts, formatAmount, type MoneyByCurrency } from '@/lib/campaignCost';
import { overdueJudgment, publishedSub, perfSub } from '@/lib/campaignTableView';

// 요약 카드 4 — 예외 우선 순서(밀림 → 게시 → 비용 → 조회, 스펙 §3-2). 숫자 26px, 라벨은 아래 13px(가독성 기준).
// 값은 전부 판정 함수의 결과를 받는다 — 카드가 따로 세지 않는다(표와 다른 숫자가 나오면 안 된다).
function Card({ alert, value, label, sub }: { alert?: boolean; value: ReactNode; label: string; sub: string }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${alert ? 'border-red-200 bg-red-50' : 'border-x-border bg-white'}`}>
      <p className={`text-[26px] font-bold leading-tight tabular-nums ${alert ? 'text-red-700' : ''}`}>{value}</p>
      <p className="mt-1 text-ui font-bold text-x-secondary">{label}</p>
      <p className="text-ui text-x-muted">{sub}</p>
    </div>
  );
}

export function SummaryCards({ summary, perf, total }: { summary: CampaignSummary; perf: PerfSummary; total: MoneyByCurrency }) {
  const money = moneyParts(total);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card alert={summary.overdue > 0} value={summary.overdue > 0 ? `⚠ ${summary.overdue}` : '0'} label="밀림" sub={overdueJudgment(summary.overdue)} />
      <Card value={<>{summary.published} <span className="text-content font-normal text-x-muted">/ {summary.total}</span></>}
            label="게시됨" sub={publishedSub(summary)} />
      {/* 통화별 두 숫자 — 합치지 않는다(§2-4). 비어 있으면 — */}
      <Card value={money.length === 0 ? '—' : (
              <span className="flex flex-col">{money.map((m) => <span key={m.currency}>{formatAmount(m.amount, m.currency)}</span>)}</span>
            )}
            label="비용 합계" sub="통화별로 따로 계산 — 원과 엔은 합치지 않아요" />
      <Card value={perf.views === null ? '—' : perf.views.toLocaleString('ko-KR')} label="조회 합계" sub={perfSub(perf)} />
    </div>
  );
}
```

- [ ] **Step 6: `ContentTable.tsx`**

```tsx
'use client';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import type { DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption } from '@/lib/draftTypes';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { InfluencerChip } from '@/components/InfluencerChip';
import { CostPopover } from '@/components/CostPopover';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { draftLabel } from '@/lib/draftViews';
import { suggestDraftCost, type DraftCost } from '@/lib/campaignCost';
import {
  sortContent, matchesStageFilter, isOutOfRange, defaultCostType,
  STAGE_FILTERS, STAGE_FILTER_LABEL, CONTENT_SORT_LABEL, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
import { overdueDays, contentSubline, perfLabel, handleInitial } from '@/lib/campaignTableView';

// 콘텐츠 표 — 열 6개 고정(예정일 120 · 콘텐츠 나머지 · 인플 200 · 비용 130 · 단계 130 · 성과 190, 스펙 §3-2).
// 행 ≥48px(py-3)·본문 15px(text-content)·보조 13px(text-ui) — "맨날 빽빽해서 보기 힘들다"(koo 08-25)가 이 표의 첫 요구사항.
// text-caption(11px)은 쓰지 않는다. 정렬·필터·밀림·기간 밖 판정은 전부 campaignJudgment — 이 파일은 결과를 그릴 뿐이다.
// 저장은 전부 콜백(부모 훅이 PATCH /api/drafts/[id]) — 캠페인 전용 경로 없음(§2-5).
const SORT_KEYS: ContentSortKey[] = ['default', 'scheduled', 'stage', 'influencer'];
const TH = 'px-3 py-2 font-normal';
const TD = 'px-3 py-3 align-top';

export function ContentTable({
  rows, campaign, today, influencerOptions, sort, onSortChange, filter, onFilterChange,
  onOpenDraft, onChangeStatus, onAssignInfluencer, onChangeScheduledOn, onChangeCost, onRemoveFromCampaign, onLinkPost,
}: {
  rows: CampaignDraftItem[];                 // 정렬·필터 전 — 여기서 sortContent·matchesStageFilter를 적용한다
  campaign: CampaignRow; today: string;      // today = 서버 detail.today(서울) — 브라우저 시계로 밀림을 판정하지 않는다
  influencerOptions: InfluencerOption[];
  sort: ContentSortKey; onSortChange: (k: ContentSortKey) => void;
  filter: StageFilter; onFilterChange: (f: StageFilter) => void;
  onOpenDraft: (id: string) => void;
  onChangeStatus: (d: CampaignDraftItem, s: DraftStatus) => void;
  onAssignInfluencer: (d: CampaignDraftItem, handle: string | null) => void;
  onChangeScheduledOn: (d: CampaignDraftItem, next: string | null) => void;
  onChangeCost: (d: CampaignDraftItem, next: DraftCost | null) => void;
  onRemoveFromCampaign: (d: CampaignDraftItem) => void;
  onLinkPost: (d: CampaignDraftItem) => void;
}) {
  const counts = Object.fromEntries(
    STAGE_FILTERS.map((f) => [f, rows.filter((d) => matchesStageFilter(d, f)).length]),
  ) as Record<StageFilter, number>;
  const shown = sortContent(rows.filter((d) => matchesStageFilter(d, filter)), sort, today);
  const optionFor = (handle: string | null) =>
    (handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined);

  // 행 클릭 = 원고 열기. 셀 안의 컨트롤(칩·팝오버·날짜 입력·메뉴)과 글자 드래그는 열지 않는다(DraftTable.opensCard 관례).
  function opensCard(e: React.MouseEvent): boolean {
    if (e.target instanceof Element && e.target.closest('a, button, label, input, select, details')) return false;
    const sel = window.getSelection();
    return !(sel && !sel.isCollapsed && sel.toString().trim() !== '');
  }
  const chip = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full border px-3 text-ui tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;

  const empty = (text: string) => (
    <p className="mt-4 rounded-xl border border-x-border bg-x-surface px-4 py-6 text-center text-content text-x-secondary">{text}</p>
  );

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-1.5">
        {STAGE_FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => onFilterChange(f)} aria-pressed={filter === f} className={chip(filter === f)}>
            {STAGE_FILTER_LABEL[f]} {counts[f]}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-ui text-x-secondary">
          정렬
          <select value={sort} onChange={(e) => onSortChange(e.target.value as ContentSortKey)} aria-label="콘텐츠 정렬"
                  className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-ui outline-none focus:border-x-blue">
            {SORT_KEYS.map((k) => <option key={k} value={k}>{CONTENT_SORT_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1.5 text-ui text-x-muted">밀린 콘텐츠가 맨 위에 와요 — 예정일·인플루언서·비용·단계는 칸을 눌러 바로 고칠 수 있어요. 행을 누르면 원고가 열려요.</p>

      {rows.length === 0 ? empty('아직 이 캠페인에 원고가 없어요 — 위의 [+ 원고 추가]로 기존 원고를 넣거나 새로 만들어요.')
       : shown.length === 0 ? empty(`'${STAGE_FILTER_LABEL[filter]}'에 해당하는 콘텐츠가 없어요.`)
       : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full table-fixed text-content">
            <colgroup>
              <col style={{ width: 120 }} /><col /><col style={{ width: 200 }} />
              <col style={{ width: 130 }} /><col style={{ width: 130 }} /><col style={{ width: 190 }} />
            </colgroup>
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className={TH}>예정일</th><th className={TH}>콘텐츠</th><th className={TH}>인플루언서</th>
                <th className={TH}>비용</th><th className={TH}>단계</th><th className={TH}>성과</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const unused = d.status === 'unused';
                const od = overdueDays(d, today);
                const label = draftLabel(d);
                const suggestion = suggestDraftCost(optionFor(d.influencerHandle)?.pricing, defaultCostType(campaign.kind));
                return (
                  // 밀린 행: 연한 빨강 배경 + 왼쪽 3px 빨간 막대(inset shadow — border-left는 table-fixed에서 열 폭을 민다). 미사용은 흐리게.
                  <tr key={d.id} tabIndex={0}
                      onClick={(e) => { if (opensCard(e)) onOpenDraft(d.id); }}
                      onKeyDown={(e) => {
                        if ((e.key !== 'Enter' && e.key !== ' ') || e.target !== e.currentTarget) return;
                        e.preventDefault(); onOpenDraft(d.id);
                      }}
                      className={`relative cursor-pointer border-b border-x-border focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue ${
                        od !== null ? 'bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'hover:bg-x-hover'} ${unused ? 'opacity-60' : ''}`}>
                    <td className={TD}>
                      <ScheduledOnField value={d.scheduledOn} overdueDays={od}
                                        outOfRange={isOutOfRange(d.scheduledOn, campaign.startsOn, campaign.endsOn)}
                                        onChange={(next) => onChangeScheduledOn(d, next)} compact />
                    </td>
                    <td className={TD}>
                      <p className="truncate font-medium" title={label.text}>{label.text}</p>
                      <p className="mt-0.5 text-ui text-x-muted">{contentSubline(d)}</p>
                    </td>
                    <td className={TD}>
                      <span className="flex items-center gap-2">
                        {d.influencerHandle && (
                          <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-x-border-strong text-ui font-bold text-white">
                            {handleInitial(d.influencerHandle)}
                          </span>
                        )}
                        {/* 배정·변경 = InfluencerChip(InfluencerField + 명부 자동완성 재사용) — 배정 시 비용 제안은 부모 훅이 넣는다 */}
                        <InfluencerChip handle={d.influencerHandle} options={influencerOptions} onChange={(next) => onAssignInfluencer(d, next)} />
                      </span>
                    </td>
                    <td className={TD}>
                      <CostPopover value={d.cost} suggestion={suggestion} defaultType={defaultCostType(campaign.kind)}
                                   onChange={(next) => onChangeCost(d, next)} compact />
                    </td>
                    <td className={TD}>
                      <span className="flex flex-col items-start gap-1">
                        <DraftStatusChip status={d.status} onChange={(s) => onChangeStatus(d, s)} />
                        {d.published ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-ui font-bold text-green-800" title="연결된 게시물이 있어요 — 상태 값과 무관하게 게시됨으로 봐요">✓ 게시됨</span>
                        ) : (
                          <button type="button" onClick={() => onLinkPost(d)} className="text-ui text-x-blue-text hover:underline"
                                  title="올라간 게시물 링크를 붙이면 게시됨으로 바뀌고 조회·좋아요가 잡혀요">게시물 연결</button>
                        )}
                      </span>
                    </td>
                    <td className={TD}>
                      <span className="flex items-start justify-between gap-1">
                        <span className={`tabular-nums ${d.published ? '' : 'text-x-muted'}`}>{perfLabel(d)}</span>
                        {/* 행 메뉴 — 네이티브 details: 상태 없이 열고 닫히고, 바깥 클릭엔 닫히지 않지만 항목 2개라 감수 */}
                        <details className="relative shrink-0">
                          <summary aria-label="행 메뉴" className="cursor-pointer list-none rounded px-1.5 text-x-muted hover:bg-x-border hover:text-x-text">···</summary>
                          <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
                            <button type="button" onClick={() => onOpenDraft(d.id)} className="block w-full rounded px-2.5 py-1.5 text-left text-ui hover:bg-x-hover">원고 열기</button>
                            <button type="button" onClick={() => onRemoveFromCampaign(d)} className="block w-full rounded px-2.5 py-1.5 text-left text-ui text-red-700 hover:bg-red-50">캠페인에서 빼기</button>
                          </div>
                        </details>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 7: 타입·린트 확인**

Run: `npx tsc --noEmit -p .`
Expected: 오류 0

Run: `npm run lint`
Expected: 경고 24개, 오류 0

- [ ] **Step 8: 가독성 체크리스트(스펙 §3-2, 하드)** — 두 파일에서 `grep -n "text-caption\|text-\[1[01]px\]" src/app/campaigns/ContentTable.tsx src/app/campaigns/SummaryCards.tsx`가 0건, 표 셀은 전부 `py-3`(행 ≥48px), 숫자는 `text-[26px]`, 섹션은 `mt-8`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/campaignTableView.ts src/lib/campaignTableView.test.ts src/app/campaigns/SummaryCards.tsx src/app/campaigns/ContentTable.tsx
git commit -m "feat(campaign): 콘텐츠 표(6열·밀림 우선·칸 편집)와 요약 카드 4 + 표시 문구 순수 함수"
```

---

### Task 9: `campaignCostEdit.ts` + `InfluencerCostTable.tsx`(인플별 비용 표·추가 비용·메모) + `AddDraftsModal.tsx`(원고 추가)

**Parallel group:** G4 (G2+G3 후, Task 8과 병렬 — Task 8 파일(`campaignTableView.ts`)을 import하지 않는다)
**Suggested model:** sonnet

**Files:**
- Create: `src/lib/campaignCostEdit.ts`
- Test: `src/lib/campaignCostEdit.test.ts`
- Create: `src/app/campaigns/InfluencerCostTable.tsx`
- Create: `src/app/campaigns/AddDraftsModal.tsx`

**Interfaces:**
- Consumes: `InfluencerLine`(Task 2) · `ExtraCost`, `Currency`, `MoneyByCurrency`, `CURRENCIES`, `CURRENCY_LABEL`, `AMOUNT_MESSAGE`, `EXTRA_LABEL_MESSAGE`, `parseAmount`, `formatAmount`, `formatMoneyBy`(Task 1) · `CampaignRow`(Task 4) · `DraftRow`(Task 3) · `fetchCandidateDrafts`, `bulkCampaignApi`(Task 7) · `draftLabel`, `searchDrafts`(`@/lib/draftViews`) · `variantLabel`(`@/lib/draftUi`) · `toggleId`, `siblingWarning`(`@/lib/draftSelection`) · `kstShort`(`@/lib/datetime`) · `Button`(`@/components/ui`)
- Produces (Task 10이 사용):
  - `upsertExtraCost(list: ExtraCost[], index: number | null, item: ExtraCost): ExtraCost[]` · `removeExtraCost(list, index): ExtraCost[]` · `extraCostLabel(e: ExtraCost): string`(`'교통비 20,000원'`)
  - `<InfluencerCostTable lines total onSaveExtraCosts onSaveNote />` — `onSaveExtraCosts(handle: string, next: ExtraCost[]): Promise<boolean>`, `onSaveNote(handle: string, note: string): Promise<boolean>`
  - `<AddDraftsModal campaign onClose onAdded />` — `onAdded(count: number)`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignCostEdit.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertExtraCost, removeExtraCost, extraCostLabel } from './campaignCostEdit.ts';
import type { ExtraCost } from './campaignCost.ts';

const a: ExtraCost = { label: '교통비', amount: 20000, currency: 'KRW' };
const b: ExtraCost = { label: '선물', amount: 5000, currency: 'JPY' };

test('1) upsert — index null이면 뒤에 추가, 범위 안이면 교체, 범위 밖이면 추가(스테일 index 방어). 원본 불변', () => {
  const list = [a];
  assert.deepEqual(upsertExtraCost(list, null, b), [a, b]);
  assert.deepEqual(upsertExtraCost([a, b], 0, { ...a, amount: 30000 }), [{ ...a, amount: 30000 }, b]);
  assert.deepEqual(upsertExtraCost([a], 5, b), [a, b]);
  assert.deepEqual(list, [a]);
});

test('2) remove — index 하나만, 범위 밖은 그대로', () => {
  assert.deepEqual(removeExtraCost([a, b], 0), [b]);
  assert.deepEqual(removeExtraCost([a, b], 9), [a, b]);
});

test('3) 항목 표기 — 이름 + 금액(통화 병기 규칙은 formatAmount)', () => {
  assert.equal(extraCostLabel(a), '교통비 20,000원');
  assert.equal(extraCostLabel(b), '선물 5,000엔');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCostEdit.test.ts`
Expected: FAIL — `Cannot find module './campaignCostEdit.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignCostEdit.ts`)

```ts
// 추가 비용 배열 편집의 순수 연산 — 다이얼로그는 '항목 하나'를 다루고 저장은 배열 전체를 PUT한다
// (campaign_influencer_cost.extra_costs는 jsonb 한 덩이 — 항목 단위 API가 없다, 스펙 §2-2).
import { formatAmount, type ExtraCost } from './campaignCost.ts';

export function upsertExtraCost(list: ExtraCost[], index: number | null, item: ExtraCost): ExtraCost[] {
  // 범위 밖 index는 '추가'로 — 다이얼로그가 열린 사이 다른 사람이 항목을 지워 index가 낡았을 때 엉뚱한 항목을 덮지 않는다
  if (index === null || index < 0 || index >= list.length) return [...list, item];
  return list.map((x, i) => (i === index ? item : x));
}

export function removeExtraCost(list: ExtraCost[], index: number): ExtraCost[] {
  return list.filter((_, i) => i !== index);
}

/** '교통비 20,000원' — 표의 항목 알약·다이얼로그 제목 */
export function extraCostLabel(e: ExtraCost): string {
  return `${e.label} ${formatAmount(e.amount, e.currency)}`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCostEdit.test.ts`
Expected: PASS 3건

- [ ] **Step 5: `InfluencerCostTable.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { InfluencerLine } from '@/lib/campaignJudgment';
import {
  formatMoneyBy, CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, EXTRA_LABEL_MESSAGE, parseAmount,
  type ExtraCost, type Currency, type MoneyByCurrency,
} from '@/lib/campaignCost';
import { upsertExtraCost, removeExtraCost, extraCostLabel } from '@/lib/campaignCostEdit';

// 인플루언서별 비용 표(스펙 §3-2 하단, 표·달력 두 보기 공통) — 열 5: 인플루언서(+메모) · 콘텐츠 n · 콘텐츠 비용 · 추가 비용 · 소계.
// 줄은 deriveInfluencers 결과 그대로(원고 핸들 ∪ 비용 행 핸들, 미배정 묶음 맨 아래) — 여기서 다시 세지 않는다.
// 저장은 부모가 PUT하고 boolean으로 알려준다 — 실패하면 입력을 남긴다(닫으면 안 저장된 게 저장된 것처럼 보인다).
type Editing = { handle: string; index: number | null } | null;
const TD = 'px-3 py-3 align-top';

export function InfluencerCostTable({ lines, total, onSaveExtraCosts, onSaveNote }: {
  lines: InfluencerLine[]; total: MoneyByCurrency;
  onSaveExtraCosts: (handle: string, next: ExtraCost[]) => Promise<boolean>;
  onSaveNote: (handle: string, note: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const editingLine = editing
    ? lines.find((l) => l.handle !== null && l.handle.toLowerCase() === editing.handle.toLowerCase()) ?? null
    : null;

  async function saveNote(handle: string, current: string) {
    const next = noteDraft.trim();
    if (next === current) { setNoteFor(null); return; }   // 바뀐 게 없으면 PUT하지 않는다
    if (await onSaveNote(handle, next)) setNoteFor(null);
  }

  return (
    <section className="mt-8">
      <h2 className="text-content font-bold">인플루언서별 비용</h2>
      <p className="mt-1 text-ui text-x-muted">콘텐츠 비용 + 추가 비용을 사람별로 모았어요. 통화가 다르면 따로 보여요. 메모를 누르면 바로 고칠 수 있어요.</p>
      {lines.length === 0 ? (
        <p className="mt-3 rounded-xl border border-x-border bg-x-surface px-4 py-6 text-center text-content text-x-secondary">
          원고에 인플루언서를 배정하면 사람별 비용이 여기 모여요.
        </p>
      ) : (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full text-content">
            <thead>
              <tr className="border-b border-x-border text-left text-ui text-x-muted">
                <th className="px-3 py-2 font-normal">인플루언서</th>
                <th className="w-[130px] px-3 py-2 font-normal">콘텐츠</th>
                <th className="w-[170px] px-3 py-2 font-normal">콘텐츠 비용</th>
                <th className="px-3 py-2 font-normal">추가 비용</th>
                <th className="w-[170px] px-3 py-2 font-normal">소계</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.handle ?? '__unassigned'} className="border-b border-x-border">
                  <td className={TD}>
                    {l.handle === null ? (
                      <p className="text-x-secondary" title="인플루언서가 아직 배정되지 않은 원고들의 비용 — 배정하면 그 사람 줄로 옮겨가요">미배정 원고</p>
                    ) : (
                      <>
                        <p className="font-medium">@{l.handle}</p>
                        {noteFor === l.handle ? (
                          <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                                 onBlur={() => void saveNote(l.handle as string, l.note)}
                                 onKeyDown={(e) => {
                                   if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveNote(l.handle as string, l.note);
                                   if (e.key === 'Escape') setNoteFor(null);
                                 }}
                                 aria-label={`@${l.handle} 메모`} placeholder="이 캠페인에서 이 사람에 대한 한 줄"
                                 className="mt-1 w-full rounded-md border border-x-border-strong px-2 py-1 text-ui outline-none focus:border-x-blue" />
                        ) : (
                          <button type="button" onClick={() => { setNoteFor(l.handle); setNoteDraft(l.note); }}
                                  className={`mt-0.5 block text-left text-ui hover:underline ${l.note ? 'text-x-secondary' : 'text-x-muted'}`}>
                            {l.note || '+ 메모'}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                  <td className={`${TD} tabular-nums`}>
                    {l.contentCount > 0 ? `${l.contentCount}개` : (
                      // 돈이 붙었는데 원고가 안 보이는 일을 막는다(§2-4) — 색만 아니라 말로
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-ui text-amber-800"
                            title="추가 비용은 적혀 있는데 배정된 원고가 없어요 — 원고를 배정하거나 비용 항목을 정리하세요">배정 원고 없음</span>
                    )}
                  </td>
                  <td className={`${TD} tabular-nums`}>{formatMoneyBy(l.contentCost)}</td>
                  <td className={TD}>
                    {l.handle === null ? (
                      <span className="text-x-muted" title="인플루언서를 배정하면 추가 비용을 적을 수 있어요">—</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {l.extraCosts.map((e, i) => (
                          <button key={i} type="button" onClick={() => setEditing({ handle: l.handle as string, index: i })}
                                  className="rounded-full border border-x-border-strong bg-white px-2.5 py-1 text-ui tabular-nums hover:bg-x-hover"
                                  title="눌러서 고치거나 지우기">
                            {extraCostLabel(e)}
                          </button>
                        ))}
                        <button type="button" onClick={() => setEditing({ handle: l.handle as string, index: null })}
                                className="rounded-full border border-dashed border-x-border-strong px-2.5 py-1 text-ui text-x-secondary hover:bg-x-hover">
                          + 추가
                        </button>
                      </span>
                    )}
                  </td>
                  <td className={`${TD} font-medium tabular-nums`}>{formatMoneyBy(l.subtotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-3 py-3 font-bold" colSpan={4}>
                  캠페인 합계 <span className="text-ui font-normal text-x-muted">— 통화별로 따로 계산, 원과 엔은 합치지 않아요</span>
                </td>
                <td className="px-3 py-3 font-bold tabular-nums">{formatMoneyBy(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing && editingLine && editingLine.handle !== null && (
        <ExtraCostDialog
          handle={editingLine.handle}
          initial={editing.index !== null ? (editingLine.extraCosts[editing.index] ?? null) : null}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            const ok = await onSaveExtraCosts(editingLine.handle as string, upsertExtraCost(editingLine.extraCosts, editing.index, item));
            if (ok) setEditing(null);
            return ok;
          }}
          onDelete={editing.index !== null ? async () => {
            const ok = await onSaveExtraCosts(editingLine.handle as string, removeExtraCost(editingLine.extraCosts, editing.index as number));
            if (ok) setEditing(null);
            return ok;
          } : undefined} />
      )}
    </section>
  );
}

// 항목 하나(항목명·금액·통화) — 작은 다이얼로그. 팝오버 좌표 계산 없이 중앙에 띄운다: 표 하단 셀에서 열리면 화면 아래로 잘리기 쉽다.
function ExtraCostDialog({ handle, initial, onClose, onSave, onDelete }: {
  handle: string; initial: ExtraCost | null; onClose: () => void;
  onSave: (item: ExtraCost) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;   // 기존 항목을 열었을 때만
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? 'KRW');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function save() {
    const name = label.trim();
    if (!name) { setErr(EXTRA_LABEL_MESSAGE); return; }
    const n = parseAmount(amount);
    if (n === null) { setErr(AMOUNT_MESSAGE); return; }
    setBusy(true); setErr('');
    const ok = await onSave({ label: name, amount: n, currency });
    setBusy(false);
    if (!ok) setErr('저장하지 못했어요 — 잠시 후 다시 시도해 주세요');
  }
  const input = 'mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-content outline-none focus:border-x-blue';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true" aria-label="추가 비용" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-content font-bold">{initial ? '추가 비용 고치기' : '추가 비용 추가'} <span className="text-ui font-normal text-x-muted">@{handle}</span></h2>
        <p className="mt-0.5 text-ui text-x-muted">교통비·패키지·선물처럼 콘텐츠 비용 밖의 항목이에요 — 이 사람의 소계와 캠페인 합계에 더해져요.</p>
        <label className="mt-3 block text-ui text-x-secondary">항목명
          <input autoFocus value={label} onChange={(e) => { setLabel(e.target.value); setErr(''); }} placeholder="교통비" className={input} />
        </label>
        <div className="mt-2 grid grid-cols-[1fr_130px] gap-2">
          <label className="block text-ui text-x-secondary">금액
            <input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(''); }}
                   onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(); }}
                   placeholder="20000" className={`${input} tabular-nums`} />
          </label>
          <label className="block text-ui text-x-secondary">통화
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} className={input}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]} ({c})</option>)}
            </select>
          </label>
        </div>
        <p className="mt-1 text-ui text-x-muted">통화를 바꿔도 금액은 그대로예요 — 환산하지 않아요</p>
        {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
        <div className="mt-3 flex items-center gap-2">
          {onDelete && (
            <button type="button" disabled={busy} onClick={() => void onDelete()} className="text-ui text-x-secondary hover:text-red-600 disabled:opacity-40">이 항목 지우기</button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto rounded-full px-3 py-1 text-ui text-x-secondary hover:bg-x-text/5 disabled:opacity-40">취소</button>
          <button type="button" disabled={busy} onClick={() => void save()} className="rounded-full bg-x-blue px-3 py-1 text-ui font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            {busy ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `AddDraftsModal.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CampaignRow } from '@/lib/campaignStore';
import type { DraftRow } from '@/lib/draftStore';
import { fetchCandidateDrafts, bulkCampaignApi } from '@/lib/campaignApi';
import { draftLabel, searchDrafts } from '@/lib/draftViews';
import { variantLabel } from '@/lib/draftUi';
import { toggleId, siblingWarning } from '@/lib/draftSelection';
import { kstShort } from '@/lib/datetime';
import { Button } from '@/components/ui';

// [+ 원고 추가] → 분기(스펙 §4-1): 새로 만들기(/generate?campaign= — 클라 자동 선택·만든 원고 자동 소속)와
// 기존 원고 고르기(트래킹 '원고 연결' 모달 골격 — 검색 + 목록 + 체크). 후보 = 그 클라이언트의 캠페인 미소속 원고(§7).
// 넣기는 bulk PATCH 한 문장(50건 = 커넥션 1개). 예정일은 비워두고 표에서 채운다.
// 형제 시안(A/B/C)은 하나만 넣는 게 기본 — 전부 넣으면 비용이 중복 집계된다(도움말에 명시, 막지는 않는다).
export function AddDraftsModal({ campaign, onClose, onAdded }: {
  campaign: CampaignRow; onClose: () => void; onAdded: (count: number) => void;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(InfluencerProfile.load 관례)
  const load = useCallback(async () => {
    const r = await fetchCandidateDrafts(campaign.id);
    if (r.ok) { setRows(r.data); setState('ready'); } else { setErr(r.error); setState('error'); }
  }, [campaign.id]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const filtered = useMemo(() => searchDrafts(rows, query), [rows, query]);
  const ids = [...selected];

  async function submit() {
    if (ids.length === 0 || busy) return;
    // 형제 시안이 둘 이상 골라졌으면 한 번 더 묻는다 — 막지는 않는다(결정은 사람 몫, /generate 일괄 배정과 같은 태도)
    const siblings = siblingWarning(rows, selected);
    if (siblings >= 2 && !window.confirm(
      `같은 조건에서 나온 시안 ${siblings}개가 함께 선택돼 있어요.\n전부 넣으면 비용이 ${siblings}번 집계돼요. 그래도 넣을까요?`)) return;
    setBusy(true); setErr('');
    const r = await bulkCampaignApi(ids, campaign.id);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onAdded(ids.length);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="flex max-h-[80vh] w-full max-w-[560px] flex-col rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="원고 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-content font-bold">원고 추가 <span className="text-ui font-normal text-x-muted">— {campaign.name}</span></h2>
          <button onClick={onClose} disabled={busy} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border disabled:opacity-40">✕</button>
        </div>

        {/* 분기 1 — 새로 만들기. 링크라 모달 상태와 무관하게 이동한다; 캠페인 화면으로 돌아오면 목록이 다시 로드된다 */}
        <Link href={`/generate?campaign=${campaign.id}`}
              className="mt-3 flex items-center justify-between rounded-xl border border-x-border-strong px-4 py-3 hover:bg-x-hover">
          <span>
            <span className="block text-content font-bold">새로 만들기 →</span>
            <span className="block text-ui text-x-muted">콘텐츠 생성으로 가요 — 클라이언트가 자동으로 잡히고, 거기서 만든 원고(생성·직접 쓰기)는 이 캠페인에 바로 들어와요</span>
          </span>
        </Link>

        <p className="mt-4 text-content font-bold">또는 기존 원고 고르기</p>
        <p className="text-ui text-x-muted">
          {campaign.clientName ?? '클라이언트 없음'}의 원고 중 아직 캠페인에 속하지 않은 것만 보여요.
          같은 조건의 시안(A/B/C)은 <b>하나만</b> 넣는 게 기본이에요 — 전부 넣으면 비용이 중복 집계돼요.
        </p>

        {state === 'loading' && <p className="py-6 text-center text-content text-x-muted">원고 목록 불러오는 중…</p>}
        {state === 'error' && (
          <p className="py-6 text-center text-content text-x-secondary">
            {err || '원고 목록을 불러오지 못했어요'}{' '}
            <button onClick={() => { setState('loading'); void load(); }} className="text-x-blue-text hover:underline">다시 시도</button>
          </p>
        )}
        {state === 'ready' && (
          <>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="제목·내용·방향성으로 찾기" aria-label="원고 검색"
                   className="mt-2 w-full rounded-md border border-x-border-strong px-3 py-1.5 text-content outline-none focus:border-x-blue" />
            <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 && <p className="py-6 text-center text-content text-x-muted">넣을 수 있는 원고가 없어요 — 전부 이미 캠페인에 속해 있거나, 아직 만든 원고가 없어요.</p>}
              {rows.length > 0 && filtered.length === 0 && <p className="py-6 text-center text-content text-x-muted">검색과 일치하는 원고가 없어요</p>}
              {filtered.map((d) => {
                const on = selected.has(d.id);
                return (
                  <label key={d.id} className={`flex cursor-pointer items-start gap-2.5 rounded-md px-3 py-2 hover:bg-x-hover ${on ? 'bg-x-blue/5' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => setSelected((cur) => toggleId(cur, d.id))}
                           className="mt-1 h-4 w-4 cursor-pointer accent-x-blue" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-content">{draftLabel(d).text}</span>
                      {/* 보조줄: 생성일 · 배정 핸들 · 시안 라벨 — 동명 원고와 형제 시안을 사람이 가려볼 맥락 */}
                      <span className="block truncate text-ui text-x-muted">
                        {kstShort(d.createdAt)}
                        {d.influencerHandle ? ` · @${d.influencerHandle}` : ''}
                        {d.batchId !== null && d.variantIndex !== null ? ` · 시안 ${variantLabel(d.variantIndex)}` : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {err && <p role="alert" className="mt-2 text-ui text-red-600">{err}</p>}
            <div className="mt-3 flex items-center gap-3 border-t border-x-border pt-3">
              <span className="text-ui text-x-secondary">{ids.length > 0 ? `${ids.length}개 선택` : '넣을 원고를 골라 주세요'}</span>
              <button onClick={onClose} disabled={busy} className="ml-auto text-ui text-x-secondary disabled:opacity-40">취소</button>
              <Button variant="primary" onClick={() => void submit()} disabled={ids.length === 0 || busy} className="text-content">
                {busy ? '넣는 중…' : `${ids.length || ''}개 넣기`.trim()}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 타입·린트 확인**

Run: `npx tsc --noEmit -p .`
Expected: 오류 0

Run: `npm run lint`
Expected: 경고 24개, 오류 0. `grep -n "text-caption" src/app/campaigns/InfluencerCostTable.tsx src/app/campaigns/AddDraftsModal.tsx` 0건.

- [ ] **Step 8: Commit**

```bash
git add src/lib/campaignCostEdit.ts src/lib/campaignCostEdit.test.ts src/app/campaigns/InfluencerCostTable.tsx src/app/campaigns/AddDraftsModal.tsx
git commit -m "feat(campaign): 인플루언서별 비용 표(추가 비용 항목·메모 인라인) + 원고 추가 모달(새로 만들기·기존 원고 고르기)"
```

---

### Task 10: `CampaignHeader.tsx` + `useCampaignDraftActions.ts` + `LinkPostModal.tsx` + `CampaignDetail.tsx`(상세 컨테이너)

**Parallel group:** G4 (Task 8·9 후)
**Suggested model:** opus

**Files:**
- Create: `src/app/campaigns/CampaignHeader.tsx`
- Create: `src/app/campaigns/useCampaignDraftActions.ts`
- Create: `src/app/campaigns/LinkPostModal.tsx`
- Create: `src/app/campaigns/CampaignDetail.tsx`

**Interfaces:**
- Consumes: `CampaignRow`, `CampaignDraftItem`, `InfluencerCostRow`(Task 4) · `summarizeStages`, `summarizePerf`, `deriveInfluencers`, `campaignTotal`, `campaignStatus`, `CAMPAIGN_STATUS_LABEL`, `CAMPAIGN_KINDS`, `CAMPAIGN_KIND_LABEL`, `CampaignKind`, `defaultCostType`, `ContentSortKey`, `StageFilter`(Task 2) · `suggestDraftCost`, `DraftCost`, `ExtraCost`(Task 1) · `CampaignPatchInput`, `checkPeriod`, `NAME_MAX`(Task 6) · `fetchCampaignDetail`, `patchCampaignApi`, `deleteCampaignApi`, `putInfluencerCostApi`, `patchDraftApi`, `DraftPatchBody`, `deleteDraftApi`, `rewriteDraftApi`, `regenPostApi`, `registerTrackedPostApi`, `linkTrackedPostDraftApi`(Task 7) · `SummaryCards`, `ContentTable`(Task 8) · `InfluencerCostTable`, `AddDraftsModal`(Task 9) · `DraftCard`, `droppedMediaOnRewrite`, `MediaDropNotice`, `DraftEditModal`(기존 — `campaign` prop은 Task 12에서 옵션으로 추가되므로 여기서는 넘기지 않는다; Task 15가 배선) · `useToast`(`@/lib/toastContext` — ToastProvider는 Task 11 layout) · `parseTweetLink`, `tweetLinkParseMessage`(`@/lib/tweetLink`) · `checkCampaign`, `campaignMessage`(`@/lib/trackingLink`)
- Produces (Task 11·15가 사용):
  - `<CampaignDetail id campaigns={CampaignRow[]} onChanged onDeleted />` — `campaigns`는 Task 15에서 DraftCard `campaign` prop 배선에 쓰기 위해 지금부터 받는다(이 태스크에서는 미사용 → `void campaigns` 대신 prop 타입만 선언하고 Task 15가 사용). Task 15가 `view: DetailView`·`onViewChange` prop을 추가한다(page.tsx가 함께 바뀐다)
  - `useCampaignDraftActions({ campaign, setDrafts, influencerOptions, show, onChanged })` → `{ changeStatus, assignInfluencer, changeScheduledOn, changeCost, changeTitle, saveMedia, setDismissed, removeFromCampaign, moveToCampaign }`(각 `(d: CampaignDraftItem, …) => Promise<boolean>`)
  - `<CampaignHeader campaign today onPatch onDelete onAddDrafts />` · `<LinkPostModal draft onClose onLinked />`

- [ ] **Step 1: `useCampaignDraftActions.ts`** — 낙관적 갱신 + 조건부 롤백(generate/page.tsx changeStatus 계열)

```ts
'use client';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import type { DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption, DraftContent } from '@/lib/draftTypes';
import { suggestDraftCost, type DraftCost } from '@/lib/campaignCost';
import { defaultCostType } from '@/lib/campaignJudgment';
import { patchDraftApi, type DraftPatchBody } from '@/lib/campaignApi';

// 캠페인 화면의 원고 편집은 전부 PATCH /api/drafts/[id] 하나를 탄다(스펙 §2-5 값은 하나) — 배정 자동 로그(influencerSync)도 그대로 돈다.
// 낙관적 갱신 + "이 요청이 세팅한 값이 아직 표시 중일 때만" 롤백(generate/page.tsx changeStatus·assignInfluencer 계열) —
// 응답을 기다리는 사이 사용자가 같은 행을 또 바꿨다면 뒤 갱신을 덮지 않는다.
type Item = CampaignDraftItem;
type Optimistic = Partial<Pick<Item, 'status' | 'influencerHandle' | 'scheduledOn' | 'cost' | 'title' | 'edited' | 'dismissedFlags'>>;

export function useCampaignDraftActions({ campaign, setDrafts, influencerOptions, show, onChanged }: {
  campaign: CampaignRow | null;                 // 로드 전엔 null — 비용 제안 유형(defaultCostType)에만 쓴다
  setDrafts: Dispatch<SetStateAction<Item[]>>;
  influencerOptions: InfluencerOption[];        // pricing 포함(Task 3) — 배정 시 비용 제안 소스
  show: (message: string) => void;
  onChanged: () => void;                        // 목록(왼쪽)의 콘텐츠 수·합계가 바뀔 변경 뒤에 부른다
}) {
  const apply = useCallback(async (d: Item, optimistic: Optimistic, body: DraftPatchBody): Promise<boolean> => {
    const keys = Object.keys(optimistic) as Array<keyof Optimistic>;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...optimistic } : x)));
    const r = await patchDraftApi(d.id, body);
    if (r.ok) {
      // 응답은 DraftRow — 게시됨·성과(published·perf·linkClicks)는 이 PATCH로 바뀌지 않으니 기존 값을 유지한 채 덮는다
      setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...r.data } : x)));
      return true;
    }
    setDrafts((cur) => cur.map((x) => {
      if (x.id !== d.id) return x;
      const stillMine = keys.every((k) => JSON.stringify(x[k]) === JSON.stringify(optimistic[k]));
      if (!stillMine) return x;
      const back = { ...x } as Record<string, unknown>;
      for (const k of keys) back[k] = (d as Record<string, unknown>)[k];
      return back as unknown as Item;
    }));
    show(r.error);
    return false;
  }, [setDrafts, show]);

  return useMemo(() => ({
    changeStatus: async (d: Item, status: DraftStatus) => {
      const ok = await apply(d, { status }, { status });
      // 미사용 ↔ 그 외는 요약 N·인플 콘텐츠 수·합계의 모집단이 바뀐다(§2-4) — 목록 보조줄도 따라가야 한다
      if (ok && (status === 'unused' || d.status === 'unused')) onChanged();
      return ok;
    },
    // 배정·변경 시 비용 제안 — 비어 있을 때만 자동 채움(사람이 적은 값은 덮지 않는다). 금액 = pricing[유형], 통화 = pricing 레벨 하나(리뷰 Blocking 3).
    // 제안이 있으면 같은 PATCH에 cost를 함께 실어 요청 1번으로 끝낸다.
    assignInfluencer: async (d: Item, handle: string | null) => {
      const opt = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
      const suggested = !d.cost && opt ? suggestDraftCost(opt.pricing, defaultCostType(campaign?.kind ?? null)) : null;
      const patch = { influencerHandle: handle, ...(suggested ? { cost: suggested } : {}) };
      const ok = await apply(d, patch, patch);
      if (ok) onChanged();   // 인플 목록·(제안이 들어갔으면) 합계가 바뀐다
      return ok;
    },
    changeScheduledOn: (d: Item, next: string | null) => apply(d, { scheduledOn: next }, { scheduledOn: next }),
    changeCost: async (d: Item, next: DraftCost | null) => {
      const ok = await apply(d, { cost: next }, { cost: next });
      if (ok) onChanged();
      return ok;
    },
    changeTitle: (d: Item, next: string | null) => apply(d, { title: next }, { title: next ?? '' }),
    saveMedia: (d: Item, next: DraftContent) => apply(d, { edited: next }, { edited: next }),
    setDismissed: (d: Item, next: string[]) => apply(d, { dismissedFlags: next }, { dismissedFlags: next }),
    // 캠페인에서 빼기 — 행이 사라지는 변경이라 apply의 필드 롤백 대신 목록 복원으로 되돌린다(순서는 표 정렬이 다시 잡는다)
    removeFromCampaign: async (d: Item) => {
      setDrafts((cur) => cur.filter((x) => x.id !== d.id));
      const r = await patchDraftApi(d.id, { campaignId: null });
      if (r.ok) { show('캠페인에서 뺐어요 — 원고는 콘텐츠 생성 목록에 그대로 있어요'); onChanged(); return true; }
      setDrafts((cur) => (cur.some((x) => x.id === d.id) ? cur : [...cur, d]));
      show(r.error);
      return false;
    },
    // DraftCard 캠페인 칸에서 다른 캠페인으로 옮김(Task 15 배선) — 값은 하나라 이 화면에서는 사라진다. 경고 없음(§7).
    moveToCampaign: async (d: Item, campaignId: string | null) => {
      if (campaignId === (campaign?.id ?? null)) return true;
      setDrafts((cur) => cur.filter((x) => x.id !== d.id));
      const r = await patchDraftApi(d.id, { campaignId });
      if (r.ok) { show(campaignId ? '다른 캠페인으로 옮겼어요' : '캠페인에서 뺐어요'); onChanged(); return true; }
      setDrafts((cur) => (cur.some((x) => x.id === d.id) ? cur : [...cur, d]));
      show(r.error);
      return false;
    },
  }), [apply, campaign, influencerOptions, onChanged, setDrafts, show]);
}
```

- [ ] **Step 2: `CampaignHeader.tsx`** — 이름·기간·유형·코드·메모 인라인 수정, 상태 pill, [+ 원고 추가], [···] 삭제

```tsx
'use client';
import { useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { checkPeriod, NAME_MAX, type CampaignPatchInput } from '@/lib/campaignInput';
import { campaignStatus, CAMPAIGN_STATUS_LABEL, CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind } from '@/lib/campaignJudgment';
import { checkCampaign, campaignMessage } from '@/lib/trackingLink';
import { Button } from '@/components/ui';

// 상세 헤더 — 이름·기간·유형·코드·메모를 그 자리에서 고친다(스펙 §3-3). 상태 pill은 기간에서 파생(수동 상태 없음, §10).
// 저장은 부모(onPatch → PATCH /api/campaigns/[id])가 하고 boolean으로 결과를 준다 — 실패하면 입력을 남긴다(거짓 성공 방지).
// 검증은 서버와 같은 함수(checkCampaign·checkPeriod) — 문구가 두 벌이 되지 않는다.
const STATUS_STYLE = {
  upcoming: 'bg-x-blue/10 text-x-blue-text', active: 'bg-green-100 text-green-800', ended: 'bg-x-border/60 text-x-secondary',
} as const;
const INPUT = 'rounded-md border border-x-border-strong bg-white px-2 py-1 text-content outline-none focus:border-x-blue';

export function CampaignHeader({ campaign, today, onPatch, onDelete, onAddDrafts }: {
  campaign: CampaignRow; today: string;
  onPatch: (patch: CampaignPatchInput) => Promise<boolean>;
  onDelete: () => void; onAddDrafts: () => void;
}) {
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [editCode, setEditCode] = useState(false);
  const [code, setCode] = useState(campaign.nameEn);
  const [codeErr, setCodeErr] = useState('');
  const [editNote, setEditNote] = useState(false);
  const [note, setNote] = useState(campaign.note);
  const [periodErr, setPeriodErr] = useState('');
  const [copied, setCopied] = useState(false);
  const status = campaignStatus(campaign.startsOn, campaign.endsOn, today);

  async function saveName() {
    const next = name.trim();
    if (!next || next === campaign.name) { setName(campaign.name); setEditName(false); return; }
    if (await onPatch({ name: next })) setEditName(false);
  }
  async function saveCode() {
    const c = checkCampaign(code);
    if (!c.ok) { setCodeErr(campaignMessage(c.reason)); return; }
    if (c.campaign === campaign.nameEn) { setEditCode(false); return; }
    if (await onPatch({ nameEn: c.campaign })) { setEditCode(false); setCodeErr(''); }
  }
  async function saveNote() {
    const next = note.trim();
    if (next === campaign.note) { setEditNote(false); return; }
    if (await onPatch({ note: next })) setEditNote(false);
  }
  async function savePeriod(patch: { startsOn?: string; endsOn?: string }) {
    const bad = checkPeriod(patch.startsOn ?? campaign.startsOn, patch.endsOn ?? campaign.endsOn);
    if (bad) { setPeriodErr(bad); return; }   // 보내기 전에 막되, 저장된 값은 그대로 보인다(입력은 controlled)
    setPeriodErr('');
    await onPatch(patch);
  }
  function copyCode() {
    navigator.clipboard.writeText(campaign.nameEn)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }
  function confirmDelete() {
    // 확인 다이얼로그 필수(§2-5) — 원고 무손실이라 실행취소는 없다(§3-3)
    if (window.confirm(
      `'${campaign.name}' 캠페인을 삭제할까요?\n\n원고 ${campaign.draftCount}개는 남고 캠페인 소속만 풀립니다. 예정일·비용도 원고에 그대로 남아요.\n실행 취소는 없어요.`)) onDelete();
  }

  return (
    <header>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editName ? (
              <input autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)}
                     onBlur={() => void saveName()}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveName();
                       if (e.key === 'Escape') { setName(campaign.name); setEditName(false); }
                     }}
                     aria-label="캠페인 이름" className={`${INPUT} min-w-[260px] text-[20px] font-bold`} />
            ) : (
              <button type="button" onClick={() => { setName(campaign.name); setEditName(true); }} title="눌러서 이름 바꾸기"
                      className="max-w-full truncate rounded-md px-1 text-left text-[20px] font-bold hover:bg-x-hover">{campaign.name}</button>
            )}
            <span className={`rounded-full px-2.5 py-0.5 text-ui font-bold ${STATUS_STYLE[status]}`}>{CAMPAIGN_STATUS_LABEL[status]}</span>
            <span className="text-ui text-x-secondary">{campaign.clientName ?? '클라이언트 없음'}</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1 text-ui text-x-secondary">기간
              <input type="date" value={campaign.startsOn} aria-label="시작일" className={INPUT}
                     onChange={(e) => { if (e.target.value) void savePeriod({ startsOn: e.target.value }); }} />
              <span>~</span>
              <input type="date" value={campaign.endsOn} aria-label="종료일" className={INPUT}
                     onChange={(e) => { if (e.target.value) void savePeriod({ endsOn: e.target.value }); }} />
            </label>
            <label className="flex items-center gap-1 text-ui text-x-secondary">유형
              <select value={campaign.kind ?? ''} aria-label="캠페인 유형" className={INPUT}
                      onChange={(e) => void onPatch({ kind: (e.target.value || null) as CampaignKind | null })}>
                <option value="">없음</option>
                {CAMPAIGN_KINDS.map((k) => <option key={k} value={k}>{CAMPAIGN_KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <span className="flex items-center gap-1 text-ui text-x-secondary">코드
              {editCode ? (
                <input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setCodeErr(''); }}
                       onBlur={() => void saveCode()}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveCode();
                         if (e.key === 'Escape') { setCode(campaign.nameEn); setCodeErr(''); setEditCode(false); }
                       }}
                       aria-label="영문 코드" autoCapitalize="none" spellCheck={false} className={`${INPUT} w-[240px] font-mono`} />
              ) : (
                <button type="button" onClick={() => { setCode(campaign.nameEn); setEditCode(true); }}
                        title="트래킹 링크의 캠페인명(utm_campaign) 기본값이에요 — 눌러서 바꾸기"
                        className="rounded-md px-1 font-mono text-content text-x-text hover:bg-x-hover">{campaign.nameEn}</button>
              )}
              <button type="button" onClick={copyCode} className="rounded-full border border-x-border-strong px-2 py-0.5 text-ui hover:bg-x-hover">
                {copied ? '복사됨 ✓' : '복사'}
              </button>
            </span>
          </div>
          {(periodErr || codeErr) && <p role="alert" className="mt-1 text-ui text-red-600">{periodErr || codeErr}</p>}

          {editNote ? (
            <textarea autoFocus value={note} rows={2} onChange={(e) => setNote(e.target.value)}
                      onBlur={() => void saveNote()}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setNote(campaign.note); setEditNote(false); } }}
                      aria-label="캠페인 메모" placeholder="이 캠페인에 대한 메모"
                      className={`${INPUT} mt-2 w-full max-w-[640px] resize-y text-ui`} />
          ) : (
            <button type="button" onClick={() => { setNote(campaign.note); setEditNote(true); }}
                    className={`mt-2 block max-w-[640px] whitespace-pre-wrap rounded-md px-1 text-left text-ui hover:bg-x-hover ${campaign.note ? 'text-x-secondary' : 'text-x-muted'}`}>
              {campaign.note || '+ 메모'}
            </button>
          )}
          <p className="mt-1 text-ui text-x-muted">여기서 고친 값은 바로 저장돼요. 기간을 줄여 예정일이 밖으로 나가도 막지 않고 '기간 밖'으로만 표시해요.</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" onClick={onAddDrafts} className="h-9 px-4 text-content">+ 원고 추가</Button>
          <details className="relative">
            <summary aria-label="캠페인 메뉴" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-x-border-strong text-x-secondary hover:bg-x-hover">···</summary>
            <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
              <button type="button" onClick={confirmDelete} className="block w-full rounded px-2.5 py-1.5 text-left text-ui text-red-700 hover:bg-red-50">캠페인 삭제</button>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: `LinkPostModal.tsx`** — 게시물 연결(등록 POST → draft_id PATCH, 둘 다 기존 라우트)

```tsx
'use client';
import { useEffect, useState } from 'react';
import type { CampaignDraftItem } from '@/lib/campaignStore';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { registerTrackedPostApi, linkTrackedPostDraftApi } from '@/lib/campaignApi';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';

// 게시물 연결(스펙 §3-2 단계 셀 옆) — 올라간 게시물 링크를 붙이면 (1) 트래킹 등록(이미 추적 중이면 그 행 반환) → (2) draft_id 연결.
// 둘 다 기존 라우트(POST /api/tracking·PATCH /api/tracking/[id]) — 새 API 없음. 연결되면 '게시됨' 판정·조회수가 잡힌다(§2-4).
// 소수 케이스용 진입점 — 자동 매칭은 백로그(§9).
export function LinkPostModal({ draft, onClose, onLinked }: {
  draft: CampaignDraftItem; onClose: () => void; onLinked: () => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const parsed = parseTweetLink(url);
  // 빈 칸은 오류가 아니라 아직 안 쓴 상태(TrackAddForm 관례)
  const showParseErr = url.trim().length > 0 && !parsed.ok && parsed.reason !== 'empty';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function submit() {
    if (!parsed.ok || busy) return;
    setBusy(true); setErr('');
    const reg = await registerTrackedPostApi(url.trim());
    if (!reg.ok) { setErr(reg.error); setBusy(false); return; }
    const row = reg.data.row;
    // 게시물 하나는 원고 하나에만 붙는다 — 이미 다른 원고에 연결돼 있으면 덮기 전에 묻는다
    if (row.draftId && row.draftId !== draft.id &&
        !window.confirm('이 게시물은 이미 다른 원고에 연결돼 있어요. 이 원고로 바꿀까요?')) { setBusy(false); return; }
    const link = await linkTrackedPostDraftApi(row.id, draft.id);
    setBusy(false);
    if (!link.ok) { setErr(link.error); return; }
    onLinked();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true" aria-label="게시물 연결" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-content font-bold">게시물 연결</h2>
        <p className="mt-0.5 truncate text-ui text-x-muted">{draftLabel(draft).text}</p>
        <p className="mt-3 text-ui text-x-secondary">인플루언서가 올린 게시물 링크를 붙이면 이 원고가 <b>게시됨</b>으로 바뀌고, 조회·좋아요가 트래킹에서 넘어와요.</p>
        <input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="https://x.com/계정/status/…" aria-label="게시물 링크"
               autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               aria-invalid={showParseErr ? true : undefined}
               className="mt-2 h-10 w-full rounded-lg border border-x-border-strong bg-white px-3 text-content outline-none focus:border-x-blue" />
        {showParseErr && <p className="mt-1 text-ui text-red-600">{tweetLinkParseMessage(parsed.ok ? 'invalid' : parsed.reason)}</p>}
        {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!parsed.ok || busy} className="text-content">
            {busy ? '연결하는 중…' : '연결'}
          </Button>
          <button onClick={onClose} disabled={busy} className="text-ui text-x-secondary disabled:opacity-40">취소</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `CampaignDetail.tsx`** — 로드·파생 재계산·모달·DraftCard 단일 표면

```tsx
'use client';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { CampaignRow, CampaignDraftItem, InfluencerCostRow } from '@/lib/campaignStore';
import type { CampaignPatchInput } from '@/lib/campaignInput';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { DraftRow } from '@/lib/draftStore';
import type { ExtraCost } from '@/lib/campaignCost';
import {
  fetchCampaignDetail, patchCampaignApi, deleteCampaignApi, putInfluencerCostApi, deleteDraftApi, rewriteDraftApi, regenPostApi,
} from '@/lib/campaignApi';
import {
  summarizeStages, summarizePerf, deriveInfluencers, campaignTotal, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
import { draftLabel } from '@/lib/draftViews';
import { Button } from '@/components/ui';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { CampaignHeader } from './CampaignHeader';
import { SummaryCards } from './SummaryCards';
import { ContentTable } from './ContentTable';
import { InfluencerCostTable } from './InfluencerCostTable';
import { AddDraftsModal } from './AddDraftsModal';
import { LinkPostModal } from './LinkPostModal';
import { useCampaignDraftActions } from './useCampaignDraftActions';

// 캠페인 상세 컨테이너 — 로드·낙관적 갱신·모달을 쥔다. 요약·인플 목록·합계·성과는 서버 응답을 그대로 쓰지 않고
// 같은 판정 함수(campaignJudgment)로 여기서 다시 계산한다 — 표에서 값을 고친 즉시 카드 숫자가 따라가야 하고,
// 서버와 같은 함수라 새로고침해도 숫자가 바뀌지 않는다. '오늘'은 서버가 준 today(서울) — 브라우저 시계를 쓰지 않는다.
interface DetailState { campaign: CampaignRow; drafts: CampaignDraftItem[]; costRows: InfluencerCostRow[]; today: string }
type ClientData = { client: ClientRow; procedures: ProcedureRow[] };

export function CampaignDetail({ id, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — Task 15가 DraftCard `campaign` prop(다른 캠페인으로 옮기기)에 쓴다. 이 태스크에선 아직 안 읽는다.
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·콘텐츠 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
}) {
  const { show } = useToast();
  const [data, setData] = useState<DetailState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [influencerOptions, setInfluencerOptions] = useState<InfluencerOption[]>([]);
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [sort, setSort] = useState<ContentSortKey>('default');
  const [filter, setFilter] = useState<StageFilter>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DraftRow | null>(null);
  const [linkFor, setLinkFor] = useState<CampaignDraftItem | null>(null);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [mediaDrop, setMediaDrop] = useState<{ draftId: string; notice: MediaDropNotice } | null>(null);

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(InfluencerProfile 관례)
  const load = useCallback(async () => {
    const r = await fetchCampaignDetail(id);
    if (r.ok) {
      const { campaign, drafts, costRows, today } = r.data;   // summary·influencers는 아래 useMemo가 같은 함수로 다시 만든다
      setData({ campaign, drafts, costRows, today });
      setLoadErr(false);
    } else {
      setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    }
    setLoaded(true);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  // 배정 자동완성 후보(+단가) — 실패해도 빈 목록(자유 입력은 그대로 동작, generate 관례)
  useEffect(() => {
    apiFetch('/api/drafts/influencers').then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((inf) => setInfluencerOptions(Array.isArray(inf) ? inf : []));
  }, []);
  // 금지 표현(DraftCard 검수 표식) — 이 캠페인의 클라이언트 하나만 필요하다. 클라가 없거나 실패하면 표식 없음.
  const clientId = data?.campaign.clientId ?? null;
  useEffect(() => {
    if (!clientId) return;
    apiFetch(`/api/clients/${clientId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((c) => setClientData(c as ClientData | null));
  }, [clientId]);

  const setDrafts: Dispatch<SetStateAction<CampaignDraftItem[]>> = useCallback((next) => {
    setData((cur) => (cur ? { ...cur, drafts: typeof next === 'function' ? next(cur.drafts) : next } : cur));
  }, []);
  const actions = useCampaignDraftActions({ campaign: data?.campaign ?? null, setDrafts, influencerOptions, show, onChanged });

  // 파생값 — 서버와 같은 함수(campaignJudgment). 원고 하나를 고치면 넷이 함께 바뀐다.
  const summary = useMemo(() => (data ? summarizeStages(data.drafts, data.today) : null), [data]);
  const perf = useMemo(() => (data ? summarizePerf(data.drafts) : null), [data]);
  const influencers = useMemo(() => (data ? deriveInfluencers(data.drafts, data.costRows) : []), [data]);
  const total = useMemo(() => campaignTotal(influencers), [influencers]);
  const peeked = peekId && data ? data.drafts.find((d) => d.id === peekId) ?? null : null;
  const bannedFor = useCallback((d: DraftRow) => (clientData
    ? [...clientData.client.bannedPhrases,
       ...clientData.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)]
    : []), [clientData]);

  // Esc로 원고 모달 닫기 — 편집 모달이 위에 있으면 그쪽 Esc가 우선(generate 관례)
  useEffect(() => {
    if (!peekId || editing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setPeekId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peekId, editing]);

  const patchCampaign = useCallback(async (patch: CampaignPatchInput) => {
    const r = await patchCampaignApi(id, patch);
    if (!r.ok) { show(r.error); return false; }
    setData((cur) => (cur ? { ...cur, campaign: r.data } : cur));
    onChanged();
    return true;
  }, [id, show, onChanged]);

  async function removeCampaign() {
    const r = await deleteCampaignApi(id);
    if (!r.ok) { show(r.error); return; }
    show('캠페인을 삭제했어요 — 원고는 콘텐츠 생성 목록에 그대로 있어요');
    onDeleted();
  }

  // 추가 비용·메모 — PUT 응답 행으로 costRows를 갈아끼운다(같은 핸들은 lower 기준 하나). 합계가 목록 보조줄에도 실리므로 onChanged.
  const saveCostRow = useCallback(async (handle: string, patch: { extraCosts?: ExtraCost[]; note?: string }) => {
    const r = await putInfluencerCostApi(id, handle, patch);
    if (!r.ok) { show(r.error); return false; }
    setData((cur) => {
      if (!cur) return cur;
      const others = cur.costRows.filter((x) => x.influencerHandle.toLowerCase() !== r.data.influencerHandle.toLowerCase());
      return { ...cur, costRows: [...others, r.data] };
    });
    onChanged();
    return true;
  }, [id, show, onChanged]);

  // DraftCard 단일 표면(스펙 §3-2) — /generate와 같은 카드, 같은 동사. 응답(DraftRow)은 published·perf를 유지한 채 병합한다.
  const mergeRow = useCallback((row: DraftRow) => setDrafts((cur) => cur.map((x) => (x.id === row.id ? { ...x, ...row } : x))), [setDrafts]);
  async function rewrite(d: CampaignDraftItem, feedback: string, baseIndex: number) {
    if (rewritingId) return;
    setMediaDrop((cur) => (cur?.draftId === d.id ? null : cur));
    setRewritingId(d.id);
    const r = await rewriteDraftApi(d.id, baseIndex, feedback);
    setRewritingId(null);
    if (!r.ok) { show(r.error); return; }
    mergeRow(r.data);
    // 스레드가 짧아져 이미지가 빠졌으면 알린다 — generate/page.tsx rewrite와 같은 계산
    const i = r.data.history.length - 1;
    const prevLatest = r.data.history[i];
    const notice = prevLatest ? droppedMediaOnRewrite(prevLatest, r.data.edited ?? r.data.content, i) : null;
    if (notice) setMediaDrop({ draftId: d.id, notice });
  }
  async function regenPost(d: CampaignDraftItem, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await regenPostApi(d.id, index);
    setRegenBusy(null);
    if (r.ok) mergeRow(r.data); else show(r.error);
  }
  async function removeDraft(d: CampaignDraftItem) {
    // 캠페인 화면의 삭제는 확인 + 즉시(5초 실행취소는 /generate 목록의 문법 — 여기선 카드 하나를 열어놓고 지운다)
    if (!window.confirm(`'${draftLabel(d).text}' 원고를 삭제할까요?\n\n캠페인에서만 빼려면 표의 ··· 메뉴에서 '캠페인에서 빼기'를 쓰세요.`)) return;
    setPeekId(null);
    const r = await deleteDraftApi(d.id);
    if (!r.ok) { show(r.error); return; }
    setDrafts((cur) => cur.filter((x) => x.id !== d.id));
    show('원고를 삭제했어요');
    onChanged();
  }
  function toggleDismiss(d: CampaignDraftItem, key: string, dismiss: boolean) {
    const next = dismiss ? [...new Set([...d.dismissedFlags, key])] : d.dismissedFlags.filter((k) => k !== key);
    void actions.setDismissed(d, next);
  }

  if (!loaded) return <p className="px-6 py-6 text-content text-x-muted">불러오는 중…</p>;
  if (loadErr && !data) {
    return (
      <div className="px-6 py-6">
        <p className="mb-2 text-content text-x-secondary" role="alert">캠페인을 불러오지 못했어요</p>
        <Button onClick={() => void load()}>다시 시도</Button>
      </div>
    );
  }
  if (!data || !summary || !perf) return null;

  return (
    <div className="min-w-0 px-6 py-6">
      {loadErr && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-ui text-red-700">
          <span>새로고침에 실패했어요 — 표시된 정보가 최신이 아닐 수 있어요</span>
          <Button variant="subtle" className="ml-auto shrink-0 bg-white" onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      <CampaignHeader campaign={data.campaign} today={data.today} onPatch={patchCampaign}
                      onDelete={() => void removeCampaign()} onAddDrafts={() => setAddOpen(true)} />
      <div className="mt-7">
        <SummaryCards summary={summary} perf={perf} total={total} />
      </div>
      <ContentTable rows={data.drafts} campaign={data.campaign} today={data.today} influencerOptions={influencerOptions}
                    sort={sort} onSortChange={setSort} filter={filter} onFilterChange={setFilter}
                    onOpenDraft={setPeekId}
                    onChangeStatus={(d, s) => void actions.changeStatus(d, s)}
                    onAssignInfluencer={(d, h) => void actions.assignInfluencer(d, h)}
                    onChangeScheduledOn={(d, next) => void actions.changeScheduledOn(d, next)}
                    onChangeCost={(d, next) => void actions.changeCost(d, next)}
                    onRemoveFromCampaign={(d) => {
                      if (window.confirm(`'${draftLabel(d).text}'을(를) 캠페인에서 뺄까요?\n\n원고는 남고 소속만 풀려요. 예정일·비용도 원고에 남아요.`)) void actions.removeFromCampaign(d);
                    }}
                    onLinkPost={setLinkFor} />
      <InfluencerCostTable lines={influencers} total={total}
                           onSaveExtraCosts={(h, next) => saveCostRow(h, { extraCosts: next })}
                           onSaveNote={(h, note) => saveCostRow(h, { note })} />

      {addOpen && (
        <AddDraftsModal campaign={data.campaign} onClose={() => setAddOpen(false)}
                        onAdded={(n) => { setAddOpen(false); show(`원고 ${n}개를 넣었어요 — 예정일은 표에서 채워요`); void load(); onChanged(); }} />
      )}
      {linkFor && (
        <LinkPostModal draft={linkFor} onClose={() => setLinkFor(null)}
                       onLinked={() => { setLinkFor(null); show('게시물을 연결했어요 — 게시됨으로 표시되고 조회수가 잡혀요'); void load(); }} />
      )}
      {peeked && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-x-text/40 p-6" onClick={() => setPeekId(null)}>
          <div role="dialog" aria-modal="true" aria-label="원고 상세" className="w-full max-w-[600px]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setPeekId(null)} aria-label="상세 닫기" title="닫기 (Esc)"
                      className="rounded-full bg-white/90 px-2.5 py-1 text-[13px] font-bold text-x-secondary hover:bg-white">✕ 닫기</button>
            </div>
            <DraftCard draft={peeked} banned={bannedFor(peeked)}
                       onEdit={() => setEditing(peeked)}
                       onRewrite={(feedback, baseIndex) => void rewrite(peeked, feedback, baseIndex)}
                       rewriteBusy={rewritingId === peeked.id}
                       onDelete={() => void removeDraft(peeked)}
                       onRegenPost={(i) => void regenPost(peeked, i)}
                       regenBusyIndex={regenBusy?.draftId === peeked.id ? regenBusy.index : null}
                       onDismissFlag={(key, dismiss) => toggleDismiss(peeked, key, dismiss)}
                       onRestoreAllFlags={() => void actions.setDismissed(peeked, [])}
                       onChangeStatus={(s) => void actions.changeStatus(peeked, s)}
                       onChangeTitle={(next) => void actions.changeTitle(peeked, next)}
                       siblingTotal={null}
                       influencerOptions={influencerOptions}
                       onAssignInfluencer={(next) => void actions.assignInfluencer(peeked, next)}
                       onSaveMedia={(next) => void actions.saveMedia(peeked, next)}
                       mediaDropNotice={mediaDrop?.draftId === peeked.id ? mediaDrop.notice : null}
                       onDismissMediaDrop={() => setMediaDrop(null)} />
          </div>
        </div>
      )}
      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { mergeRow(u); setEditing(null); }}
                        onMediaSaved={mergeRow} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 타입·린트 확인**

Run: `npx tsc --noEmit -p .`
Expected: 오류 0 — `campaigns` prop이 미사용이면 `noUnusedParameters`에 걸릴 수 있다. 걸리면 함수 시그니처의 구조분해에서 `campaigns`를 빼고 타입에만 남긴다(`{ id, onChanged, onDeleted }: { id: string; campaigns: CampaignRow[]; … }` — 위 코드가 이미 그 형태다).

Run: `npm run lint`
Expected: 경고 24개, 오류 0. `grep -n "text-caption" src/app/campaigns/CampaignHeader.tsx src/app/campaigns/CampaignDetail.tsx src/app/campaigns/LinkPostModal.tsx` 0건(peek 닫기 버튼의 `text-[13px]`는 13px이라 기준 안).

- [ ] **Step 6: Commit**

```bash
git add src/app/campaigns/CampaignHeader.tsx src/app/campaigns/useCampaignDraftActions.ts src/app/campaigns/LinkPostModal.tsx src/app/campaigns/CampaignDetail.tsx
git commit -m "feat(campaign): 상세 컨테이너 — 헤더 인라인 수정·삭제 확인, 원고 편집 낙관적 갱신 훅(PATCH /api/drafts 단일 경로), 게시물 연결, DraftCard 단일 표면"
```

---

### Task 11: `/campaigns` 페이지·레이아웃 + `CampaignList` + `CampaignCreateModal` + 사이드바 항목 + `campaignView.ts`

**Parallel group:** G4 (Task 10 후)
**Suggested model:** sonnet

**Files:**
- Create: `src/lib/campaignView.ts`
- Test: `src/lib/campaignView.test.ts`
- Create: `src/app/campaigns/layout.tsx`
- Create: `src/app/campaigns/page.tsx`
- Create: `src/app/campaigns/CampaignList.tsx`
- Create: `src/app/campaigns/CampaignCreateModal.tsx`
- Modify: `src/components/Sidebar.tsx:11`(import) · `:55-61`(`globalNav`)
- Modify: `src/components/XIcons.tsx`(끝에 `CampaignIcon` 추가)

**Interfaces:**
- Consumes: `CampaignRow`(Task 4) · `campaignStatus`, `formatDateKo`, `nextWeekRange`, `suggestCampaignName`, `suggestCampaignCode`, `CAMPAIGN_KINDS`, `CAMPAIGN_KIND_LABEL`, `CampaignKind`(Task 2) · `checkPeriod`, `NAME_MAX`(Task 6) · `fetchCampaigns`, `createCampaignApi`(Task 7) · `CampaignDetail`(Task 10) · `checkCampaign`, `campaignMessage`(`@/lib/trackingLink`) · `kstToday`(`@/lib/datetime`) · `ClientRow`(`@/lib/clientStore`) · `GlobalShell`, `ToastProvider`, `useToast`, `Button`
- Produces (Task 15가 사용):
  - `groupCampaigns<T>(rows, today): { active: T[]; upcoming: T[]; ended: T[] }` · `pickCampaignId(rows, urlId, today): { id: string | null; missing: boolean }` · `periodLabel(startsOn, endsOn): string`(`'8/24 월 ~ 8/30 일'`) · `listSubline(c): string`(`'8/24 월 ~ 8/30 일 · 콘텐츠 3개'`) — 셋은 이 태스크 안에서만 쓴다(CampaignList)
  - `type DetailView = 'table' | 'calendar'` · `DETAIL_VIEW_KEY = 'campaign-detail-view'` · `parseDetailView(raw: string | null): DetailView`(Task 15의 [표|주간 달력] 기억)
  - 라우트 `/campaigns?id=<campaignId>` — 사이드바 "캠페인"(첫 항목), 인플 프로필 "참여 캠페인" 링크(Task 14)가 이 형식을 쓴다

스펙 모호점 해소(이 계획의 결정): 자동 선택은 진행 중 첫 캠페인 → 없으면 예정 첫 → 없으면 종료 첫(목록 순 = 시작일 내림차순). 하나도 없으면 빈 상태 안내 + [+ 새 캠페인].

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignView.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupCampaigns, pickCampaignId, periodLabel, listSubline, parseDetailView, DETAIL_VIEW_KEY } from './campaignView.ts';

const T = '2026-08-27';
const rows = [
  { id: 'u', startsOn: '2026-09-07', endsOn: '2026-09-13', draftCount: 0 },  // 예정
  { id: 'a', startsOn: '2026-08-24', endsOn: '2026-08-30', draftCount: 3 },  // 진행 중
  { id: 'e', startsOn: '2026-08-03', endsOn: '2026-08-09', draftCount: 5 },  // 종료
];

test('1) 그룹 — 상태는 campaignStatus로만(수동 상태 없음), 그룹 안 순서는 입력 순서 유지', () => {
  const g = groupCampaigns(rows, T);
  assert.deepEqual(g.active.map((r) => r.id), ['a']);
  assert.deepEqual(g.upcoming.map((r) => r.id), ['u']);
  assert.deepEqual(g.ended.map((r) => r.id), ['e']);
});

test('2) 선택 — ?id=가 있으면 그것, 없으면 진행 중→예정→종료 첫 번째, 무효 id는 missing=true + 폴백', () => {
  assert.deepEqual(pickCampaignId(rows, 'e', T), { id: 'e', missing: false });
  assert.deepEqual(pickCampaignId(rows, null, T), { id: 'a', missing: false });
  assert.deepEqual(pickCampaignId(rows, 'zzz', T), { id: 'a', missing: true });
  assert.deepEqual(pickCampaignId([rows[0], rows[2]], null, T), { id: 'u', missing: false });   // 진행 중 없음 → 예정
  assert.deepEqual(pickCampaignId([rows[2]], null, T), { id: 'e', missing: false });            // 종료만 있으면 종료
  assert.deepEqual(pickCampaignId([], 'zzz', T), { id: null, missing: true });
  assert.deepEqual(pickCampaignId([], null, T), { id: null, missing: false });
});

test('3) 문구·보기 기억', () => {
  assert.equal(periodLabel('2026-08-24', '2026-08-30'), '8/24 월 ~ 8/30 일');
  assert.equal(listSubline(rows[1]), '8/24 월 ~ 8/30 일 · 콘텐츠 3개');
  assert.equal(parseDetailView('calendar'), 'calendar');
  assert.equal(parseDetailView('table'), 'table');
  assert.equal(parseDetailView(null), 'table');        // 기본 표(스펙 §3-2)
  assert.equal(parseDetailView('garbage'), 'table');
  assert.equal(DETAIL_VIEW_KEY, 'campaign-detail-view');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignView.test.ts`
Expected: FAIL — `Cannot find module './campaignView.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignView.ts`)

```ts
// 캠페인 목록·선택·보기 기억의 순수 규칙 — 페이지 컴포넌트가 아니라 여기 두어 테스트로 고정한다.
import { campaignStatus, formatDateKo } from './campaignJudgment.ts';

export interface CampaignGroups<T> { active: T[]; upcoming: T[]; ended: T[] }

// 그룹은 기간에서 파생한 상태로만 나눈다(§10 수동 상태 없음). 그룹 안 순서는 서버 순서(starts_on desc) 그대로.
export function groupCampaigns<T extends { startsOn: string; endsOn: string }>(rows: T[], today: string): CampaignGroups<T> {
  const g: CampaignGroups<T> = { active: [], upcoming: [], ended: [] };
  for (const r of rows) g[campaignStatus(r.startsOn, r.endsOn, today)].push(r);
  return g;
}

// 진입 시 자동 선택(스펙 §3-2 목록): ?id=가 살아 있으면 그것, 아니면 진행 중 첫 → 예정 첫 → 종료 첫.
// missing = ?id=가 있었는데 목록에 없음(삭제됨) → 페이지가 토스트로 알리고 폴백을 연다(§7).
export function pickCampaignId<T extends { id: string; startsOn: string; endsOn: string }>(
  rows: T[], urlId: string | null, today: string,
): { id: string | null; missing: boolean } {
  if (urlId && rows.some((r) => r.id === urlId)) return { id: urlId, missing: false };
  const g = groupCampaigns(rows, today);
  const first = g.active[0] ?? g.upcoming[0] ?? g.ended[0] ?? null;
  return { id: first?.id ?? null, missing: !!urlId };
}

/** '8/24 월 ~ 8/30 일' — 목록 보조줄. (인플 프로필 참여 캠페인(Task 14)은 G4와 병렬이라 이 파일을 import하지 않고 formatDateKo로 같은 모양을 조립한다) */
export function periodLabel(startsOn: string, endsOn: string): string {
  return `${formatDateKo(startsOn)} ~ ${formatDateKo(endsOn)}`;
}
/** 목록 행 보조줄 — 콘텐츠 수는 미사용 제외(campaignStore.draftCount) */
export function listSubline(c: { startsOn: string; endsOn: string; draftCount: number }): string {
  return `${periodLabel(c.startsOn, c.endsOn)} · 콘텐츠 ${c.draftCount}개`;
}

// 상세 [표 | 주간 달력] — 작업 방식 선호라 저장한다(generate VIEW_KEY 관례). 기본은 표(§3-2).
export type DetailView = 'table' | 'calendar';
export const DETAIL_VIEW_KEY = 'campaign-detail-view';
export function parseDetailView(raw: string | null): DetailView {
  return raw === 'calendar' ? 'calendar' : 'table';
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignView.test.ts`
Expected: PASS 3건

- [ ] **Step 5: `layout.tsx`** (`src/app/campaigns/layout.tsx` 생성 — tracking/layout.tsx와 같은 셸 + ToastProvider)

```tsx
import { GlobalShell } from '@/components/GlobalShell';
import { ToastProvider } from '@/lib/toastContext';

// 프로바이더가 없으면 useToast는 no-op 기본값으로 조용히 삼켜진다(toastContext) — 이 화면은 저장 실패·무효 링크를
// 토스트로만 알리므로, 없으면 실패가 보이지 않는다(tracking/layout.tsx와 같은 이유).
export default function CampaignsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GlobalShell>
      <ToastProvider>{children}</ToastProvider>
    </GlobalShell>
  );
}
```

- [ ] **Step 6: `CampaignList.tsx`** — 진행 중 / 예정 / 종료(접힘) 그룹, 행 = 이름 + 보조줄

```tsx
'use client';
import { useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { groupCampaigns, listSubline } from '@/lib/campaignView';
import { Button } from '@/components/ui';

// 캠페인 목록(왼쪽 280px, 스펙 §3-2) — 진행 중 / 예정 / 종료 그룹, 종료는 기본 접힘(koo 선택).
// 행 = 이름(15px) + 보조줄(13px: 기간 · 콘텐츠 n개). 선택 표시는 clients/influencers 목록과 같은 연한 파랑.
export function CampaignList({ rows, selectedId, today, loaded, loadErr, onSelect, onCreate, onRetry }: {
  rows: CampaignRow[]; selectedId: string | null; today: string;
  loaded: boolean; loadErr: boolean;
  onSelect: (id: string) => void; onCreate: () => void; onRetry: () => void;
}) {
  const [endedOpen, setEndedOpen] = useState(false);
  const g = groupCampaigns(rows, today);

  // 컴포넌트가 아니라 함수 — 렌더마다 새 컴포넌트 타입을 만들면 행의 상태·포커스가 매번 리셋된다
  const renderRow = (c: CampaignRow) => {
    const on = c.id === selectedId;
    return (
      <button key={c.id} onClick={() => onSelect(c.id)} aria-current={on ? 'true' : undefined}
              className={`mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${on ? 'bg-[#e3f1fb]' : 'hover:bg-x-hover'}`}>
        <span className={`block truncate text-content font-semibold ${on ? 'text-x-blue-text' : ''}`}>{c.name}</span>
        <span className="block text-ui text-x-muted">{listSubline(c)}</span>
      </button>
    );
  };
  const renderGroup = (title: string, items: CampaignRow[]) => (items.length === 0 ? null : (
    <div key={title} className="mb-3">
      <p className="mb-1 px-2 text-ui font-bold text-x-secondary">{title} <span className="font-normal text-x-muted">{items.length}</span></p>
      {items.map(renderRow)}
    </div>
  ));

  return (
    <>
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 className="text-content font-bold">캠페인 {rows.length > 0 && <span className="text-ui font-normal text-x-secondary">{rows.length}</span>}</h2>
        <button onClick={onCreate} className="text-ui font-medium text-x-blue-text hover:underline">+ 새 캠페인</button>
      </div>
      <p className="mb-3 px-2 text-ui text-x-muted">클라이언트 한 곳의 한 기간 동안 나가는 원고를 묶어요 — 진행·성과·비용을 한 화면에서 봐요.</p>

      {!loaded && <p className="px-2 py-4 text-content text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="px-2 py-4">
          <p className="mb-2 text-content text-x-secondary">목록을 불러오지 못했습니다</p>
          <Button onClick={onRetry}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && (
        <>
          {renderGroup('진행 중', g.active)}
          {renderGroup('예정', g.upcoming)}
          {g.ended.length > 0 && (
            <div className="mb-3">
              <button onClick={() => setEndedOpen((v) => !v)} aria-expanded={endedOpen}
                      className="mb-1 flex w-full items-center gap-1 px-2 text-ui font-bold text-x-secondary hover:text-x-text">
                종료 <span className="font-normal text-x-muted">{g.ended.length}</span>
                <span aria-hidden className="ml-auto">{endedOpen ? '⌃' : '⌄'}</span>
              </button>
              {endedOpen && g.ended.map(renderRow)}
            </div>
          )}
        </>
      )}
    </>
  );
}
```

- [ ] **Step 7: `CampaignCreateModal.tsx`** — 클라이언트 → 기간(기본 다음 월~일) → 이름(제안) → 영문 코드(제안·checkCampaign) → 유형 → 메모

```tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { CampaignRow } from '@/lib/campaignStore';
import { createCampaignApi } from '@/lib/campaignApi';
import { checkPeriod, NAME_MAX } from '@/lib/campaignInput';
import {
  nextWeekRange, suggestCampaignName, suggestCampaignCode, CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind,
} from '@/lib/campaignJudgment';
import { checkCampaign, campaignMessage } from '@/lib/trackingLink';
import { Button } from '@/components/ui';

// [+ 새 캠페인](스펙 §3-3) — 클라이언트(필수) → 기간(기본 다음 월~일) → 이름(자동 제안, 수정) → 영문 코드(자동 제안, 트래킹 링크 규칙) → 유형 → 메모.
// 제안값은 손대기 전까지만 따라간다(LinkCreateModal의 touched 관례) — 클라·시작일을 바꾸면 제안이 다시 계산되지만, 사람이 고친 값은 덮지 않는다.
// 검증은 서버와 같은 함수(checkCampaign·checkPeriod)로 즉시 피드백 — 문구가 두 벌이 되지 않는다.
const INPUT = 'mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-content outline-none focus:border-x-blue';
const LABEL = 'mt-3 block text-ui text-x-secondary';
const HELP = 'mt-1 text-ui text-x-muted';

export function CampaignCreateModal({ today, onClose, onCreated }: {
  today: string; onClose: () => void; onCreated: (row: CampaignRow) => void;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState('');
  const initial = useMemo(() => nextWeekRange(today), [today]);
  const [startsOn, setStartsOn] = useState(initial.startsOn);
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [kind, setKind] = useState<CampaignKind | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // 클라이언트 명부 — 실패해도 모달은 뜬다(select가 비어 '골라 주세요'가 남는다)
  useEffect(() => {
    apiFetch('/api/clients').then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((rows: Array<{ client: ClientRow }>) => setClients(Array.isArray(rows) ? rows.map((r) => r.client) : []));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const suggestedName = suggestCampaignName(client?.name ?? '', startsOn);   // '{클라} {M월 N주}'
  const suggestedCode = suggestCampaignCode(client?.nameEn ?? '', startsOn); // '{영문 소문자}-{YYYYMMDD}' / 영문 없으면 날짜만
  const nameValue = nameTouched ? name : suggestedName;
  const codeValue = codeTouched ? code : suggestedCode;
  const periodErr = checkPeriod(startsOn, endsOn);
  const codeCheck = checkCampaign(codeValue);
  const reason = !clientId ? '클라이언트를 골라 주세요'
    : !nameValue.trim() ? '캠페인 이름을 입력해 주세요'
    : periodErr ? periodErr
    : !codeCheck.ok ? campaignMessage(codeCheck.reason)
    : '';
  const canSubmit = reason === '' && !busy;

  async function submit() {
    if (!canSubmit || !codeCheck.ok) return;
    setBusy(true); setErr('');
    const r = await createCampaignApi({
      clientId, name: nameValue.trim(), nameEn: codeCheck.campaign, startsOn, endsOn, kind: kind || null, note: note.trim(),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated(r.data);   // 만들면 그 캠페인이 선택된 상세로(§3-3) — 페이지가 ?id=로 이동
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true" aria-label="새 캠페인" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-content font-bold">새 캠페인</h2>
          <button onClick={onClose} disabled={busy} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border disabled:opacity-40">✕</button>
        </div>
        <p className="mt-1 text-ui text-x-muted">클라이언트 한 곳 × 기간 하나예요. 원고는 만든 뒤 [+ 원고 추가]로 넣거나 콘텐츠 생성에서 바로 만들어요.</p>

        <label htmlFor="cc-client" className={LABEL}>클라이언트</label>
        <select id="cc-client" value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus className={INPUT}>
          <option value="">골라 주세요</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <p className={HELP}>고르면 이름과 영문 코드가 자동으로 제안돼요(직접 고친 값은 그대로 유지돼요)</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-ui text-x-secondary">시작일
            <input type="date" value={startsOn} onChange={(e) => { if (e.target.value) setStartsOn(e.target.value); }} className={INPUT} />
          </label>
          <label className="block text-ui text-x-secondary">종료일
            <input type="date" value={endsOn} onChange={(e) => { if (e.target.value) setEndsOn(e.target.value); }} className={INPUT} />
          </label>
        </div>
        <p className={periodErr ? 'mt-1 text-ui text-red-600' : HELP}>{periodErr ?? '기본은 다음 주 월~일이에요 — 주 단위 캠페인이 대부분이라서요. 더 길어도 돼요'}</p>

        <label htmlFor="cc-name" className={LABEL}>이름</label>
        <input id="cc-name" value={nameValue} maxLength={NAME_MAX}
               onChange={(e) => { setName(e.target.value); setNameTouched(true); }} className={INPUT} />
        <p className={HELP}>목록과 원고 카드에서 이 캠페인을 부를 이름이에요</p>

        <label htmlFor="cc-code" className={LABEL}>영문 코드</label>
        <input id="cc-code" value={codeValue} autoCapitalize="none" spellCheck={false}
               onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }} className={`${INPUT} font-mono`} />
        <p className={codeValue.trim() && !codeCheck.ok ? 'mt-1 text-ui text-red-600' : HELP}>
          {codeValue.trim() && !codeCheck.ok ? campaignMessage(codeCheck.reason) : '이 캠페인 원고로 트래킹 링크를 만들 때 캠페인명(utm_campaign)으로 들어가요 — 영어·숫자·하이픈'}
        </p>

        <label htmlFor="cc-kind" className={LABEL}>유형 <span className="text-x-muted">(선택)</span></label>
        <select id="cc-kind" value={kind} onChange={(e) => setKind(e.target.value as CampaignKind | '')} className={INPUT}>
          <option value="">없음</option>
          {CAMPAIGN_KINDS.map((k) => <option key={k} value={k}>{CAMPAIGN_KIND_LABEL[k]}</option>)}
        </select>
        <p className={HELP}>표시용이에요 — 방문 협찬이면 비용 제안이 방문 단가를 봐요</p>

        <label htmlFor="cc-note" className={LABEL}>메모 <span className="text-x-muted">(선택)</span></label>
        <textarea id="cc-note" value={note} rows={2} onChange={(e) => setNote(e.target.value)} className={`${INPUT} resize-y`} />

        {err && <p role="alert" className="mt-2 text-ui text-red-600">{err}</p>}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} className="text-content">
            {busy ? '만드는 중…' : '캠페인 만들기'}
          </Button>
          <button onClick={onClose} disabled={busy} className="text-ui text-x-secondary disabled:opacity-40">취소</button>
        </div>
        {!canSubmit && !busy && reason && <p className="mt-1.5 text-ui text-x-muted">{reason}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: `page.tsx`** — 목록 + 상세(master-detail), `?id=` 단일 출처

```tsx
'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/lib/toastContext';
import { kstToday } from '@/lib/datetime';
import type { CampaignRow } from '@/lib/campaignStore';
import { fetchCampaigns } from '@/lib/campaignApi';
import { pickCampaignId } from '@/lib/campaignView';
import { Button } from '@/components/ui';
import { CampaignList } from './CampaignList';
import { CampaignCreateModal } from './CampaignCreateModal';
import { CampaignDetail } from './CampaignDetail';

export default function CampaignsPage() {
  // useSearchParams는 Suspense 경계 필수(clients/page.tsx·generate/page.tsx 선례)
  return <Suspense><CampaignsSplit /></Suspense>;
}

function CampaignsSplit() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlId = searchParams.get('id');
  const { show } = useToast();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [creating, setCreating] = useState(false);
  // '오늘'(서울)은 마운트 시 한 번 — 렌더마다 시계를 읽지 않는다(react-hooks/purity). 자정을 넘기면 새로고침이 기준을 갱신한다.
  const [today] = useState(() => kstToday());

  const load = useCallback(async () => {
    const r = await fetchCampaigns();
    if (r.ok) { setRows(r.data); setLoadErr(false); } else setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const picked = useMemo(() => pickCampaignId(rows, urlId, today), [rows, urlId, today]);
  // 무효 ?id= → 토스트 + 첫 캠페인(스펙 §7). URL도 고쳐 새로고침해도 같은 화면(clients 폴백 관례).
  useEffect(() => {
    if (!loaded || loadErr) return;
    if (picked.missing) show('링크가 가리키는 캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요. 첫 캠페인을 열었어요');
    if (picked.id && picked.id !== urlId) router.replace(`${pathname}?id=${picked.id}`, { scroll: false });
    else if (!picked.id && urlId) router.replace(pathname, { scroll: false });
  }, [loaded, loadErr, picked, urlId, pathname, router, show]);

  const select = useCallback((id: string) => router.replace(`${pathname}?id=${id}`, { scroll: false }), [router, pathname]);

  return (
    <div className="flex">
      <aside className="sticky top-0 max-h-screen w-[280px] shrink-0 self-start overflow-y-auto border-r border-x-border px-3 py-5">
        <CampaignList rows={rows} selectedId={picked.id} today={today} loaded={loaded} loadErr={loadErr}
                      onSelect={select} onCreate={() => setCreating(true)} onRetry={() => void load()} />
      </aside>
      <main className="min-w-0 flex-1">
        {loaded && !loadErr && rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="mb-1 text-content font-bold">아직 캠페인이 없어요</p>
            <p className="mb-4 text-ui text-x-secondary">클라이언트 한 곳의 한 기간 원고를 캠페인으로 묶으면 진행·성과·비용을 한 화면에서 볼 수 있어요.</p>
            <Button variant="primary" onClick={() => setCreating(true)} className="text-content">+ 새 캠페인</Button>
          </div>
        )}
        {picked.id && (
          <CampaignDetail key={picked.id} id={picked.id} campaigns={rows} onChanged={() => void load()}
                          onDeleted={() => { router.replace(pathname, { scroll: false }); void load(); }} />
        )}
      </main>
      {creating && (
        <CampaignCreateModal today={today} onClose={() => setCreating(false)}
                             onCreated={async (row) => { setCreating(false); await load(); select(row.id); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 9: 사이드바 + 아이콘**

`src/components/XIcons.tsx` 끝에 추가:
```tsx
// 캠페인(사이드바) — 깃발. 콘텐츠 생성·인플루언서·트래킹을 묶는 상위 개념이라 그 그룹 맨 위에 선다(스펙 §3-1).
export const CampaignIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d="M5 2h2v20H5V2zm3 1h12.6l-2.7 5 2.7 5H8V3zm2 2v6h7.3l-1.6-3 1.6-3H10z" />
);
```

`src/components/Sidebar.tsx` 11행 import에 `CampaignIcon` 추가, 55-61행 `globalNav` 교체:
```tsx
import { SearchIcon, ColumnsIcon, DocIcon, FolderIcon, PenIcon, ClinicIcon, PromptIcon, UserIcon, ViewIcon, CampaignIcon } from './XIcons';
```
```tsx
  // 워크스페이스 무관 최상위 기능 (스펙 §4 — 콘텐츠 생성은 /w/[wsId] 밖)
  // 캠페인이 맨 위 — 콘텐츠 생성·인플루언서·트래킹 셋을 묶는 상위 개념이다(캠페인 스펙 §3-1).
  // 인플루언서 명부도 워크스페이스 밖 — 원고를 누구에게 줄지는 워크스페이스와 무관한 사람 정보다(스펙 §3)
  const globalNav = [
    { href: '/campaigns', label: '캠페인', Ic: CampaignIcon },
    { href: '/generate', label: '콘텐츠 생성', Ic: PenIcon },
    { href: '/influencers', label: '인플루언서', Ic: UserIcon },
    // 트래킹도 워크스페이스 밖 — 게시된 게시물의 반응은 리서치 덱이 아니라 우리가 낸 원고에 딸린 결과다.
    // 인플루언서 다음: 원고를 누구에게 줬는지 → 그게 어떻게 됐는지 순서로 읽힌다.
    { href: '/tracking', label: '트래킹', Ic: ViewIcon },
  ];
```

- [ ] **Step 10: 타입·린트·빌드·화면 확인**

Run: `npx tsc --noEmit -p .` → 오류 0 · `npm run lint` → 경고 24개 · `npm run build` → 성공(`/campaigns` 라우트가 목록에 보인다)

Run: `npm run start -- -p 3001` 후 `http://127.0.0.1:3001/campaigns`(로컬 확인은 build+start, 메모리 `cb-x-deck-local-dev-broken`). 확인: 사이드바 첫 항목 "캠페인" → 빈 상태 → [+ 새 캠페인] → 클라 선택 시 이름·코드 제안 → 만들기 → 상세가 열리고 `?id=`가 붙는다 → 새로고침해도 같은 캠페인 → `?id=zzz`로 들어가면 토스트 + 첫 캠페인.

- [ ] **Step 11: Commit**

```bash
git add src/lib/campaignView.ts src/lib/campaignView.test.ts src/app/campaigns/layout.tsx src/app/campaigns/page.tsx src/app/campaigns/CampaignList.tsx src/app/campaigns/CampaignCreateModal.tsx src/components/Sidebar.tsx src/components/XIcons.tsx
git commit -m "feat(campaign): /campaigns 목록+상세 셸(진행 중·예정·종료 그룹, ?id= 단일 출처, 무효 링크 폴백) + 새 캠페인 모달 + 사이드바 첫 항목"
```

---

### Task 12: `DraftCampaignField` + DraftCard `campaign` prop 객체(캠페인·예정일·비용 칸) + 트래킹 링크 `campaignCode` prefill

**Parallel group:** G5 (G2+G3 후, G4와 병렬 — `src/app/campaigns/*`·Sidebar를 건드리지 않는다)
**Suggested model:** opus

**Files:**
- Create: `src/lib/draftCampaignOptions.ts`
- Test: `src/lib/draftCampaignOptions.test.ts`
- Create: `src/components/DraftCampaignField.tsx`
- Modify: `src/components/DraftCard.tsx:3-25`(import) · `:165-184`(props) · `:427-441`(도구층 스트립) · `:725-726`(TrackingLinkSection)
- Modify: `src/components/TrackingLinkSection.tsx:15-20`(props) · `:110-115`(prefill)
- Modify: `src/components/LinkCreateModal.tsx:14-18`(prefill 타입) · `:25`(초기값) · `:45`(open 리셋) · `:56-61`(클라 로드 후) · `:136-141`(onClientChange)

**Interfaces:**
- Consumes: `CampaignRow`(Task 4) · `campaignStatus`, `isOverdue`, `isOutOfRange`, `daysBetweenDates`, `defaultCostType`(Task 2) · `suggestDraftCost`, `DraftCost`(Task 1) · `DraftRow.campaignId/campaignName/campaignCode/scheduledOn/cost`, `InfluencerOption.pricing`(Task 3) · `CostPopover`, `ScheduledOnField`(Task 7) · `PATCH /api/drafts/[id]` 새 필드(Task 5 — 호출은 호스트 페이지가 한다)
- Produces (Task 13·15가 사용):
  - `campaignOptionsFor<T>(all: T[], clientId: string | null, today: string, currentId: string | null): { open: T[]; ended: T[] }`
  - `<DraftCampaignField campaignId campaignName clientId options today onChange />`
  - **DraftCard 새 prop(옵션)**: `campaign?: { options: CampaignRow[]; today: string; onChange: (campaignId: string | null) => void; onChangeScheduledOn: (next: string | null) => void; onChangeCost: (next: DraftCost | null) => void }` — 없으면 캠페인 칸을 그리지 않는다(기존 호출부 무변경 컴파일)
  - `TrackingLinkSection` 새 prop `campaignCode: string | null` · `LinkCreateModal.prefill.campaignCode?: string`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/draftCampaignOptions.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignOptionsFor } from './draftCampaignOptions.ts';

const T = '2026-08-27';
const all = [
  { id: 'a', clientId: 'c1', startsOn: '2026-08-24', endsOn: '2026-08-30' },   // c1 진행 중
  { id: 'u', clientId: 'c1', startsOn: '2026-09-07', endsOn: '2026-09-13' },   // c1 예정
  { id: 'e', clientId: 'c1', startsOn: '2026-08-03', endsOn: '2026-08-09' },   // c1 종료
  { id: 'o', clientId: 'c2', startsOn: '2026-08-24', endsOn: '2026-08-30' },   // 다른 클라
  { id: 'n', clientId: null, startsOn: '2026-08-24', endsOn: '2026-08-30' },   // 클라 삭제된 캠페인
];

test('1) 클라이언트가 있는 원고 — 그 클라의 진행 중·예정이 open, 종료는 ended, 다른 클라는 제외', () => {
  const r = campaignOptionsFor(all, 'c1', T, null);
  assert.deepEqual(r.open.map((c) => c.id), ['a', 'u']);
  assert.deepEqual(r.ended.map((c) => c.id), ['e']);
});

test('2) 현재 소속 캠페인은 클라가 달라도 목록에 남는다 — 표시가 값과 어긋나지 않게(라벨-값 일치)', () => {
  const r = campaignOptionsFor(all, 'c1', T, 'o');
  assert.deepEqual(r.open.map((c) => c.id), ['a', 'u', 'o']);
});

test('3) 클라이언트 없는 원고는 전체 캠페인(스펙 §4-2)', () => {
  const r = campaignOptionsFor(all, null, T, null);
  assert.deepEqual(r.open.map((c) => c.id), ['a', 'u', 'o', 'n']);
  assert.deepEqual(r.ended.map((c) => c.id), ['e']);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftCampaignOptions.test.ts`
Expected: FAIL — `Cannot find module './draftCampaignOptions.ts'`

- [ ] **Step 3: 구현** (`src/lib/draftCampaignOptions.ts`)

```ts
// DraftCard 캠페인 칸의 후보(스펙 §4-2) — 그 원고 클라이언트의 진행 중·예정 캠페인이 기본, 종료는 접힘("종료 캠페인 보기").
// 클라이언트 없는 원고는 전체 캠페인. 현재 소속 캠페인은 클라가 달라도 목록에 남긴다 — 값이 있는데 목록에 없으면 칩이 '없음'을 보인다.
import { campaignStatus } from './campaignJudgment.ts';

export function campaignOptionsFor<T extends { id: string; clientId: string | null; startsOn: string; endsOn: string }>(
  all: T[], clientId: string | null, today: string, currentId: string | null,
): { open: T[]; ended: T[] } {
  const mine = clientId === null ? all : all.filter((c) => c.clientId === clientId || c.id === currentId);
  return {
    open: mine.filter((c) => campaignStatus(c.startsOn, c.endsOn, today) !== 'ended'),
    ended: mine.filter((c) => campaignStatus(c.startsOn, c.endsOn, today) === 'ended'),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftCampaignOptions.test.ts`
Expected: PASS 3건

- [ ] **Step 5: `DraftCampaignField.tsx`** — "캠페인: 없음 ▾"(칩처럼 보이는 select, DraftStatusChip 골격)

```tsx
'use client';
import { useMemo, useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { campaignOptionsFor } from '@/lib/draftCampaignOptions';

// 원고의 캠페인 소속 한 칸(스펙 §4-2) — 인플루언서 칸 옆 "캠페인: 없음 ▾". 값은 draft.campaign_id 하나(§2-5):
// 여기서 바꾸면 캠페인 화면에 즉시 반영된다(같은 컬럼). 다른 캠페인 소속으로 옮길 때 경고 없음(§7 — 값은 하나).
// DraftStatusChip과 같은 '보이는 칩 + 투명 select' 골격 — 목록이 5~20개라 네이티브 select가 가장 빠르다.
export function DraftCampaignField({ campaignId, campaignName, clientId, options, today, onChange }: {
  campaignId: string | null; campaignName: string | null; clientId: string | null;
  options: CampaignRow[]; today: string;
  onChange: (next: string | null) => void;
}) {
  const [showEnded, setShowEnded] = useState(false);
  const { open, ended } = useMemo(() => campaignOptionsFor(options, clientId, today, campaignId), [options, clientId, today, campaignId]);
  const currentInEnded = campaignId !== null && ended.some((c) => c.id === campaignId);
  const withEnded = showEnded || currentInEnded;   // 현재 소속이 종료 캠페인이면 접어둘 수 없다 — 값이 보여야 한다
  return (
    <span className="inline-flex items-center gap-1.5">
      <label title="이 원고가 속한 캠페인 — 바꾸면 캠페인 화면에 바로 반영돼요"
             className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-white px-2.5 text-ui focus-within:ring-2 focus-within:ring-x-blue ${
               campaignId ? 'border-x-border-strong text-x-text hover:bg-x-hover' : 'border-dashed border-x-border-strong text-x-muted hover:bg-x-hover hover:text-x-secondary'}`}>
        캠페인: {campaignName ?? '없음'} <span aria-hidden className="text-x-muted">⌄</span>
        <select value={campaignId ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="캠페인 선택"
                className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">없음</option>
          {open.length > 0 && <optgroup label="진행 중 · 예정">{open.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
          {withEnded && ended.length > 0 && <optgroup label="종료">{ended.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        </select>
      </label>
      {ended.length > 0 && !withEnded && (
        <button type="button" onClick={() => setShowEnded(true)} className="text-ui text-x-muted hover:text-x-secondary hover:underline">종료 캠페인 보기</button>
      )}
    </span>
  );
}
```

- [ ] **Step 6: DraftCard에 `campaign` prop 객체** (`src/components/DraftCard.tsx`)

import 추가(25행 `DraftStatus` import 아래):
```tsx
import type { CampaignRow } from '@/lib/campaignStore';
import { suggestDraftCost, type DraftCost } from '@/lib/campaignCost';
import { isOverdue, isOutOfRange, daysBetweenDates, defaultCostType } from '@/lib/campaignJudgment';
import { DraftCampaignField } from '@/components/DraftCampaignField';
import { ScheduledOnField } from '@/components/ScheduledOnField';
import { CostPopover } from '@/components/CostPopover';
```

165행 시그니처의 구조분해 끝(`onDismissMediaDrop`) 뒤에 `, campaign` 추가하고, 183행 `onDismissMediaDrop: () => void;` 아래 prop 타입 추가:
```tsx
  // 캠페인 관련은 객체 하나로(리뷰 Should 4 — prop 18개 위에 4개를 더 얹지 않는다). undefined면 캠페인 칸을 그리지 않는다:
  // 캠페인 화면(Task 15)·/generate(Task 13)가 배선하고, 그 밖의 호스트는 그대로 컴파일·동작한다. 값은 전부 draft에서 읽고(값은 하나),
  // 저장은 호스트가 PATCH /api/drafts/[id]로 — 카드는 fetch하지 않는다(TrackingLinkSection의 자급식과 다른 이유: 낙관적 갱신·롤백이 목록 소유자의 몫).
  campaign?: {
    options: CampaignRow[];          // 전 캠페인 — 후보 필터(클라·상태)는 DraftCampaignField가 한다
    today: string;                   // 밀림·기간 밖 판정 기준(서울) — 호스트가 서버 today 또는 kstToday()를 준다
    onChange: (campaignId: string | null) => void;
    onChangeScheduledOn: (next: string | null) => void;
    onChangeCost: (next: DraftCost | null) => void;
  };
```

184행 `}) {` 바로 아래(첫 `useState` 위)에 파생값 추가:
```tsx
  // 캠페인 칸 파생값 — 카드는 게시됨(tracked_post)을 모르므로 published:false로 판정한다. 캠페인 화면 표는 게시됨을 알고
  // 판정하므로 그쪽이 정확하고, 카드는 "예정일 지났고 아직 상태가 미사용이 아니다"까지만 말한다.
  const camp = campaign ? (campaign.options.find((c) => c.id === draft.campaignId) ?? null) : null;
  const overdue = campaign && isOverdue({ status: draft.status, published: false, scheduledOn: draft.scheduledOn }, campaign.today)
    ? daysBetweenDates(draft.scheduledOn as string, campaign.today) : null;
  const outOfRange = camp ? isOutOfRange(draft.scheduledOn, camp.startsOn, camp.endsOn) : false;
  const costSuggestion = campaign && draft.influencerHandle
    ? suggestDraftCost(influencerOptions.find((o) => o.handle.toLowerCase() === (draft.influencerHandle as string).toLowerCase())?.pricing,
                       defaultCostType(camp?.kind ?? null))
    : null;
```

430행 `<InfluencerChip … />` 바로 아래에 캠페인 칸 추가:
```tsx
        {/* 캠페인 소속(스펙 §4-2) — 인플루언서 칸 옆 "누구에게 · 어느 캠페인에". 배선한 호스트에서만 보인다 */}
        {campaign && (
          <DraftCampaignField campaignId={draft.campaignId} campaignName={draft.campaignName} clientId={draft.clientId}
                              options={campaign.options} today={campaign.today} onChange={campaign.onChange} />
        )}
```

441행(도구층 스트립 `</div>`) 바로 아래, 제목 줄(`{/* 원고 이름 — …`) 위에 둘째 줄 추가:
```tsx
      {/* 예정일·비용 — 캠페인 소속일 때만(§4-2 "값은 하나"). 표에서 고친 값이 여기, 여기서 고친 값이 표에 그대로 보인다 */}
      {campaign && draft.campaignId && (
        <div className="flex flex-wrap items-center gap-2 border-b border-x-border bg-x-surface px-4 pb-2">
          <ScheduledOnField value={draft.scheduledOn} overdueDays={overdue} outOfRange={outOfRange} onChange={campaign.onChangeScheduledOn} />
          <CostPopover value={draft.cost} suggestion={costSuggestion} defaultType={defaultCostType(camp?.kind ?? null)} onChange={campaign.onChangeCost} />
        </div>
      )}
```

725-726행 TrackingLinkSection 호출에 prop 추가:
```tsx
        <TrackingLinkSection draftId={draft.id} influencerHandle={draft.influencerHandle}
                             clientId={draft.clientId} clientName={draft.clientName}
                             campaignCode={draft.campaignCode} />
```

- [ ] **Step 7: `TrackingLinkSection.tsx`** — `campaignCode` prop → prefill

15-20행 props 교체:
```tsx
export function TrackingLinkSection({ draftId, influencerHandle, clientId, clientName, campaignCode }: {
  draftId: string;
  influencerHandle: string | null;
  clientId: string | null;
  clientName: string | null;
  campaignCode: string | null;   // 소속 캠페인의 영문 코드(campaign.name_en) — 있으면 utm_campaign 기본값(스펙 §5)
}) {
```
110-115행 prefill 교체:
```tsx
      {createOpen && (
        <LinkCreateModal open={createOpen} onClose={() => setCreateOpen(false)} configured={configured}
                         onCreated={onCreated}
                         prefill={{ draftId, influencerHandle: influencerHandle ?? undefined,
                                    clientId: clientId ?? undefined, clientName: clientName ?? undefined,
                                    campaignCode: campaignCode ?? undefined }} />
      )}
```
`grep -rn "TrackingLinkSection" src --include=*.tsx`로 호출부가 DraftCard 하나뿐인지 확인한다(다른 호출부가 있으면 같은 prop을 넘긴다).

- [ ] **Step 8: `LinkCreateModal.tsx`** — 세팅 지점 **두 곳** 모두 `campaignCode` 우선(리뷰 Should 2)

17행 prefill 타입:
```tsx
  prefill?: { draftId?: string; influencerHandle?: string; clientId?: string; clientName?: string; campaignCode?: string };
```
25행 초기값:
```tsx
  // 캠페인 코드(campaign.name_en)가 있으면 그것이 utm_campaign — 클라명 제안(suggestCampaign)은 캠페인 없는 원고의 폴백(스펙 §5)
  const [campaign, setCampaign] = useState(prefill?.campaignCode ?? suggestCampaign(prefill?.clientName ?? null));
```
45행 open 리셋 이펙트 — `setCampaign(...)` 부분과 의존성 배열 교체:
```tsx
  useEffect(() => { if (!open) return; setClientId(prefill?.clientId ?? ''); setLandingUrl(''); setLandingTouched(false); setHandle(prefill?.influencerHandle ?? ''); setCampaign(prefill?.campaignCode ?? suggestCampaign(prefill?.clientName ?? null)); setCampaignTouched(false); setSlug(generateWordCode()); setContentLabel(suggestContentLabel()); setBusy(false); setErr(''); setDone(null); setCopied(false); }, [open, prefill?.clientId, prefill?.influencerHandle, prefill?.clientName, prefill?.campaignCode, prefill?.draftId]);
```
56-61행 클라 로드 후 채움 — 두 번째 세팅 지점. 캠페인 코드가 있으면 클라명 제안으로 덮지 않는다:
```tsx
        if (prefill?.clientId) {
          const c = list.find((x) => x.id === prefill.clientId);
          if (c) {
            if (!landingTouchedRef.current) setLandingUrl(c.landingUrl);
            // 캠페인 코드가 prefill로 왔으면 클라명 제안으로 조용히 덮지 않는다(리뷰 Should 2 — 세팅 지점이 둘이라 한쪽만 고치면 덮인다)
            if (!campaignTouchedRef.current && !prefill.campaignCode) setCampaign(suggestCampaign(c.nameEn || c.name));
          }
        }
```
69행 의존성에 `prefill?.campaignCode` 추가: `}, [open, prefill?.clientId, prefill?.campaignCode]);`

136-141행 onClientChange — 모달 안에서 클라를 바꿔도 캠페인 코드는 유지(코드는 캠페인의 것, 클라의 것이 아니다):
```tsx
  const onClientChange = useCallback((id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!landingTouched) setLandingUrl(c ? c.landingUrl : '');
    if (!campaignTouched && !prefill?.campaignCode) setCampaign(suggestCampaign(c ? (c.nameEn || c.name) : null));
  }, [clients, landingTouched, campaignTouched, prefill?.campaignCode]);
```
209행 도움말을 캠페인 코드가 있을 때 맥락으로 감싼다(기술 값 노출 최소화, UX 원칙 5):
```tsx
            <p className="mt-1 text-caption text-x-muted">
              {prefill?.campaignCode ? '소속 캠페인의 영문 코드가 들어갔어요 — 랜딩 쪽 분석 도구에서 이 이름으로 모아 봐요' : '랜딩 쪽 분석 도구에서 이 캠페인 이름으로 모아 볼 수 있어요 — 영어·숫자로 적어 주세요'}
            </p>
```
(이 모달은 기존 파일이라 `text-caption`을 그대로 둔다 — 가독성 기준은 캠페인 UI(`src/app/campaigns/*`·새 컴포넌트)에 적용하고 기존 화면은 범위 밖.)

- [ ] **Step 9: 타입·린트·기존 테스트**

Run: `npx tsc --noEmit -p .` → 오류 0(`generate/page.tsx`의 두 DraftCard 호출은 `campaign` 미지정으로 그대로 컴파일돼야 한다)
Run: `npm run lint` → 경고 24개
Run: `node --import tsx --env-file-if-exists=.env --test src/components/DraftCard.test.ts src/lib/draftCampaignOptions.test.ts` → PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/draftCampaignOptions.ts src/lib/draftCampaignOptions.test.ts src/components/DraftCampaignField.tsx src/components/DraftCard.tsx src/components/TrackingLinkSection.tsx src/components/LinkCreateModal.tsx
git commit -m "feat(campaign): DraftCard 캠페인 칸(campaign prop 객체 — 소속·예정일·비용) + 트래킹 링크 utm_campaign 기본값 = 캠페인 코드(세팅 지점 2곳)"
```

---

### Task 13: `/generate` 배선 — `?campaign=` 딥링크·배너·생성/직접 쓰기 `campaignId` · DraftCard `campaign` prop · 표 캠페인 열 + 필터

**Parallel group:** G5 (Task 12 후)
**Suggested model:** opus

**Files:**
- Modify: `src/lib/draftUi.ts:67-77`(`DraftListFilter`·`filterDrafts`)
- Modify: `src/lib/draftUi.test.ts:75-85`(filterDrafts 테스트)
- Modify: `src/components/DraftFilterBar.tsx`(캠페인 select)
- Modify: `src/components/DraftTable.tsx:56-63`(헤더) · `:99`(캠페인 열)
- Modify: `src/components/DraftWriteModal.tsx:16-23`(props) · `:32-34`(scope) · `:55-63`(body)
- Modify: `src/app/generate/page.tsx` — import(1-30) · 상태(60, 96 뒤) · 마운트 로드(159-185) · 새 이펙트(?campaign=) · `generate()` body(352-362) · 새 함수 3개(assignInfluencer 뒤) · 필터 호출(274-281, 337) · 툴바 배너(683-718) · DraftFilterBar(700-702) · DraftCard 두 호출(764-780, 827-843) · DraftWriteModal(856-866)

**Interfaces:**
- Consumes: `CampaignRow`(Task 4) · `fetchCampaigns`(Task 7) · DraftCard `campaign` prop(Task 12) · `DraftRow.campaignId/campaignName/scheduledOn/cost`(Task 3) · `PATCH/POST /api/drafts` 새 필드(Task 5) · `DraftCost`(Task 1) · `kstToday`
- Produces (koo QA가 검증 — 뒤 태스크가 import하는 것 없음):
  - `DraftListFilter.campaignId: string`(`''` 전체 · `'none'` 캠페인 없음 · id) · `filterDrafts`가 그 축을 AND로 적용
  - `DraftFilterBar` 새 prop `campaigns: Array<{ id: string; name: string }>`
  - `DraftWriteModal` 새 prop `campaignId: string | null; campaignName: string | null`
  - `/generate?campaign=<id>` — 클라 자동 선택 + 배너 + 생성·직접 쓰기 `campaignId` + 표 필터 = 그 캠페인

스펙 모호점 해소(이 계획의 결정): ① "필터 칩"은 클라이언트 필터와 같은 **select**로 둔다 — 캠페인은 클라별로 늘어나 칩 줄이 넘친다(상태 탭 5개는 고정 집합이라 칩). ② `?campaign=`으로 들어오면 표 필터의 캠페인 축도 그 캠페인으로 맞춘다(배너 [해제] 시 함께 풀림) — "이 캠페인에 추가 중"인데 목록에 남의 원고가 섞이면 방금 만든 것이 어디 갔는지 헷갈린다.

- [ ] **Step 1: 실패하는 테스트 — `draftUi.test.ts` filterDrafts 확장** (75-85행 교체)

```ts
test('filterDrafts — 상태·클라이언트·캠페인 AND 조합', () => {
  const drafts = [
    { status: 'review' as DraftStatus, clientId: 'c1', campaignId: 'k1' },
    { status: 'review' as DraftStatus, clientId: 'c2', campaignId: null },
    { status: 'draft' as DraftStatus, clientId: null, campaignId: 'k1' },
  ];
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '', campaignId: '' }).length, 3);
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: '', campaignId: '' }).length, 2);
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: 'c1', campaignId: '' }).length, 1);
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: 'none', campaignId: '' }).length, 1); // 클라이언트 없음
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '', campaignId: 'k1' }).length, 2);
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '', campaignId: 'none' }).length, 1);  // 캠페인 없음
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: 'c1', campaignId: 'none' }).length, 0);
});
```
(기존 테스트가 `{ status, clientId }`만 넘겼다면 위처럼 `campaignId`를 추가한다 — 타입이 요구한다. 파일 상단 import에 `type DraftStatus`가 없으면 `import type { DraftStatus } from './draftStatus.ts';`를 추가.)

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: FAIL — `campaignId`를 모르는 타입 오류 또는 `filterDrafts(... campaignId: 'k1').length` 3 ≠ 2

- [ ] **Step 3: `draftUi.ts` 67-77행 교체**

```ts
// /generate 목록 필터 (스펙 3-1) — clientId: '' 전체 · 'none' 클라이언트 없음 · 그 외 해당 id
// 'none'에는 클라이언트 삭제로 고아가 된 초안(client_id ON DELETE SET NULL)도 포함된다.
// campaignId도 같은 3값 규칙(캠페인 스펙 §4-3 표 보기 캠페인 축) — 캠페인 삭제로 풀린 원고도 'none'에 든다.
export interface DraftListFilter { status: DraftStatus | 'all'; clientId: string; campaignId: string }

export function filterDrafts<T extends { status: DraftStatus; clientId: string | null; campaignId: string | null }>(
  drafts: T[], f: DraftListFilter,
): T[] {
  const pick = (want: string, have: string | null) => want === '' || (want === 'none' ? have === null : have === want);
  return drafts.filter((d) =>
    (f.status === 'all' || d.status === f.status) && pick(f.clientId, d.clientId) && pick(f.campaignId, d.campaignId));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts`
Expected: PASS(기존 건 + 확장 1건)

- [ ] **Step 5: `DraftFilterBar.tsx`** — 캠페인 select 추가(클라이언트 select 앞)

```tsx
'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { DraftListFilter } from '@/lib/draftUi';

// 상태 탭 + 캠페인·클라이언트 필터 (스펙 3-1) — 작업 세션용 렌즈라 저장하지 않는다
// showStatusTabs=false: 칸반 뷰는 열 위치가 곧 상태라 탭이 중복 — select만 노출(T4)
// 캠페인은 select — 클라별로 늘어나 칩 줄이 넘친다(상태 5개는 고정 집합이라 칩). 캠페인 스펙 §4-3.
export function DraftFilterBar({ counts, total, filter, clients, campaigns, onChange, showStatusTabs = true }: {
  counts: Record<DraftStatus, number>; total: number;
  filter: DraftListFilter; clients: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  onChange: (f: DraftListFilter) => void;
  showStatusTabs?: boolean;
}) {
  const tab = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full border px-3 tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;
  const select = 'h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue';
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-[13px]">
      {showStatusTabs && (
        <>
          <button onClick={() => onChange({ ...filter, status: 'all' })} className={tab(filter.status === 'all')}>
            전체 {total}
          </button>
          {DRAFT_STATUSES.map((s) => (
            <button key={s} onClick={() => onChange({ ...filter, status: filter.status === s ? 'all' : s })}
                    className={tab(filter.status === s)}>
              {STATUS_LABEL[s]} {counts[s]}
            </button>
          ))}
        </>
      )}
      <select value={filter.campaignId} onChange={(e) => onChange({ ...filter, campaignId: e.target.value })}
              aria-label="캠페인으로 거르기" className={`ml-auto ${select}`}>
        <option value="">모든 캠페인</option>
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">캠페인 없음</option>
      </select>
      <select value={filter.clientId} onChange={(e) => onChange({ ...filter, clientId: e.target.value })}
              aria-label="클라이언트로 거르기" className={select}>
        <option value="">모든 클라이언트</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">클라이언트 없음</option>
      </select>
    </div>
  );
}
```

- [ ] **Step 6: `DraftTable.tsx`** — 캠페인 열(클라이언트 다음, 비정렬)

57행 클라이언트 `<th>` 바로 아래에 추가:
```tsx
            {/* 캠페인 — 클라이언트 바로 다음: 둘 다 "어디 소속" 축. 정렬 없음(시술·형식과 같은 급, 캠페인 스펙 §4-3) */}
            <th className="px-3 py-2 font-normal">캠페인</th>
```
99행 클라이언트 `<td>` 바로 아래에 추가:
```tsx
              <td className="max-w-[180px] truncate whitespace-nowrap px-3 py-2 text-x-secondary" title={d.campaignName ?? undefined}>{d.campaignName ?? '—'}</td>
```

- [ ] **Step 7: `DraftWriteModal.tsx`** — `campaignId`·`campaignName` props, 저장 body, 승계 조건 한 줄

16-23행 props:
```tsx
export function DraftWriteModal({ clientId, clientName, procedureNames, procedureIds, campaignId, campaignName, onClose, onSaved }: {
  clientId: string | null;
  clientName: string | null;      // 표시용 — 모달이 clients 배열을 뒤지지 않게 이름만 받는다
  procedureNames: string[];       // 표시용
  procedureIds: string[];         // 저장용
  campaignId: string | null;      // /generate?campaign= 배너가 켜져 있으면 그 캠페인 소속으로 저장(캠페인 스펙 §4-1)
  campaignName: string | null;    // 표시용 — 승계 조건 줄에 "어느 캠페인에 들어가는지"가 저장 전에 보여야 한다
  onClose: () => void;
  onSaved: (created: DraftRow) => void;
}) {
```
34행 scope:
```tsx
  const scope = [campaignName ? `${campaignName} 캠페인` : null, clientName, ...procedureNames].filter(Boolean).join(' · ') || null;
```
57-62행 body에 한 줄:
```tsx
      body: JSON.stringify({
        posts: texts,
        // 빈 제목은 아예 싣지 않는다 — 목록 라벨은 본문 첫 줄로 폴백한다(draftLabel)
        ...(title.trim() ? { title: title.trim() } : {}),
        clientId, procedureIds,
        ...(campaignId ? { campaignId } : {}),   // 없으면 키 자체를 싣지 않는다(undefined = 소속 없음)
      }),
```

- [ ] **Step 8: `generate/page.tsx`**

(a) import 추가(30행 아래):
```tsx
import type { CampaignRow } from '@/lib/campaignStore';
import { fetchCampaigns } from '@/lib/campaignApi';
import type { DraftCost } from '@/lib/campaignCost';
import { kstToday } from '@/lib/datetime';
```

(b) 60행 필터 초기값:
```tsx
  const [filter, setFilter] = useState<DraftListFilter>({ status: 'all', clientId: '', campaignId: '' });
```

(c) 96행 `pinnedIds` 아래 상태 추가:
```tsx
  // 캠페인 — 목록은 카드 캠페인 칸·표 열·필터의 소스, campaignCtx는 ?campaign= 진입 시 "이 캠페인에 추가 중" 컨텍스트(캠페인 스펙 §4-1)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [campaignCtx, setCampaignCtx] = useState<CampaignRow | null>(null);
  const campaignLinkDone = useRef(false); // ?campaign= 소비 표시 — 클라·캠페인 목록이 다 온 뒤 1회만
  // '오늘'(서울)은 마운트 시 한 번 — 카드의 밀림 판정 기준. 렌더마다 시계를 읽지 않는다(react-hooks/purity)
  const [today] = useState(() => kstToday());
```

(d) 마운트 로드(159-185행)의 `apiFetch('/api/drafts/influencers')` 블록 아래에 추가:
```tsx
    // 캠페인 목록 — 카드 캠페인 칸·표 열·필터의 소스. 실패해도 원고 열람은 막지 않는다(캠페인 칸이 '없음'만 보인다).
    fetchCampaigns().then((r) => { if (r.ok) setCampaigns(r.data); setCampaignsLoaded(true); });
```

(e) 진입점 B(`?draft=`) 이펙트 아래에 새 이펙트 추가:
```tsx
  // 진입점 D: /generate?campaign=<id> — 캠페인 화면 [+ 원고 추가 → 새로 만들기]에서 진입(캠페인 스펙 §4-1).
  // 클라를 자동 선택하고 배너를 켠다; 이 상태에서 만든 원고(생성·직접 쓰기)는 campaignId가 실려 그 캠페인 소속으로 저장된다.
  // 클라·캠페인 목록이 둘 다 온 뒤 1회만 — composer.clientId를 세팅하려면 그 클라가 목록에 있어야 한다(유령 클라 정리 이펙트와 순서 충돌 방지).
  useEffect(() => {
    if (campaignLinkDone.current || !clientsLoaded || !campaignsLoaded) return;
    const target = searchParams.get('campaign');
    if (!target) return;
    campaignLinkDone.current = true;
    const row = campaigns.find((c) => c.id === target);
    if (!row) { setToast('링크가 가리키는 캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요'); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 딥링크 소비, 두 로드가 끝난 뒤 1회
    setCampaignCtx(row);
    setFilter((f) => ({ ...f, campaignId: row.id }));
    if (row.clientId && clients.some((c) => c.client.id === row.clientId)) {
      setComposer((cur) => (cur.clientId === row.clientId ? cur : { ...cur, clientId: row.clientId, procedureIds: [] }));
    }
    if (!panelOpenRef.current) setPanelPref('open');   // 만들러 왔으니 생성 패널을 펼친다(?ref=와 같은 규칙)
  }, [searchParams, clientsLoaded, campaignsLoaded, campaigns, clients]);

  // 배너 [해제] — 컨텍스트와 필터를 풀고 주소에서도 지운다(?draft= 동기화와 같은 replaceState 관례 — 라우터 리렌더 없이 주소만).
  function clearCampaignCtx() {
    setCampaignCtx(null);
    setFilter((f) => ({ ...f, campaignId: '' }));
    const url = new URL(window.location.href);
    url.searchParams.delete('campaign');
    window.history.replaceState(null, '', url);
  }
```

(f) `generate()`의 `src` 객체(352-358행)에 한 줄:
```tsx
        count: composer.count,
        ...(campaignCtx ? { campaignId: campaignCtx.id } : {}),   // 배너가 켜져 있으면 그 캠페인 소속으로
```

(g) 필터 호출 3곳 — 274-275행 `clientScoped`:
```tsx
  const clientScoped = useMemo(
    () => filterDrafts(drafts, { status: 'all', clientId: filter.clientId, campaignId: filter.campaignId }), [drafts, filter.clientId, filter.campaignId]);
```
280-281행 `visibleDrafts`:
```tsx
  const visibleDrafts = useMemo(
    () => filterDrafts(scoped, { status: filter.status, clientId: '', campaignId: '' }), [scoped, filter.status]);
```
287행 리셋 의존성에 `filter.campaignId` 추가: `}, [filter.status, filter.clientId, filter.campaignId, query, procFilter, period, view]);`
337행 `revealIfHidden` 리셋:
```tsx
      setFilter({ status: 'all', clientId: '', campaignId: '' });
```

(h) `assignInfluencer`(540-547행) 아래에 함수 3개 추가 — 같은 모양(낙관적 갱신 + 조건부 롤백):
```tsx
  // 캠페인 소속·예정일·비용 — 카드 캠페인 칸(DraftCard campaign prop)에서. assignInfluencer와 같은 모양. 값은 하나(§2-5): 캠페인 화면이 같은 컬럼을 본다.
  function changeCampaign(d: DraftRow, campaignId: string | null) {
    const camp = campaignId ? campaigns.find((c) => c.id === campaignId) ?? null : null;
    const prev = { campaignId: d.campaignId, campaignName: d.campaignName, campaignCode: d.campaignCode };
    const next = { campaignId, campaignName: camp?.name ?? null, campaignCode: camp?.nameEn ?? null };
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...next } : x)));
    void patchDraft(d.id, { campaignId }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.campaignId === campaignId ? { ...x, ...prev } : x)));
    });
  }
  function changeScheduledOn(d: DraftRow, scheduledOn: string | null) {
    const prev = d.scheduledOn;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, scheduledOn } : x)));
    void patchDraft(d.id, { scheduledOn }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.scheduledOn === scheduledOn ? { ...x, scheduledOn: prev } : x)));
    });
  }
  function changeCost(d: DraftRow, cost: DraftCost | null) {
    const prev = d.cost;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, cost } : x)));
    void patchDraft(d.id, { cost }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.cost === cost ? { ...x, cost: prev } : x)));
    });
  }
  // 두 DraftCard 호출부(카드 뷰·피크)가 같은 객체 모양을 넘긴다 — 한 곳에서 만든다
  const cardCampaign = (d: DraftRow) => ({
    options: campaigns, today,
    onChange: (id: string | null) => changeCampaign(d, id),
    onChangeScheduledOn: (next: string | null) => changeScheduledOn(d, next),
    onChangeCost: (next: DraftCost | null) => changeCost(d, next),
  });
```

(i) 툴바 — 683행 `{loaded && drafts.length > 0 && (` 블록 **위**에 배너 추가(원고 0건이어도 보여야 한다 — 만들러 온 상태):
```tsx
        {campaignCtx && (
          <div role="status" className="flex flex-wrap items-center gap-2 border-b border-x-blue/30 bg-x-blue/5 px-4 py-2 text-ui text-x-blue-text">
            <span><b>{campaignCtx.name}</b> 캠페인에 추가 중 — 지금 만드는 원고(생성·직접 쓰기)는 이 캠페인에 들어가요</span>
            <button onClick={clearCampaignCtx} className="ml-auto rounded-full border border-x-blue/40 px-2.5 py-0.5 text-ui hover:bg-white">해제</button>
          </div>
        )}
```
700-702행 DraftFilterBar에 `campaigns` 전달:
```tsx
                <DraftFilterBar counts={counts} total={scoped.length} filter={filter}
                                clients={clients.map(({ client }) => ({ id: client.id, name: client.name }))}
                                campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
                                onChange={setFilter} showStatusTabs={view !== 'kanban'} />
```

(j) DraftCard 두 호출(764-780행 카드 뷰, 827-843행 피크) 각각 `onDismissMediaDrop={…}` 줄 아래에:
```tsx
                       campaign={cardCampaign(d)} />
```
(피크는 `campaign={cardCampaign(peeked)} />`)

(k) DraftWriteModal(856-866행)에 두 prop:
```tsx
        <DraftWriteModal clientId={composer.clientId} procedureIds={composer.procedureIds}
                         clientName={writeScope.clientName} procedureNames={writeScope.procedureNames}
                         campaignId={campaignCtx?.id ?? null} campaignName={campaignCtx?.name ?? null}
```

- [ ] **Step 9: 타입·린트·테스트·화면 확인**

Run: `npx tsc --noEmit -p .` → 오류 0(`filterDrafts` 호출부가 전부 `campaignId`를 넘겨야 한다 — 빠진 곳이 있으면 여기서 잡힌다)
Run: `npm run lint` → 경고 24개(새 `eslint-disable` 1개는 실제로 걸리는 자리에만 — 걸리지 않으면 지시문을 지운다)
Run: `node --import tsx --env-file-if-exists=.env --test src/lib/draftUi.test.ts src/components/DraftCard.test.ts` → PASS
Run: `npm run build && npm run start -- -p 3001` → `/generate?campaign=<id>`: 배너 + 클라 자동 선택 + 표 필터 = 그 캠페인 → 직접 쓰기로 저장 → `/campaigns?id=<id>` 표에 뜬다. 표 보기에 "캠페인" 열, 필터 select에 캠페인 목록. 카드의 "캠페인: 없음 ▾"에서 소속 변경 → 캠페인 화면 반영.

- [ ] **Step 10: Commit**

```bash
git add src/lib/draftUi.ts src/lib/draftUi.test.ts src/components/DraftFilterBar.tsx src/components/DraftTable.tsx src/components/DraftWriteModal.tsx src/app/generate/page.tsx
git commit -m "feat(campaign): /generate ?campaign= 딥링크(클라 자동 선택·배너·생성/직접 쓰기 campaignId) + 카드 캠페인 칸 배선 + 표 캠페인 열·필터"
```

---

### Task 14: `renameInfluencer` 캠페인 비용 행 이관·병합(같은 트랜잭션) + 인플 프로필 "참여 캠페인" 섹션

**Parallel group:** G5 (G2+G3 후, Task 12·13과 병렬 — `src/components/*`·`src/app/generate/*`·`src/app/campaigns/*`를 건드리지 않는다. G4(Task 8~11)와도 파일이 겹치지 않는다)
**Suggested model:** sonnet

**Files:**
- Modify: `src/lib/influencerStore.ts:1-8`(import) · `:55-60`(`InfluencerDetail`) · `:176-209`(`getInfluencerDetail` 반환) · `:249-261`(`renameInfluencer` 교체 + 헬퍼 추가)
- Modify: `src/lib/influencerStore.test.ts:1-22`(import·정리 쿼리) · 파일 끝에 테스트 2개 추가
- Create: `src/app/influencers/CampaignSection.tsx`
- Modify: `src/app/influencers/InfluencerProfile.tsx:9-13`(import) · `:193-197`(`content` 패널)

**Interfaces:**
- Consumes: `listInfluencerCampaigns(sql, handle): Promise<InfluencerCampaignItem[]>`, `InfluencerCampaignItem { id; name; startsOn; endsOn; contentCount; subtotal: MoneyByCurrency }`, `createCampaign`, `upsertInfluencerCost`(Task 4) · 테이블 `campaign_influencer_cost`(Task 1 — `unique (campaign_id, lower(influencer_handle))`, `extra_costs jsonb`) · `formatMoneyBy`(Task 1) · `campaignStatus`, `CAMPAIGN_STATUS_LABEL`, `formatDateKo`(Task 2) · `kstToday`(`@/lib/datetime`) · `InfoTip`(`@/components/InfoTip`) · `createClient`(`./clientStore.ts`, 테스트) · 기존 `renameInfluencer` 호출부 `src/app/api/influencers/route.ts:54-69`(이미 `sql.begin` 안에서 부른다 — **수정 없음**)
- Produces (뒤 태스크가 import하는 것 없음 — koo QA가 검증):
  - `InfluencerDetail.campaigns: InfluencerCampaignItem[]`(`GET /api/influencers/[id]` 응답에 그대로 실린다 — 새 라우트 없음)
  - `renameInfluencer(sql, args)` 시그니처 불변, 동작 확장: `campaign_influencer_cost.influencer_handle`도 같은 sql(=트랜잭션)에서 새 핸들로 이관, 같은 캠페인에 새 핸들 행이 있으면 병합(스펙 §2-5 충돌 규칙)
  - `<CampaignSection campaigns={InfluencerCampaignItem[]} />` — 캠페인명 클릭 → `/campaigns?id=<id>`(Task 11 라우트 형식)

스펙 모호점 해소(이 계획의 결정): ① "참여 캠페인" 섹션의 자리 — main이 프로필을 3구역 탭(계정 정보·협업 콘텐츠·거래 정보, `src/lib/profileTabs.ts`)으로 나눴다. **협업 콘텐츠 탭 맨 위**(넘긴 원고 위)에 둔다: 캠페인은 이 사람에게 넘긴 콘텐츠의 묶음이고, 비용 소계는 파생 롤업일 뿐 거래 조건(단가)이 아니다. 거래 정보 탭은 단가·조건의 자리로 남긴다. ② 상세 응답에 싣는다(`InfluencerDetail.campaigns`) — 새 라우트·클라 fetch를 만들지 않는다(조회만, 로그 없음 §5). ③ 기간 문구는 Task 11의 `periodLabel`과 같은 모양(`8/24 월 ~ 8/30 일`)이지만 **G4와 병렬**이라 `campaignView.ts`를 import하지 않고 `formatDateKo`(Task 2)로 직접 조립한다. ④ 병합의 대소문자 — `from`·`to`가 소문자 기준 같으면(표기만 바뀜) 병합 없이 표기만 바꾼다(자기 자신과 조인해 extra_costs가 두 배가 되는 사고 방지). 라우트는 이 경우 renameInfluencer를 부르지 않지만 스토어가 스스로 안전해야 한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/influencerStore.test.ts`)

import(1-13행)에 두 줄 추가 — `from './draftStore.ts';` 줄 아래:
```ts
import { createClient } from './clientStore.ts';
import { createCampaign, upsertInfluencerCost } from './campaignStore.ts';
```

`after` 블록(19-24행)을 교체 — 캠페인은 비용 행을 cascade로 데려가고, 원고·캠페인의 클라 FK는 set null이라 순서는 무관:
```ts
after(async () => {
  await sql`delete from draft where lower(influencer_handle) like ${P.toLowerCase() + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from campaign where name like ${P + '%'}`;                   // 비용 행(campaign_influencer_cost)은 cascade
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer where lower(handle) like ${P.toLowerCase() + '%'}`; // 로그는 cascade
  await sql.end();
});
```

파일 끝에 추가:
```ts
// ── 캠페인 연결(캠페인 스펙 §2-5·§5) ──
const mkCampaign = (clientId: string, clientName: string, suffix: string) => createCampaign(sql, {
  clientId, clientName, name: P + '캠페인' + suffix, nameEn: `${P.toLowerCase()}-${suffix}`,
  startsOn: '2026-08-24', endsOn: '2026-08-30', kind: null, note: '', createdBy: null,
});
type CicRow = { influencer_handle: string; extra_costs: unknown; note: string };
const cicOf = (campaignId: string) => sql<CicRow[]>`
  select influencer_handle, extra_costs, note from campaign_influencer_cost where campaign_id = ${campaignId}`;

test('12) renameInfluencer: 캠페인 추가 비용 행도 새 핸들로 이관(단순 이동) + 참여 캠페인 조회가 새 핸들로 이어진다', async () => {
  const from = P + 'CostOld';
  const to = P + 'CostNew';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  assert.deepEqual((await getInfluencerDetail(sql, row.id))!.campaigns, []);   // 참여 전엔 빈 배열(null 아님)

  const c = await createClient(sql, P + '클라a');
  const camp = await mkCampaign(c.id, c.name, 'a');
  // 표기가 달라도(대문자) lower 기준으로 같은 사람의 행이다
  await upsertInfluencerCost(sql, camp.id, from.toUpperCase(), {
    extraCosts: [{ label: '교통비', amount: 20000, currency: 'KRW' }], note: '옛 메모',
  });

  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });

  const rows = await cicOf(camp.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].influencer_handle, to);                                   // 표기는 새 핸들 그대로
  assert.deepEqual(rows[0].extra_costs, [{ label: '교통비', amount: 20000, currency: 'KRW' }]);
  assert.equal(rows[0].note, '옛 메모');
  assert.equal((await sql`select id from campaign_influencer_cost where lower(influencer_handle) = ${from.toLowerCase()}`).length, 0);

  const detail = await getInfluencerDetail(sql, row.id);
  assert.deepEqual(detail!.campaigns.map((x) => x.id), [camp.id]);
  assert.equal(detail!.campaigns[0].contentCount, 0);                            // 원고 없이 비용만 — "배정 원고 없음"
  assert.deepEqual(detail!.campaigns[0].subtotal, { KRW: 20000 });
});

test('13) renameInfluencer: 같은 캠페인에 옛·새 핸들 행이 둘 다 있으면 병합 — extra_costs는 새 뒤에 옛, note는 새가 비었을 때만 옛, 옛 행 삭제', async () => {
  const from = P + 'MergeOld';
  const to = P + 'MergeNew';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  const c = await createClient(sql, P + '클라b');
  const campA = await mkCampaign(c.id, c.name, 'b');
  const campB = await mkCampaign(c.id, c.name, 'c');
  const campC = await mkCampaign(c.id, c.name, 'd');
  // A: 둘 다 있음 · 새 행 note 비어 있음 → 옛 note 승계
  await upsertInfluencerCost(sql, campA.id, from, { extraCosts: [{ label: '옛항목', amount: 1000, currency: 'KRW' }], note: '옛 메모' });
  await upsertInfluencerCost(sql, campA.id, to, { extraCosts: [{ label: '새항목', amount: 2000, currency: 'JPY' }] });
  // B: 둘 다 있음 · 새 행 note 있음 → 새 note 유지
  await upsertInfluencerCost(sql, campB.id, from, { note: '옛 메모', extraCosts: [{ label: '선물', amount: 300, currency: 'KRW' }] });
  await upsertInfluencerCost(sql, campB.id, to, { note: '새 메모' });
  // C: 옛 행만 → 단순 이관(병합 로직이 이걸 건드리면 안 된다)
  await upsertInfluencerCost(sql, campC.id, from, { note: 'C만' });

  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });   // unique 위반 없이 끝나야 한다

  const a = await cicOf(campA.id);
  assert.equal(a.length, 1);
  assert.equal(a[0].influencer_handle, to);
  assert.deepEqual(a[0].extra_costs, [
    { label: '새항목', amount: 2000, currency: 'JPY' }, { label: '옛항목', amount: 1000, currency: 'KRW' },
  ]);
  assert.equal(a[0].note, '옛 메모');

  const b = await cicOf(campB.id);
  assert.equal(b.length, 1);
  assert.equal(b[0].influencer_handle, to);
  assert.deepEqual(b[0].extra_costs, [{ label: '선물', amount: 300, currency: 'KRW' }]);   // 새 행 [] 뒤에 옛 것
  assert.equal(b[0].note, '새 메모');

  const cc = await cicOf(campC.id);
  assert.equal(cc.length, 1);
  assert.equal(cc[0].influencer_handle, to);
  assert.equal(cc[0].note, 'C만');

  assert.equal((await sql`select id from campaign_influencer_cost where lower(influencer_handle) = ${from.toLowerCase()}`).length, 0);
  // 참여 캠페인은 3개, 소계는 병합 후 값
  const detail = await getInfluencerDetail(sql, row.id);
  assert.equal(detail!.campaigns.length, 3);
  assert.deepEqual(detail!.campaigns.find((x) => x.id === campA.id)!.subtotal, { KRW: 1000, JPY: 2000 });
});

test('14) renameInfluencer: 표기만 바뀌면(소문자 기준 같음) 병합 없이 표기만 — extra_costs가 두 배가 되지 않는다', async () => {
  const from = P + 'casehandle';
  const to = P + 'CaseHandle';
  const { row } = await createInfluencer(sql, { handle: from, createdBy: null });
  const c = await createClient(sql, P + '클라c');
  const camp = await mkCampaign(c.id, c.name, 'e');
  await upsertInfluencerCost(sql, camp.id, from, { extraCosts: [{ label: '교통비', amount: 1, currency: 'KRW' }] });
  await renameInfluencer(sql, { influencerId: row.id, from, to, actorId: null });
  const rows = await cicOf(camp.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].influencer_handle, to);
  assert.deepEqual(rows[0].extra_costs, [{ label: '교통비', amount: 1, currency: 'KRW' }]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/influencerStore.test.ts`
Expected: FAIL — 12) `detail!.campaigns`가 `undefined`(`deepEqual` 실패) · 13) `renameInfluencer`가 unique 위반(23505 `idx_cic_campaign_handle_lower`)으로 reject, 또는 옛 핸들 행이 남아 `orphan` 길이 1

- [ ] **Step 3: `influencerStore.ts` — import·타입·상세**

import(8행 `analysisStats` 아래)에 추가 — `campaignStore`는 `draftStore·campaignJudgment·campaignCost·datetime`만 import하고 `influencerStore`를 모르므로 순환이 생기지 않는다:
```ts
import { listInfluencerCampaigns, type InfluencerCampaignItem } from './campaignStore.ts';
```

`InfluencerDetail`(55-60행) 교체:
```ts
export interface InfluencerDetail {
  influencer: InfluencerRow; logs: InfluencerLogRow[]; drafts: DraftRollupItem[];
  draftStatusCounts: Partial<Record<DraftStatus, number>>;  // 파생: lower 조인 group by status, 전체 기준(50건 롤업과 별개)
  // 단가·분석은 상세에만 싣는다 — 목록(InfluencerRow)까지 실으면 payload가 불필요하게 커진다.
  pricing: Pricing; analysis: InfluencerAnalysis | null; analyzedAt: string | null;
  // 참여 캠페인(캠페인 스펙 §5) — 원고가 배정됐거나 추가 비용 행이 있는 캠페인, 시작일 내림차순. 조회만, 로그 없음.
  // 상세에 싣는 이유: 프로필이 한 번의 GET으로 그려지고(탭 3개가 같은 data), 새 라우트·fetch를 만들 필요가 없다.
  campaigns: InfluencerCampaignItem[];
}
```

`getInfluencerDetail`(176-209행) — `extra` 조회(194-196행) 아래에 한 줄, 반환 객체 끝에 한 줄:
```ts
  const campaigns = await listInfluencerCampaigns(sql, influencer.handle);   // lower 기준 — 표기가 달라도 같은 사람
```
```ts
    analyzedAt: extra[0]?.analyzed_at ? new Date(extra[0].analyzed_at).toISOString() : null,
    campaigns,
  };
```

- [ ] **Step 4: `renameInfluencer` 교체 + 헬퍼** (249-261행 전체 교체)

```ts
// 개명 — 같은 사람이므로 이미 준 원고의 배정 사실은 그대로 따라간다 (스펙 §5).
// 트랜잭션으로 묶을지는 호출자가 정한다(라우트는 sql.begin 안에서 부른다) — 아래 세 UPDATE는 반드시 한 트랜잭션이어야 한다:
// 원고만 옮기고 비용 행이 남으면 캠페인 인플 목록에 옛 핸들 유령 줄("배정 원고 없음")이 생긴다(캠페인 스펙 §2-5).
export async function renameInfluencer(
  sql: postgres.Sql, args: { influencerId: string; from: string; to: string; actorId: string | null },
): Promise<void> {
  const { influencerId, from, to, actorId } = args;
  await sql`update influencer set handle = ${to} where id = ${influencerId}`;
  await sql`update draft set influencer_handle = ${to} where lower(influencer_handle) = ${from.toLowerCase()}`;
  await moveCampaignCostRows(sql, from, to);
  await insertAutoLog(sql, {
    influencerId, eventType: 'handle_changed', draftId: null, draftTitle: null,
    payload: { from, to }, authorId: actorId,
  });
}

// 캠페인 추가 비용 행(campaign_influencer_cost)의 핸들 이관. 같은 캠페인에 옛·새 핸들 행이 둘 다 있으면
// unique(campaign_id, lower(handle)) 위반이 나므로 병합한다(리뷰 Blocking 5): extra_costs는 새 행 뒤에 옛 것을 이어붙이고
// (jsonb 배열 ||), note는 새 행이 비어 있을 때만 옛 값, 옛 행은 삭제. 나머지 옛 행은 표기만 새 핸들로.
// from·to가 소문자 기준 같으면(표기만 바뀜) 병합 조인이 자기 자신과 맞아 extra_costs가 두 배가 된다 — 그 경우는 표기만 바꾼다.
async function moveCampaignCostRows(sql: postgres.Sql, from: string, to: string): Promise<void> {
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();
  if (fromLower !== toLower) {
    await sql`
      update campaign_influencer_cost n
         set extra_costs = n.extra_costs || o.extra_costs,
             note = case when n.note = '' then o.note else n.note end,
             updated_at = now()
        from campaign_influencer_cost o
       where o.campaign_id = n.campaign_id
         and lower(o.influencer_handle) = ${fromLower}
         and lower(n.influencer_handle) = ${toLower}`;
    await sql`
      delete from campaign_influencer_cost o
       where lower(o.influencer_handle) = ${fromLower}
         and exists (select 1 from campaign_influencer_cost n
                      where n.campaign_id = o.campaign_id and lower(n.influencer_handle) = ${toLower})`;
  }
  // 충돌이 없던(또는 병합으로 옛 행이 지워진 뒤 남은) 행은 표기만 새 핸들로
  await sql`
    update campaign_influencer_cost set influencer_handle = ${to}, updated_at = now()
     where lower(influencer_handle) = ${fromLower}`;
}
```

- [ ] **Step 5: 테스트 통과 + 회귀 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/influencerStore.test.ts src/lib/influencerSync.test.ts src/lib/campaignStore.test.ts`
Expected: 전부 PASS(influencerStore 새 3건 포함 — 기존 8) 개명 테스트도 그대로 통과). `npx tsc --noEmit -p .` 오류 0(`InfluencerDetail`을 받는 `AccountTab`·`DealTab`·`InfluencerProfile`은 필드가 늘어난 것뿐이라 그대로 컴파일된다).

- [ ] **Step 6: `CampaignSection.tsx`** (`src/app/influencers/CampaignSection.tsx` 생성)

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { InfoTip } from '@/components/InfoTip';
import type { InfluencerCampaignItem } from '@/lib/campaignStore';
import { campaignStatus, CAMPAIGN_STATUS_LABEL, formatDateKo, type CampaignStatus } from '@/lib/campaignJudgment';
import { formatMoneyBy } from '@/lib/campaignCost';
import { kstToday } from '@/lib/datetime';

// 인플 프로필 "참여 캠페인"(캠페인 스펙 §5) — 원고가 배정됐거나 추가 비용이 적힌 캠페인. 캠페인명·기간·배정 콘텐츠 n·비용 소계(통화별).
// 조회만: 값은 전부 서버 롤업(listInfluencerCampaigns)이고 여기서 다시 세지 않는다. 캠페인 클릭 → /campaigns?id=(Task 11 라우트 형식).
// 협업 콘텐츠 탭 맨 위 — 캠페인은 이 사람에게 넘긴 콘텐츠의 묶음이다(거래 정보 탭은 단가·조건의 자리).
// 가독성 기준(캠페인 스펙 §3-2): 본문 15px(text-content)·보조 13px(text-ui)·행 ≥48px(py-3) — text-caption(11px)은 쓰지 않는다.
const STATUS_STYLE: Record<CampaignStatus, string> = {
  upcoming: 'bg-x-blue/10 text-x-blue-text', active: 'bg-green-100 text-green-800', ended: 'bg-x-surface text-x-secondary',
};

export function CampaignSection({ campaigns }: { campaigns: InfluencerCampaignItem[] }) {
  // '오늘'(서울)은 마운트 시 한 번 — 렌더마다 시계를 읽지 않는다(react-hooks/purity, /campaigns page 관례)
  const [today] = useState(() => kstToday());
  return (
    <section className="mt-7 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="text-content font-bold">참여 캠페인</h2>
        <InfoTip text="이 계정에 원고가 배정됐거나 추가 비용이 적힌 캠페인을 모아 보여줘요. 캠페인을 누르면 캠페인 화면이 열려요." />
        {campaigns.length > 0 && <span className="text-ui text-x-muted">· {campaigns.length}개</span>}
      </div>
      {campaigns.length === 0 ? (
        <p className="mt-1 text-ui leading-relaxed text-x-muted">아직 참여한 캠페인이 없어요 — 캠페인 화면에서 원고에 이 계정을 배정하면 여기 모여요.</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {campaigns.map((c) => {
            const status = campaignStatus(c.startsOn, c.endsOn, today);
            return (
              <li key={c.id}>
                <Link href={`/campaigns?id=${c.id}`}
                      className="flex items-center gap-3 rounded-lg border border-x-border px-3 py-3 hover:bg-x-hover">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-content font-medium">{c.name}</span>
                    <span className="block text-ui text-x-muted">
                      {formatDateKo(c.startsOn)} ~ {formatDateKo(c.endsOn)} · 콘텐츠 {c.contentCount}개
                      {/* 돈이 붙었는데 원고가 없는 경우를 말로 드러낸다(캠페인 스펙 §2-4) */}
                      {c.contentCount === 0 && <span className="text-amber-800"> · 배정 원고 없음 — 추가 비용만</span>}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-ui font-bold ${STATUS_STYLE[status]}`}>{CAMPAIGN_STATUS_LABEL[status]}</span>
                  <span className="shrink-0 text-content tabular-nums" title="이 캠페인에서 이 사람의 콘텐츠 비용 + 추가 비용 — 통화가 다르면 따로 보여요">
                    {formatMoneyBy(c.subtotal)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 7: `InfluencerProfile.tsx` — 협업 콘텐츠 패널에 끼운다**

import(11행 `ContentTab` 아래)에 추가:
```tsx
import { CampaignSection } from './CampaignSection';
```
193-197행 `content` 패널 교체 — `[&>section:first-child]:mt-2`는 이제 CampaignSection에 걸리고, ContentTab의 `mt-7`(28px)이 두 섹션 사이 간격이 된다:
```tsx
                     // 세 탭의 첫 섹션이 탭 바에서 같은 거리에 서도록 위 여백만 맞춘다(ContentTab 자체는 불변).
                     // 참여 캠페인이 넘긴 원고 위 — 캠페인은 넘긴 콘텐츠의 묶음이라 큰 단위부터(캠페인 스펙 §5)
                     content: (
                       <div className="[&>section:first-child]:mt-2">
                         <CampaignSection campaigns={data.campaigns} />
                         <ContentTab drafts={data.drafts} draftCount={inf.draftCount} />
                       </div>
                     ),
```

- [ ] **Step 8: 타입·린트·화면 확인**

Run: `npx tsc --noEmit -p .` → 오류 0
Run: `npm run lint` → 경고 24개(기준선), 오류 0. `grep -n "text-caption\|text-\[1[01]px\]" src/app/influencers/CampaignSection.tsx` 0건.
Run: `npm run build && npm run start -- -p 3001` → `http://127.0.0.1:3001/influencers?i=<id>&tab=content`: "참여 캠페인" 섹션이 넘긴 원고 위에 보이고, 캠페인 화면에서 원고에 이 핸들을 배정한 뒤 새로고침하면 줄이 생긴다 · 클릭 → `/campaigns?id=`로 이동 · 참여 없는 인플은 빈 안내 한 줄. 개명 시나리오: 캠페인에 추가 비용을 적은 핸들을 `/influencers`에서 새 핸들로 추가(같은 X 계정 → 개명 플로우) → 캠페인 화면 인플별 비용 표에 새 핸들 한 줄만 남고 옛 핸들 줄이 없다.

- [ ] **Step 9: Commit**

```bash
git add src/lib/influencerStore.ts src/lib/influencerStore.test.ts src/app/influencers/CampaignSection.tsx src/app/influencers/InfluencerProfile.tsx
git commit -m "feat(campaign): 핸들 변경 시 캠페인 추가 비용 행 이관·충돌 병합(같은 트랜잭션) + 인플 프로필 '참여 캠페인' 섹션(상세 응답에 롤업)"
```

---

### Task 15: `campaignCalendar.ts` + `WeekCalendar.tsx`(주간 달력·드래그로 예정일 변경) + [표 | 주간 달력] 세그먼트(localStorage 기억) + 캠페인 화면 DraftCard `campaign` prop 배선

**Parallel group:** G6 (전부 끝난 뒤 — Task 10·11·12의 파일을 수정하므로 마지막)
**Suggested model:** opus

**Files:**
- Create: `src/lib/campaignCalendar.ts`
- Test: `src/lib/campaignCalendar.test.ts`
- Create: `src/app/campaigns/WeekCalendar.tsx`
- Modify: `src/app/campaigns/CampaignDetail.tsx`(Task 10 작성분 — import · props 시그니처 · 상태 · 표 자리 → 세그먼트+분기 · DraftCard `campaign` prop)
- Modify: `src/app/campaigns/page.tsx`(Task 11 작성분 — import · 보기 상태(localStorage) · `CampaignDetail` 호출)

**Interfaces:**
- Consumes: `CampaignDraftItem`, `CampaignRow`(Task 4) · `weekStartOf`, `weekDays`, `addDays`, `initialWeekStart`, `formatDateKo`, `isOutOfRange`, `sortContent`, `contentStage`, `STAGE_LABEL`, `SortInput`, `ContentStage`(Task 2) · `overdueDays`(Task 8 `@/lib/campaignTableView`) · `DetailView`, `DETAIL_VIEW_KEY`, `parseDetailView`(Task 11 `@/lib/campaignView`) · `weekRangeLabel`, `asDateOnly`(`@/lib/datetime`) · `draftLabel`(`@/lib/draftViews`) · `useCampaignDraftActions()`의 `changeScheduledOn`·`changeCost`·`moveToCampaign`(Task 10 — 낙관적 갱신·실패 시 롤백+토스트가 이미 들어 있다) · DraftCard `campaign?: { options; today; onChange; onChangeScheduledOn; onChangeCost }`(Task 12) · `CampaignDetail`의 `campaigns: CampaignRow[]` prop(Task 10이 선언만, Task 11 page가 `campaigns={rows}`로 이미 넘긴다)
- Produces: 뒤 태스크 없음 — koo QA가 검증. 이 태스크로 스펙 §3-2 주간 달력·§4-2 "캠페인 화면 카드에 캠페인·예정일·비용 칸"·§7 "드래그 실패 → 원위치 + 토스트"가 닫힌다.

스펙 모호점 해소(이 계획의 결정): ① "7일 이하면 한 주, 넘으면 ◀ ▶ 넘김" — 열이 월~일 고정이라 수~화 7일짜리 캠페인은 한 줄에 못 들어간다. **넘김 표시 기준 = 캠페인 기간(∪ 예정일이 찍힌 날들)이 월~일 주 하나에 들어가는지**로 둔다(`isSingleWeek`). ② 넘김 범위 = 기간의 주들 ∪ 예정일이 찍힌 주들 — 기간 밖 예정일 카드도 어느 주엔가 보여야 "기간 밖" 배지(§3-2)가 의미가 있다. 예정일이 지워져 범위가 줄어 현재 주가 밖으로 나가면 가장 가까운 경계 주로 붙인다(`clampWeek`). ③ 달력 카드의 단계 칩은 **읽기 전용 배지**(누를 수 없는 모양) — 상태 변경은 표의 칩과 카드(DraftCard)에서 한다. 카드를 누르면 원고가 열리므로 칩까지 누를 수 있으면 두 동작이 겹친다(거짓 어포던스 방지). ④ 드래그 불가 환경(터치·키보드)의 대체 경로 = 카드 클릭 → DraftCard의 예정일 칸(이 태스크의 `campaign` prop 배선) — 도움말 한 줄로 알린다. ⑤ [표 | 주간 달력] 상태는 `page.tsx`가 쥐고 localStorage에 저장 — `CampaignDetail`은 `key={picked.id}`로 캠페인마다 다시 마운트되므로 상태를 거기 두면 캠페인을 바꿀 때마다 저장값을 다시 읽어야 한다.

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/campaignCalendar.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekColumns, weekBounds, isSingleWeek, prevWeek, nextWeek, clampWeek, weekLabel } from './campaignCalendar.ts';
import type { SortInput } from './campaignJudgment.ts';

const T = '2026-08-27'; // 목
const s = (o: Partial<SortInput> & { createdAt: string }): SortInput =>
  ({ status: 'draft', published: false, scheduledOn: null, influencerHandle: null, ...o });

test('1) weekColumns — 월~일 7열 + 예정일 없음, 다른 주 카드는 제외, 열 안은 생성순·미사용 맨 아래', () => {
  const rows = [
    s({ scheduledOn: '2026-08-26', createdAt: 'b' }),
    s({ scheduledOn: '2026-08-26', createdAt: 'a' }),
    s({ scheduledOn: '2026-08-26', status: 'unused', createdAt: '0' }),   // 같은 날이지만 맨 아래
    s({ scheduledOn: '2026-09-02', createdAt: 'c' }),                     // 다음 주 — 이 주엔 안 보인다
    s({ scheduledOn: null, createdAt: 'd' }),
    s({ scheduledOn: null, createdAt: 'e', status: 'unused' }),
  ];
  const cols = weekColumns(rows, '2026-08-24', T);
  assert.deepEqual(cols.days.map((d) => d.date), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
  assert.deepEqual(cols.days[2].items.map((r) => r.createdAt), ['a', 'b', '0']);
  assert.equal(cols.days.flatMap((d) => d.items).length, 3);
  assert.deepEqual(cols.unscheduled.map((r) => r.createdAt), ['d', 'e']);
});

test('2) weekBounds — 기간의 주 ∪ 예정일의 주, 단일 주 판정', () => {
  assert.deepEqual(weekBounds('2026-08-24', '2026-08-30', []), { first: '2026-08-24', last: '2026-08-24' });
  assert.equal(isSingleWeek(weekBounds('2026-08-24', '2026-08-30', [null, '2026-08-28'])), true);
  assert.equal(isSingleWeek(weekBounds('2026-08-26', '2026-09-01', [])), false);            // 수~화 7일 — 두 주에 걸친다
  assert.deepEqual(weekBounds('2026-08-24', '2026-09-06', ['2026-09-09', '2026-08-20', null]),
    { first: '2026-08-17', last: '2026-09-07' });                                            // 기간 밖 예정일도 닿을 수 있어야 한다
});

test('3) prev/next — 경계에서 null, clamp는 가장 가까운 경계 주로', () => {
  const b = { first: '2026-08-24', last: '2026-09-07' };
  assert.equal(prevWeek('2026-08-24', b), null);
  assert.equal(nextWeek('2026-08-24', b), '2026-08-31');
  assert.equal(nextWeek('2026-09-07', b), null);
  assert.equal(prevWeek('2026-09-07', b), '2026-08-31');
  assert.equal(clampWeek('2026-08-10', b), '2026-08-24');
  assert.equal(clampWeek('2026-09-21', b), '2026-09-07');
  assert.equal(clampWeek('2026-08-31', b), '2026-08-31');
});

test('4) weekLabel — datetime.weekRangeLabel 연계(월 경계 포함)', () => {
  assert.equal(weekLabel('2026-08-24'), '8/24~30 주');
  assert.equal(weekLabel('2026-08-31'), '8/31~9/6 주');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCalendar.test.ts`
Expected: FAIL — `Cannot find module './campaignCalendar.ts'`

- [ ] **Step 3: 구현** (`src/lib/campaignCalendar.ts`)

```ts
// 주간 달력의 순수 계산(스펙 §3-2 주간 달력) — 열 배분·넘김 범위·주 라벨. DOM 없음, 컴포넌트는 결과를 그릴 뿐이다.
// 날짜는 전부 'YYYY-MM-DD'(date-only) — 산술은 campaignJudgment의 헬퍼, 라벨은 datetime.weekRangeLabel(스펙 §8 "주 범위 계산 연계").
import { weekStartOf, weekDays, addDays, sortContent, type SortInput } from './campaignJudgment.ts';
import { weekRangeLabel, asDateOnly } from './datetime.ts';

export interface DayColumn<T> { date: string; items: T[] }
export interface WeekColumns<T> { days: DayColumn<T>[]; unscheduled: T[] }
export interface WeekBounds { first: string; last: string }   // 넘길 수 있는 첫·마지막 주(월요일)

// 월~일 7열 + 예정일 없음. 다른 주의 카드는 이 주에 없다(넘김으로 간다). 열 안 순서는 sortContent('scheduled') —
// 같은 날이라 생성순이 되고 미사용은 맨 아래(표와 같은 규칙, 흐린 카드가 중간에 끼지 않게).
export function weekColumns<T extends SortInput>(items: T[], weekStart: string, today: string): WeekColumns<T> {
  const sorted = sortContent(items, 'scheduled', today);
  return {
    days: weekDays(weekStart).map((date) => ({ date, items: sorted.filter((d) => d.scheduledOn === date) })),
    unscheduled: sorted.filter((d) => d.scheduledOn === null),
  };
}

// 넘김 범위 = 캠페인 기간의 주들 ∪ 예정일이 찍힌 주들. 기간 밖 예정일도 어느 주엔가 보여야 '기간 밖' 배지가 뜬다.
export function weekBounds(startsOn: string, endsOn: string, scheduled: Array<string | null>): WeekBounds {
  let first = weekStartOf(startsOn);
  let last = weekStartOf(endsOn);
  for (const s of scheduled) {
    if (s === null) continue;
    const w = weekStartOf(s);
    if (w < first) first = w;
    if (w > last) last = w;
  }
  return { first, last };
}
// 한 주에 다 들어가면 ◀ ▶를 그리지 않는다(스펙 §3-2 "7일 이하면 한 주" — 열이 월~일 고정이라 주 단위로 판정한다)
export function isSingleWeek(b: WeekBounds): boolean {
  return b.first === b.last;
}
export function prevWeek(weekStart: string, b: WeekBounds): string | null {
  const p = addDays(weekStart, -7);
  return p < b.first ? null : p;
}
export function nextWeek(weekStart: string, b: WeekBounds): string | null {
  const n = addDays(weekStart, 7);
  return n > b.last ? null : n;
}
// 보고 있던 주가 범위 밖으로 나가면(예정일 지움·기간 축소) 가장 가까운 경계 주로 — 빈 달력에 갇히지 않게
export function clampWeek(weekStart: string, b: WeekBounds): string {
  if (weekStart < b.first) return b.first;
  if (weekStart > b.last) return b.last;
  return weekStart;
}
/** '8/24~30 주' · 월이 바뀌면 '8/31~9/6 주' — 넘김 헤더 */
export function weekLabel(weekStart: string): string {
  return `${weekRangeLabel(asDateOnly(weekStart))} 주`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCalendar.test.ts`
Expected: PASS 4건

- [ ] **Step 5: `WeekCalendar.tsx`** (`src/app/campaigns/WeekCalendar.tsx` 생성) — 네이티브 HTML5 드래그(새 의존성 0)

```tsx
'use client';
import { useState } from 'react';
import type { CampaignDraftItem, CampaignRow } from '@/lib/campaignStore';
import { isOutOfRange, formatDateKo, contentStage, STAGE_LABEL, type ContentStage } from '@/lib/campaignJudgment';
import { overdueDays } from '@/lib/campaignTableView';
import { weekColumns, weekBounds, isSingleWeek, prevWeek, nextWeek, clampWeek, weekLabel } from '@/lib/campaignCalendar';
import { draftLabel } from '@/lib/draftViews';

// 주간 달력(스펙 §3-2) — 월~일 7열 + "예정일 없음"(오른쪽, 점선). 카드 = 제목(2줄 말줄임) · @핸들 · 단계 배지. 밀린 카드 빨간 막대 + "n일 지남",
// 오늘 헤더 파란 강조, 기간 밖 카드 "기간 밖" 배지. 카드를 끌어 열에 놓으면 예정일이 바뀐다(요일 ↔ 예정일 없음 포함) —
// 저장은 부모의 changeScheduledOn(PATCH scheduled_on, 낙관적 갱신 + 실패 시 원위치 + 토스트, §7). 새 의존성 없이 HTML5 DnD.
// 판정(밀림·기간 밖·단계)은 표와 같은 함수 — 표와 달력이 다른 말을 하면 안 된다. 가독성: 제목 15px·보조 13px·카드 ≥48px·열 간격 12px.
const NONE = '__none__';   // 예정일 없음 열의 drop 키
const STAGE_STYLE: Record<ContentStage, string> = {
  draft: 'border-x-border-strong bg-white text-x-secondary',
  review: 'border-amber-300 bg-amber-100 text-amber-800',
  approved: 'border-x-blue/40 bg-x-blue/10 text-x-blue-text',
  delivered: 'border-green-300 bg-green-100 text-green-800',
  unused: 'border-x-border-strong bg-x-border/40 text-x-muted',
  published: 'border-green-600 bg-green-600 text-white',
};

export function WeekCalendar({ rows, campaign, today, weekStart, onWeekChange, onOpenDraft, onChangeScheduledOn }: {
  rows: CampaignDraftItem[];
  campaign: CampaignRow; today: string;          // today = 서버 detail.today(서울)
  weekStart: string;                              // 보고 있는 주의 월요일 — 부모가 쥔다(initialWeekStart로 시작)
  onWeekChange: (weekStart: string) => void;
  onOpenDraft: (id: string) => void;
  onChangeScheduledOn: (d: CampaignDraftItem, next: string | null) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const bounds = weekBounds(campaign.startsOn, campaign.endsOn, rows.map((r) => r.scheduledOn));
  const ws = clampWeek(weekStart, bounds);
  const cols = weekColumns(rows, ws, today);
  const prev = prevWeek(ws, bounds);
  const next = nextWeek(ws, bounds);

  // drop 대상 열 — 날짜 문자열 또는 NONE(예정일 없음). 같은 열에 놓으면 PATCH하지 않는다.
  function drop(e: React.DragEvent, target: string | null) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null); setOverKey(null);
    const d = rows.find((x) => x.id === id);
    if (!d || d.scheduledOn === target) return;
    onChangeScheduledOn(d, target);
  }
  const columnProps = (key: string, target: string | null) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overKey !== key) setOverKey(key); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverKey((k) => (k === key ? null : k)); },
    onDrop: (e: React.DragEvent) => drop(e, target),
  });

  const card = (d: CampaignDraftItem) => {
    const od = overdueDays(d, today);
    const stage = contentStage(d);
    const unused = d.status === 'unused';
    return (
      // button이 draggable — 클릭은 원고 열기, 끌기는 예정일 변경. 텍스트 선택은 draggable이 막아 표의 opensCard 판정이 필요 없다.
      <button key={d.id} type="button" draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; setDragId(d.id); }}
              onDragEnd={() => { setDragId(null); setOverKey(null); }}
              onClick={() => onOpenDraft(d.id)}
              title="누르면 원고가 열려요 · 끌어서 다른 요일에 놓으면 예정일이 바뀌어요"
              className={`block w-full min-h-12 cursor-grab rounded-lg border px-3 py-2 text-left active:cursor-grabbing ${
                od !== null ? 'border-red-200 bg-red-50 shadow-[inset_3px_0_0_0_#dc2626]' : 'border-x-border bg-white hover:bg-x-hover'} ${
                unused ? 'opacity-60' : ''} ${dragId === d.id ? 'opacity-40' : ''}`}>
        <span className="line-clamp-2 text-content font-medium">{draftLabel(d).text}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-ui text-x-muted">
          <span>{d.influencerHandle ? `@${d.influencerHandle}` : '미배정'}</span>
          <span className={`rounded-full border px-2 py-0.5 font-bold ${STAGE_STYLE[stage]}`}>{STAGE_LABEL[stage]}</span>
          {od !== null && <span className="font-bold text-red-700">{od}일 지남</span>}
          {isOutOfRange(d.scheduledOn, campaign.startsOn, campaign.endsOn) && (
            <span className="rounded bg-amber-100 px-1 text-amber-800" title="캠페인 기간 밖 날짜예요 — 저장은 되지만 표시로 알려요">기간 밖</span>
          )}
        </span>
      </button>
    );
  };
  const columnBox = (key: string, dashed = false) =>
    `flex min-h-[220px] flex-col gap-2 rounded-xl border p-2 transition-colors ${dashed ? 'border-dashed' : ''} ${
      overKey === key ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface/60'}`;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center gap-2">
        {!isSingleWeek(bounds) && (
          <>
            <button type="button" onClick={() => prev && onWeekChange(prev)} disabled={!prev} aria-label="이전 주"
                    className="h-8 w-8 rounded-full border border-x-border-strong text-ui hover:bg-x-hover disabled:opacity-30">◀</button>
            <span className="text-content font-bold tabular-nums">{weekLabel(ws)}</span>
            <button type="button" onClick={() => next && onWeekChange(next)} disabled={!next} aria-label="다음 주"
                    className="h-8 w-8 rounded-full border border-x-border-strong text-ui hover:bg-x-hover disabled:opacity-30">▶</button>
          </>
        )}
        {isSingleWeek(bounds) && <span className="text-content font-bold tabular-nums">{weekLabel(ws)}</span>}
      </div>
      <p className="mt-1.5 text-ui text-x-muted">카드를 끌어 요일에 놓으면 예정일이 바뀌어요(오른쪽 '예정일 없음'으로도). 카드를 누르면 원고가 열리고, 거기서도 예정일을 고칠 수 있어요.</p>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-x-border bg-x-surface px-4 py-6 text-center text-content text-x-secondary">
          아직 이 캠페인에 원고가 없어요 — 위의 [+ 원고 추가]로 기존 원고를 넣거나 새로 만들어요.
        </p>
      ) : (
        <div className="mt-3 w-full overflow-x-auto">
          {/* 8열: 요일 7 + 예정일 없음. 최소 폭을 두어 좁은 창에서는 가로 스크롤 — 카드 글자를 줄이지 않는다(가독성 기준) */}
          <div className="grid min-w-[1080px] grid-cols-[repeat(7,minmax(0,1fr))_minmax(150px,0.9fr)] gap-3">
            {cols.days.map((col) => {
              const isToday = col.date === today;
              return (
                <div key={col.date}>
                  <p className={`mb-1.5 px-1 text-ui ${isToday ? 'font-bold text-x-blue-text' : 'text-x-secondary'}`}>
                    {formatDateKo(col.date)}{isToday && <span className="ml-1 rounded bg-x-blue/10 px-1">오늘</span>}
                    {col.items.length > 0 && <span className="ml-1 text-x-muted">{col.items.length}</span>}
                  </p>
                  <div {...columnProps(col.date, col.date)} className={columnBox(col.date)} aria-label={`${formatDateKo(col.date)} 예정`}>
                    {col.items.map(card)}
                  </div>
                </div>
              );
            })}
            <div>
              <p className="mb-1.5 px-1 text-ui text-x-secondary">
                예정일 없음{cols.unscheduled.length > 0 && <span className="ml-1 text-x-muted">{cols.unscheduled.length}</span>}
              </p>
              <div {...columnProps(NONE, null)} className={columnBox(NONE, true)} aria-label="예정일 없음">
                {cols.unscheduled.map(card)}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: `CampaignDetail.tsx` 수정** (Task 10 작성분)

(a) import — `useCampaignDraftActions` import 아래에 추가하고, `campaignJudgment` import에 `initialWeekStart`를 더한다:
```tsx
import type { DetailView } from '@/lib/campaignView';
import { WeekCalendar } from './WeekCalendar';
```
```tsx
import {
  summarizeStages, summarizePerf, deriveInfluencers, campaignTotal, initialWeekStart, type ContentSortKey, type StageFilter,
} from '@/lib/campaignJudgment';
```

(b) 시그니처 교체 — `campaigns`를 이제 읽고, 보기 상태는 부모가 준다:
```tsx
export function CampaignDetail({ id, campaigns, view, onViewChange, onChanged, onDeleted }: {
  id: string;
  campaigns: CampaignRow[];   // 전 캠페인 목록 — DraftCard `campaign` prop(다른 캠페인으로 옮기기)의 후보
  view: DetailView;           // [표 | 주간 달력] — page가 쥐고 localStorage에 기억한다(캠페인을 바꿔도 유지)
  onViewChange: (v: DetailView) => void;
  onChanged: () => void;      // 목록(왼쪽) 새로고침 — 이름·콘텐츠 수·합계가 바뀌면 목록 보조줄도 움직여야 한다
  onDeleted: () => void;
}) {
```

(c) 상태 — `const [filter, setFilter] = useState<StageFilter>('all');` 아래에 추가:
```tsx
  // 달력의 주 — null이면 initialWeekStart(오늘이 기간 안이면 오늘의 주, 아니면 시작 주). 넘기면 값이 생긴다.
  const [weekStart, setWeekStart] = useState<string | null>(null);
```

(d) JSX — `<ContentTable … onLinkPost={setLinkFor} />` 블록 전체를 아래로 교체(세그먼트 + 분기). `[&>section]:mt-3`으로 ContentTable/WeekCalendar 자체의 `mt-8`을 세그먼트 아래 12px로 줄인다(두 컴포넌트는 손대지 않는다):
```tsx
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="콘텐츠 보기" className="inline-flex rounded-full border border-x-border-strong p-0.5">
          {(['table', 'calendar'] as DetailView[]).map((v) => (
            <button key={v} type="button" onClick={() => onViewChange(v)} aria-pressed={view === v}
                    className={`h-8 rounded-full px-3.5 text-ui ${view === v ? 'bg-x-text font-bold text-white' : 'text-x-secondary hover:bg-x-hover'}`}>
              {v === 'table' ? '표' : '주간 달력'}
            </button>
          ))}
        </div>
        <span className="text-ui text-x-muted">표는 밀린 것부터 한눈에, 달력은 요일별로 — 마지막에 고른 보기를 기억해요</span>
      </div>
      <div className="[&>section]:mt-3">
        {view === 'table' ? (
          <ContentTable rows={data.drafts} campaign={data.campaign} today={data.today} influencerOptions={influencerOptions}
                        sort={sort} onSortChange={setSort} filter={filter} onFilterChange={setFilter}
                        onOpenDraft={setPeekId}
                        onChangeStatus={(d, s) => void actions.changeStatus(d, s)}
                        onAssignInfluencer={(d, h) => void actions.assignInfluencer(d, h)}
                        onChangeScheduledOn={(d, next) => void actions.changeScheduledOn(d, next)}
                        onChangeCost={(d, next) => void actions.changeCost(d, next)}
                        onRemoveFromCampaign={(d) => {
                          if (window.confirm(`'${draftLabel(d).text}'을(를) 캠페인에서 뺄까요?\n\n원고는 남고 소속만 풀려요. 예정일·비용도 원고에 남아요.`)) void actions.removeFromCampaign(d);
                        }}
                        onLinkPost={setLinkFor} />
        ) : (
          // 드래그 저장 = 표와 같은 changeScheduledOn — 실패하면 apply가 카드를 원위치로 되돌리고 서버 문구를 토스트로 띄운다(§7)
          <WeekCalendar rows={data.drafts} campaign={data.campaign} today={data.today}
                        weekStart={weekStart ?? initialWeekStart(data.campaign.startsOn, data.campaign.endsOn, data.today)}
                        onWeekChange={setWeekStart} onOpenDraft={setPeekId}
                        onChangeScheduledOn={(d, next) => void actions.changeScheduledOn(d, next)} />
        )}
      </div>
```

(e) DraftCard 호출 — `onDismissMediaDrop={() => setMediaDrop(null)} />`를 아래로 교체(§4-2 "예정일·비용 칸도 캠페인 소속일 때 카드에 함께 표시 — 값은 하나"):
```tsx
                       onDismissMediaDrop={() => setMediaDrop(null)}
                       campaign={{
                         options: campaigns, today: data.today,
                         // 다른 캠페인으로 옮기면(또는 없음) 이 화면에서 사라진다 — 카드를 먼저 닫는다. 같은 캠페인이면 moveToCampaign이 no-op.
                         onChange: (campaignId) => { if (campaignId !== data.campaign.id) setPeekId(null); void actions.moveToCampaign(peeked, campaignId); },
                         onChangeScheduledOn: (next) => void actions.changeScheduledOn(peeked, next),
                         onChangeCost: (next) => void actions.changeCost(peeked, next),
                       }} />
```

- [ ] **Step 7: `page.tsx` 수정** (Task 11 작성분) — 보기 상태 + localStorage

(a) import 교체:
```tsx
import { pickCampaignId, parseDetailView, DETAIL_VIEW_KEY, type DetailView } from '@/lib/campaignView';
```

(b) `CampaignsSplit` 밖(파일 상단 `export default` 위)에 헬퍼 — TrackingTable `loadStoredWidths`와 같은 태도:
```tsx
// [표 | 주간 달력] 마지막 선택(스펙 §3-2) — 작업 방식 선호라 기억한다(TrackingTable 열 폭 저장 관례). 서버 렌더(localStorage 없음)·
// 접근 거부·손상 값은 전부 기본 '표'. 서버와 첫 클라 렌더가 달라도 hydration 불일치는 없다 — 이 값으로 그리는 CampaignDetail은
// 목록 fetch 뒤(loaded)에만 마운트된다.
function readDetailView(): DetailView {
  try { return parseDetailView(localStorage.getItem(DETAIL_VIEW_KEY)); } catch { return 'table'; }
}
function saveDetailView(v: DetailView) {
  try { localStorage.setItem(DETAIL_VIEW_KEY, v); } catch { /* 저장 못 해도 화면은 동작 */ }
}
```

(c) `const [today] = useState(() => kstToday());` 아래에 상태 추가:
```tsx
  const [view, setView] = useState<DetailView>(() => readDetailView());
  const changeView = useCallback((v: DetailView) => { setView(v); saveDetailView(v); }, []);
```

(d) `CampaignDetail` 호출 교체:
```tsx
        {picked.id && (
          <CampaignDetail key={picked.id} id={picked.id} campaigns={rows} view={view} onViewChange={changeView}
                          onChanged={() => void load()}
                          onDeleted={() => { router.replace(pathname, { scroll: false }); void load(); }} />
        )}
```

- [ ] **Step 8: 타입·린트·테스트·빌드·화면 확인**

Run: `npx tsc --noEmit -p .` → 오류 0(`CampaignDetail`의 새 필수 prop `view`/`onViewChange`를 page가 넘긴다 — 빠지면 여기서 잡힌다)
Run: `npm run lint` → 경고 24개(기준선), 오류 0. `grep -n "text-caption\|text-\[1[01]px\]" src/app/campaigns/WeekCalendar.tsx src/app/campaigns/CampaignDetail.tsx` 0건.
Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCalendar.test.ts src/lib/campaignJudgment.test.ts src/lib/campaignView.test.ts` → PASS
Run: `npm test` → 전체 PASS(약 4분, 실 DB — 마지막 태스크라 여기서 한 번 전량)
Run: `npm run build && npm run start -- -p 3001` → `http://127.0.0.1:3001/campaigns` 확인 항목:
  1. 세그먼트 [표 | 주간 달력] 기본 표 → 달력으로 바꾸고 새로고침·다른 캠페인 선택해도 달력 유지(localStorage `campaign-detail-view`)
  2. 달력: 오늘 열 파란 강조 · 예정일 없는 원고는 오른쪽 점선 열 · 밀린 카드 빨간 막대 + "n일 지남" · 기간 밖 예정일 카드에 "기간 밖" 배지 · 2주 이상 캠페인에서 ◀ ▶ 넘김(경계에서 비활성), 한 주짜리는 넘김 없음
  3. 카드를 다른 요일에 끌어 놓기 → 카드가 옮겨지고 표로 바꾸면 예정일이 바뀌어 있다 · '예정일 없음' 열로 끌기 → 예정일 지움
  4. DevTools Network **Offline**으로 놓고 끌기 → 카드가 원래 열로 돌아오고 토스트("네트워크 오류가 났어요 …")
  5. 카드 클릭 → DraftCard에 "캠페인: {이름} ▾"·예정일·비용 칸이 보인다 → 예정일을 카드에서 바꾸면 달력·표에 반영 → 캠페인을 다른 것으로 바꾸면 카드가 닫히고 이 캠페인에서 사라지며 토스트
  6. `/generate` 카드(Task 13 배선)와 같은 칸이 같은 값을 보인다(값은 하나)

- [ ] **Step 9: Commit**

```bash
git add src/lib/campaignCalendar.ts src/lib/campaignCalendar.test.ts src/app/campaigns/WeekCalendar.tsx src/app/campaigns/CampaignDetail.tsx src/app/campaigns/page.tsx
git commit -m "feat(campaign): 주간 달력(월~일+예정일 없음, 드래그로 예정일 변경, 넘김) + [표|주간 달력] 세그먼트(마지막 선택 기억) + 캠페인 화면 DraftCard 캠페인·예정일·비용 칸 배선"
```

---

## 스펙 커버리지 (자기 점검 — 스펙 §번호 → 구현 Task)

| 스펙 | Task |
|---|---|
| §2-1 `campaign` 테이블·인덱스·이름/코드 기본 제안 | 1(DDL) · 2(`suggestCampaignName/Code`) · 4(CRUD) · 6(검증·라우트) |
| §2-2 `campaign_influencer_cost`(명단 아님, 처음 적을 때 행 생성) | 1 · 4(`upsertInfluencerCost`) · 7(PUT) · 9(표 UI) · 14(핸들 변경 이관·병합) |
| §2-3 `draft` 3컬럼 · case-when 패치 규칙 · bulk `campaignId` + 400 가드 확장 | 1 · 3 · 5 |
| §2-4 파생값 전부(단계 승격·밀림·준비 중·N 미사용 제외·기간 밖·캠페인 상태·인플 목록·소계·합계·성과) | 2(순수 함수) · 4(서버 요약·lateral·링크 클릭) · 8·9·10(클라 표시가 같은 함수) |
| §2-5 값은 하나(캠페인 전용 배정 경로 없음) | 5·7·10·12·13·15 — 전부 `PATCH /api/drafts/[id]`(`patchDraftApi`) |
| §2-5 핸들 변경 → 비용 행 같은 트랜잭션 이관 + 충돌 병합 | 14 |
| §2-5 클라 삭제 스냅샷 · 캠페인 삭제 set null · 확인 다이얼로그 | 1(FK) · 4(테스트) · 10(`CampaignHeader.confirmDelete`) |
| §3-1 사이드바 그룹 맨 위 "캠페인" | 11 |
| §3-2 목록(진행 중/예정/종료 접힘 · 자동 선택 · 보조줄) | 11 |
| §3-2 헤더(이름·상태 pill·기간·유형·코드 복사·[+ 원고 추가]·[···]) | 10 |
| §3-2 요약 카드 4(예외 우선·보조 문구·통화별) | 8 |
| §3-2 콘텐츠 표 6열·정렬·필터 칩·밀림 행·셀 편집·행 메뉴·게시물 연결 | 7(팝오버·예정일 칸) · 8(표) · 10(콜백·`LinkPostModal`) |
| §3-2 비용 제안(비어 있을 때만, 통화는 pricing 레벨) | 1(`suggestDraftCost`) · 3(`InfluencerOption.pricing`) · 10(`assignInfluencer`) · 12(카드) |
| §3-2 주간 달력(월~일+예정일 없음 · 넘김 · 드래그 · 밀림 · 오늘 · 기간 밖) | 15 |
| §3-2 인플별 비용 표(추가 비용 항목·메모 인라인·합계·도움말) | 9 |
| §3-2 [표 \| 주간 달력] 기본 표 · 마지막 선택 기억 | 11(`parseDetailView`·`DETAIL_VIEW_KEY`) · 15(UI·localStorage) |
| §3-2 가독성 기준(15/13px·12px 미만 금지·행 ≥48·간격 28~32) | Global Constraints + 8·9·10·14·15의 grep 체크 단계 |
| §3-3 만들기 모달(클라→기간 기본 다음 주→이름·코드 제안→유형→메모, 만들면 선택) | 2(제안) · 6(검증) · 11(모달) |
| §3-3 수정 인라인 · 기간 밖 경고만 · 삭제 확인 문구 | 6(라우트 `checkPeriod` 합침) · 10 |
| §4-1 [+ 원고 추가] 기존 원고 고르기(미소속만·형제 시안 도움말·bulk 한 문장) | 3(`listUnassignedDrafts`) · 5(bulk) · 7(후보 GET) · 9(`AddDraftsModal`) |
| §4-1 새로 만들기 `/generate?campaign=`(클라 자동 선택·배너·생성/직접 쓰기 `campaignId`) | 5(POST 수용) · 13 |
| §4-2 DraftCard 캠페인 칸(진행 중·예정, 종료 펼침, 클라 없으면 전체) + 예정일·비용 칸 | 12(칸·`campaign` prop) · 13(/generate 배선) · 15(캠페인 화면 배선) |
| §4-3 /generate 표 캠페인 열 + 필터 | 13 |
| §4 DraftRow 확장(`campaignId·campaignName·campaignCode·scheduledOn·cost`, `left join campaign` 1회) | 3 |
| §5 트래킹 링크 `campaignCode` prefill(세팅 지점 2곳) | 12 |
| §5 게시물 트래킹(게시됨·성과 = `tracked_post.draft_id`, 연결 진입점) | 4 · 10 |
| §5 인플 프로필 "참여 캠페인"(조회만 · `/campaigns?id=` 링크) | 4(`listInfluencerCampaigns`) · 14 |
| §5 인플 단가 `pricing[type]` 사용 | 1 · 3 · 10 · 12 |
| §6 `GET/POST /api/campaigns` | 6 |
| §6 `GET/PATCH/DELETE /api/campaigns/[id]` | 6 |
| §6 `PUT /api/campaigns/[id]/influencers/[handle]` | 7 |
| §6 `PATCH /api/drafts/[id]` 새 필드 | 5 |
| §6 `PATCH /api/drafts` bulk `campaignId` | 5 |
| (스펙 표에 없음 — 추가) `GET /api/campaigns/[id]/drafts` 원고 후보 읽기 전용 | 7 — 고르기 모달의 후보 목록. 쓰기는 §6의 bulk PATCH 그대로 |
| §7 기간 역순 400 문구 | 6 |
| §7 영문 코드 위반 `campaignMessage` | 6 · 10 · 11 |
| §7 캠페인 미존재 `?id=` → 토스트 + 첫 캠페인 | 11 |
| §7 금액 0 이상 정수 · 통화 변경 시 변환 없음 도움말 | 1(검증) · 7·9(도움말 한 줄) |
| §7 달력 드래그 실패 → 원위치 + 토스트 | 10(`apply` 롤백) · 15 |
| §7 성과 스냅샷 없음 → "—", 게시 0건 | 2(null 유지) · 8(문구) |
| §7 다른 캠페인 소속은 후보에 없음 · DraftCard 이동 경고 없음 | 3 · 12 |
| §8 순수 함수 테스트 | 1·2·5·6·7·8·9·11·12·13·15 |
| §8 스토어 테스트(생성·목록·상세 조인·upsert·핸들 변경 전파·클라 삭제 스냅샷·캠페인 삭제 원고 보존·null=지움) | 3 · 4 · 14 |
| §8 라우트는 스토어 테스트 + koo 화면 QA(build+start) | 5·6·7(tsc·lint) · 11·13·14·15(화면 단계) · 15(`npm test` 전량) |

## 병렬 안전성 (같은 wave에서 같은 파일을 두 태스크가 고치지 않는다)

- **G2 ‖ G3** — Task 5: `draftFieldPatch.ts(+test)`·`api/drafts/[id]/route.ts`·`api/drafts/route.ts`·`api/drafts/manual/route.ts`·`generate.ts` / Task 6: `campaignInput.ts(+test)`·`api/campaigns/route.ts`·`api/campaigns/[id]/route.ts` / Task 7: `api/campaigns/[id]/influencers/[handle]/route.ts`·`api/campaigns/[id]/drafts/route.ts`·`campaignApi.ts(+test)`·`CostPopover.tsx`·`ScheduledOnField.tsx` → 겹침 없음.
- **G4 안 Task 8 ‖ 9** — 8: `campaignTableView.ts(+test)`·`SummaryCards.tsx`·`ContentTable.tsx` / 9: `campaignCostEdit.ts(+test)`·`InfluencerCostTable.tsx`·`AddDraftsModal.tsx` → 겹침 없음. Task 10(`CampaignHeader`·`useCampaignDraftActions`·`LinkPostModal`·`CampaignDetail`) · Task 11(`campaignView(+test)`·`layout`·`page`·`CampaignList`·`CampaignCreateModal`·`Sidebar.tsx`·`XIcons.tsx`)은 순차.
- **G4 ‖ G5** — G5 Task 12: `draftCampaignOptions.ts(+test)`·`DraftCampaignField.tsx`·`DraftCard.tsx`·`TrackingLinkSection.tsx`·`LinkCreateModal.tsx` / Task 13: `draftUi.ts(+test)`·`DraftFilterBar.tsx`·`DraftTable.tsx`·`DraftWriteModal.tsx`·`generate/page.tsx` / Task 14: `influencerStore.ts(+test)`·`influencers/CampaignSection.tsx`·`influencers/InfluencerProfile.tsx`. G4 파일과 겹침 없음(Task 10은 `DraftCard`를 import만 하고 수정하지 않는다). G5 안에서도 12·13·14는 파일이 겹치지 않는다. 단 **Task 13은 Task 12의 `campaign` prop에 컴파일 의존**하므로 12 → 13 순차(14는 둘과 병렬).
- **G6** — Task 15가 Task 10·11·12의 파일(`CampaignDetail.tsx`·`page.tsx`, `DraftCard` prop 소비)을 고치므로 전부 끝난 뒤 단독.
