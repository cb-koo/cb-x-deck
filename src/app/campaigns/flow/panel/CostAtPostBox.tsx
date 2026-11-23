'use client';
import { useState, type ReactNode } from 'react';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { TaskType } from '@/lib/campaignJudgment';
import { CURRENCIES, CURRENCY_LABEL, AMOUNT_MESSAGE, parseAmount, suggestTaskCost, type TaskCost, type Currency } from '@/lib/campaignCost';
import { needsCostAtPost, costAtPostExtra, COST_AT_POST_MESSAGE, ZERO_COST_HINT, type CostAtPostExtra } from '@/lib/costAtPost';

// 게시 확인 때 비용 받기(koo 11-23, 시안 A) — 비용이 빈 작업의 게시 칸(링크·RT 증빙·링크 없이·기타 협찬 완료) 안에 뜨는 주황 상자.
// 프로필 단가가 있으면 미리 채워 보여 주지만 그건 제안일 뿐이다 — [게시 확인]을 눌러야 게시일과 같은 요청으로 저장된다.
// 금액을 넣거나 '비용 없음'을 골라야 [게시 확인]이 눌린다(서버도 같은 판정, costAtPost.costAtPostGateError).
// 비용이 이미 있거나 '비용 없음'인 작업(같은 방문의 연결 작업 포함)에는 아무것도 그리지 않는다.
export type { CostAtPostExtra };

export function useCostAtPost(task: { cost: TaskCost | null; noCost?: boolean; type: TaskType }, option: InfluencerOption | undefined, disabled = false): {
  node: ReactNode;                    // 상자(필요 없으면 null)
  extra: CostAtPostExtra | null;      // 요청에 실을 값. null = 아직 못 정함(버튼을 막는다)
  blockReason: string;                // 버튼 title·안내 — 막혀 있을 때만
} {
  const needed = needsCostAtPost(task);
  const profile = suggestTaskCost(option?.pricing, task.type);
  // 사람이 손대기 전에는 지금의 프로필 단가를 그대로 보여 준다 — 인플 목록이 늦게 오거나 인플이 바뀌어도 따라간다(상태로 굳히지 않는다)
  const [typed, setTyped] = useState<string | null>(null);
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null);
  const [noCost, setNoCost] = useState(false);
  const touched = typed !== null;
  const amount = typed ?? (profile ? String(profile.amount) : '');
  const currency: Currency = pickedCurrency ?? profile?.currency ?? 'JPY';

  const parsed = parseAmount(amount);
  const cost: TaskCost | null = parsed === null ? null : { amount: parsed, currency };
  const extra = costAtPostExtra(needed, { noCost, cost });
  const invalid = !noCost && amount.trim() !== '' && parsed === null;
  if (!needed) return { node: null, extra: {}, blockReason: '' };

  const help = noCost ? "돈이 나가지 않는 작업으로 저장돼요. 정산 요청에서 빠져요."
    : invalid ? AMOUNT_MESSAGE
    : amount.trim() === '' ? "금액을 넣거나 '비용 없음'을 골라야 게시 확인을 누를 수 있어요."
    : profile && !touched ? '프로필 단가를 넣어 뒀어요. 맞는지 보고 고쳐 주세요. 게시 확인을 누르면 함께 저장돼요.'
    : '게시 확인을 누르면 함께 저장돼요.';
  const node = (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 pb-3 pt-3" data-cost-at-post>
      <p className="mb-1.5 text-[14px] font-semibold text-amber-800">이 작업 비용이 아직 없어요</p>
      <div className="flex items-center gap-2">
        <input inputMode="numeric" aria-label={task.type === 'visit' ? '예산' : '비용'} value={noCost ? '' : amount} disabled={noCost || disabled}
               placeholder={noCost ? '비용 없음' : '금액'}
               onChange={(e) => setTyped(e.target.value)}
               aria-invalid={invalid}
               className={`h-10 min-w-0 flex-1 rounded-md border bg-white px-3 text-content tabular-nums outline-none focus:border-x-blue disabled:bg-x-surface disabled:text-x-muted ${invalid ? 'border-red-500' : 'border-x-border-strong'}`} />
        <select value={currency} aria-label="통화" disabled={noCost || disabled} onChange={(e) => setPickedCurrency(e.target.value as Currency)}
                className="h-10 rounded-md border border-x-border-strong bg-white px-2 text-content outline-none focus:border-x-blue disabled:bg-x-surface disabled:text-x-muted">
          {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL[c]}</option>)}
        </select>
      </div>
      <p className={`mt-1 text-[14px] ${invalid ? 'text-red-600' : 'text-x-secondary'}`}>{help}</p>
      {!noCost && parsed === 0 && <p className="mt-1 text-[14px] text-amber-800">{ZERO_COST_HINT}</p>}
      <label className="mt-2 flex items-center gap-2 text-content">
        <input type="checkbox" checked={noCost} disabled={disabled} onChange={(e) => setNoCost(e.target.checked)} />
        비용 없음
        <span className="text-[14px] text-x-secondary">돈이 나가지 않는 작업이에요</span>
      </label>
    </div>
  );
  return { node, extra, blockReason: extra === null ? COST_AT_POST_MESSAGE : '' };
}
