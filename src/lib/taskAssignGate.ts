// 작업·원고에 사람을 넣을 때의 서버 관문(설계 §9·§8-2) — 라우트 5곳과 campaignTaskStore.attachDraft가 같이 쓴다.
// 잎 모듈이다: campaignTaskStore가 값으로 import하므로 여기서 influencerStore·draftStore를 import하면
// campaignTaskStore ↔ draftStore 순환이 생긴다(campaignTaskStore.ts 머리 주석). 명부는 SQL 한 줄로 직접 본다.
import type postgres from 'postgres';
import { PAYMENT_NOT_FOUND, type PaymentMethod } from './influencerPayment.ts';   // 순수 모듈 — 잎 성질 유지
import { PAYMENT_METHOD_NO_INFLUENCER_MESSAGE } from './campaignTaskInput.ts';   // 순수 모듈(스토어는 type만) — 순환 없음

// 라우트가 400으로 돌려주는 문구 — 무엇을 하면 되는지까지 말한다(옛 /campaigns 화면도 이 문구를 그대로 띄운다)
export const ROSTER_REQUIRED_MESSAGE = '명부에 없는 인플이에요 — 명부에 먼저 등록해 주세요';

// 명부 표기 핸들(대소문자 무관 비교, 지금 관례) 또는 null. 저장은 이 표기로 맞춘다(§9 "저장 표기는 명부 표기로").
export async function rosterHandleOf(sql: postgres.Sql, handle: string): Promise<string | null> {
  const rows = await sql<Array<{ handle: string }>>`
    select handle from influencer where lower(handle) = lower(${handle}) limit 1`;
  return rows[0]?.handle ?? null;
}

// 라우트 문구 — 결제 수단(설계 §8-2). 409는 잠금, 400은 고를 수 없는 경우.
export const PAYMENT_METHOD_LOCKED_MESSAGE = '정산 요청된 작업이에요 — 결제 수단을 바꾸려면 정산 화면에서 요청을 먼저 취소해 주세요';

// 작업이 고를 결제 수단이 그 인플의 지금 목록에 있는가(설계 §8-2). 오류 문구 또는 null.
// 인플이 없으면 parseTaskPatch와 같은 문구(요청 모양과 무관하게 한 문구). 명부 밖 핸들이면 고를 수단 자체가 없다 — '없음'과 같은 문구(새로고침하면 화면이 명부 상태를 다시 보여 준다).
export async function checkTaskPaymentMethod(sql: postgres.Sql, handle: string | null, methodId: string): Promise<string | null> {
  if (!handle) return PAYMENT_METHOD_NO_INFLUENCER_MESSAGE;
  const rows = await sql<Array<{ payment_methods: unknown }>>`
    select payment_methods from influencer where lower(handle) = lower(${handle}) limit 1`;
  const list = Array.isArray(rows[0]?.payment_methods) ? (rows[0].payment_methods as PaymentMethod[]) : [];
  return list.some((m) => m.id === methodId) ? null : PAYMENT_NOT_FOUND;
}

// 수단을 못 바꾸게 막는 '살아 있는 요청' — 작업 패널의 잠금 표시(paymentView.loadPaymentView)·단계 판정(flowStage)과 같은 조건.
// 요청 뒤에 수단을 바꾸면 제자리 수정(reviseRequest)이 후보를 다시 계산하며 스냅샷이 조용히 바뀐다 — UI 잠금만으론 못 막는다.
export async function hasLiveRequest(sql: postgres.Sql, taskId: string): Promise<boolean> {
  const r = await sql<Array<{ n: string | number }>>`
    select count(*) as n from payment_request
     where task_id = ${taskId} and status = 'requested' and coalesce(external_status, '') <> 'cancelled'`;
  return Number(r[0].n) > 0;
}
