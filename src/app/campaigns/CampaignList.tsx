'use client';
import { useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { groupCampaigns, listSubline } from '@/lib/campaignView';
import { Button } from '@/components/ui';

// 캠페인 목록(왼쪽 280px, 스펙 §3-2) — 진행 중 / 예정 / 종료 그룹, 종료는 기본 접힘(koo 선택).
// 행 = 이름(15px) + 보조줄(13px: 기간 · 콘텐츠 n개). 선택 표시는 clients/influencers 목록과 같은 연한 파랑.
export function CampaignList({ rows, selectedId, today, loaded, loadErr, onSelect, onCreate, onRetry }: {
  rows: CampaignRow[]; selectedId: string | null; today: string;
  loaded: boolean; loadErr: boolean;
  onSelect: (id: string) => void; onCreate: () => void; onRetry: () => void;
}) {
  const [endedOpen, setEndedOpen] = useState(false);
  const g = groupCampaigns(rows, today);

  // 컴포넌트가 아니라 함수 — 렌더마다 새 컴포넌트 타입을 만들면 행의 상태·포커스가 매번 리셋된다
  const renderRow = (c: CampaignRow) => {
    const on = c.id === selectedId;
    return (
      <button key={c.id} onClick={() => onSelect(c.id)} aria-current={on ? 'true' : undefined}
              className={`mb-0.5 block w-full rounded-lg px-2.5 py-2 text-left transition-colors ${on ? 'bg-[#e3f1fb]' : 'hover:bg-x-hover'}`}>
        <span className={`block truncate text-content font-semibold ${on ? 'text-x-blue-text' : ''}`}>{c.name}</span>
        <span className="block text-ui text-x-muted">{listSubline(c)}</span>
      </button>
    );
  };
  const renderGroup = (title: string, items: CampaignRow[]) => (items.length === 0 ? null : (
    <div key={title} className="mb-3">
      <p className="mb-1 px-2 text-ui font-bold text-x-secondary">{title} <span className="font-normal text-x-muted">{items.length}</span></p>
      {items.map(renderRow)}
    </div>
  ));

  return (
    <>
      <div className="mb-1 flex items-center justify-between px-2">
        <h2 className="text-content font-bold">캠페인 {rows.length > 0 && <span className="text-ui font-normal text-x-secondary">{rows.length}</span>}</h2>
        <button onClick={onCreate} className="text-ui font-medium text-x-blue-text hover:underline">+ 새 캠페인</button>
      </div>
      <p className="mb-3 px-2 text-ui text-x-muted">클라이언트 한 곳의 한 기간 동안 나가는 원고를 묶어요 — 진행·성과·비용을 한 화면에서 봐요.</p>

      {!loaded && <p className="px-2 py-4 text-content text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="px-2 py-4">
          <p className="mb-2 text-content text-x-secondary">목록을 불러오지 못했습니다</p>
          <Button onClick={onRetry}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && (
        <>
          {renderGroup('진행 중', g.active)}
          {renderGroup('예정', g.upcoming)}
          {g.ended.length > 0 && (
            <div className="mb-3">
              <button onClick={() => setEndedOpen((v) => !v)} aria-expanded={endedOpen}
                      className="mb-1 flex w-full items-center gap-1 px-2 text-ui font-bold text-x-secondary hover:text-x-text">
                종료 <span className="font-normal text-x-muted">{g.ended.length}</span>
                <span aria-hidden className="ml-auto">{endedOpen ? '⌃' : '⌄'}</span>
              </button>
              {endedOpen && g.ended.map(renderRow)}
            </div>
          )}
        </>
      )}
    </>
  );
}
