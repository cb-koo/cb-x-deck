'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftLabel, draftPreviewLine, draftKoLine, groupByStatus } from '@/lib/draftViews';
import { columnLimit, isDoneColumn, orderColumn } from '@/lib/kanbanColumns';
import { PAGE_STEP } from '@/lib/draftPaging';
import { ShowMoreButton } from '@/components/ShowMoreButton';

// 열 헤더 점 색 — DraftStatusChip의 STATUS_STYLE과 같은 계열 유지 (색은 UI 파일에만)
const STATUS_DOT: Record<DraftStatus, string> = {
  draft: 'bg-x-muted', review: 'bg-amber-500', approved: 'bg-x-blue', delivered: 'bg-green-500', unused: 'bg-x-border-strong',
};

// 파이프라인용 칸반 — 열 위치가 곧 상태. 드롭 = 상태 변경(낙관적 갱신·롤백은 부모 changeStatus 재사용)
// DnD는 마우스 전용 — 키보드 사용자는 카드 클릭→카드 뷰의 상태 칩이 등가 경로 (스펙 §접근성)
export function DraftKanban({ drafts, clientNameOf, onChangeStatus, onOpenCard, pinnedIds, onGoToTable }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
  // 방금 드래그로 옮긴 카드 — 그 열 맨 위에 세운다(설계 §H). 세션 한정이라 페이지가 소유한다.
  pinnedIds: ReadonlySet<string>;
  // 종착 열의 '전체 보기' — 표 뷰로 전환하며 그 상태 필터를 건다. 안내문이 아니라 실제로 데려간다.
  onGoToTable: (status: DraftStatus) => void;
}) {
  const [overCol, setOverCol] = useState<DraftStatus | null>(null);
  // 열마다 그리는 개수 — 열별로 독립이라 상태도 열별이다.
  const [shown, setShown] = useState<Partial<Record<DraftStatus, number>>>({});
  const byStatus = groupByStatus(drafts);
  return (
    <div className="flex w-full gap-3 overflow-x-auto pb-2">
      {DRAFT_STATUSES.map((s) => {
        // 방금 옮긴 카드를 앞으로 세운 뒤 그리는 개수만 자른다 — 자르기는 표시의 문제라
        // 아래 열 머리의 건수(byStatus[s].length)는 자르기 전 전체를 그대로 쓴다(설계 §F).
        const all = orderColumn(byStatus[s], pinnedIds);
        const limit = shown[s] ?? columnLimit(s);
        const rows = all.slice(0, limit);
        const done = isDoneColumn(s);
        return (
        <div key={s}
             onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverCol(s); }}
             onDragLeave={() => setOverCol((cur) => (cur === s ? null : cur))}
             onDrop={(e) => {
               e.preventDefault(); setOverCol(null);
               const d = drafts.find((x) => x.id === e.dataTransfer.getData('text/plain'));
               if (d && d.status !== s) onChangeStatus(d, s);
             }}
             className={`flex max-h-[calc(100vh-220px)] min-h-[220px] min-w-[230px] max-w-[360px] flex-1 shrink-0 flex-col rounded-xl border p-2 ${overCol === s ? 'border-x-blue bg-x-blue/5' : 'border-x-border bg-x-surface'}`}>
          <p className="flex items-center gap-1.5 px-1 pb-2 text-caption font-bold text-x-secondary">
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
            {STATUS_LABEL[s]} <span className="tabular-nums font-normal text-x-muted">{byStatus[s].length}</span>
          </p>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {rows.map((d) => {
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
                   // relative가 반드시 있어야 한다. 카드 안의 sr-only(스크린리더용 "한국어 번역:" 라벨)는
                   // position:absolute인데, 위치 기준이 될 조상이 없으면 문서를 기준으로 배치된다. 그러면
                   // 열의 overflow-y-auto가 카드는 잘라내도 그 요소들은 클리핑을 빠져나가, 문서 높이만
                   // 3000px 가까이 늘어나 칸반 아래에 스크롤되는 빈 공간이 생긴다(실측으로 확인).
                   className="relative cursor-pointer rounded-lg border border-x-border bg-white p-2 hover:border-x-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue">
                {/* 방금 옮긴 카드는 최신순 정렬을 무시하고 맨 위에 세워둔 것이라, 왜 여기 있는지 밝힌다(설계 §H) */}
                {pinnedIds.has(d.id) && (
                  <p className="mb-1 text-caption font-bold text-x-blue-text">방금 옮김</p>
                )}
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
                  {/* 인플루언서 배정 — 클라이언트(파랑 채움)·시술/형식(테두리 알약)과 구분되는 중립 회색 채움. 미배정이면 칩 없음 */}
                  {d.influencerHandle && (
                    <span className="max-w-[140px] truncate rounded bg-x-text/5 px-1.5 py-px text-caption text-x-muted">
                      @{d.influencerHandle}
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
            {rows.length === 0 && (
              <p className="rounded-lg border border-dashed border-x-border-strong p-3 text-center text-caption leading-relaxed text-x-muted">
                여기로 끌어다 놓으면<br />상태가 바뀝니다
              </p>
            )}
            {/* 종착 열은 '확인용 창구'다 — 더 보기 대신 표로 데려간다(설계 §F).
                검색·정렬이 필요한 일이고 그건 표가 하는 일이다. */}
            {done && all.length > rows.length && (
              <button type="button" onClick={() => onGoToTable(s)}
                      className="mt-2 w-full rounded-lg border border-x-border-strong bg-white px-2 py-2 text-caption font-bold text-x-secondary hover:bg-x-hover">
                {STATUS_LABEL[s]} 원고 {all.length}건 전체 보기 →
              </button>
            )}
            {!done && (
              <ShowMoreButton total={all.length} shown={rows.length}
                              onMore={() => setShown((cur) => ({ ...cur, [s]: (cur[s] ?? columnLimit(s)) + PAGE_STEP }))} />
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
