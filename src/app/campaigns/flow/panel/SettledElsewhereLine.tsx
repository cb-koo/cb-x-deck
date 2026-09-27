'use client';
import { isSettleWaiting, type FlowRow } from '@/lib/campaignFlowView';
import { formatDateKo, SETTLED_ELSEWHERE_LABEL } from '@/lib/campaignJudgment';

// 비용 · 정산 상자 맨 아래 한 줄(061, koo 09-27 시안) — 앱 밖(구글폼 등)에서 이미 지급한 작업을 정산 대기에서 뺀다.
//  · 표시가 있으면: ✓ 다른 곳에서 정산함 M/D · 메모 (표시한 사람) [되돌리기]
//  · 정산 대기(게시 확인·비용·인플 있고 살아있는 요청 없음)일 때만 입구를 보인다 — 대기 수에 잡히는 작업에만(UX 원칙 4)
//  · 그 밖(게시 전·요청 중·지급 완료)은 아무것도 그리지 않는다(거짓 어포던스 금지)
export function SettledElsewhereLine({ task, onOpen, onUndo }: { task: FlowRow; onOpen: () => void; onUndo: () => void }) {
  if (task.settledElsewhereAt) {
    return (
      <div className="-mx-4 mt-3.5 border-t border-x-border px-4 pt-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-content">
            <span className="font-semibold">✓ {SETTLED_ELSEWHERE_LABEL}</span> {formatDateKo(task.settledElsewhereAt)}
            {task.settledElsewhereNote && ` · ${task.settledElsewhereNote}`}
            {task.settledElsewhereByName && <span className="text-x-muted"> ({task.settledElsewhereByName})</span>}
          </p>
          <button type="button" onClick={onUndo} title="표시를 지우면 다시 정산 대기에 올라와요"
                  className="shrink-0 text-ui text-x-secondary hover:underline">되돌리기</button>
        </div>
        <p className="mt-0.5 text-caption text-x-muted">정산 대기에서 빠졌어요 · 비용은 집행액에 그대로 잡혀요</p>
      </div>
    );
  }
  if (!isSettleWaiting(task)) return null;
  return (
    <div className="-mx-4 mt-3.5 flex items-center justify-between gap-3 border-t border-x-border px-4 pt-3">
      <span className="text-[14px] text-x-secondary">이미 구글폼 등 다른 곳에서 지급했다면</span>
      <button type="button" onClick={onOpen} title="정산 대기에서 빼고, 이 작업으로 정산 요청을 보낼 수 없게 해요"
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-x-border-strong bg-white px-3.5 text-[14px] font-semibold text-x-text hover:bg-x-hover">
        {SETTLED_ELSEWHERE_LABEL}
      </button>
    </div>
  );
}
