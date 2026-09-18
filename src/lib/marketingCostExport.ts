// LINE 메시지 대시보드(마케팅 비용 표)로 X 마케팅 비용을 전달하는 GET API의 순수 부분 — 카테고리 매핑·페이지 클램프·직렬화. DB 없음.
// 계약 문서: docs/api/marketing-costs-external-api.md. 그쪽 원본 스펙: linemessagedashboard/docs/api/cb-x-deck-marketing-cost-export.md (2026-09-18).
import type { TaskType } from './campaignJudgment.ts';
import type { Currency } from './influencerPricing.ts';

// 그쪽이 받는 4종 고정 enum(스펙 §4). 자유 텍스트 금지 — 이 키가 "합산의 변수명"이다.
export const MARKETING_COST_CATEGORIES = ['x_content_quote_rt', 'x_secondary_viral', 'x_visit_manuscript', 'x_visit_etc'] as const;
export type MarketingCostCategory = typeof MARKETING_COST_CATEGORIES[number];

// 작업 유형 → 카테고리(스펙 §4). 근거: 그쪽 0918.md·부록 A가 옛 '프로모션 RT·인용RT' 버킷을 인용RT(콘텐츠)와
// RT(2차 바이럴)로 가르는데, 그 경계가 정확히 quoteRt/rt 유형 경계다. 정산 카테고리(설정값)는 사용자가 편집할 수
// 있어 이 경계를 안정적으로 표현하지 못하므로, category가 아니라 task_type을 매핑 기준으로 삼는다.
//  · post(투고)·quoteRt(인용RT) → x_content_quote_rt ("X 콘텐츠 게시 및 인용 RT")
//  · rt(RT)                     → x_secondary_viral   ("X 2차 바이럴 작업 (RT, 댓글)" — 댓글은 별도 작업 유형이 없어 RT에 포함)
//  · visit(방문협찬)            → x_visit_manuscript  ("X 방문형 협찬 원고")
//
// x_visit_etc(방문 기타·실비)는 이 매핑에서 나오지 않는다 — cb-x-deck는 방문 비용을 원고/기타로 가르지 않고,
// 교통·실비(campaign_influencer_cost.extra_costs)는 인플에게 송금하는 돈이 아니라 정산 요청(payment_request)으로
// 흐르지 않기 때문이다. enum에는 남겨 둔다(그쪽 계약의 4종).
// 📌 BACKLOG(koo 2026-09-18, 아직 케이스 없음): extra_costs를 소스로 붙이는 후속 작업. 착수 트리거·해야 할 일은
//    docs/api/marketing-costs-external-api.md §7-1 참조. 그때 이 표(또는 별도 소스)에 x_visit_etc를 추가한다.
export const CATEGORY_BY_TASK_TYPE: Record<TaskType, MarketingCostCategory> = {
  post: 'x_content_quote_rt',
  quoteRt: 'x_content_quote_rt',
  rt: 'x_secondary_viral',
  visit: 'x_visit_manuscript',
};
export function categoryForTaskType(t: TaskType): MarketingCostCategory {
  return CATEGORY_BY_TASK_TYPE[t];
}

// cb-x-deck client.id → LINE 대시보드 클리닉 슬러그(clinicId). 편집 가능한 clinic_code나 한글명은 표기가 흔들려서
// (예: '마인드스킨클리닉'↔'마인드피부과', '닥터손유나클리닉'↔'손유나클리닉') 매핑 키로 쓰지 않고, 불변인 client.id에 고정한다
// (koo 2026-09-18). 여기 UUID는 운영 DB의 실제 클라이언트다 — 신규 클리닉은 이 표에 client.id와 슬러그를 추가한다.
// 슬러그 값은 그쪽 스펙 §5 표를 따른다.
export const CLIENT_ID_TO_CLINIC_ID: Record<string, string> = {
  '6a2405e8-fa35-4804-9048-06e5a6e25641': 'mimodreamjp',        // 미모드림
  '70baf347-ea8c-4e8e-a32c-4bb18cca50ff': 'maindskinjp',        // 마인드스킨클리닉
  '904cb696-7236-45cf-a7b0-803033f5fbe2': 'sonyounajp',         // 닥터손유나클리닉
  '3e9e4e61-c837-4d04-b711-df72a7bd32d5': 'thesquaredentaljp',  // 더스퀘어치과
};
export const MAPPED_CLIENT_IDS = Object.keys(CLIENT_ID_TO_CLINIC_ID);
// 우선순위: 고정 UUID 매핑 → clinic_code 폴백(스테이징/테스트 DB는 UUID가 달라 폴백을 탄다). 둘 다 없으면 null(집계 제외).
export function resolveClinicId(clientId: string, clinicCode: string | null): string | null {
  return CLIENT_ID_TO_CLINIC_ID[clientId] ?? clinicCode ?? null;
}

// 페이지네이션(스펙 §2-1): page는 1부터. limit 기본 500(안 보내면 500/페이지), 최대 2000.
// 최대를 2000으로 올린 이유(koo 2026-09-18): 1년치를 1~3요청에 당길 수 있게 — 이 엔드포인트는 PostgREST가 아니라
// postgres.js 직결이라 1000행 상한이 없고, 2000행(≈400KB, created_at 인덱스 조회)은 p95 5초 안에 든다.
// 정산 API의 clampLimit(기본 100)과 일부러 다르다 — 계약·상한이 달라 재사용하지 않는다.
export const PAGE_LIMIT_DEFAULT = 500;
export const PAGE_LIMIT_MAX = 2000;
export function clampPageLimit(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) return PAGE_LIMIT_DEFAULT;
  return Math.min(n, PAGE_LIMIT_MAX);
}
export function clampPage(raw: string | null): number {
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

// 한 행(스펙 §3). 그쪽이 집계에 실제로 쓰는 값은 category·amountKrw·timestamp·clinicId 4개. 나머지는 감사·추적용.
export interface MarketingCostItem {
  id: string;
  timestamp: string;        // KST 'YYYY-MM-DD HH:mm:ss' — 지급 요청일(payment_request.created_at)
  clinicId: string;         // LINE 대시보드 클리닉 슬러그(client.clinic_code)
  clinic: string;           // 클리닉 한글명(폴백용)
  category: MarketingCostCategory;
  amountKrw: number;        // 실지급액(원화 정수) — payment_request.gross_krw
  currency: Currency;       // 지급(요청) 통화
  originalAmount: number;   // 환산 전 지급액(요청 통화) — payment_request.amount_gross. 참고용, 집계엔 미사용
  splitCount: number;       // cb-x-deck 요청은 이미 클리닉 단위라 항상 1
}

// 직렬화 입력 — 스토어가 SQL에서 뽑아 온 행. timestamp는 SQL(to_char, KST)에서 이미 문자열로 만든다.
export interface MarketingCostSource {
  id: string;
  taskType: TaskType;
  createdAtKst: string;
  clinicCode: string;
  clientName: string;
  grossKrw: number;
  amountGross: number;
  payoutCurrency: Currency;
}
export function toMarketingCostItem(s: MarketingCostSource): MarketingCostItem {
  return {
    id: `xdeck:${s.id}`,
    timestamp: s.createdAtKst,
    clinicId: s.clinicCode,
    clinic: s.clientName,
    category: categoryForTaskType(s.taskType),
    amountKrw: Math.round(s.grossKrw),   // 스펙 §3: 반드시 정수 KRW
    currency: s.payoutCurrency,
    originalAmount: s.amountGross,
    splitCount: 1,
  };
}
