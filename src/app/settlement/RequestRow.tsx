'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { describeSnapshot } from '@/lib/settlementCalc';
import { displayStatus, TONE_CLASS, taskPaidMismatch, requestCostOf } from '@/lib/settlementDisplay';
import { sameTaskCost } from '@/lib/campaignCost';
import { CELL, COLS, NUM, TYPE_CHIP, METHOD_CHIP, signedMoney } from './tableStyle';
import { proofUploadedLine } from '@/lib/taskProofGuard';
import { signPaymentQrUrl } from '@/lib/paymentQr';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PartnerResultBlock } from './PartnerResultBlock';
import { RevisionHistory } from './RevisionHistory';

export function RequestRow({ r, open, proofSignedUrl, revisionEnabled, onToggle, onCancel, onRevise, onMatch, onKeep, onChanged }: {
  r: PaymentRequestRow; open: boolean; proofSignedUrl: string | null; revisionEnabled: boolean;
  onToggle: () => void; onCancel: () => void; onRevise: () => void; onMatch: () => void; onKeep: () => void; onChanged: () => void;
}) {
  const [zoom, setZoom] = useState(false);
  const cancelled = r.status === 'cancelled';
  const paid = r.externalStatus === 'paid';
  const st = displayStatus(r, 'list');
  // 판정은 지금 작업 금액 vs 정산팀 지급(스펙 2026-10-07 §4) — '다름'이면 상태 칸에 배지 대신 두 버튼(§8-2)
  const mm = taskPaidMismatch(r);
  // '작업 금액' = 지금 작업 금액. 요청에 담긴 금액과 다르면 아래 작은 글씨로 `요청 {금액}`(§8-3)
  const reqCost = requestCostOf(r);
  const showReqCost = r.taskCost !== null && !sameTaskCost(r.taskCost, reqCost);
  // 표 한 줄 = 요청 하나, 칸마다 값 하나(koo 09-28) — 수수료는 송금액에 합치고 내역은 title로.
  const sendTitle = r.feeAmount > 0 ? `순액 ${formatMoney(r.amountNet, r.payoutCurrency)} + 송금 수수료 ${formatMoney(r.feeAmount, r.payoutCurrency)}` : undefined;
  const hasPaid = paid && r.paidAmountKrw !== null;
  // 정산팀 지급 — 판정에 쓰는 통화로(원화 지급=원화, 엔화 지급+엔화 값=엔화, 그 밖=원화).
  const paidCell = !hasPaid ? null
    : r.payoutCurrency === 'JPY' && r.paidAmountJpy !== null ? formatMoney(r.paidAmountJpy, 'JPY') : formatMoney(r.paidAmountKrw as number, 'KRW');
  return (
    <>
      <tr onClick={onToggle} aria-expanded={open} className={`cursor-pointer text-[15px] hover:bg-x-hover ${open ? 'bg-x-hover/60' : ''}`}>
        <td className={`${CELL} font-semibold`}>@{r.influencerHandle}</td>
        <td className={CELL}><span className={TYPE_CHIP[r.taskType]}>{TASK_TYPE_LABEL[r.taskType]}</span></td>
        <td className={`${CELL} ${NUM}`}>
          {r.taskCost ? formatMoney(r.taskCost.amount, r.taskCost.currency) : <span className="text-x-muted">—</span>}
          {showReqCost && <span className="block text-ui text-x-muted">요청 {formatMoney(reqCost.amount, reqCost.currency)}</span>}
        </td>
        <td className={`${CELL} ${NUM}`} title={sendTitle}>{formatMoney(r.amountGross, r.payoutCurrency)}</td>
        {/* 옅은 세로선 — 왼쪽은 우리가 보낸 값, 오른쪽은 정산팀이 알려 준 결과 */}
        <td className={`${CELL} ${NUM} border-l border-x-border`}>{paidCell ?? <span className="text-x-muted">—</span>}</td>
        <td className={`${CELL} ${NUM}`}>
          {mm ? <span className="text-amber-700">{signedMoney(mm.diff, mm.currency)}</span> : <span className="text-x-muted">—</span>}
        </td>
        <td className={CELL}><span className={METHOD_CHIP}>{PAYMENT_TYPE_LABEL[r.paymentMethod.type]}</span></td>
        <td className={CELL}>
          {mm ? (
            // 행 클릭(펼치기)과 겹치지 않게 — 버튼 줄에서 이벤트를 멈춘다. 확정(맞추기)이 오른쪽·진한 버튼
            <span className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button onClick={onKeep}>그대로 두기</Button>
              <Button variant="primary" onClick={onMatch}>지급 금액에 맞추기</Button>
            </span>
          ) : (
            <span className={`rounded-full px-2.5 py-0.5 text-ui whitespace-nowrap ${TONE_CLASS[st.tone]}`} title={st.title}>{st.label}</span>
          )}
        </td>
        <td className={`${CELL} w-8 text-x-muted`} aria-hidden>{open ? '▾' : '▸'}</td>
      </tr>
      {open && (
        <tr><td colSpan={COLS} className="px-4 pb-4">
        <div className="rounded-xl bg-x-surface p-4 text-ui">
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
            {/* 정산 쪽이 이번 건의 수취 정보를 고친 경우(056·057) — 이제 이 요청과 인플루언서 명부에 함께 반영된다(고친 항목만 병합).
                더는 명부를 따로 확인할 필요가 없다. [고친 값으로 다시 반영]도 명부가 이미 같은 값이라 되돌아가지 않는다. */}
            <Item k="결제수단" v={describeSnapshot(r.paymentMethod)}
                  sub={(r.paymentMethodCorrection || r.paymentMethod.qr)
                    ? <>
                        {r.paymentMethodCorrection && (
                          <span className="text-x-secondary">정산 쪽이 수취 정보를 고쳤어요 · {r.paymentMethodCorrection.byName} · {new Date(r.paymentMethodCorrection.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}{r.paymentMethodCorrection.reason ? <> — {r.paymentMethodCorrection.reason}</> : null}
                            <span className="block text-x-muted">이 요청과 인플루언서 명부에 함께 반영됐어요</span></span>
                        )}
                        {/* QR만 주는 인플이 있어 명부와 같은 모양의 미리보기를 여기서도 보여준다 — 보낼 때 무엇이
                            나가는지 요청을 펼친 자리에서 바로 확인할 수 있어야 한다(스펙 2026-09-22). */}
                        {r.paymentMethod.qr && (
                          <div className={r.paymentMethodCorrection ? 'mt-1.5' : undefined}>
                            <QrPreviewCell path={r.paymentMethod.qr} />
                          </div>
                        )}
                      </>
                    : undefined} />
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
          <RevisionHistory r={r} />
          <div className="mt-3 flex items-center justify-between gap-3 text-x-muted">
            <span>만든 사람 {r.requesterName} · {new Date(r.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
              {cancelled && <> · <span className="text-x-secondary">취소 · {r.cancelledByName} · {r.cancelledAt ? new Date(r.cancelledAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : ''} · {r.cancelReason}</span></>}
            </span>
            {!cancelled && (paid
              ? <span className="text-x-secondary">지급 완료된 요청은 취소·수정할 수 없어요 — 정산 담당자에게 알려 주세요</span>
              : (
                <span className="flex items-center gap-2">
                  {/* 제자리 수정(스펙 2026-09-07 §6) — 전환 스위치가 켜진 뒤에만. 그 전엔 종전대로 취소 → 검토 대기에서 새로 요청 */}
                  {revisionEnabled && <Button onClick={onRevise} title="프로필·캠페인에서 고친 값을 이 요청에 반영해요 — 정산 쪽에는 같은 건의 수정으로 전달돼요">고친 값으로 다시 반영</Button>}
                  <Button onClick={onCancel}>취소</Button>
                </span>
              ))}
          </div>
        </div>
        {zoom && proofSignedUrl && <ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
        </td></tr>
      )}
    </>
  );
}
function Item({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (<><dt className="text-x-secondary">{k}</dt><dd className="min-w-0">{v}{sub && <div className="text-x-muted">{sub}</div>}</dd></>);
}

// 명부(PaymentSection.tsx QrPreviewCell)와 같은 모양 — 마운트 시 한 번 서명해 작은 미리보기를
// 보여주고 눌러서 확대만 한다. 호출부가 key={path}로 그리지 않지만 path가 요청 하나에 고정이라
// (수단이 바뀌면 새 요청) 재서명이 필요 없다.
function QrPreviewCell({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signPaymentQrUrl(path)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) return <span className="text-x-muted">미리보기를 불러오지 못했어요</span>;
  if (!url) return <span className="text-x-muted">불러오는 중…</span>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="QR 이미지" onClick={() => setZoom(true)}
           className="h-[72px] w-[72px] cursor-zoom-in rounded-md border border-x-border bg-white object-contain" />
      {zoom && <ImageLightbox urls={[url]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </>
  );
}
