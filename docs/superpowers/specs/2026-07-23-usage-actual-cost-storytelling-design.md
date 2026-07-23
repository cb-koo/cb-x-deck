# /usage 개편 — 제공사 실청구 + 사이드바 통합 + 데이터 스토리텔링

작성일: 2026-07-23
상태: 설계 승인됨(구현 진행)
베이스: main `459a847` (브랜치 `cb-koo/usage-actual-cost`)

## 1. 목적 / 배경

기존 `/usage`는 (a) 최상위 독립 페이지라 사이드바가 없어 다른 페이지로 못 넘어가고, (b) "우리가 기록한 호출 × 공식 단가 = **추정치**"만 보여주며, (c) 표 나열식이라 비개발 사용자가 "얼마·어디에·괜찮나"를 한눈에 파악하기 어렵다.

이번 개편 3가지:
1. **제공사 실청구 표시** — getxapi(기존 키), Exa(service key)로 실제 청구/사용을 끌어와 추정과 대조. Anthropic은 현행 유지(추정만).
2. **사이드바 통합** — 다른 페이지처럼 좌측 사이드바로 이동 가능하게.
3. **데이터 스토리텔링 재구성** — 사용자가 궁금한 순서(총액→신뢰·잔액→구성→추세→상세)로 정보 위계 재배치.

대상 사용자: 비개발 콘텐츠 기획자. 실제 질문: ①이번 기간 얼마?(늘었나) ②추정이 실제와 맞나? 잔액·예산 괜찮나? ③어디에 가장 많이 쓰나? ④튄 날 있나?

## 2. 사이드바 통합

`/usage`를 워크스페이스 레이아웃 안으로 이동: **`src/app/usage/` → `src/app/w/[wsId]/usage/`**. `/w/[wsId]/layout.tsx`가 `MemberProvider` + `Sidebar`를 감싸므로 자동으로 사이드바가 붙고 리서치/덱/브리핑/보관함 이동 가능. 워크스페이스 레이아웃은 client 컴포넌트지만 `children`으로 **서버 컴포넌트 페이지를 렌더 가능**(App Router 규칙).

- 데이터는 여전히 **앱 전체 공통**(wsId로 필터하지 않음). `params.wsId`는 사이드바 렌더용으로만 존재.
- `src/components/Sidebar.tsx`의 "API 사용량" 링크 `href`를 `/usage` → `/w/${wsId}/usage`로 변경. active 판정도 그에 맞게.
- 기존 `src/app/usage/` 라우트 삭제(중복 방지).

## 3. 제공사 실청구 취득 (`src/lib/actualCost.ts` 신규)

페이지 로드 시 조회 + **모듈 레벨 TTL 캐시(5분)**로 반복 완화. 각 fetcher는 **타임아웃(5s) + 실패 시 `null` 반환**(페이지가 폴백 표시). 키 없으면 `null`.

### 3.1 getxapi (기존 `GETXAPI_KEY`, 누적)
- `GET https://api.getxapi.com/account/me` → `{credits_remaining, credits_used, total_requests, created_at}` (credits ≈ USD, 계정 생성 이래 **누적**)
- `GET https://api.getxapi.com/account/payments` → `[{amount, credits_added, status, created_at}]`
- 무료 엔드포인트(크레딧 미소모), Bearer 인증.
```ts
export interface GetxapiActual {
  creditsRemaining: number; creditsUsed: number; totalRequests: number;
  recentPayments: Array<{ amount: number; creditsAdded: number; status: string; at: string }>;
}
export async function getxapiActual(): Promise<GetxapiActual | null>;
```

### 3.2 Exa (`EXA_SERVICE_KEY`, 기간)
- `GET https://admin-api.exa.ai/team-management/api-keys` → `{ apiKeys: [{ id, name, budgetCents, isOverBudget, ... }] }`. 첫(유일) 키의 `id`·`budgetCents`·`isOverBudget` 사용.
- `GET https://admin-api.exa.ai/team-management/api-keys/{id}/usage?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` → `{ period, total_cost_usd, cost_breakdown:[{price_name, quantity, amount_usd}], ... }`
- `x-api-key: EXA_SERVICE_KEY`. 검색 키(`EXA_API_KEY`)와 별개, 읽기 전용.
```ts
export interface ExaActual {
  totalCostUsd: number; periodStart: string; periodEnd: string;
  budgetUsd: number | null; overBudget: boolean;
}
export async function exaActual(from: Date, to: Date): Promise<ExaActual | null>;
```

### 3.3 Anthropic
실청구 API 미연동(Admin 키+조직 필요). 화면엔 "실청구는 콘솔에서 확인" 안내 + 추정치만. fetcher 없음(향후 자리).

### 3.4 공통 인터페이스
```ts
export interface ProviderActual {
  api: 'getxapi' | 'exa' | 'anthropic';
  kind: 'cumulative' | 'period' | 'estimate-only';
  actualUsd: number | null;      // period 실비용(exa) / 누적 사용(getxapi) / null(anthropic)
  balanceUsd?: number | null;    // getxapi 잔액
  budgetUsd?: number | null;     // exa 예산
  overBudget?: boolean;
  note?: string;                 // 폴백/안내 문구
}
```
`getProviderActuals(from, to)` — getxapi·exa fetcher를 병렬 호출해 `ProviderActual[]` 조립(각 실패는 그 카드만 폴백).

## 4. 데이터 스토리텔링 레이아웃 (역피라미드)

페이지 위→아래 = 중요도. 각 숫자에 **한 줄 해석**(AGENTS.md UX 원칙: 숫자만 던지지 말고 판단 서술), **사용자 언어 라벨**, operation 원문 비노출.

1. **헤드라인 (`UsageHeadline`)** — 기간 총 추정비용(큰 숫자) + **전 기간 대비 증감%**(▲/▼). 예: "이번 30일 약 $X.XX — 지난 기간보다 12% 늘었어요." 전 기간 총액은 `rawAggregate(prevFrom, prevTo)`로 계산.
2. **실제 청구 대조 (`ActualCostPanel`)** — 제공사 카드 3장:
   - getxapi: 잔액 $A · 누적 사용 $B · 최근 충전. 잔액 낮으면(예: <$5) 경고색.
   - Exa: **기간 실제 $C / 우리 추정 $D** 나란히 + "거의 일치/차이 큼" 해석. 예산 대비 상태(여유/초과, overBudget이면 경고).
   - Anthropic: 추정 $F + "실청구는 콘솔 확인" 안내.
   - 실패한 카드는 "불러오기 실패"만, 나머지·추정 정상.
3. **어디에 쓰였나 (`FeatureBreakdown`)** — 기능별 비중 가로 막대(트윗검색/번역/브리핑…) + 비용 + %. `summarizeByFeature` 재사용.
4. **일별 추이 (`UsageBar` 개선)** — 일별 총비용 막대, **최댓값(튀는 날) 강조**(색/라벨).
5. **상세 (`UsageDetailTables`)** — API별·기능별 표(기존), **접기/펼치기**(기본 접힘)로 강등.

기간 토글(7일/30일/이번달, 기본 30일)은 헤드라인 옆. `?period=` 링크 방식 유지.

## 5. 페이지 데이터 흐름

`src/app/w/[wsId]/usage/page.tsx`(서버 컴포넌트, 기존 로직 이전·확장):
- 기간 `range(period)` → `{from,to}` + 전 기간 `{prevFrom,prevTo}`(동일 길이 직전).
- `rawAggregate(sql, from, to)` / `dailyAggregate` / `rawAggregate(sql, prevFrom, prevTo)`(추세용).
- `summarizeByApi/Feature/Day`, `totalCostUsd` 재사용.
- `getProviderActuals(from, to)` 호출(실패 폴백).
- 각 섹션 컴포넌트에 props 전달.

## 6. 시각화 원칙 (구현 시 `dataviz` 스킬 적용)

- API/기능별 **일관된 색 매핑**(한 시스템처럼), 라이트/다크 대응, 명암 대비 확보.
- 막대·스탯타일·비중 막대 스펙은 dataviz 가이드 따름. 라이브러리 추가 없이 인라인(SVG/CSS).

## 7. 실패·비용·보안

- 실청구 호출 실패/키 없음 → 해당 카드만 폴백, 페이지·추정 정상. 절대 페이지를 깨지 않음.
- 페이지 로드당 실청구 호출 최대 3회(getxapi 2 + exa 2 = list+usage), TTL 캐시로 반복 완화. getxapi 계정 엔드포인트 무료.
- 키(`GETXAPI_KEY`, `EXA_SERVICE_KEY`)는 env, 코드·로그 노출 없음. 서버 컴포넌트에서만 호출(클라이언트 번들 유입 없음).

## 8. 테스트

- `actualCost` fetcher: 정상 응답 파싱(getxapi me/payments, exa keys→usage), 실패/키없음 → null, 타임아웃 처리, TTL 캐시 동작. `fetchImpl` 주입으로 단위테스트(실 네트워크 없이).
- 헤드라인 추세 계산(전 기간 대비 %)·기능 비중 % 순수 함수.
- 기존 `usagePricing`/`usageStore`/`usageFeatures` 테스트 유지.
- UI는 `npx tsc --noEmit` + `npm run build`로 검증(로컬 DB 없음).

## 9. 비목표 (YAGNI)

- Anthropic 실청구 API 연동(Admin 키+조직 필요 — 별도).
- 워크스페이스별 비용 분해.
- 실청구를 DB에 적재/크론 동기화(온디맨드+캐시로 충분).
- 원화 환산(구조만 유지).
- 예산 알림/한도 설정.

## 10. 파일 요약

- Create `src/lib/actualCost.ts` (+ `.test.ts`) — 제공사 실청구 fetcher + 조립.
- Create `src/app/w/[wsId]/usage/page.tsx` — 이전+재구성 서버 컴포넌트.
- Create `src/app/w/[wsId]/usage/UsageHeadline.tsx`, `ActualCostPanel.tsx`, `FeatureBreakdown.tsx`, `UsageDetailTables.tsx`.
- Move/rewrite `UsageBar.tsx` → `src/app/w/[wsId]/usage/UsageBar.tsx` (튀는 날 강조 추가).
- Delete `src/app/usage/page.tsx`, `src/app/usage/UsageBar.tsx`.
- Modify `src/components/Sidebar.tsx` — 링크 `/usage` → `/w/${wsId}/usage`.
- Reuse `src/lib/usagePricing.ts`, `usageStore.ts`, `usageFeatures.ts` (변경 없음, 필요 시 추세용 export만 추가).
