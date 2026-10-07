'use client';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { formatMoney } from '@/lib/influencerPricing';
import { kstDateTime } from '@/lib/datetime';
import { EXTERNAL_STATUS_LABEL, usdText, paidFxRateText } from '@/lib/settlementDisplay';

// 펼침의 오른쪽 블록 — '정산팀이 보낸 결과'(스펙 2026-10-07 §8-6). 왼쪽 '우리가 보낸 요청'과 나란히 두어 어느 값이 누구 것인지 헷갈리지 않게.
// 처리 상태 라벨은 settlementDisplay.ts가 유일한 출처. 빈 값은 '—' 하나(§8-7). 판정·처리는 표와 '처리 기록' 블록이 맡는다.
export function PartnerResultBlock({ r }: { r: PaymentRequestRow }) {
  // "정산팀은 보냈다는데 우리 화면엔 없다" 조사가 시작되는 지점 — 호출 기록 링크는 결과가 없을 때도 보인다
  const logLink = (
    <a href={`/settlement?tab=log&request=${r.id}`} className="mt-3 inline-block text-[14px] text-x-blue-text hover:underline">
      이 요청의 호출 기록 보기 →
    </a>
  );
  const dash = <span className="text-x-muted">—</span>;

  if (!r.externalStatus) {
    return (
      <section>
        <h3 className="text-[14px] font-semibold">정산팀이 보낸 결과</h3>
        <p className="mt-2 text-[14px] text-x-muted">아직 정산팀이 확인 전이에요</p>
        {logLink}
      </section>
    );
  }
  const fx = paidFxRateText(r);
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h3 className="text-[14px] font-semibold">정산팀이 보낸 결과</h3>
        <span className="text-[14px] text-x-muted">{kstDateTime(r.externalUpdatedAt)} 받음</span>
      </div>
      <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        <dt className="text-x-secondary">처리 상태</dt>
        <dd>{EXTERNAL_STATUS_LABEL[r.externalStatus]}</dd>

        {/* 사람이 실행한 전이에만 담당자가 실려 온다(09-04). 자동 전이면 없다 — 줄을 그리지 않는다 */}
        {r.externalOperatorName && <>
          <dt className="text-x-secondary">처리한 사람</dt>
          <dd>{r.externalOperatorName} <span className="text-x-muted">· 정산팀 담당자</span></dd>
        </>}

        {r.paidAmountKrw !== null && <>
          <dt className="text-x-secondary">실지급액</dt>
          <dd>
            <div className="font-medium tabular-nums">{formatMoney(r.paidAmountKrw, 'KRW')}</div>
            {r.paidAmountUsd !== null && <div className="text-x-secondary">달러 {usdText(r.paidAmountUsd)}로 송금됨 <span className="text-x-muted">· 원화는 정산팀 환산값</span></div>}
            {r.paidAmountJpy !== null && <div className="text-x-secondary">엔화 {formatMoney(r.paidAmountJpy, 'JPY')}로 송금됨 <span className="text-x-muted">· 원화는 정산팀 환산값</span></div>}
            {/* 표에서 뺀 환율 정보는 여기서만(§8-4) */}
            {fx && <div className="text-x-muted tabular-nums">{fx}</div>}
          </dd>
        </>}

        {r.paidAt && <><dt className="text-x-secondary">지급 시각</dt><dd>{kstDateTime(r.paidAt)}</dd></>}

        <dt className="text-x-secondary">메모</dt>
        <dd>{r.externalNote ?? dash}</dd>

        <dt className="text-x-secondary">정산팀 건 번호</dt>
        <dd>{r.externalId ?? dash}</dd>
      </dl>
      {logLink}
    </section>
  );
}
