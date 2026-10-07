// 배포 전 확인(스펙 2026-10-07 §10) — 지급 완료 요청에 새 판정(taskPaidMismatch)을 돌려 '다름' 목록을 찍는다.
// 쓰기 없음: read only 트랜잭션 안에서 select 한 번. 065 적용 전 운영에서도 돌도록 065 칸(diff_ack_kind 등)·task_change는 읽지 않는다
// (처리 기록 없이 본 판정 — 지금 운영엔 처리 기록이 없다).
// 같은 날 비교(peerRatio)는 화면과 같은 함수(withPeerRatios)로 읽은 지급 완료 전체 위에서 계산한다.
// 실행: node --import tsx --env-file=<env 파일> scripts/check-paid-mismatch.ts
import { getSql } from '../src/lib/db.ts';
import { parseTaskCost, type TaskCost } from '../src/lib/campaignCost.ts';
import { taskPaidMismatch, withPeerRatios, type MismatchSource } from '../src/lib/settlementDisplay.ts';
import type { PaymentFee } from '../src/lib/influencerPayment.ts';
import { formatMoney } from '../src/lib/influencerPricing.ts';

type Row = {
  id: string; task_id: string | null; influencer_handle: string; campaign_name: string; payout_currency: 'KRW' | 'JPY';
  fee: PaymentFee | null; rate_krw_per_jpy: string | number; paid_amount_krw: number | null; paid_amount_jpy: string | number | null;
  paid_amount_usd: string | number | null; paid_at: Date | null; external_note: string | null; task_cost: unknown;
};
const costOf = (v: unknown): TaskCost | null => { const p = parseTaskCost(v ?? null); return p.ok ? p.value : null; };
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

(async () => {
  const sql = getSql();
  try {
    console.log(`== target: ${process.env.PGHOST ?? '?'}`);
    const rows = await sql.begin('read only', async (tx) => tx<Row[]>`
      select pr.id, pr.task_id, pr.influencer_handle, pr.campaign_name, pr.payout_currency, pr.fee, pr.rate_krw_per_jpy,
             pr.paid_amount_krw, pr.paid_amount_jpy, pr.paid_amount_usd, pr.paid_at, pr.external_note, t.cost as task_cost
        from payment_request pr left join campaign_task t on t.id = pr.task_id
       where pr.external_status = 'paid' and pr.status <> 'cancelled'
       order by pr.created_at`);
    const sources = rows.map((r) => ({
      id: r.id,
      status: 'requested', externalStatus: 'paid', taskId: r.task_id, taskCost: costOf(r.task_cost),
      payoutCurrency: r.payout_currency, fee: r.fee, rateKrwPerJpy: Number(r.rate_krw_per_jpy),
      paidAmountKrw: r.paid_amount_krw, paidAmountJpy: num(r.paid_amount_jpy), paidAmountUsd: num(r.paid_amount_usd),
      paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null, peerRatio: null,
      diffAckKind: null, diffAckTaskCost: null,
    } satisfies MismatchSource & { id: string }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    let hits = 0;
    for (const s of withPeerRatios(sources)) {
      const m = taskPaidMismatch(s);
      if (!m) continue;
      const r = byId.get(s.id)!;
      hits += 1;
      const cost = s.taskCost ? formatMoney(s.taskCost.amount, s.taskCost.currency) : '—';
      const how = m.kind === 'exact' ? `exact 차이 ${m.diff} ${m.currency}` : `band 비율 ${m.ratio.toFixed(3)} (원화 차이 ${m.diff})`;
      const peer = s.peerRatio != null ? ` · 같은 날 비율 ${s.peerRatio.toFixed(3)}` : '';
      console.log(`@${r.influencer_handle} · ${r.campaign_name} · 작업 ${cost} · 지급 원화 ${r.paid_amount_krw}${r.paid_amount_jpy !== null ? ` / 엔화 ${r.paid_amount_jpy}` : ''}${r.paid_amount_usd !== null ? ` / 달러 ${r.paid_amount_usd}` : ''} · ${how}${peer} · 메모 ${r.external_note ?? '—'} · ${r.id}`);
    }
    console.log(`== 지급 완료 ${rows.length}건 중 '다름' ${hits}건`);
  } finally {
    await sql.end();
  }
})();
