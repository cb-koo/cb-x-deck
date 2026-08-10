'use client';
import { useState } from 'react';
import type { DraftRow } from '@/lib/draftStore';
import type { DraftStatus } from '@/lib/draftStatus';
import { DraftStatusChip } from '@/components/DraftStatusChip';
import { draftTimeLabel } from '@/lib/draftUi';
import { draftPreviewLine, sortDrafts, type TableSort, type TableSortKey } from '@/lib/draftViews';

// 트리아지용 테이블 — 정독 액션은 없다. 행 클릭 = 카드 뷰 점프 (스펙 2차 §DraftTable)
export function DraftTable({ drafts, clientNameOf, onChangeStatus, onOpenCard }: {
  drafts: DraftRow[];
  clientNameOf: (id: string | null) => string;
  onChangeStatus: (d: DraftRow, s: DraftStatus) => void;
  onOpenCard: (id: string) => void;
}) {
  const [sort, setSort] = useState<TableSort>({ key: 'createdAt', dir: 'desc' });
  const rows = sortDrafts(drafts, sort, clientNameOf);
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
            <th className="px-3 py-2 font-normal">{sortBtn('client', '클라이언트')}</th>
            <th className="px-3 py-2 font-normal">시술</th>
            <th className="px-3 py-2 font-normal">형식</th>
            <th className="px-3 py-2 font-normal">{sortBtn('status', '상태')}</th>
            <th className="px-3 py-2 font-normal">{sortBtn('createdAt', '생성')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} onClick={() => onOpenCard(d.id)}
                className="cursor-pointer border-b border-x-border hover:bg-x-hover">
              <td className="max-w-[360px] truncate px-3 py-2">{draftPreviewLine(d) || '(내용 없음)'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{clientNameOf(d.clientId)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.procedureNames.join(' · ') || '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-x-secondary">{d.format === 'thread' ? '스레드' : '단문'}</td>
              {/* 칩 클릭이 행 클릭(카드 점프)으로 번지지 않게 — 셀에서 차단 */}
              <td className="whitespace-nowrap px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <DraftStatusChip status={d.status} onChange={(s) => onChangeStatus(d, s)} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-caption text-x-muted">{draftTimeLabel(d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
