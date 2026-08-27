# 클라이언트 월 마케팅 예산 — 설계 스펙

작성: 2026-08-27 · 브랜치 `cb-koo/client-info` · 상태: 설계 승인(koo 브레인스토밍 08-27) — 구현 계획 작성 전
선행: 캠페인 관리 스펙(`2026-08-25-campaign-management-design.md`) §9 백로그 "예산 상한/경고"가 이 건이다.

## 0. 한 줄 정의

**클라이언트마다 기본 월 마케팅 예산(원화) 하나를 두고, 달마다 필요할 때만 그 달 예산을 따로 고친다. 그 달에 시작한 캠페인들의 비용 합계를 예산과 대조해 잔액·초과를 보여준다.** 예산은 저장하고, 집행·잔액은 저장하지 않고 계산한다(캠페인 스펙 §0의 원칙 그대로).

## 1. 목적과 사용 맥락

- 사용자: 콘텐츠 기획 담당자. 클라이언트에게 배정된 월 예산 안에서 캠페인을 굴린다.
- 지금은 캠페인마다 비용 합계는 보이지만 "이 달 얼마나 남았나"는 어디에도 없다 → 초과를 캠페인이 끝난 뒤 정산에서 안다.
- 성공 기준: 캠페인 상세를 열면 그 달 잔액이 바로 보이고, 클라이언트 상세에서 달마다 예산·집행·잔액을 한 표로 훑을 수 있다.

## 2. 결정 사항 (브레인스토밍 08-27, koo)

| 질문 | 결정 | 이유 |
|---|---|---|
| 캠페인 비용을 어느 달에 귀속하나 | **캠페인 `starts_on`의 달(서울 기준)** — A안 | 캠페인이 "클라 1 × 기간 1" 단위이고 이름 제안도 `{클라} {M월 N주}`라 월 단위 사고와 맞음. 규칙이 한 줄. 기간이 월을 걸쳐도 시작 달 하나에만 집계 |
| 통화 | **예산은 원화 하나. 엔화 집행은 1엔 = 10원 고정 환산해 합산** | 클라이언트 예산이 원화로 잡힘. 환율은 상수 한 곳에 두고 나중에 설정으로 승격 가능 |
| 환율 변경 시 과거 숫자 | **새 환율로 재계산됨(스냅샷 없음)** | 참고 환산이므로 지금은 허용. 문제가 되면 월별 환율 스냅샷을 그때 넣는다 |
| 어디에 보이나 | **① 클라이언트 상세 패널(입력+월별 표) ② 캠페인 상세 요약 카드.** 만들기 모달·캠페인 목록은 넣지 않음 | ①이 없으면 적을 곳이 없고 ②가 없으면 캠페인 연결이 안 산다. 목록은 이미 빽빽 |
| 저장 방식 | **`client` 컬럼 2개(기본 예산 + 예외 달 jsonb)** — A안 | 이 저장소의 jsonb 설정 관례(`influencer.pricing`, `banned_phrases`). 클라 수 × 연 12칸이라 양 문제 없음. 변경 이력이 필요해지면 `client_budget_month` 테이블로 옮김(단순) |
| 초과 시 동작 | **차단 없음, 표시만(빨강)** | 생성·비용 입력을 막으면 기록 자체가 안 되는 쪽이 더 위험 |
| 클라이언트 상세 안 위치 | **기본 정보 → 시술 → 월 마케팅 예산** 순서의 세 번째 패널. 탭 아님 | 예산 입력과 월별 표가 한 패널에 붙어 기본값·예외가 같이 보임. 상세가 탭이 필요할 만큼 길지 않음 |

## 3. 데이터 모델 — 마이그레이션 `037_client_budget.sql`

main은 035까지, `036`은 정산 결제 수단 브랜치(`cb-koo/influencer-profile`)가 쓴다 → 037(08-27 전 활성 브랜치 확인 — 다른 브랜치는 035까지). `scripts/apply-migrations.sh`가 전 파일을 다시 돌므로 재실행 안전.

```sql
alter table client add column if not exists monthly_budget int;                       -- 기본 월 예산(원). null = 미설정
alter table client add column if not exists budget_overrides jsonb not null default '{}'; -- {"YYYY-MM": int} 예외 달만
```

- `monthly_budget`: 0 이상 정수(원). null = "예산 미설정".
- `budget_overrides`: 키 `YYYY-MM`, 값 0 이상 정수(원). 예외 달만 들어간다. 기본값과 같은 금액을 적어도 예외로 남는다(사용자가 명시적으로 고정한 것 — 기본값을 바꿔도 그 달은 안 움직임). 되돌리기는 키 삭제.
- 그 달 예산 = `budget_overrides[월] ?? monthly_budget` → 둘 다 없으면 미설정.
- `ClientRow`(`clientStore.ts`)에 `monthlyBudget: number | null`, `budgetOverrides: Record<string, number>` 추가. jsonb 모양은 보증되지 않으므로 읽을 때 검증 통과분만 쓴다(`draftStore.costOf`와 같은 태도 — 키 형식·정수 아니면 버림).

**집행(저장하지 않음)**: 클라이언트 × 달 → 그 달에 `starts_on`이 속하는 캠페인들의 합계. 합계 정의는 캠페인 스펙 §2-4와 같다(원고 콘텐츠 비용 중 `status <> 'unused'` + `campaign_influencer_cost.extra_costs`). 통화별로 모은 뒤 원화로 환산.

## 4. 계산 모듈 `src/lib/clientBudget.ts` (순수 함수 — 서버·화면 공용)

| 함수 | 역할 |
|---|---|
| `JPY_TO_KRW = 10` | 환율 상수. 바꿀 자리는 여기 한 곳. 화면 ⓘ 문구도 이 값으로 만든다(하드코딩 금지) |
| `toKrw(total: MoneyByCurrency) → { krw: number; jpyIncluded: number }` | 통화별 합계를 원화 하나로. `jpyIncluded`는 엔화 원금(보조줄 "엔화 95,000엔 포함(950,000원으로 환산)"용). 알 수 없는 통화는 `totalsFor`가 이미 걸러 들어오지 않음 |
| `monthOf(startsOn: DateOnly) → 'YYYY-MM'` | 귀속 달. `starts_on`은 `to_char`로 읽은 DateOnly 문자열이므로 앞 7자 — 시간대 시프트 없음 |
| `budgetForMonth(client, month) → { amount: number \| null; source: 'override' \| 'default' \| 'none' }` | 예외 → 기본 → 미설정 |
| `budgetRows(client, spendByMonth, today) → MonthRow[]` | 클라이언트 상세 표 행. `today`는 `kstToday()`(서울 날짜, `datetime.ts`) — 월말 밤에 UTC로 달이 갈리지 않게. 범위: `min(첫 캠페인 달, 이번 달)` ~ 다음 달, 최대 12행, 최신 위. 캠페인이 없으면 이번 달·다음 달 2행 |
| `budgetJudgment(row) → string` | 잔액 셀 문구: `N원 남음` / `N원 초과` / 예산 미설정이면 `예산을 설정하면 잔액이 보여요` |

```ts
interface MonthRow {
  month: string;                 // 'YYYY-MM'
  budget: number | null; source: 'override' | 'default' | 'none';
  spentKrw: number; jpyIncluded: number; campaignCount: number;
  remaining: number | null;      // budget - spentKrw, budget null이면 null
}
```

## 5. 저장소·API

### 5-1. `clientStore.ts`
- `listClients` / `getClientWithProcedures` select에 두 컬럼 추가.
- `updateClient` 패치에 `monthlyBudget?: number | null`. **null = 지움**이므로 `coalesce`가 아니라 `case when {patch.monthlyBudget !== undefined} then {value} else monthly_budget end` 패턴(`draftStore.updateDraft`의 influencer_handle 규칙). `updated_at = now()`.
- `setBudgetOverride(sql, id, month, amount: number | null)`: null이면 `budget_overrides = budget_overrides - ${month}`, 아니면 `budget_overrides || jsonb_build_object(${month}, ${amount})`. `updated_at = now()`.

### 5-2. `campaignStore.ts`
- `spendByMonth(sql, clientId, months?: string[]) → Map<'YYYY-MM', { total: MoneyByCurrency; campaignCount: number }>`: 기존 `totalsFor`의 합산 SQL을 재사용해 `to_char(c.starts_on, 'YYYY-MM')`로 group by. `months`를 주면 그 달만(캠페인 상세는 한 달), 없으면 전부(클라이언트 상세). 캠페인 수는 비용 0인 캠페인도 센다(합계 서브쿼리와 별개로 `count(distinct c.id)`).
- 캠페인 상세 응답(`getCampaignDetail`)에 `budget` 필드 추가 — §5-3.

### 5-3. 라우트

| 라우트 | 변경 |
|---|---|
| `PATCH /api/clients/[id]` | body `monthlyBudget?: number \| null` 추가. 검증: null 또는 0 이상 정수, 아니면 400 `예산은 0 이상 숫자로 입력해 주세요`. `requireMember` |
| `PUT /api/clients/[id]/budget/[month]` (신설) | body `{ amount: number \| null }`. `month`는 `/^\d{4}-(0[1-9]\|1[0-2])$/`, 아니면 400. amount 규칙 동일. 응답 = `getClientWithProcedures` 결과. `requireMember` |
| `GET /api/clients/[id]/budget` (신설) | `{ rows: MonthRow[] }`. 클라이언트 로드와 분리 — 상세 첫 화면을 느리게 하지 않고 예산 패널이 자기 데이터를 따로 부른다. `requireAllowedUser` |
| `GET /api/campaigns/[id]` | 응답에 `budget: { month, amount, source, othersKrw, campaignCount } \| null` 추가. `client_id`가 null이면 null. `othersKrw` = 같은 달 **다른** 캠페인의 원화 환산 합 — 이 캠페인 몫은 화면이 자기 합계(`campaignTotal`)를 더해 잔액을 만든다. 비용 셀을 고친 순간 '비용 합계' 칸과 '예산 잔액' 칸이 같은 박자로 움직이게(UX 원칙 4) |

## 6. 화면

### 6-1. 클라이언트 상세 (`src/app/clients/ClientDetail.tsx`) — 세 번째 패널 `BudgetPanel`

기본 정보 패널 · 시술 패널 **다음**에 같은 격(`rounded-2xl border`)의 패널. 자기 데이터(`GET /api/clients/[id]/budget`)를 따로 불러온다. 가독성 기준(14~15px·행 44px+·여백)은 기존 표 스타일을 따른다.

```
┌ 월 마케팅 예산 ──────────────────────────────────────────────────┐
│ 기본 월 예산  [ 3,000,000 ] 원   [저장]  저장됨 ✓                   │
│ 매달 이 금액을 기준으로 캠페인 비용을 대조해요. 특정 달만 다르면 아래 표에서 그 달을 고쳐요. │
│ ──────────────────────────────────────────────────────────────── │
│ 월별 예산과 집행                    캠페인은 시작한 달에 잡혀요 · 엔화는 1엔 = 10원으로 환산해요 ⓘ │
│  월          예산                집행                    잔액          │
│  2026년 9월   3,000,000원  기본    1,200,000원 · 캠페인 1개   1,800,000원 남음 │
│  2026년 8월   2,500,000원  (수정)  2,850,000원 · 캠페인 3개   350,000원 초과  │  ← 빨강
│                                   엔화 95,000엔 포함(950,000원으로 환산)        │  ← 엔화 있을 때만 보조줄
│  2026년 7월   3,000,000원  기본    0원 · 캠페인 없음          3,000,000원 남음 │
└───────────────────────────────────────────────────────────────────┘
```

- **기본 월 예산 입력**: 숫자만(천 단위 콤마 표시는 화면에서만, 저장은 정수). 비우고 저장 = 미설정(null). 저장은 `PATCH /api/clients/[id]`. 기존 `BasicInfoEditor`와 같은 dirty/저장됨 패턴, 상세의 `register`에 등록해 미저장 확인·일괄 저장에 포함.
- **예산 셀 클릭** → 그 행이 인라인 편집으로 바뀜(포털 팝오버 아님 — 표 안이라 잘림 문제 없음): 금액 입력 + [저장] + [취소] + **[기본값으로 되돌리기]**(예외가 있는 달만 표시). 즉시 저장(`PUT …/budget/[month]`), 성공 시 표 재조회. "기본"·"(수정)" 표기는 `source`에서.
- **집행 셀**: 원화 환산 합계 + 캠페인 수(숫자만, 링크 없음 — 캠페인 목록에 클라 필터가 없다). 엔화 포함 달만 보조줄.
- **잔액 셀**: `budgetJudgment`. 초과는 숫자·문구 빨강(`text-red-700`, 요약 카드 밀림과 같은 방식 — 배경색 안 씀).
- **예산 미설정 + 예외 없음**: 예산 "—", 잔액 "예산을 설정하면 잔액이 보여요". 집행은 그대로 보인다.
- 로딩·오류: 표 자리에 "불러오는 중…" / "예산 정보를 불러오지 못했어요 [다시 시도]".

### 6-2. 캠페인 상세 요약 (`src/app/campaigns/SummaryCards.tsx`) — 4칸 → 5칸

기존 밀림 · 게시됨 · 비용 합계 · 조회 뒤에 **월 예산 잔액** 칸. `grid-cols-4` → `grid-cols-5`(`budget`이 null이면 칸을 그리지 않고 4칸 유지).

```
1,150,000원                                  ← remaining. 초과면 빨간 "−350,000원", alert
8월 예산 잔액 ⓘ                               ← ⓘ: "클라이언트의 8월에 시작한 캠페인 비용을 전부 합쳐 예산과 대조해요. 엔화는 1엔 = 10원으로 환산해요."
3,000,000원 중 1,850,000원 사용 · 캠페인 2개    ← 보조줄. 이 캠페인만이 아니라 같은 클라이언트의 같은 달 캠페인 전체
```

- 예산 미설정(`amount === null`): 값 "—", 라벨 "월 예산", 보조줄 "미설정 — 클라이언트 설정에서 입력"(→ `/clients?client={clientId}` 링크(clients/page.tsx의 기존 딥링크 파라미터)). 거짓 어포던스 없이 갈 곳을 알려준다.
- 값은 서버 응답 `budget`을 그대로 쓴다 — 카드가 따로 세지 않는다(SummaryCards 관례).

## 7. 경계·오류

- **캠페인에 넣지 않은 원고의 비용은 예산 집계에 들어가지 않는다.** 예산은 캠페인 단위 집행을 대조하는 것이고(§0), 캠페인 없는 원고는 귀속 달이 없다. 클라이언트 상세 표 ⓘ 문구에 "캠페인에 넣은 콘텐츠 비용만 집계해요"를 포함한다.
- 캠페인 시작일을 바꿔 달이 옮겨가면 자동으로 새 달에 잡힌다(저장 안 하므로 조치 없음).
- 캠페인 기간이 여러 달을 걸쳐도 시작 달 하나에만 집계. 표 ⓘ에 한 줄로 명시(§6-1).
- 예외 달을 기본값과 같은 금액으로 저장해도 "(수정)"으로 남는다(§3). 되돌리기는 별도 버튼.
- 환율을 바꾸면 지난 달 숫자도 새 환율로 바뀐다(§2). 바꾸는 사람이 알 수 있게 `JPY_TO_KRW` 옆에 주석.
- 금액은 0 이상 정수만(비용·단가 검증 규칙과 동일). 음수·소수·문자는 400.
- 클라이언트 삭제 시 예산도 함께 사라진다(컬럼이므로). 캠페인은 `client_id` null → 요약 카드 예산 칸 없음.

## 8. 테스트

- **순수(`clientBudget.test.ts`, tsx로 수초)**: `toKrw`(엔화 포함/미포함/빈 합계), `monthOf`(월 경계 `2026-08-31`·`2026-09-01`), `budgetForMonth`(예외/기본/미설정, 예외가 기본과 같은 금액), `budgetRows`(캠페인 없음 → 2행 · 12개 초과 잘림 · 최신 위 · 첫 캠페인이 이번 달 뒤일 때), `budgetJudgment` 세 문구.
- **스토어(실 DB, npm test 관례)**: `updateClient` monthlyBudget null=지움 · 값 설정, `setBudgetOverride` 설정·삭제·`updated_at` 갱신, `spendByMonth` — 미사용 원고 제외·추가 비용 포함·엔화 분리·비용 0 캠페인도 count·months 필터.
- **라우트 검증(순수 함수로 분리해 테스트)**: month 형식, amount 규칙.
- 화면은 하네스 없음 — koo QA(로컬 build+start 3001 또는 프리뷰).

## 9. 범위 밖 (백로그)

예산 변경 이력(테이블 승격) · 환율 설정 화면(월별 스냅샷 포함) · 캠페인 목록의 예산 진행률 · 캠페인 만들기 모달의 잔액 표시 · 예산 초과 알림(Slack) · 원고 예정일 기준 귀속(B안) · 연 예산.

## 10. 머지 체크

- `src/content/updates.ts` 맨 위에 `새 기능` 1건: "클라이언트마다 월 마케팅 예산을 정하고 캠페인 비용과 대조할 수 있어요" — 클라이언트 상세의 새 패널, 캠페인 요약의 잔액 칸, 엔화 환산 규칙(1엔=10원)·시작 달 귀속 규칙을 불릿으로. `link: /clients`.
- 마이그레이션 번호 037이 다른 브랜치와 충돌하는지 머지 시 확인(036 정산 결제 수단 브랜치).
