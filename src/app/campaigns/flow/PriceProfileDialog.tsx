'use client';
import { useCallback, useEffect, useRef } from 'react';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { formatAmount, type TaskCost } from '@/lib/campaignCost';
import { Button } from '@/components/ui';

// 비용 [확인] 뒤에 뜨는 "프로필도 바꿀까요" 질문(b-task-8-brief.md §3) — 이 작업의 비용은 이 창이 뜨기 전에
// 이미 저장됐다(CostConfirmField.confirm). 여기서 고르는 건 인플루언서 명부의 단가까지 같이 바꿀지뿐이고,
// 어느 쪽을 골라도 이 작업의 비용은 그대로다(보조 문구로 알린다).
export function PriceProfileDialog({ scenario, handle, type, profile, entered, onAnswer }: {
  scenario: 'differs' | 'no-profile';
  handle: string;
  type: TaskType;
  profile: TaskCost | null;
  entered: TaskCost;
  onAnswer: (toProfile: boolean) => void;
}) {
  // Esc는 이 창만 닫는다(= [이 작업만]과 같은 답) — capture로 받아 전파를 끊는다, 안 그러면 패널 자체의
  // Esc 리스너까지 같이 먹어 패널이 통째로 닫힌다(CostPopover 관례, TaskPanel의 overlayOpen이 이 창은 모른다).
  // 답은 한 번만 — 연타·Esc·바깥 클릭이 겹쳐도 프로필 PATCH가 두 번 나가지 않는다. 답하면 부모가 이 창을
  // 곧바로 내리므로 버튼을 비활성으로 바꿔 보여줄 필요는 없다(렌더 중 ref 읽기도 피한다).
  const answeredRef = useRef(false);
  const answer = useCallback((toProfile: boolean) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    onAnswer(toProfile);
  }, [onAnswer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.stopPropagation();
      answer(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [answer]);

  const body = scenario === 'differs' && profile
    ? `@${handle} 프로필의 ${TASK_TYPE_LABEL[type]} 단가도 ${formatAmount(profile.amount, profile.currency)} → ${formatAmount(entered.amount, entered.currency)}으로 바꿀까요?`
    : `@${handle} 프로필에 ${TASK_TYPE_LABEL[type]} 단가 ${formatAmount(entered.amount, entered.currency)}으로 저장할까요?`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={() => answer(false)}>
      <div role="dialog" aria-modal="true" aria-label="프로필 단가" className="w-full max-w-[420px] rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[17px]">프로필 단가</h2>
        <p className="mt-2 text-content">{body}</p>
        <p className="mt-2 text-caption text-x-muted">이 작업의 비용은 어느 쪽을 골라도 지금 값으로 확정돼요. 프로필을 바꾸면 인플루언서 타임라인에 단가 변경이 남아요.</p>
        <div className="mt-4 flex justify-end gap-2.5">
          <Button onClick={() => answer(false)} className="h-10 px-4 text-content">이 작업만</Button>
          <Button variant="primary" onClick={() => answer(true)} className="h-10 px-4 text-content">
            {scenario === 'differs' ? '프로필도 바꾸기' : '프로필에 저장'}
          </Button>
        </div>
      </div>
    </div>
  );
}
