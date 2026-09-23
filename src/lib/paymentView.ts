// 작업 패널의 '결제 수단' 한 줄(설계 §8-1) — 이 작업에 쓰일 수단을 한 곳에서 판정한다.
// 요청을 보낸 뒤(단계 정산·완료)에는 요청에 담긴 스냅샷이 사실이다 — 명부 수단이 그 뒤에 바뀌어도 송금은 스냅샷대로 간다.
import type postgres from 'postgres';
import { describeMethod, getDefaultPaymentMethod, feeShortLabel, type PaymentMethod, type PaymentFee } from './influencerPayment.ts';
import { describeSnapshot, type PaymentMethodSnapshot } from './settlementCalc.ts';
import { isUuidLike } from './uuid.ts';

export type FeeChip = { text: string; cb: boolean };
export type PaymentView =
  | { state: 'notInRoster' }
  | { state: 'none' }
  | { state: 'ok'; label: string; fee: FeeChip }
  // paid = 정산 프로덕트가 지급 완료를 보냈다(external_status 'paid') — flowStage의 '완료' 판정과 같은 조건
  | { state: 'requested'; label: string; fee: FeeChip; paid: boolean };

export function buildPaymentView(input: {
  request: { method: PaymentMethodSnapshot; fee: PaymentFee | null; paid: boolean } | null;
  roster: { methods: PaymentMethod[] } | null;
}): PaymentView {
  if (input.request) {
    const m = input.request.method;
    // describeSnapshot은 슬랙 양식(`수단 | 수취인 | 식별`)이라 패널 한 줄엔 ' · '로 바꿔 쓴다
    return { state: 'requested', label: describeSnapshot(m).split(' | ').filter(Boolean).join(' · '), fee: feeShortLabel(input.request.fee, m.currency), paid: input.request.paid };
  }
  if (!input.roster) return { state: 'notInRoster' };
  const d = getDefaultPaymentMethod(input.roster.methods);
  if (!d) return { state: 'none' };
  return { state: 'ok', label: describeMethod(d), fee: feeShortLabel(d.fee, d.currency) };
}

export async function loadPaymentView(sql: postgres.Sql, q: { handle: string; taskId: string | null }): Promise<PaymentView> {
  let request: { method: PaymentMethodSnapshot; fee: PaymentFee | null; paid: boolean } | null = null;
  if (q.taskId && isUuidLike(q.taskId)) {
    // 활성 요청만 — campaignJudgment.ts의 flowStage(`settlement?.status === 'requested' && settlement.externalStatus !== 'cancelled'`)와
    // 같은 조건. coalesce(external_status,'')<>'cancelled'는 null(그쪽이 아직 안 봄)일 때도 참이라 externalStatus !== 'cancelled'와 동치.
    // 우리가 취소했거나(status='cancelled') 그쪽이 취소한 요청(external_status='cancelled')은 없는 것으로 본다.
    const rows = await sql<Array<{ payment_method: PaymentMethodSnapshot; fee: PaymentFee | null; external_status: string | null }>>`
      select payment_method, fee, external_status from payment_request
       where task_id = ${q.taskId} and status = 'requested' and coalesce(external_status, '') <> 'cancelled'
       order by created_at desc limit 1`;
    if (rows[0]) request = { method: rows[0].payment_method, fee: rows[0].fee, paid: rows[0].external_status === 'paid' };
  }
  const inf = await sql<Array<{ payment_methods: unknown }>>`
    select payment_methods from influencer where lower(handle) = lower(${q.handle}) limit 1`;
  const roster = inf[0] ? { methods: Array.isArray(inf[0].payment_methods) ? (inf[0].payment_methods as PaymentMethod[]) : [] } : null;
  return buildPaymentView({ request, roster });
}
