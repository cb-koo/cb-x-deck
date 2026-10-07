'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import type { PaymentRequestRow } from '@/lib/settlementStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { methodLine } from '@/lib/settlementCalc';
import { displayStatus, TONE_CLASS, taskPaidMismatch, requestCostOf, partnerNameLabel, paidSummary, requestSummarySub } from '@/lib/settlementDisplay';
import { kstMonthDayTimeKo, asDateOnly, dateOnlyMonthDayKo } from '@/lib/datetime';
import { sameTaskCost } from '@/lib/campaignCost';
import { CELL, COLS, NUM, TYPE_CHIP, METHOD_CHIP, signedMoney } from './tableStyle';
import { proofUploadedLine } from '@/lib/taskProofGuard';
import { signPaymentQrUrl } from '@/lib/paymentQr';
import { ImageLightbox } from '@/components/ImageLightbox';
import { PartnerResultBlock } from './PartnerResultBlock';
import { RevisionHistory } from './RevisionHistory';
import { ReconcileRecord } from './ReconcileRecord';
import { CARD, CARD_HEAD, CARD_META, ROW, ROW_KEY, GROUP, GROUP_TITLE, DIVIDER, SUB } from './expandStyle';

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
  const paidSum = paidSummary(r);
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
        {/* 펼침(10-07 koo QA 시안 A) — 옅은 회색 바탕 위 흰 카드: 금액 비교 요약 → 두 카드(우리가 보낸 요청 / 정산팀이 보낸 결과) → 개정 이력 → 맨 아래 한 줄 */}
        <div className="flex flex-col gap-4 rounded-[14px] bg-x-surface p-5">
          <section className="flex flex-col gap-4 rounded-xl border border-x-border bg-white px-[22px] py-[18px] md:flex-row md:items-center md:gap-0">
            <SummaryAmount label="작업 금액" amount={r.taskCost ? formatMoney(r.taskCost.amount, r.taskCost.currency) : null}
                           sub={requestSummarySub(r)} subTitle={sendTitle} />
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 aria-hidden className="hidden shrink-0 text-[#9aa5ad] md:mx-7 md:block"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            <SummaryAmount label="정산팀 지급" amount={paidSum.amount} sub={paidSum.sub} warn={!!mm} />
            <ReconcileRecord r={r} mismatch={!!mm} onKeep={onKeep} onMatch={onMatch} onChanged={onChanged} />
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className={CARD}>
              <div className={CARD_HEAD}>
                <h3 className="text-[16px] font-bold">우리가 보낸 요청</h3>
                <span className={CARD_META}>{[r.requesterName, kstMonthDayTimeKo(r.createdAt)].filter(Boolean).join(' · ')}</span>
              </div>
              <div className={GROUP}>
                <div className={GROUP_TITLE}>지급 정보</div>
                {/* 정산팀이 이번 건의 수취 정보를 고친 경우(056·057) — 이 요청과 인플루언서 명부에 함께 반영된다 */}
                <Item k="결제 수단" v={methodLine(r.paymentMethod)}
                      sub={(r.paymentMethodCorrection || r.paymentMethod.qr)
                        ? <>
                            {r.paymentMethodCorrection && (
                              <span className="text-x-secondary">정산팀이 수취 정보를 고쳤어요 · {r.paymentMethodCorrection.byName} · {kstMonthDayTimeKo(r.paymentMethodCorrection.at)}{r.paymentMethodCorrection.reason ? <> — {r.paymentMethodCorrection.reason}</> : null}
                                <span className="block text-x-muted">이 요청과 인플루언서 명부에 함께 반영됐어요</span></span>
                            )}
                            {r.paymentMethod.qr && (
                              <div className={r.paymentMethodCorrection ? 'mt-1.5' : undefined}>
                                <QrPreviewCell path={r.paymentMethod.qr} />
                              </div>
                            )}
                          </>
                        : undefined} />
                <Item k="마감" v={dateOnlyMonthDayKo(asDateOnly(r.deadlineOn))} />
              </div>
              <div className={DIVIDER} />
              <div className={GROUP}>
                <div className={GROUP_TITLE}>확인 자료</div>
                <Item k="게시물" v={r.referenceUrl ? <a href={r.referenceUrl} target="_blank" rel="noreferrer" className="break-all text-x-blue-text hover:underline">{r.referenceUrl}</a> : <span className="text-x-muted">—</span>}
                      sub={r.referenceUrl && r.taskType !== 'rt' ? '정산팀이 이 링크로 게시를 확인해요' : undefined} />
                {/* 증빙이 필요 없는 유형엔 줄 자체를 안 그린다(리뷰 수정 4) */}
                {(r.taskType === 'rt' || r.proof) && (
                  <Item k="증빙" v={r.proof
                    ? (proofSignedUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={proofSignedUrl} alt="증빙 스크린샷" onClick={() => setZoom(true)}
                             className="h-16 w-16 cursor-zoom-in rounded border border-x-border object-cover" />
                      : '있음')
                    : <span className="text-x-muted">—</span>} sub={<>{r.proof ? proofUploadedLine(r.proof.byName, r.proof.at) : null}
                                  <div>
                                    {r.taskType === 'rt'
                                      ? (r.proof ? '정산팀도 이 증빙을 봐요' : '증빙을 올리면 정산팀에도 자동으로 전달돼요')
                                      : '정산에는 안 보내요 (우리 보관용)'}
                                  </div></>} />
                )}
              </div>
              <div className={DIVIDER} />
              {/* 정산팀에 나간 문구 그대로 — 분류 / 항목 · 목적(확인할 일이 있어 남긴다) */}
              <div className={GROUP}>
                <div className={GROUP_TITLE}>정산팀에 보낸 문구</div>
                <div className={`${SUB} leading-[1.55]`}>
                  <div>{r.category}</div>
                  <div>{r.itemText} · {r.purposeText}</div>
                </div>
              </div>
              {r.note && (
                <>
                  <div className={DIVIDER} />
                  <Item k="메모" v={r.note} />
                </>
              )}
            </section>
            <PartnerResultBlock r={r} />
          </div>

          <RevisionHistory r={r} />

          <div className="flex flex-wrap items-center justify-end gap-3 text-[14px] text-x-muted">
            {cancelled
              ? <span>{['취소', partnerNameLabel(r.cancelledByName), kstMonthDayTimeKo(r.cancelledAt), r.cancelReason].filter(Boolean).join(' · ')}</span>
              : paid
                ? <span>지급이 끝난 요청은 취소하거나 고칠 수 없어요 — 정산팀에 알려 주세요</span>
                : (
                  <span className="flex items-center gap-2">
                    {revisionEnabled && <Button onClick={onRevise} title="프로필·캠페인에서 고친 값을 이 요청에 반영해요 — 정산팀에는 같은 건의 수정으로 전달돼요">고친 값으로 다시 반영</Button>}
                    <Button onClick={onCancel}>취소</Button>
                  </span>
                )}
          </div>
        </div>
        {zoom && proofSignedUrl && <ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
        </td></tr>
      )}
    </>
  );
}
// 펼침 요약 카드의 금액 한 칸 — 라벨(흐림) / 금액 22px 굵게 / 보조 한 줄. 금액이 없으면 '—'.
function SummaryAmount({ label, amount, sub, subTitle, warn }: { label: string; amount: string | null; sub: string | null; subTitle?: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[14px] text-x-muted">{label}</span>
      <span className={`text-[22px] font-bold tabular-nums ${amount === null ? 'text-x-muted' : warn ? 'text-amber-700' : ''}`}>{amount ?? '—'}</span>
      {sub && <span className="text-[14px] text-x-muted tabular-nums" title={subTitle}>{sub}</span>}
    </div>
  );
}
function Item({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className={ROW_KEY}>{k}</span>
      <div className="min-w-0">{v}{sub && <div className={SUB}>{sub}</div>}</div>
    </div>
  );
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
