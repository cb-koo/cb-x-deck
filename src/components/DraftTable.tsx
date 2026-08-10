'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftStatus } from '@/lib/draftStatus';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftPreviewLine, draftKoLine, sortDrafts, type TableSort, type TableSortKey } from '@/lib/draftViews';

// 트리아지용 테이블 — 정독 액션은 없다. 행 클릭 = 카드 뷰 점프 (스펙 2차 §DraftTable)
export function DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: 'createdAt', dir: 'desc' });
  const rows = sortDrafts(drafts, sort, clientNameOf);

  // 행을 눌렀을 때 카드를 열어야 하는 클릭인지. 두 가지는 카드를 열지 않는다:
  // (1) 셀 안의 링크·버튼 — 상태 칩을 눌렀는데 팝업까지 뜨면 두 일이 동시에 일어난 것처럼 보인다.
  // (2) 글자를 드래그해 선택한 경우 — 값을 복사하려던 동작이 팝업으로 끝나면 안 된다.
  function opensCard(e: React.MouseEvent): boolean {
    if (e.target instanceof Element && e.target.closest('a, button')) return false;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim() !== '') return false;
    return true;
  }

  const sortBtn = (key: TableSortKey, label: string) => (
    <button onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
            className="flex items-center gap-1 hover:text-x-text">
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            <th className="px-3 py-2 font-normal">원고</th>
            <th className="px-3 py-2 font-normal" aria-sort={sort.key === 'client' ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{sortBtn('client', '클라이언트')}</th>
            <th className="px-3 py-2 font-normal">시술</th>
            <th className="px-3 py-2 font-normal">형식</th>
            <th className="px-3 py-2 font-normal" aria-sort={sort.key === 'status' ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{sortBtn('status', '상태')}</th>
            <th className="px-3 py-2 font-normal" aria-sort={sort.key === 'createdAt' ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{sortBtn('createdAt', '생성')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const ko = draftKoLine(d);
            return (
            // 행 전체가 카드를 여는 손잡이다. role="button"으로 덮어쓰지 않는다 — 행을 버튼이라고
            // 말하면 보조기술에서 표의 행·칸 구조가 사라진다. 행은 행으로 두고 조작만 얹는다.
            <tr key={d.id}
                tabIndex={0}
                onClick={(e) => { if (opensCard(e)) onOpenCard(d.id); }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  if (e.target !== e.currentTarget) return;   // 셀 안 요소에 포커스가 있으면 그쪽 몫
                  e.preventDefault();                          // 스페이스로 페이지가 스크롤되는 것을 막는다
                  onOpenCard(d.id);
                }}
                className="cursor-pointer border-b border-x-border hover:bg-x-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue">
              <td className="max-w-[360px] truncate px-3 py-2">
                {/* 마커는 스크린리더에도 노출 — 번역본 표시의 유일한 수단이라 숨기면 원칙 4 위반 (DraftCard 관례) */}
                {ko ? <><span title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span><span className="sr-only">한국어 번역: </span>{ko}</> : (draftPreviewLine(d) || '(내용 없음)')}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{clientNameOf(d.clientId)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.procedureNames.join(' · ') || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.format === 'thread' ? '스레드' : '단문'}</td>
              {/* 칩 클릭이 행 클릭(카드 점프)으로 번지지 않게 — 셀에서 차단 */}
              <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <DraftStatusChip status={d.status} onChange={(s) => onChangeStatus(d, s)} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">{draftTimeLabel(d.createdAt)}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
