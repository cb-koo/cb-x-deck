'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import type { SettlementCategory } from '@/lib/settlementSettings';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL, describeMethod } from '@/lib/influencerPayment';
import { formatMoney } from '@/lib/influencerPricing';
import { ImageLightbox } from '@/components/ImageLightbox';
import { READINESS_STYLE, effectiveReadiness, effectiveIssues } from './readinessView';
import { referenceRequiredFor } from '@/lib/settlementCalc';
import { CELL, NUM, TYPE_CHIP, METHOD_CHIP } from './tableStyle';

export interface RowEdit { category: string | null; deadlineOn: string; referenceUrl: string }
const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui';

export function CandidateRow({ c, edit, categories, selected, failure, proofSignedUrl, onEdit, onToggle }: {
  c: SettlementCandidate; edit: RowEdit; categories: SettlementCategory[]; selected: boolean; failure?: string; proofSignedUrl: string | null;
  onEdit: (e: RowEdit) => void; onToggle: (on: boolean) => void;
}) {
  const [zoom, setZoom] = useState(false);
  const [editLink, setEditLink] = useState(false);
  const level = effectiveReadiness(c, edit);
  const st = READINESS_STYLE[level];
  const issues = effectiveIssues(c, edit);
  const m = c.money;
  const linkRequired = referenceRequiredFor(c.taskType);
  const linkMissing = linkRequired && !edit.referenceUrl;
  const showSub = issues.length > 0 || !!failure || editLink || linkMissing;
  // 표 한 줄 = 작업 하나, 칸마다 값 하나(koo 09-28). 결제 수단의 이메일·계좌는 칸에 올리지 않고 title로.
  return (
    <>
      <tr className={`text-[15px] ${level === 'blocked' ? 'bg-x-surface/60' : ''}`}>
        <td className={`${CELL} w-9`}>
          <input type="checkbox" className="h-4 w-4" checked={selected} disabled={level === 'blocked'} onChange={(e) => onToggle(e.target.checked)} aria-label={`@${c.influencerHandle} 선택`} />
        </td>
        <td className={`${CELL} font-semibold`}>@{c.influencerHandle}</td>
        <td className={CELL}><span className={TYPE_CHIP[c.taskType]}>{TASK_TYPE_LABEL[c.taskType]}</span></td>
        <td className={`${CELL} ${NUM}`}>{formatMoney(c.cost.amount, c.cost.currency)}</td>
        <td className={`${CELL} ${NUM}`} title={m && m.feeAmount > 0 ? `순액 ${formatMoney(m.amountNet, m.payoutCurrency)} + 송금 수수료 ${formatMoney(m.feeAmount, m.payoutCurrency)}` : undefined}>
          {m ? formatMoney(m.amountGross, m.payoutCurrency) : <span className="text-x-muted">—</span>}
        </td>
        <td className={CELL}>
          {c.method
            ? <span className={METHOD_CHIP} title={`${describeMethod(c.method)}${identOf(c.method) ? ` · ${identOf(c.method)}` : ''}`}>{PAYMENT_TYPE_LABEL[c.method.type]}</span>
            : <span className="text-ui text-red-700">없음</span>}
        </td>
        <td className={CELL}>
          <select className={`${FIELD} ${!edit.category ? 'border-red-400' : ''}`} value={edit.category ?? ''} aria-label="분류" onChange={(e) => onEdit({ ...edit, category: e.target.value || null })}>
            <option value="">골라 주세요</option>
            {categories.map((k) => <option key={k.id} value={k.sendAs}>{k.label}</option>)}
          </select>
        </td>
        <td className={CELL}>
          <input type="date" className={`${FIELD} w-[136px]`} value={edit.deadlineOn} aria-label="마감" onChange={(e) => onEdit({ ...edit, deadlineOn: e.target.value })} />
        </td>
        <td className={`${CELL} text-ui`}>
          {/* 게시물 — 투고·인용RT·방문은 이 링크가 정산 쪽 확인 자료라 필수(09-02). RT는 원본 트윗이라 선택이고, 대신 증빙 스크린샷 */}
          <span className="flex items-center gap-2">
            {edit.referenceUrl
              ? <a href={edit.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline" title={edit.referenceUrl}>보기 ↗</a>
              : linkRequired ? <span className="text-red-700">링크 필요</span> : <span className="text-x-muted">—</span>}
            <button type="button" onClick={() => setEditLink((v) => !v)} className="text-x-muted hover:text-x-text" title="게시물 링크 고치기" aria-label="게시물 링크 고치기">✎</button>
            {c.proof && (
              <button type="button" disabled={!proofSignedUrl} onClick={() => proofSignedUrl && setZoom(true)}
                      title={proofSignedUrl ? '증빙 스크린샷 — 눌러서 크게 보기' : '증빙 스크린샷 불러오는 중…'}
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-slate-200 disabled:cursor-default disabled:opacity-70">
                증빙
              </button>
            )}
          </span>
        </td>
        <td className={`${CELL} text-ui ${st.text}`}><span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}</span></td>
      </tr>
      {showSub && (
        // 막힘·주의 이유와 링크 입력은 그 행 바로 아래 한 줄 — 괜찮은 행엔 추가 줄이 없다
        <tr className={level === 'blocked' ? 'bg-x-surface/60' : ''}>
          <td />
          <td colSpan={9} className="border-b border-x-border/60 px-3 pb-2.5 pt-0 text-ui">
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {(editLink || linkMissing) && (
                <input type="url" autoFocus={editLink} className={`${FIELD} w-[320px] ${linkMissing ? 'border-red-400' : ''}`}
                       placeholder={linkRequired ? '인플루언서 게시물 링크(필수)' : '게시물 링크(선택)'}
                       value={edit.referenceUrl} onChange={(e) => onEdit({ ...edit, referenceUrl: e.target.value })} aria-label="게시물 링크" />
              )}
              {issues.map((i) => (
                <span key={i.code} className={i.level === 'blocked' ? 'text-red-700' : 'text-amber-700'}>
                  {i.text}
                  {i.code === 'no-payment-method' && <> · <Link href="/influencers" className="underline">프로필에서 등록 →</Link></>}
                  {i.code === 'paypay-no-receiving-info' && <> · <Link href="/influencers" className="underline">프로필에서 채우기 →</Link></>}
                  {i.code === 'no-influencer' && <> · <Link href="/influencers" className="underline">명부 →</Link></>}
                  {i.code === 'no-proof' && <> · <Link href={`/campaigns/flow?id=${c.campaignId}`} className="underline">캠페인에서 채우기 →</Link></>}
                </span>
              ))}
              {failure && <span role="alert" className="font-medium text-red-700">{failure}</span>}
            </span>
          </td>
        </tr>
      )}
      {zoom && proofSignedUrl && <tr><td><ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} /></td></tr>}
    </>
  );
}
function identOf(m: NonNullable<SettlementCandidate['method']>): string {
  if (m.type === 'paypal') return m.email ?? (m.paypalId ? `paypal.me/${m.paypalId}` : '');
  // qr(저장소 경로)이 있으면 송금 가능한 상태다 — identifier가 없다고 "미입력"으로 보이면 거짓 표시다(원칙 4)
  if (m.type === 'paypay') return m.identifier ?? (m.qr ? 'QR 등록됨' : '미입력');
  return `${m.bank ?? ''} ${m.account ?? ''}`.trim();
}
