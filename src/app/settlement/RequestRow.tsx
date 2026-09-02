'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { describeSnapshot } from '@/lib/settlementCalc';
import { displayStatus, TONE_CLASS, paidText } from '@/lib/settlementDisplay';
import { proofUploadedLine } from '@/lib/taskProofGuard';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PartnerResultBlock } from './PartnerResultBlock';

export function RequestRow({ r, open, proofSignedUrl, onToggle, onCancel, onChanged }: { r: PaymentRequestRow; open: boolean; proofSignedUrl: string | null; onToggle: () => void; onCancel: () => void; onChanged: () => void }) {
  const [zoom, setZoom] = useState(false);
  const cancelled = r.status === 'cancelled';
  const paid = r.externalStatus === 'paid';
  const st = displayStatus(r, 'list');
  const costAmount = r.costCurrency === 'KRW' ? r.amountKrw : Math.round(r.amountKrw / r.rateKrwPerJpy);
  const base = r.costCurrency === r.payoutCurrency ? formatMoney(r.amountNet, r.payoutCurrency) : `${formatMoney(costAmount, r.costCurrency)} → ${formatMoney(r.amountNet, r.payoutCurrency)}`;
  return (
    <li className="px-4 py-3" style={{ minHeight: 76 }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="block w-full text-left text-[15px]">
        <div className="flex items-center gap-3">
          <span className="font-semibold">@{r.influencerHandle}</span>
          <span className="rounded-full border border-x-border px-2 py-0.5 text-ui">{TASK_TYPE_LABEL[r.taskType]}</span>
          <span className="text-x-secondary truncate">{r.clientName} · {r.campaignName}</span>
          <span className="ml-auto tabular-nums font-medium whitespace-nowrap">{base}{r.feeAmount > 0 && <span className="ml-1 text-x-muted font-normal">+ {r.feeAmount.toLocaleString('ko-KR')}</span>}</span>
          <span className="text-ui text-x-secondary whitespace-nowrap">{PAYMENT_TYPE_LABEL[r.paymentMethod.type]}</span>
          <span className={`rounded-full px-2 py-0.5 text-ui whitespace-nowrap ${TONE_CLASS[st.tone]}`} title={st.title}>{st.label}</span>
        </div>
        <div className="mt-1 pl-0 text-ui text-x-muted">마감 {r.deadlineOn} · 요청자 {r.requesterName}{paid && r.paidAmountKrw !== null && <> · {paidText(r.grossKrw, r.paidAmountKrw)}</>}</div>
      </button>
      {open && (
        <div className="mt-3 rounded-xl bg-x-surface p-4 text-ui">
          <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-1.5">
            <Item k="요청자" v={r.requesterName} />
            <Item k="클리닉" v={r.clientName} />
            <Item k="분류" v={r.category} sub={r.categoryDefault && r.categoryDefault !== r.category ? `미리 채운 값: ${r.categoryDefault}` : undefined} />
            <Item k="항목" v={r.itemText} />
            <Item k="목적" v={r.purposeText} />
            {/* 금액은 통화별로 줄을 나눈다 — 한 줄에 송금액·순액·수수료·단가·실지출 다섯 숫자가 몰리면 어느 게 어느 건지 안 읽힌다(koo 09-01).
                '원화' 줄은 엔화로 보낼 때만: 원화로 보내면 송금액이 곧 원화라 같은 숫자가 두 번 나오고,
                그 경우 단가는 아래 '순액'이 이미 말해 준다(원화 지급이면 순액 = 단가). */}
            <Item k="송금액" v={formatMoney(r.amountGross, r.payoutCurrency)}
                  sub={r.feeAmount > 0
                    ? `순액 ${formatMoney(r.amountNet, r.payoutCurrency)} + 송금 수수료 ${formatMoney(r.feeAmount, r.payoutCurrency)}`
                    : undefined} />
            {r.payoutCurrency === 'JPY' && (
              <Item k="원화"
                    v={r.grossKrw !== r.amountKrw ? `실지출 ${formatMoney(r.grossKrw, 'KRW')}` : formatMoney(r.amountKrw, 'KRW')}
                    sub={[
                      // 수수료를 원화로도 적는다 — 여기가 "실질 비용"을 보는 자리인데 차액을 사용자가 직접 빼게 두면 안 된다(koo 09-01).
                      // 값은 실지출 − 단가로 낸다(수수료×환율이 아니라): 화면의 덧셈이 언제나 맞아떨어져야 한다(원가 원화→엔화 환산 시 반올림이 섞인다).
                      r.grossKrw !== r.amountKrw
                        ? `단가 ${formatMoney(r.amountKrw, 'KRW')} + 송금 수수료 ${formatMoney(r.grossKrw - r.amountKrw, 'KRW')}`
                        : null,
                      `환율 ${r.rateKrwPerJpy}원 = 1엔`,
                    ].filter(Boolean).join(' · ')} />
            )}
            <Item k="데드라인" v={r.deadlineOn} />
            <Item k="결제수단" v={describeSnapshot(r.paymentMethod)} />
            {/* 증빙 2026-09-01-proof-to-partner-design.md §6: 투고·인용RT·방문은 이 링크(인플루언서 본인 게시물)가
                정산 쪽 확인 자료다 — RT는 아니다(원본 트윗이라 증거가 안 된다, 아래 증빙 줄 참고). */}
            <Item k="참고자료" v={r.referenceUrl ? <a href={r.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline break-all">{r.referenceUrl}</a> : '—'}
                  sub={r.referenceUrl && r.taskType !== 'rt' ? '이 링크가 정산 쪽 확인 자료예요' : undefined} />
            {/* 증빙이 필요 없는 유형(투고·인용RT·방문)엔 이 줄 자체를 안 그린다 — RT가 아니면서 증빙도 없는 행에
                '증빙 —'가 남으면 "빠진 것"으로 읽힌다(리뷰 수정 4). 여기서는 자리가 남아 64px 썸네일을 유지한다.
                증빙이 정산 쪽에 나가는 것은 RT뿐이다(§4·§6) — 나가지 않는 그 외 유형까지 이 줄이 뜨는 경우
                (있는 자료를 숨기지 않는다, settlementStore.test.ts)엔 "정산에는 안 보내요"가 여전히 맞는 말이다. */}
            {(r.taskType === 'rt' || r.proof) && (
              <Item k="증빙" v={r.proof
                ? (proofSignedUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={proofSignedUrl} alt="증빙 스크린샷" onClick={() => setZoom(true)}
                         className="h-16 w-16 cursor-zoom-in rounded border border-x-border object-cover" />
                  : '있음')
                : '—'} sub={<>{r.proof ? proofUploadedLine(r.proof.byName, r.proof.at) : null}
                              <div className="text-x-muted">
                                {r.taskType === 'rt'
                                  ? (r.proof ? '정산 프로덕트도 이 증빙을 봐요' : '증빙을 올리면 정산 프로덕트에도 자동으로 전달돼요')
                                  : '정산에는 안 보내요 (우리 보관용)'}
                              </div></>} />
            )}
            <Item k="메모" v={r.note || '—'} />
          </dl>
          <PartnerResultBlock r={r} onChanged={onChanged} />
          <div className="mt-3 flex items-center justify-between text-x-muted">
            <span>만든 사람 {r.requesterName} · {new Date(r.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {cancelled && <> · <span className="text-x-secondary">취소 · {r.cancelledByName} · {r.cancelledAt ? new Date(r.cancelledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''} · {r.cancelReason}</span></>}
            </span>
            {!cancelled && (paid
              ? <span className="text-x-secondary">지급 완료된 요청은 취소할 수 없어요 — 정산 담당자에게 알려 주세요</span>
              : <Button onClick={onCancel}>취소</Button>)}
          </div>
        </div>
      )}
      {zoom && proofSignedUrl && <ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </li>
  );
}
function Item({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (<><dt className="text-x-secondary">{k}</dt><dd className="min-w-0">{v}{sub && <div className="text-x-muted">{sub}</div>}</dd></>);
}
