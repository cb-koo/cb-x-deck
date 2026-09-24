// 작업 패널의 '결제 수단' 한 줄(설계 §8-1) — 이 작업에 쓰일 수단을 한 곳에서 판정한다.
// 요청을 보낸 뒤(단계 정산·완료)에는 요청에 담긴 스냅샷이 사실이다 — 명부 수단이 그 뒤에 바뀌어도 송금은 스냅샷대로 간다.
import type postgres from 'postgres';
import { feeShortLabel, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { describeSnapshot, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { toPaymentChoices, resolvePaymentChoice, type FeeChip, type PaymentChoice } from './paymentChoice.ts';
import { isUuidLike } from './uuid.ts';

export type { FeeChip } from './paymentChoice.ts';   // 1단계 화면이 여기서 가져가던 이름 유지
export type PaymentView =
  | { state: 'notInRoster' }
  | { state: 'none'; influencerId: string }   // influencerId: 패널의 [+ 등록]이 이 인플에 수단을 추가한다(§8-3)
  // label·fee = 이 작업의 수단(resolvePaymentChoice — 작업이 고른 게 있으면 그것, 없으면 기본). choices = 고를 목록(§8-2)
  // fallback = 작업이 고른 id가 그 사이 지워져 기본으로 떨어졌다 — 화면이 '기본 수단으로 바뀜 ⓘ'로 알린다(§10)
  | { state: 'ok'; label: string; fee: FeeChip; influencerId: string; choices: PaymentChoice[]; fallback: boolean }
  // paid = 정산 프로덕트가 지급 완료를 보냈다(external_status 'paid') — flowStage의 '완료' 판정과 같은 조건
  | { state: 'requested'; label: string; fee: FeeChip; paid: boolean };

export function buildPaymentView(input: {
  request: { method: PaymentMethodSnapshot; fee: PaymentFee | null; paid: boolean } | null;
  roster: { id: string; methods: PaymentMethod[] } | null;
  chosenId: string | null;
}): PaymentView {
  if (input.request) {
    const m = input.request.method;
    // describeSnapshot은 슬랙 양식(`수단 | 수취인 | 식별`)이라 패널 한 줄엔 ' · '로 바꿔 쓴다
    return { state: 'requested', label: describeSnapshot(m).split(' | ').filter(Boolean).join(' · '), fee: feeShortLabel(input.request.fee, m.currency), paid: input.request.paid };
  }
  if (!input.roster) return { state: 'notInRoster' };
  // "이 작업의 수단" 판정은 taskPaymentMethod 하나(resolvePaymentChoice가 그 위에 얹은 것) — 여기서 다시 만들지 않는다(전역 제약).
  const choices = toPaymentChoices(input.roster.methods);
  const { choice, fallback } = resolvePaymentChoice(choices, input.chosenId);
  if (!choice) return { state: 'none', influencerId: input.roster.id };
  return { state: 'ok', label: choice.label, fee: choice.fee, influencerId: input.roster.id, choices, fallback };
}

export async function loadPaymentView(sql: postgres.Sql, q: { handle: string; taskId: string | null }): Promise<PaymentView> {
  let request: { method: PaymentMethodSnapshot; fee: PaymentFee | null; paid: boolean } | null = null;
  let chosenId: string | null = null;
  if (q.taskId && isUuidLike(q.taskId)) {
    // 활성 요청만 — campaignJudgment.ts의 flowStage(`settlement?.status === 'requested' && settlement.externalStatus !== 'cancelled'`)와
    // 같은 조건. coalesce(external_status,'')<>'cancelled'는 null(그쪽이 아직 안 봄)일 때도 참이라 externalStatus !== 'cancelled'와 동치.
    // 우리가 취소했거나(status='cancelled') 그쪽이 취소한 요청(external_status='cancelled')은 없는 것으로 본다.
    const rows = await sql<Array<{ payment_method: PaymentMethodSnapshot; fee: PaymentFee | null; external_status: string | null }>>`
      select payment_method, fee, external_status from payment_request
       where task_id = ${q.taskId} and status = 'requested' and coalesce(external_status, '') <> 'cancelled'
       order by created_at desc limit 1`;
    if (rows[0]) request = { method: rows[0].payment_method, fee: rows[0].fee, paid: rows[0].external_status === 'paid' };
    // 작업이 고른 수단(060) — 활성 요청이 없을 때만 쓰인다(요청이 있으면 위에서 이미 반환)
    const taskRows = await sql<Array<{ payment_method_id: string | null }>>`
      select payment_method_id from campaign_task where id = ${q.taskId} limit 1`;
    chosenId = taskRows[0]?.payment_method_id ?? null;
  }
  const inf = await sql<Array<{ id: string; payment_methods: unknown }>>`
    select id, payment_methods from influencer where lower(handle) = lower(${q.handle}) limit 1`;
  const roster = inf[0] ? { id: inf[0].id, methods: Array.isArray(inf[0].payment_methods) ? (inf[0].payment_methods as PaymentMethod[]) : [] } : null;
  return buildPaymentView({ request, roster, chosenId });
}
