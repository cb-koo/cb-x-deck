'use client';
import { useEffect, useState } from 'react';
import { CANCEL_REASON_CHIPS, type FlowRow } from '@/lib/campaignFlowView';
import { TASK_TYPE_LABEL, formatDateKo } from '@/lib/campaignJudgment';
import { formatAmount, suggestTaskCost, type TaskCost } from '@/lib/campaignCost';
import type { CancelReason } from '@/lib/campaignTaskInput';
import type { InfluencerOption } from '@/lib/draftTypes';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';
import { InfluencerField } from '@/components/InfluencerField';
import { Button } from '@/components/ui';

// 인플루언서 교체(ADR 0005) 확인 — 작업·대상·예정일은 그대로, 사람만 바뀐다(브리프 결정 3). 비용은 두
// 갈래뿐이다: 지금 금액 유지, 또는 새 사람의 명부 단가로. 새 단가가 없거나 통화가 지금 비용과 다르면
// 그 선택지 자체를 감춘다 — 통화 단위가 다른 값을 슬쩍 밀어 넣지 않는다(koo 결정, 리뷰 carried-over 2).
// onConfirm은 flowActions.replace를 감싼 것 — CancelDialog·BulkCreateDialog와 같은 관례로 제출 뒤 결과와
// 무관하게 닫는다(성공·실패는 토스트가 말한다).
// 핸들 하나를 검증·정규화한다 — 사용자가 친 값이든(commitHandle) 카드에서 미리 골라 넘어온 값이든
// (initialHandle) 같은 길을 지나야 한다(koo QA 지적: 두 번 고르게 하지 않되 검증은 다르게 타면 안 된다).
function resolveHandle(raw: string, currentHandle: string | null): { handle: string; handleInput: string; handleErr: string | null } {
  const v = raw.trim();
  if (!v) return { handle: '', handleInput: '', handleErr: null };
  const p = parseXHandle(v);
  if (!p.ok) return { handle: '', handleInput: raw, handleErr: handleParseMessage(p.reason) };
  if (currentHandle && p.handle.toLowerCase() === currentHandle.toLowerCase()) {
    return { handle: '', handleInput: raw, handleErr: '같은 인플루언서예요 — 바꿀 사람을 골라요' };
  }
  return { handle: p.handle, handleInput: p.handle, handleErr: null };
}

export function ReplaceDialog({ task, influencerOptions, initialHandle, onClose, onConfirm }: {
  task: FlowRow;
  influencerOptions: InfluencerOption[];
  // 원고 카드에서 이미 고른 핸들(선택) — 있으면 입력칸에 미리 채운 채 연다. 검증은 resolveHandle 하나로
  // commitHandle과 공유한다(아래) — 초기값만 다른 길을 타면 카드에서 고른 값이 여기선 다르게 판정될 수 있다.
  initialHandle?: string;
  onClose: () => void;
  onConfirm: (body: { handle: string; cost?: TaskCost | null; reason?: CancelReason | null; note?: string }) => Promise<void>;
}) {
  // 다이얼로그는 열릴 때마다 새로 마운트된다(FlowDetail이 {replaceFor && <ReplaceDialog .../>}로 그린다) —
  // 그래서 마운트 시 한 번 계산하는 이 값은 매번 다시 여는 것과 같다(리렌더마다 다시 계산돼도 useState
  // 초기값 인자로만 쓰이므로 첫 렌더 뒤로는 영향이 없다).
  const initial = initialHandle ? resolveHandle(initialHandle, task.influencerHandle) : { handle: '', handleInput: '', handleErr: null };
  const [handleInput, setHandleInput] = useState(initial.handleInput);
  const [handle, setHandle] = useState(initial.handle);
  const [handleErr, setHandleErr] = useState<string | null>(initial.handleErr);
  const [costChoice, setCostChoice] = useState<'keep' | 'suggest'>('keep');
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  function commitHandle(raw: string) {
    const r = resolveHandle(raw, task.influencerHandle);
    setHandle(r.handle); setHandleInput(r.handleInput); setHandleErr(r.handleErr);
    if (r.handle) setCostChoice('keep');   // 사람이 바뀌면 새 단가 선택은 다시 기본값(유지)부터
  }

  const option = handle ? influencerOptions.find((o) => o.handle.toLowerCase() === handle.toLowerCase()) : undefined;
  const suggest = handle ? suggestTaskCost(option?.pricing, task.type) : null;
  const showSuggest = suggest !== null && (!task.cost || suggest.currency === task.cost.currency);

  async function submit() {
    if (!handle || handleErr || busy) return;
    setBusy(true);
    await onConfirm({
      handle,
      cost: costChoice === 'suggest' && showSuggest && suggest ? suggest : undefined,
      reason, note: note.trim(),
    });
    setBusy(false);
    onClose();
  }

  const who = task.influencerHandle ? `@${task.influencerHandle}` : '미배정';
  const costText = task.cost ? formatAmount(task.cost.amount, task.cost.currency) : '비용 미정';
  const summary = `${TASK_TYPE_LABEL[task.type]} · ${who} · 예정 ${task.scheduledOn ? formatDateKo(task.scheduledOn) : '미정'} · ${costText}`;
  // 해당되는 항목만 보인다(브리프 결정 3) — 없는 얘기를 하면 뭘 잃는지 헷갈린다
  const notice = '작업·대상·예정일은 그대로예요.'
    + (task.type === 'rt' && task.proof ? ' 올려둔 RT 증빙은 지워져요.' : '')
    + (task.draftStatus === 'delivered' ? ` 원고 상태는 '전달됨'에서 '사용 확정'으로 돌아가요.` : '');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="인플루언서 교체" className="w-full max-w-[440px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-[17px]">인플루언서 교체</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="text-[18px] text-x-muted hover:text-x-text">✕</button>
        </div>
        <p className="mt-1 text-ui text-x-secondary">{summary}</p>

        <div className="mt-3">
          <p className="text-ui text-x-secondary">새 인플루언서</p>
          <div className="mt-1">
            <InfluencerField value={handleInput} options={influencerOptions} hideLabel
                             onChange={(v) => { setHandleInput(v); setHandleErr(null); }} error={handleErr}
                             onEnter={commitHandle} onBlur={commitHandle} />
          </div>
        </div>

        <div className="mt-3">
          <p className="text-ui text-x-secondary">교체 후 비용</p>
          <div role="radiogroup" aria-label="교체 후 비용" className="mt-1 space-y-1.5">
            <label className="flex items-center gap-2 text-content">
              <input type="radio" checked={costChoice === 'keep'} onChange={() => setCostChoice('keep')} />
              {task.cost ? `지금 금액 유지 ${formatAmount(task.cost.amount, task.cost.currency)}` : '비용 없음 — 그대로'}
            </label>
            {showSuggest && suggest && (
              <label className="flex items-center gap-2 text-content">
                <input type="radio" checked={costChoice === 'suggest'} onChange={() => setCostChoice('suggest')} />
                {`새 단가로 ${formatAmount(suggest.amount, suggest.currency)} (명부 ${TASK_TYPE_LABEL[task.type]} 단가)`}
              </label>
            )}
          </div>
        </div>

        <div className="mt-3">
          <p className="text-ui text-x-secondary">{who}가 빠지는 이유 <span className="text-x-muted">선택</span></p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CANCEL_REASON_CHIPS.map((c) => (
              <button key={c.value} type="button" aria-pressed={reason === c.value}
                      onClick={() => setReason((cur) => (cur === c.value ? null : c.value))}
                      className={`rounded-full border px-2.5 py-1 text-ui ${
                        reason === c.value ? 'border-x-blue bg-x-blue/10 text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3">
          <label className="block text-ui text-x-secondary">메모 <span className="text-x-muted">선택</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="한 줄"
                   className="mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue" />
          </label>
        </div>

        <p className="mt-3 text-caption text-x-muted">{notice}</p>

        <div className="mt-4 flex justify-end gap-2.5">
          <Button onClick={onClose} disabled={busy} className="h-10 px-4 text-content">닫기</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!handle || !!handleErr || busy} className="h-10 px-4 text-content">
            {busy ? '교체하는 중…' : '교체하기'}
          </Button>
        </div>
      </div>
    </div>
  );
}
