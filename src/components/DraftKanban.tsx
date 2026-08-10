'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftPreviewLine, groupByStatus } from '@/lib/draftViews';

// 열 헤더 점 색 — DraftStatusChip의 STATUS_STYLE과 같은 계열 유지 (색은 UI 파일에만)
const STATUS_DOT: Record<DraftStatus, string> = {
  draft: 'bg-x-muted', review: 'bg-amber-500', approved: 'bg-x-blue', delivered: 'bg-green-500', unused: 'bg-x-border-strong',
};

// 파이프라인용 칸반 — 열 위치가 곧 상태. 드롭 = 상태 변경(낙관적 갱신·롤백은 부모 changeStatus 재사용)
// DnD는 마우스 전용 — 키보드 사용자는 카드 클릭→카드 뷰의 상태 칩이 등가 경로 (스펙 §접근성)
export function DraftKanban({ drafts, clientNameOf, onChangeStatus, onOpenCard }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
}) {
  const [overCol, setOverCol] = useState<DraftStatus | null>(null);
  const byStatus = groupByStatus(drafts);
  return (
    <div className="flex w-full gap-3 overflow-x-auto pb-2">
      {DRAFT_STATUSES.map((s) => (
        <div key={s}
             onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverCol(s); }}
             onDragLeave={() => setOverCol((cur) => (cur === s ? null : cur))}
             onDrop={(e) => {
               e.preventDefault(); setOverCol(null);
               const d = drafts.find((x) => x.id === e.dataTransfer.getData('text/plain'));
               if (d && d.status !== s) onChangeStatus(d, s);
             }}
             className={`flex min-h-[220px] w-[210px] shrink-0 flex-col rounded-xl border p-2 ${overCol === s ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface'}`}>
          <p className="flex items-center gap-1.5 px-1 pb-2 text-caption font-bold text-x-secondary">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
            {STATUS_LABEL[s]} <span className="tabular-nums font-normal text-x-muted">{byStatus[s].length}</span>
          </p>
          <div className="flex flex-col gap-2">
            {byStatus[s].map((d) => (
              <div key={d.id} draggable tabIndex={0}
                   onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; }}
                   onClick={() => onOpenCard(d.id)}
                   onKeyDown={(e) => {
                     if (e.key !== 'Enter' && e.key !== ' ') return;
                     if (e.target !== e.currentTarget) return;   // 카드 안 요소에 포커스가 있으면 그쪽 몫
                     e.preventDefault();                          // 스페이스로 페이지가 스크롤되는 것을 막는다
                     onOpenCard(d.id);
                   }}
                   className="cursor-pointer rounded-lg border border-x-border bg-white p-2 hover:border-x-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue">
                <p className="line-clamp-2 text-ui">{draftPreviewLine(d) || '(내용 없음)'}</p>
                <p className="mt-1 truncate text-caption text-x-muted">
                  {[d.clientId ? clientNameOf(d.clientId) : null, ...d.procedureNames, d.format === 'thread' ? '스레드' : '단문'].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-0.5 text-caption text-x-muted">{draftTimeLabel(d.createdAt)}</p>
              </div>
            ))}
            {byStatus[s].length === 0 && (
              <p className="rounded-lg border border-dashed border-x-border-strong p-3 text-center text-caption leading-relaxed text-x-muted">
                여기로 끌어다 놓으면<br />상태가 바뀝니다
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
