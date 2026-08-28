'use client';
import Link from 'next/link';
import type { SettlementCandidate } from '@/lib/settlementCalc';
import type { SettlementCategory } from '@/lib/settlementSettings';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { PAYMENT_TYPE_LABEL, describeMethod } from '@/lib/influencerPayment';
import { READINESS_STYLE, effectiveReadiness } from './readinessView';
import { formatKrwToPayout } from './money';

export interface RowEdit { category: string | null; deadlineOn: string; referenceUrl: string }
const FIELD = 'rounded-lg border border-x-border bg-white px-2 py-1 text-ui';

export function CandidateRow({ c, edit, categories, selected, failure, onEdit, onToggle }: {
  c: SettlementCandidate; edit: RowEdit; categories: SettlementCategory[]; selected: boolean; failure?: string;
  onEdit: (e: RowEdit) => void; onToggle: (on: boolean) => void;
}) {
  const level = effectiveReadiness(c, edit);
  const st = READINESS_STYLE[level];
  const issues = c.issues.filter((i) => !(i.code === 'no-category' && edit.category));
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
          {money ? <>{money.base}{money.fee && <span className="ml-1 text-x-muted font-normal">{money.fee}</span>}</> : <span className="text-x-muted">→ —</span>}
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
          <input type="url" className={`${FIELD} w-[260px]`} placeholder="게시물 링크(선택)" value={edit.referenceUrl} onChange={(e) => onEdit({ ...edit, referenceUrl: e.target.value })} />
          {edit.referenceUrl && <a href={edit.referenceUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">열기</a>}
        </label>
        {issues.map((i) => (
          <span key={i.code} className={i.level === 'blocked' ? 'text-red-700' : 'text-amber-700'}>
            {i.text}
            {i.code === 'no-payment-method' && <> · <Link href="/influencers" className="underline">프로필에서 등록 →</Link></>}
            {i.code === 'no-influencer' && <> · <Link href="/influencers" className="underline">명부 →</Link></>}
          </span>
        ))}
        {failure && <span role="alert" className="text-red-700 font-medium">{failure}</span>}
      </div>
    </li>
  );
}
function identOf(m: NonNullable<SettlementCandidate['method']>): string {
  if (m.type === 'paypal') return m.email ?? (m.paypalId ? `paypal.me/${m.paypalId}` : '');
  if (m.type === 'paypay') return m.identifier ?? '미입력';
  return `${m.bank ?? ''} ${m.account ?? ''}`.trim();
}
