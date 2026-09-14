'use client';
import { DRAFT_STATUSES, STATUS_LABEL, type DraftStatus } from '@/lib/draftStatus';
import type { DraftListFilter } from '@/lib/draftUi';

// 상태 탭 + 캠페인·클라이언트 필터 (스펙 3-1) — 작업 세션용 렌즈라 저장하지 않는다
// showStatusTabs=false: 칸반 뷰는 열 위치가 곧 상태라 탭이 중복 — 셀렉트만 노출(T4)
// 캠페인은 칩이 아니라 select — 클라별로 늘어나 칩 줄이 넘친다(상태 5개는 고정 집합이라 칩). 캠페인 스펙 §4-3.
export function DraftFilterBar({ counts, total, filter, clients, campaigns, currentCampaignName, onChange, showStatusTabs = true }: {
  counts: Record<DraftStatus, number>; total: number;
  filter: DraftListFilter; clients: Array<{ id: string; name: string }>;
  campaigns: Array<{ id: string; name: string }>;
  currentCampaignName?: string;   // 걸려 있는 캠페인의 이름 — 목록에 아직 없을 때 옵션 라벨로 쓴다
  onChange: (f: DraftListFilter) => void;
  showStatusTabs?: boolean;
}) {
  const tab = (on: boolean) =>
    `inline-flex h-8 items-center rounded-full border px-3 tabular-nums ${on ? 'border-x-blue bg-x-blue/10 font-bold text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`;
  const select = 'h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue';
  return (
    <div className="flex w-full flex-wrap items-center gap-1.5 text-[13px]">
      {showStatusTabs && (
        <>
          <button onClick={() => onChange({ ...filter, status: 'all' })} className={tab(filter.status === 'all')}>
            전체 {total}
          </button>
          {DRAFT_STATUSES.map((s) => (
            <button key={s} onClick={() => onChange({ ...filter, status: filter.status === s ? 'all' : s })}
                    className={tab(filter.status === s)}>
              {STATUS_LABEL[s]} {counts[s]}
            </button>
          ))}
        </>
      )}
      <select value={filter.campaignId} onChange={(e) => onChange({ ...filter, campaignId: e.target.value })}
              aria-label="캠페인으로 거르기" className={`ml-auto ${select}`}>
        <option value="">모든 캠페인</option>
        {/* 값은 걸렸는데 목록에 그 캠페인이 아직(또는 영영) 없는 경우 — ?task= 딥링크가 목록보다 먼저 필터를
            채울 수 있다. 옵션이 없으면 셀렉트가 '모든 캠페인'으로 보여 거르는 중이라는 사실이 사라진다(라벨-값 일치). */}
        {filter.campaignId && filter.campaignId !== 'none' && !campaigns.some((c) => c.id === filter.campaignId) && (
          <option value={filter.campaignId}>{currentCampaignName ?? '현재 캠페인'}</option>
        )}
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">캠페인 없음</option>
      </select>
      <select value={filter.clientId} onChange={(e) => onChange({ ...filter, clientId: e.target.value })}
              aria-label="클라이언트로 거르기" className={select}>
        <option value="">모든 클라이언트</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="none">클라이언트 없음</option>
      </select>
    </div>
  );
}
