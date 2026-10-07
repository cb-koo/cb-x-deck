'use client';
import { useEffect, useState } from 'react';
import type { PaymentRequestRow, RevisionHistoryRow } from '@/lib/settlementStore';
import { fetchRevisions } from '@/lib/settlementApi';
import { formatMoney } from '@/lib/influencerPricing';
import { ChangeEntry } from '@/components/ChangeEntry';

// 개정 이력 블록(스펙 2026-09-07 §6) — 고친 요청에만. 모양은 작업 금액 변경 이력과 같다(시각·사람 / 전→후 / 사유, 스펙 2026-10-07 §8-6).
export function RevisionHistory({ r }: { r: PaymentRequestRow }) {
  const [rows, setRows] = useState<RevisionHistoryRow[] | null>(null);
  useEffect(() => {
    if (r.revision === 0) return;
    let on = true;
    void fetchRevisions(r.id).then((x) => { if (on && x.ok) setRows(x.data.revisions); });
    return () => { on = false; };
  }, [r.id, r.revision]);
  if (r.revision === 0) return null;
  return (
    <section className="mt-4 border-t border-x-border pt-3">
      <h3 className="text-[14px] font-semibold">개정 이력 <span className="font-normal text-x-muted">· 지금은 {r.revision + 1}판</span></h3>
      {!rows ? <p className="mt-1 text-[14px] text-x-muted">불러오는 중…</p> : (
        <ol className="mt-1 divide-y divide-x-border/60">
          {rows.map((h, i) => {
            const next = rows[i + 1]?.snapshot ?? r;   // 다음 판 = 이력의 다음 행, 마지막이면 지금 요청
            return (
              <ChangeEntry key={h.revision} at={h.createdAt} by={h.revisedByName} reason={h.reason}
                           change={`${h.revision + 1}판 ${formatMoney(h.snapshot.amountGross, h.snapshot.payoutCurrency)} → ${h.revision + 2}판 ${formatMoney(next.amountGross, next.payoutCurrency)}`}>
                {h.partnerConfirmed && <p className="text-[14px] text-x-muted">정산팀 확인 후</p>}
                {h.snapshot.externalNote && <p className="text-[14px] text-x-muted">정산팀 메모 “{h.snapshot.externalNote}”{h.snapshot.externalOperatorName ? `(${h.snapshot.externalOperatorName})` : ''}</p>}
              </ChangeEntry>
            );
          })}
        </ol>
      )}
    </section>
  );
}
