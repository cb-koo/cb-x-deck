'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';
import { kstDateTime } from '@/lib/datetime';
import { paidDiff, needsDiffAck, EXTERNAL_STATUS_LABEL, usdText } from '@/lib/settlementDisplay';
import { ackDiffApi, unackDiffApi } from '@/lib/settlementApi';

// 요청 펼침의 두 번째 블록 — '정산 프로덕트가 보낸 결과'. 위 블록(우리가 보낸 요청 내용)과 시각적으로 분리해서
// 어느 값이 누구 것인지 헷갈리지 않게 한다(spec §7). 처리 상태 라벨은 settlementDisplay.ts가 유일한 출처.
export function PartnerResultBlock({ r, onChanged }: { r: PaymentRequestRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // "그쪽은 보냈다는데 우리 화면엔 없다" 조사가 시작되는 지점이 바로 여기(externalStatus 없음)다 —
  // 호출 기록 링크가 가장 필요한 상태이므로 아래 블록과 똑같은 링크를 여기서도 보여준다.
  const logLink = (
    <a href={`/settlement?tab=log&request=${r.id}`} className="mt-3 inline-block text-ui text-x-blue-text hover:underline">
      이 요청의 호출 기록 보기 →
    </a>
  );

  if (!r.externalStatus) {
    return (
      <div className="mt-3 border-t border-x-border pt-3">
        <p className="text-ui text-x-muted">아직 정산 쪽에서 확인 전이에요</p>
        {logLink}
      </div>
    );
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

        {/* 그쪽이 사람이 실행한 전이(취소·보류·재개·지급)에만 담당자를 실어 보낸다(09-04). 자동 전이면 키가 없어 null → 줄을 그리지 않는다.
            "누가 처리했는지"가 없다고 해서 빠진 것이 아니라 시스템이 자동으로 넘긴 것이다. */}
        {r.externalOperatorName && <>
          <dt className="text-x-secondary">처리한 사람</dt>
          <dd>{r.externalOperatorName} <span className="text-x-muted">· 정산 프로덕트 담당자</span></dd>
        </>}

        {r.paidAmountKrw !== null && <>
          <dt className="text-x-secondary">실지급액</dt>
          {/* 세 줄로 나눈다 — 원화 금액 / 달러 송금액(PayPal, 그쪽 09-09) / 우리 송금액과의 차이. 한 줄에 이어 붙이면
              "8,734원달러로 $6.51 송금우리가 보낸…"처럼 읽힌다(koo 09-09). 달러는 "환율 차이인가"를 판단하는 근거라 원화 바로 아래에. */}
          <dd>
            <div className="font-medium">{formatMoney(r.paidAmountKrw, 'KRW')}</div>
            {r.paidAmountUsd !== null && <div className="text-x-secondary">달러 {usdText(r.paidAmountUsd)}로 송금됨 <span className="text-x-muted">· 원화는 정산 쪽 환산값</span></div>}
            {r.paidAmountJpy !== null && <div className="text-x-secondary">엔화 {formatMoney(r.paidAmountJpy, 'JPY')}로 송금됨 <span className="text-x-muted">· 원화는 정산 쪽 환산값</span></div>}
            {diff !== null && diff !== 0 && (
              <div className="text-amber-700">우리가 보낸 송금액 {formatMoney(r.grossKrw, 'KRW')}보다 {Math.abs(diff).toLocaleString('ko-KR')}원 {diff < 0 ? '적어요' : '많아요'}</div>
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

      {logLink}
    </section>
  );
}
