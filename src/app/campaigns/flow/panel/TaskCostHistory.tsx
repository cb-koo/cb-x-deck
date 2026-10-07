'use client';
import { useState } from 'react';
import type { TaskChangeRow } from '@/lib/campaignTaskStore';
import { fetchTaskChangesApi } from '@/lib/campaignApi';
import { ChangeEntry } from '@/components/ChangeEntry';
import { TASK_CHANGE_SOURCE_TEXT, costText } from '@/lib/taskChangeView';

// 작업 패널 금액 옆 `변경 이력 N`(스펙 2026-10-07 §6·§9) — 0이면 숨김. 펼칠 때 읽는다(부모가 key에 N을 넣어 수가 바뀌면 다시 읽게 한다).
export function TaskCostHistory({ campaignId, taskId, count }: { campaignId: string; taskId: string; count: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<TaskChangeRow[] | null>(null);
  const [err, setErr] = useState('');
  if (count === 0) return null;

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rows) return;
    const r = await fetchTaskChangesApi(campaignId, taskId);
    if (r.ok) setRows(r.data.changes); else setErr(r.error);
  }

  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="text-[14px] text-x-blue-text hover:underline">
        변경 이력 {count} {open ? '▾' : '▸'}
      </button>
      {open && (
        rows ? (
          <ol className="mt-1 divide-y divide-x-border/60">
            {rows.map((c) => (
              <ChangeEntry key={c.id} at={c.createdAt} by={c.byName} change={`${costText(c.before)} → ${costText(c.after)}`}
                           source={TASK_CHANGE_SOURCE_TEXT[c.source]} reason={c.reason || null} />
            ))}
          </ol>
        ) : err ? <p role="alert" className="mt-1 text-[14px] text-red-600">{err}</p>
          : <p className="mt-1 text-[14px] text-x-muted">불러오는 중…</p>
      )}
    </div>
  );
}
