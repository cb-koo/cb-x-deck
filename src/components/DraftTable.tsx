'use client';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftStatus } from '@/lib/draftStatus';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftLabel, draftPreviewLine, draftKoLine, type TableSort, type TableSortKey } from '@/lib/draftViews';
import { allSelected } from '@/lib/draftSelection';

// 트리아지용 테이블 — 정독 액션은 없다. 행 클릭 = 카드 뷰 점프 (스펙 2차 §DraftTable)
export function DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard, selectedIds, onToggleId, onToggleAll, sort, onSortChange }: {
  drafts: DraftRow[];        // 이미 정렬·절단이 끝난 배열 — 이 컴포넌트는 순서를 바꾸지 않는다(설계 §D)
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
  selectedIds: ReadonlySet<string>;
  onToggleId: (id: string) => void;
  onToggleAll: () => void;
  sort: TableSort;
  onSortChange: (next: TableSort) => void;
}) {
  // 정렬은 페이지가 소유한다 — 여기서 정렬하면 "이미 잘린 배열을 정렬"한 결과가 되어
  // 전체 정렬의 상위 N건으로 보이지 않는다(설계 §D). 이 컴포넌트는 받은 순서를 그대로 그린다.
  const rows = drafts;
  const headChecked = allSelected(selectedIds, rows.map((d) => d.id));
  // 일부만 골랐을 때 헤더 체크박스는 '중간' 상태로 — 전부 선택된 것처럼 보이면 안 된다
  const headIndeterminate = !headChecked && rows.some((d) => selectedIds.has(d.id));

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
    <button onClick={() => onSortChange({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })}
            className="flex items-center gap-1 hover:text-x-text">
      {label}{sort.key === key && <span aria-hidden>{sort.dir === 'desc' ? '↓' : '↑'}</span>}
    </button>
  );
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-ui">
        <thead>
          <tr className="border-b border-x-border text-left text-caption text-x-muted">
            <th className="w-10 px-3 py-2 font-normal">
              <input type="checkbox" checked={headChecked}
                     ref={(el) => { if (el) el.indeterminate = headIndeterminate; }}
                     onChange={onToggleAll}
                     aria-label="보이는 원고 전체 선택"
                     className="h-4 w-4 cursor-pointer accent-x-blue" />
            </th>
            <th className="px-3 py-2 font-normal">원고</th>
            <th className="px-3 py-2 font-normal" aria-sort={sort.key === 'client' ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{sortBtn('client', '클라이언트')}</th>
            {/* 인플루언서 — 시술·형식과 같은 비정렬 열(스펙 §F). 클라이언트 바로 다음: 둘 다 "누구" 축이라 붙여야 훑기 좋다 */}
            <th className="px-3 py-2 font-normal">인플루언서</th>
            <th className="px-3 py-2 font-normal">시술</th>
            <th className="px-3 py-2 font-normal">형식</th>
            <th className="px-3 py-2 font-normal" aria-sort={sort.key === 'status' ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{sortBtn('status', '상태')}</th>
            <th className="px-3 py-2 font-normal" aria-sort={sort.key === 'createdAt' ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{sortBtn('createdAt', '생성')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const label = draftLabel(d);
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
                className={`cursor-pointer border-b border-x-border focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-x-blue ${selectedIds.has(d.id) ? 'bg-x-blue/5' : 'hover:bg-x-hover'}`}>
              {/* 체크박스 클릭이 행 클릭(카드 열기)으로 번지지 않게 — 상태 칩 셀과 같은 방식 */}
              <td className="w-10 px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selectedIds.has(d.id)}
                       onChange={() => onToggleId(d.id)}
                       aria-label={`${label.text} 선택`}
                       className="h-4 w-4 cursor-pointer accent-x-blue" />
              </td>
              <td className="max-w-[360px] truncate px-3 py-2"
                  title={label.kind === 'title' ? (draftKoLine(d) ?? draftPreviewLine(d)) : undefined}>
                {label.kind === 'title' ? <span className="font-medium">{label.text}</span>
                 : label.kind === 'ko' ? <><span title="한국어 번역으로 표시 중 — 원문은 카드에서">🌐 </span><span className="sr-only">한국어 번역: </span>{label.text}</>
                 : label.text}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{clientNameOf(d.clientId)}</td>
              {/* 열 정합을 위해서만 미배정에 '—'를 쓴다 (카드·칸반은 자리 자체를 안 그림 — 표만 예외) */}
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.influencerHandle ? `@${d.influencerHandle}` : '—'}</td>
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
