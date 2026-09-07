'use client';
import { useEffect, useState } from 'react';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import type { RevisionHistoryRow } from '@/lib/settlementStore';
import { fetchRevisions } from '@/lib/settlementApi';
import { formatMoney } from '@/lib/influencerPricing';
import { kstDateTime } from '@/lib/datetime';

// 개정 이력 블록(스펙 2026-09-07 §6) — 고친 요청에만 그린다. "1판 ¥8,000 → 2판 ¥8,421 · 9/7 12:50 · 박구건 · 사유 · 그쪽 메모(담당자)".
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
    <section className="mt-3 border-t border-x-border pt-3">
      <h3 className="text-ui font-semibold">개정 이력 <span className="font-normal text-x-muted">· 지금은 {r.revision + 1}판</span></h3>
      {!rows ? <p className="mt-1 text-ui text-x-muted">불러오는 중…</p> : (
        <ol className="mt-1 space-y-1 text-ui">
          {rows.map((h, i) => {
            const next = rows[i + 1]?.snapshot ?? r;   // 다음 판 = 이력의 다음 행, 마지막이면 지금 요청
            return (
              <li key={h.revision} className="text-x-secondary">
                <span className="text-x-text">{h.revision + 1}판 {formatMoney(h.snapshot.amountGross, h.snapshot.payoutCurrency)} → {h.revision + 2}판 {formatMoney(next.amountGross, next.payoutCurrency)}</span>
                {' · '}{kstDateTime(h.createdAt)} · {h.revisedByName} · {h.reason}
                {h.snapshot.externalNote && <span className="text-x-muted"> · 정산 쪽 메모 “{h.snapshot.externalNote}”{h.snapshot.externalOperatorName ? `(${h.snapshot.externalOperatorName})` : ''}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
