'use client';
import { useEffect, useState } from 'react';
import { fetchTaskDeletionsApi } from '@/lib/campaignApi';
import type { TaskDeletionRow } from '@/lib/taskDeletionStore';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { kstDateTime } from '@/lib/datetime';

// 작업 표 아래 '삭제한 작업 N건' — 누가 언제 무엇을 지웠는지(073, koo 10-13). 지운 기록이 없으면 아무것도 그리지 않는다.
// refreshKey(삭제 성공 횟수)가 바뀌면 다시 읽는다 — 방금 지운 작업이 바로 목록에 붙는다.
export function TaskDeletionLog({ campaignId, refreshKey }: { campaignId: string; refreshKey: number }) {
  const [items, setItems] = useState<TaskDeletionRow[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchTaskDeletionsApi(campaignId).then((r) => { if (alive && r.ok) setItems(r.data.items); });
    return () => { alive = false; };
  }, [campaignId, refreshKey]);
  if (!items.length) return null;
  return (
    <div className="mt-3 text-ui text-x-secondary">
      <button type="button" className="underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        삭제한 작업 {items.length}건 {open ? '접기' : '보기'}
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums">{kstDateTime(d.deletedAt)}</span>
              <span className="text-x-text">{d.deletedByName || '알 수 없음'}</span>
              <span>
                {d.influencerHandle ? `@${d.influencerHandle}` : '인플루언서 미정'}
                {d.taskType && TASK_TYPE_LABEL[d.taskType as TaskType] ? ` · ${TASK_TYPE_LABEL[d.taskType as TaskType]}` : ''}
                {d.withReservation ? ' · 예약 기록도 함께 지움' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
