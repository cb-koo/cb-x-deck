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
- **통화는 합치지 않는다(§2-4)** — 모든 합계는 `MoneyByCurrency`(통화별), 표기는 `formatMoney` → `360,000원 · 95,000엔`. 통화 변경 시 금액 변환 없음(도움말 한 줄).
- **값은 하나(§2-5)** — 인플 배정은 `draft.influencer_handle`, 캠페인 소속은 `draft.campaign_id`, 예정일·비용은 `draft.scheduled_on/cost`. 캠페인 화면·DraftCard·/generate 표가 전부 같은 컬럼을 `PATCH /api/drafts/[id]`로 고친다. 캠페인 전용 배정 API를 만들지 않는다.
- **패치 규칙(§2-3)** — `campaign_id·scheduled_on·cost`(및 bulk `campaignId`)는 `case when {patch.x !== undefined} then {value} else x end`: `undefined`=건드리지 않음 · `null`=지움 · 값=설정. `coalesce` 금지(지움 표현 불가).
- **파생값 정의(§2-4)** — 콘텐츠 단계 = `draft.status` 5종 + **게시됨**(`exists(tracked_post where draft_id=…)`, status는 바꾸지 않음) · **밀림** = `scheduled_on < 오늘(서울)` and 미게시 and `status ≠ unused` · **준비 중** = `draft+review+approved`(합성 라벨, `campaignJudgment`에만 정의) · **N**(게시됨 n/N) = 캠페인 원고 수 **미사용 제외**(밀림과 같은 모집단) · **기간 밖** = `scheduled_on ∉ [starts_on, ends_on]`(경고만) · **캠페인 상태** = 오늘<starts_on 예정 / 안 진행 중 / 오늘>ends_on 종료(수동 없음). "오늘"은 `kstToday()`.
- **마이그레이션 번호 033**(032는 미머지 `cb-koo/influencer-profile`). `scripts/apply-migrations.sh`가 전 파일을 재적용하므로 모든 문장 멱등(`if not exists`). 033은 `alter table influencer add column if not exists pricing jsonb not null default '{}'` 한 줄을 포함(리뷰 Blocking 2).
- `date` 컬럼은 항상 `to_char(col, 'YYYY-MM-DD')`로 읽는다(briefingStore 관례) — postgres.js가 Date로 돌려주면 시간대가 하루 민다. 날짜 산술은 `'YYYY-MM-DD'` 문자열(date-only 계열, `datetime.ts`).
- 비용 리터럴은 `src/lib/campaignCost.ts`에 지역 정의 — `'KRW'|'JPY'`, `'rt'|'quoteRt'|'post'|'visit'`(influencer-profile 브랜치의 `influencerPricing.ts`와 문자열 동일, import 불가). `influencer.pricing` 모양 `{currency?: 'KRW'|'JPY', rt?, quoteRt?, post?, visit?}` — 통화는 pricing 레벨 하나, 기본 KRW.
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
| `src/lib/campaignCost.ts` (+test) | 통화·유형 리터럴, 금액/추가비용 검증, 통화별 합계·표기, 단가 제안 | 1 |
| `src/lib/campaignJudgment.ts` (+test) | 단계·밀림·기간 밖·캠페인 상태·준비 중·요약·정렬·인플 목록·이름/코드 제안·주 계산 | 2 |
| `src/lib/draftStore.ts` (+`draftStore.campaign.test.ts`) | DraftRow 5필드 + `left join campaign`, case-when 패치, `listDraftsByCampaign`, `listUnassignedDrafts` | 3 |
| `src/lib/draftTypes.ts`, `src/lib/influencerStore.ts` | `InfluencerOption.pricing`(비용 제안 소스) | 3 |
| `src/lib/campaignStore.ts` (+test) | CRUD·목록(파생 수·합계)·상세(lateral 성과)·비용 upsert·인플 참여 캠페인 | 4 |
| `src/lib/draftFieldPatch.ts` (+test), `src/app/api/drafts/[id]/route.ts`, `src/app/api/drafts/route.ts`, `src/app/api/drafts/manual/route.ts`, `src/lib/generate.ts` | 원고 PATCH(단건·bulk) 새 필드, 생성 경로 `campaignId` | 5 |
| `src/lib/campaignInput.ts` (+test), `src/app/api/campaigns/route.ts`, `src/app/api/campaigns/[id]/route.ts` | 캠페인 입력 검증 + GET/POST, GET/PATCH/DELETE | 6 |
| `src/app/api/campaigns/[id]/influencers/[handle]/route.ts`, `src/app/api/campaigns/[id]/drafts/route.ts`, `src/lib/campaignApi.ts`, `src/components/CostPopover.tsx`, `src/components/ScheduledOnField.tsx` | 추가 비용 PUT, 원고 후보/추가, 클라 fetch 헬퍼, 공용 비용·예정일 입력 | 7 |
| `src/app/campaigns/ContentTable.tsx`, `SummaryCards.tsx` | 콘텐츠 표(6열) · 요약 카드 4 | 8 |
| `src/app/campaigns/InfluencerCostTable.tsx`, `AddDraftsModal.tsx` | 인플별 비용 표(+추가 비용 팝오버·메모) · 원고 추가 모달 | 9 |
| `src/app/campaigns/CampaignHeader.tsx`, `CampaignDetail.tsx`, `useCampaignDraftActions.ts` | 헤더 인라인 수정·삭제 확인 · 상세 컨테이너(로드·낙관적 갱신·DraftCard 모달) | 10 |
| `src/app/campaigns/page.tsx`, `layout.tsx`, `CampaignList.tsx`, `CampaignCreateModal.tsx`, `src/components/Sidebar.tsx`, `src/components/XIcons.tsx` | 목록+상세 셸, 생성 모달, 사이드바 | 11 |
| `src/components/DraftCampaignField.tsx`, `DraftCard.tsx`, `TrackingLinkSection.tsx`, `LinkCreateModal.tsx` | DraftCard 캠페인 칸(`campaign` prop 객체) · 트래킹 링크 `campaignCode` prefill | 12 |
| `src/app/generate/page.tsx`, `src/components/DraftWriteModal.tsx`, `DraftTable.tsx`, `DraftFilterBar.tsx`, `src/lib/draftUi.ts` | `?campaign=` 딥링크·배너·생성/직접쓰기 campaignId · 표 캠페인 열+필터 | 13 |
| `src/lib/influencerStore.ts`, `src/app/influencers/InfluencerProfile.tsx` | 핸들 변경 시 비용 행 이관+병합 · "참여 캠페인" 섹션 | 14 |
| `src/app/campaigns/WeekCalendar.tsx`, `CampaignDetail.tsx` | 주간 달력 + [표\|주간 달력] 세그먼트 | 15 |

## 병렬 그룹 · 모델 배정

| Task | 내용 | Parallel group | Suggested model |
|---|---|---|---|
| 1 | 마이그레이션 033 + `campaignCost.ts` | G1 (순차 1번째) | sonnet |
| 2 | `campaignJudgment.ts` | G1 (순차 2번째) | opus |
| 3 | draftStore 확장 + InfluencerOption.pricing | G1 (순차 3번째) | opus |
| 4 | `campaignStore.ts` | G1 (순차 4번째) | opus |
| 5 | 원고 PATCH/생성 라우트 새 필드 | G2 (G1 후, G3와 병렬) | sonnet |
| 6 | 캠페인 입력 검증 + `/api/campaigns`, `/api/campaigns/[id]` | G3 (G1 후, G2와 병렬) | opus |
| 7 | 인플 비용 PUT · 원고 후보/추가 · `campaignApi.ts` · CostPopover · ScheduledOnField | G3 (Task 6 후) | sonnet |
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
- Consumes: 없음(리포 최초 진입). `influencer` 테이블(024), `draft`(014~025), `client`(001/029), `member`.
- Produces (Task 2~15가 사용):
  - 테이블 `campaign`, `campaign_influencer_cost`, `draft.campaign_id/scheduled_on/cost`, `influencer.pricing`
  - `CURRENCIES`, `type Currency = 'KRW' | 'JPY'`, `CURRENCY_LABEL`
  - `COST_TYPES`, `type CostType = 'rt' | 'quoteRt' | 'post' | 'visit'`, `COST_TYPE_LABEL`
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
  - `formatAmount(amount: number, currency: Currency): string` → `'360,000원'`
  - `formatMoney(m: MoneyByCurrency): string` → `'360,000원 · 95,000엔'` / 비면 `'—'`
  - `suggestDraftCost(pricing: unknown, type: CostType): DraftCost | null`

- [ ] **Step 1: 마이그레이션 파일 작성** (`migrations/033_campaign.sql`)

```sql
-- 033: 캠페인 관리 — campaign · campaign_influencer_cost · draft 3컬럼 (+ influencer.pricing 멱등 보장)
-- 설계: docs/superpowers/specs/2026-08-25-campaign-management-design.md §2
-- main은 031까지, 032는 미머지 브랜치(cb-koo/influencer-profile)가 사용 → 033.
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

-- influencer.pricing의 DDL은 미머지 032에만 있다. 이 브랜치의 비용 제안(select pricing)이 새 DB에서
-- 깨지지 않게 멱등으로 보장한다(리뷰 Blocking 2). 프로덕션 DB에는 이미 있어 무해.
alter table influencer add column if not exists pricing jsonb not null default '{}';
```

- [ ] **Step 2: DB에 적용** (리포 관례 — `.env`가 가리키는 단일 DB)

```bash
set -a; source .env; set +a; psql -v ON_ERROR_STOP=1 -f migrations/033_campaign.sql
```

Expected: `CREATE TABLE` ×2, `CREATE INDEX` ×4, `ALTER TABLE` ×4, 오류 없음. 두 번 실행해도 같은 결과(멱등).

- [ ] **Step 3: 실패하는 테스트 작성** (`src/lib/campaignCost.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCIES, COST_TYPES, AMOUNT_MESSAGE,
  parseAmount, parseDraftCost, parseExtraCosts,
  sumMoney, mergeMoney, moneyParts, formatAmount, formatMoney, suggestDraftCost,
} from './campaignCost.ts';

test('1) 리터럴 — influencer-profile 브랜치와 같은 문자열(머지 후 통합 전제)', () => {
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
  assert.equal(formatAmount(360000, 'KRW'), '360,000원');
  assert.equal(formatMoney({ KRW: 360000, JPY: 95000 }), '360,000원 · 95,000엔');
  assert.equal(formatMoney({}), '—');
  assert.equal(formatMoney({ KRW: 0 }), '0원'); // 0은 값이다 — '없음'과 다르다
});

test('6) suggestDraftCost — pricing[type]이 있을 때만, 통화는 pricing 레벨 하나(기본 KRW)', () => {
  assert.deepEqual(suggestDraftCost({ post: 50000, currency: 'JPY' }, 'post'), { type: 'post', amount: 50000, currency: 'JPY' });
  assert.deepEqual(suggestDraftCost({ rt: 100000 }, 'rt'), { type: 'rt', amount: 100000, currency: 'KRW' });
  assert.equal(suggestDraftCost({ rt: 100000 }, 'visit'), null);   // 그 유형 금액이 없으면 제안 없음
  assert.equal(suggestDraftCost({}, 'post'), null);
  assert.equal(suggestDraftCost(null, 'post'), null);
  assert.equal(suggestDraftCost({ post: 'abc' }, 'post'), null);
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCost.test.ts`
Expected: FAIL — `Cannot find module './campaignCost.ts'`

- [ ] **Step 5: 구현** (`src/lib/campaignCost.ts`)

```ts
// 캠페인 비용의 순수 로직 — 통화·유형 리터럴, 입력 검증, 통화별 합계, 표기, 단가 제안.
// 리터럴 문자열은 미머지 influencer-profile 브랜치의 influencerPricing.ts와 동일해야 한다
// ('KRW'|'JPY', 'rt'|'quoteRt'|'post'|'visit') — 그 파일은 이 브랜치에 없어 import할 수 없고,
// 통합은 머지 후 별건이다(스펙 §2-3). 서버(라우트 검증)와 브라우저(팝오버·표)가 같은 함수를 쓴다.

export const CURRENCIES = ['KRW', 'JPY'] as const;
export type Currency = typeof CURRENCIES[number];
export const CURRENCY_LABEL: Record<Currency, string> = { KRW: '원', JPY: '엔' };

export const COST_TYPES = ['rt', 'quoteRt', 'post', 'visit'] as const;
export type CostType = typeof COST_TYPES[number];
export const COST_TYPE_LABEL: Record<CostType, string> = { rt: 'RT', quoteRt: '인용 RT', post: '게시', visit: '방문' };

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
  return typeof v === 'string' && (COST_TYPES as readonly string[]).includes(v);
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

export function formatAmount(amount: number, currency: Currency): string {
  return `${amount.toLocaleString('en-US')}${CURRENCY_LABEL[currency]}`;
}

// '360,000원 · 95,000엔' — 통화 병기, 합치지 않는다. 비어 있으면 '—'(값 없음 관례).
export function formatMoney(m: MoneyByCurrency): string {
  const parts = moneyParts(m);
  return parts.length ? parts.map((p) => formatAmount(p.amount, p.currency)).join(' · ') : '—';
}

// 인플루언서 단가(influencer.pricing)에서 제안 — {currency?, rt?, quoteRt?, post?, visit?}.
// 통화는 유형별이 아니라 pricing 레벨 하나, 없으면 KRW(리뷰 Blocking 3).
// pricing이 {}거나 그 유형 금액이 없으면 제안 없음(null) — 빈칸으로 둔다(스펙 §3-2 비용 셀).
export function suggestDraftCost(pricing: unknown, type: CostType): DraftCost | null {
  if (!pricing || typeof pricing !== 'object') return null;
  const p = pricing as Record<string, unknown>;
  const amount = parseAmount(p[type]);
  if (amount === null) return null;
  const currency = isCurrency(p.currency) ? p.currency : 'KRW';
  return { type, amount, currency };
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/campaignCost.test.ts`
Expected: PASS 6건

- [ ] **Step 7: Commit**

```bash
git add migrations/033_campaign.sql src/lib/campaignCost.ts src/lib/campaignCost.test.ts
git commit -m "feat(campaign): 스키마 033(campaign·인플 추가비용·draft 3컬럼·pricing 멱등) + 비용 순수 로직(통화별 합계·검증·단가 제안)"
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
  - `addDays(date: string, n: number): string` · `daysBetweenDates(from: string, to: string): number` · `weekStartOf(date: string): string`(월요일) · `weekDays(weekStart: string): string[]`(7개) · `initialWeekStart(startsOn, endsOn, today): string` · `nextWeekRange(today): { startsOn: string; endsOn: string }` · `formatDateKo(date: string): string`(`'8/26 수'`)
  - `type CampaignStatus = 'upcoming' | 'active' | 'ended'`, `CAMPAIGN_STATUS_LABEL`, `campaignStatus(startsOn, endsOn, today): CampaignStatus`
  - `CAMPAIGN_KINDS`, `type CampaignKind = 'content' | 'visit' | 'seeding'`, `CAMPAIGN_KIND_LABEL`, `defaultCostType(kind: CampaignKind | null): CostType`
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
  addDays, daysBetweenDates, weekStartOf, weekDays, initialWeekStart, nextWeekRange, formatDateKo,
  campaignStatus, defaultCostType,
  contentStage, isOverdue, isOutOfRange, isPreparing, matchesStageFilter, summarizeStages, summarizePerf,
  sortContent, deriveInfluencers, campaignTotal, suggestCampaignName, suggestCampaignCode,
  type StageInput, type SortInput,
} from './campaignJudgment.ts';

const T = '2026-08-27'; // 목요일

test('1) 날짜 산술 — 시간대 시프트 없음, 월요일 시작 주, 월/연 경계', () => {
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
export const CAMPAIGN_KIND_LABEL: Record<CampaignKind, string> = { content: '콘텍츠 의뢰', visit: '방문 협찬', seeding: '시딩' };
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

// ─────────────────────────── 콘텍츠 표 정렬 ───────────────────────────
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

- [ ] **Step 5: 오타 점검** — `CAMPAIGN_KIND_LABEL.content`는 `'콘텐츠 의뢰'`, 섹션 주석은 `콘텐츠 표 정렬`이어야 한다(위 코드 블록에 '콘텍츠'가 남아 있으면 고친다). `grep -n "콘텍츠" src/lib/campaignJudgment.ts`가 0건이어야 한다.

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
- Modify: `src/lib/influencerStore.ts:264-268` (`listOptions`)
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
  - `InfluencerOption.pricing?: unknown` — 비용 제안 소스(`/api/drafts/influencers`가 그대로 내려준다)

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

```ts
// pricing: 인플 단가 jsonb 원본(influencer.pricing, 모양은 campaignCost.suggestDraftCost가 해석) —
// 비용 제안 소스. 자동완성 후보를 받는 화면이 그대로 제안에 쓴다. 없으면 제안 없음.
export interface InfluencerOption { handle: string; name?: string; pricing?: unknown }
```

- [ ] **Step 5: `listOptions`가 pricing을 내려준다** (`src/lib/influencerStore.ts:264-268` 교체)

```ts
// 배정 자동완성 후보 — 명부가 기준이다(과거 배정 이력에서 긁어모으던 listInfluencerHandles의 후신).
// pricing도 함께 — 캠페인 비용 제안(스펙 §3-2 비용 셀)이 배정 직후 단가를 알아야 한다. 컬럼은 033이 멱등 보장.
export async function listOptions(sql: postgres.Sql): Promise<InfluencerOption[]> {
  const rows = await sql<Array<{ handle: string; display_name: string | null; pricing: unknown }>>`
    select handle, display_name, pricing from influencer order by lower(handle)`;
  return rows.map((r) => ({ handle: r.handle, name: r.display_name ?? undefined, pricing: r.pricing ?? undefined }));
}
```

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
