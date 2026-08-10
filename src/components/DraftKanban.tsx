'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftLabel, draftPreviewLine, draftKoLine, groupByStatus } from '@/lib/draftViews';

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
             className={`flex min-h-[220px] min-w-[230px] max-w-[360px] flex-1 shrink-0 flex-col rounded-xl border p-2 ${overCol === s ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface'}`}>
          <p className="flex items-center gap-1.5 px-1 pb-2 text-caption font-bold text-x-secondary">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
            {STATUS_LABEL[s]} <span className="tabular-nums font-normal text-x-muted">{byStatus[s].length}</span>
          </p>
          <div className="flex flex-col gap-2">
            {byStatus[s].map((d) => {
              const label = draftLabel(d);
              return (
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
                {label.kind === 'title' ? (
                  <>
                    <p className="truncate text-ui font-medium">{label.text}</p>
                    {/* 제목이 있으면 본문 미리보기는 보조로 강등 — 제목은 생성 라벨이라 🌐 없음.
                        단 보조 줄이 대역이면 그건 번역이므로 🌐 유지(원칙 4 — 최종 리뷰 F2) */}
                    <p className="mt-0.5 truncate text-caption text-x-muted">
                      {draftKoLine(d)
                        ? <><span title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span><span className="sr-only">한국어 번역: </span>{draftKoLine(d)}</>
                        : draftPreviewLine(d)}
                    </p>
                  </>
                ) : (
                  <p className="line-clamp-2 text-ui">
                    {label.kind === 'ko' ? <><span title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span><span className="sr-only">한국어 번역: </span>{label.text}</> : label.text}
                  </p>
                )}
                {/* 속성은 칩으로 — 본문 텍스트와 시각 문법을 분리(속성=칩, 내용=평문) */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {d.clientId && (
                    <span className="max-w-[140px] truncate rounded bg-x-blue/10 px-1.5 py-px text-caption font-medium text-x-blue-text">
                      {clientNameOf(d.clientId)}
                    </span>
                  )}
                  {d.procedureNames.map((p) => (
                    <span key={p} className="rounded-full border border-x-border-strong px-1.5 py-px text-caption text-x-muted">{p}</span>
                  ))}
                  <span className="rounded-full border border-x-border-strong px-1.5 py-px text-caption text-x-muted">
                    {d.format === 'thread' ? '스레드' : '단문'}
                  </span>
                  <span className="ml-auto pl-1 text-caption text-x-muted">{draftTimeLabel(d.createdAt)}</span>
                </div>
              </div>
              );
            })}
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
