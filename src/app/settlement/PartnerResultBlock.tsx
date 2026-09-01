'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';
import { kstDateTime } from '@/lib/datetime';
import { paidDiff, needsDiffAck, EXTERNAL_STATUS_LABEL } from '@/lib/settlementDisplay';
import { ackDiffApi, unackDiffApi } from '@/lib/settlementApi';

// 요청 펼침의 두 번째 블록 — '정산 프로덕트가 보낸 결과'. 위 블록(우리가 보낸 요청 내용)과 시각적으로 분리해서
// 어느 값이 누구 것인지 헷갈리지 않게 한다(spec §7). 처리 상태 라벨은 settlementDisplay.ts가 유일한 출처.
export function PartnerResultBlock({ r, onChanged }: { r: PaymentRequestRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!r.externalStatus) {
    return <p className="mt-3 border-t border-x-border pt-3 text-ui text-x-muted">아직 정산 쪽에서 확인 전이에요</p>;
  }

  const diff = paidDiff(r);
  const needsAck = needsDiffAck(r);

  async function run(kind: 'ack' | 'unack') {
    setBusy(true); setErr('');
    const res = kind === 'ack' ? await ackDiffApi(r.id) : await unackDiffApi(r.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onChanged();
  }

  return (
    <section className="mt-3 border-t border-x-border pt-3">
      <div className="flex items-baseline gap-2">
        <h3 className="text-ui font-semibold">정산 프로덕트가 보낸 결과</h3>
        <span className="text-ui text-x-muted">{kstDateTime(r.externalUpdatedAt)} 받음</span>
      </div>
      <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5 text-ui">
        <dt className="text-x-secondary">처리 상태</dt>
        <dd>{EXTERNAL_STATUS_LABEL[r.externalStatus]}</dd>

        {r.paidAmountKrw !== null && <>
          <dt className="text-x-secondary">실지급액</dt>
          <dd>{formatMoney(r.paidAmountKrw, 'KRW')}
            {diff !== null && diff !== 0 && (
              <span className="ml-2 text-amber-700">
                우리가 보낸 송금액 {formatMoney(r.grossKrw, 'KRW')}보다 {Math.abs(diff).toLocaleString('ko-KR')}원 {diff < 0 ? '적어요' : '많아요'}
              </span>
            )}
          </dd>
        </>}

        {r.paidAt && <><dt className="text-x-secondary">지급 시각</dt><dd>{kstDateTime(r.paidAt)}</dd></>}

        <dt className="text-x-secondary">메모</dt>
        <dd>{r.externalNote ?? <span className="text-x-muted">— 정산 쪽이 안 적었어요</span>}</dd>

        <dt className="text-x-secondary">그쪽 건 번호</dt>
        <dd>{r.externalId ?? <span className="text-x-muted">— 아직 보내오지 않아요</span>}</dd>
      </dl>

      {needsAck && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-ui text-amber-700">차액 확인이 필요해요</p>
            <Button onClick={() => void run('ack')} disabled={busy}>확인함</Button>
          </div>
          <p className="mt-1 text-ui text-x-muted">정산 쪽 조정 금액을 확인했다는 표시예요 — 사유는 정산 쪽 메모에만 있어요.</p>
        </div>
      )}

      {r.diffAckAt && diff !== null && diff !== 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-ui">
          <span className="text-x-secondary">차액 확인 · 확인함 · {r.diffAckByName} · {kstDateTime(r.diffAckAt)}</span>
          <Button onClick={() => void run('unack')} disabled={busy}>확인 취소</Button>
        </div>
      )}

      {err && <p role="alert" className="mt-2 text-ui text-red-700">{err}</p>}

      <a href={`/settlement?tab=log&request=${r.id}`} className="mt-3 inline-block text-ui text-x-blue-text hover:underline">
        이 요청의 호출 기록 보기 →
      </a>
    </section>
  );
}
