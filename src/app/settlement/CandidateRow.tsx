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
import { formatKrwToPayout } from './money';

export interface RowEdit { category: string | null; deadlineOn: string; referenceUrl: string }
const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui';

export function CandidateRow({ c, edit, categories, selected, failure, proofSignedUrl, onEdit, onToggle }: {
  c: SettlementCandidate; edit: RowEdit; categories: SettlementCategory[]; selected: boolean; failure?: string; proofSignedUrl: string | null;
  onEdit: (e: RowEdit) => void; onToggle: (on: boolean) => void;
}) {
  const [zoom, setZoom] = useState(false);
  const level = effectiveReadiness(c, edit);
  const st = READINESS_STYLE[level];
  const issues = effectiveIssues(c, edit);
  const money = c.money ? formatKrwToPayout(c.money) : null;
  return (
    <li className={`px-4 py-3 ${level === 'blocked' ? 'bg-x-surface/60' : ''}`} style={{ minHeight: 76 }}>
      {/* 윗줄 — 읽기 6개: 체크 · 핸들 · 유형 · 클리닉/캠페인 · 금액 · 수단 · 신호등 */}
      <div className="flex items-center gap-3 text-[15px]">
        <input type="checkbox" className="h-4 w-4" checked={selected} disabled={level === 'blocked'} onChange={(e) => onToggle(e.target.checked)} aria-label={`@${c.influencerHandle} 선택`} />
        <span className="font-semibold">@{c.influencerHandle}</span>
        <span className="rounded-full border border-x-border px-2 py-0.5 text-ui">{TASK_TYPE_LABEL[c.taskType]}</span>
        <span className="text-x-secondary truncate">{c.clientName} · {c.campaignName}</span>
        <span className="ml-auto tabular-nums font-medium whitespace-nowrap">
          {money ? <>{money.base}{money.fee && <span className="ml-1 text-x-muted font-normal">{money.fee}</span>}</> : <span className="text-x-muted">{formatMoney(c.cost.amount, c.cost.currency)} → —</span>}
        </span>
        <span className="text-ui text-x-secondary truncate max-w-[260px]" title={c.method ? describeMethod(c.method) : ''}>
          {c.method ? `${PAYMENT_TYPE_LABEL[c.method.type]} · ${identOf(c.method)}` : '결제 수단 없음'}
        </span>
        <span className={`flex items-center gap-1.5 text-ui ${st.text} whitespace-nowrap`}><span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.label}</span>
      </div>
      {/* 아랫줄 — 편집 3개 + 이유 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-7 text-ui">
        <label className="flex items-center gap-1.5 text-x-secondary">분류
          <select className={`${FIELD} ${!edit.category ? 'border-red-400' : ''}`} value={edit.category ?? ''} onChange={(e) => onEdit({ ...edit, category: e.target.value || null })}>
            <option value="">골라 주세요</option>
            {categories.map((k) => <option key={k.id} value={k.sendAs}>{k.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-x-secondary">마감
          <input type="date" className={FIELD} value={edit.deadlineOn} onChange={(e) => onEdit({ ...edit, deadlineOn: e.target.value })} />
        </label>
        <label className="flex items-center gap-1.5 text-x-secondary min-w-0">참고
          {/* 투고·인용RT·방문은 이 링크가 정산 쪽 확인 자료라 필수(09-02) — 비면 🔴, 넣으면 즉시 풀린다. RT는 원본 트윗이라 선택 */}
          <input type="url" className={`${FIELD} w-[260px] ${referenceRequiredFor(c.taskType) && !edit.referenceUrl ? 'border-red-400' : ''}`}
                 placeholder={referenceRequiredFor(c.taskType) ? '인플루언서 게시물 링크(필수)' : '게시물 링크(선택)'}
                 value={edit.referenceUrl} onChange={(e) => onEdit({ ...edit, referenceUrl: e.target.value })} />
          {edit.referenceUrl && <a href={edit.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">열기</a>}
        </label>
        {c.proof && (
          // 캠페인 작업 표(TaskTable)와 같은 표현 — 회색 알약 버튼 '증빙 보기'(서명 URL이 늦으면 비활성+안내 문구,
          // '없음'으로 스치지 않는다). 28px 썸네일은 판독이 안 돼 정보값 없이 행만 빽빽하게 만들어 없앴다(리뷰 수정 2).
          <span className="flex items-center gap-1.5 text-x-secondary">증빙
            <button type="button" disabled={!proofSignedUrl} onClick={() => proofSignedUrl && setZoom(true)}
                    title={proofSignedUrl ? '증빙 스크린샷 — 눌러서 크게 보기' : '증빙 스크린샷 불러오는 중…'}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600 hover:bg-slate-200 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-slate-100">
              증빙 보기
            </button>
          </span>
        )}
        {issues.map((i) => (
          <span key={i.code} className={i.level === 'blocked' ? 'text-red-700' : 'text-amber-700'}>
            {i.text}
            {i.code === 'no-payment-method' && <> · <Link href="/influencers" className="underline">프로필에서 등록 →</Link></>}
            {i.code === 'paypay-no-receiving-info' && <> · <Link href="/influencers" className="underline">프로필에서 채우기 →</Link></>}
            {i.code === 'no-influencer' && <> · <Link href="/influencers" className="underline">명부 →</Link></>}
            {i.code === 'no-proof' && <> · <Link href={`/campaigns?id=${c.campaignId}`} className="underline">캠페인에서 채우기 →</Link></>}
          </span>
        ))}
        {failure && <span role="alert" className="text-red-700 font-medium">{failure}</span>}
      </div>
      {zoom && proofSignedUrl && <ImageLightbox urls={[proofSignedUrl]} index={0} onIndexChange={() => {}} onClose={() => setZoom(false)} />}
    </li>
  );
}
function identOf(m: NonNullable<SettlementCandidate['method']>): string {
  if (m.type === 'paypal') return m.email ?? (m.paypalId ? `paypal.me/${m.paypalId}` : '');
  // qr(저장소 경로)이 있으면 송금 가능한 상태다 — identifier가 없다고 "미입력"으로 보이면 거짓 표시다(원칙 4)
  if (m.type === 'paypay') return m.identifier ?? (m.qr ? 'QR 등록됨' : '미입력');
  return `${m.bank ?? ''} ${m.account ?? ''}`.trim();
}
