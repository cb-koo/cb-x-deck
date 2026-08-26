'use client';
import { useMemo, useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { campaignOptionsFor } from '@/lib/draftCampaignOptions';

// 원고의 캠페인 소속 한 칸(스펙 §4-2) — 인플루언서 칸 옆 "캠페인: 없음 ▾". 값은 draft.campaign_id 하나(§2-5):
// 여기서 바꾸면 캠페인 화면에 즉시 반영된다(같은 컬럼). 다른 캠페인 소속으로 옮길 때 경고 없음(§7 — 값은 하나).
// DraftStatusChip과 같은 '보이는 칩 + 투명 select' 골격 — 목록이 5~20개라 네이티브 select가 가장 빠르다.
export function DraftCampaignField({ campaignId, campaignName, clientId, options, today, onChange }: {
  campaignId: string | null; campaignName: string | null; clientId: string | null;
  options: CampaignRow[]; today: string;
  onChange: (next: string | null) => void;
}) {
  const [showEnded, setShowEnded] = useState(false);
  const { open, ended } = useMemo(() => campaignOptionsFor(options, clientId, today, campaignId), [options, clientId, today, campaignId]);
  const currentInEnded = campaignId !== null && ended.some((c) => c.id === campaignId);
  const withEnded = showEnded || currentInEnded;   // 현재 소속이 종료 캠페인이면 접어둘 수 없다 — 값이 보여야 한다
  return (
    <span className="inline-flex items-center gap-1.5">
      <label title="이 원고가 속한 캠페인 — 바꾸면 캠페인 화면에 바로 반영돼요"
             className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-white px-2.5 text-ui focus-within:ring-2 focus-within:ring-x-blue ${
               campaignId ? 'border-x-border-strong text-x-text hover:bg-x-hover' : 'border-dashed border-x-border-strong text-x-muted hover:bg-x-hover hover:text-x-secondary'}`}>
        캠페인: {campaignName ?? '없음'} <span aria-hidden className="text-x-muted">⌄</span>
        <select value={campaignId ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="캠페인 선택"
                className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">없음</option>
          {open.length > 0 && <optgroup label="진행 중 · 예정">{open.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
          {withEnded && ended.length > 0 && <optgroup label="종료">{ended.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        </select>
      </label>
      {ended.length > 0 && !withEnded && (
        <button type="button" onClick={() => setShowEnded(true)} className="text-ui text-x-muted hover:text-x-secondary hover:underline">종료 캠페인 보기</button>
      )}
    </span>
  );
}
