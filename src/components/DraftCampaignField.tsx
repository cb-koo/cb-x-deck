'use client';
import { useMemo, useRef, useState } from 'react';
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
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const { open, ended } = useMemo(() => campaignOptionsFor(options, clientId, today, campaignId), [options, clientId, today, campaignId]);
  const currentInEnded = campaignId !== null && ended.some((c) => c.id === campaignId);
  const withEnded = showEnded || currentInEnded;   // 현재 소속이 종료 캠페인이면 접어둘 수 없다 — 값이 보여야 한다
  // options가 아직 로드되기 전(빈 배열)이거나 캠페인이 방금 삭제됐으면 campaignId가 open·ended 어디에도 없다 —
  // 그럴 때 select에 맞는 <option>이 없으면 브라우저가 첫 항목("없음")을 보여줘 칩 글자(campaignName)와
  // select 표시가 어긋난다. 실제 옵션 목록이 오기 전까지 자리를 채워 라벨-값을 맞춘다.
  const currentMissing = campaignId !== null && !open.some((c) => c.id === campaignId) && !ended.some((c) => c.id === campaignId);
  return (
    <span className="inline-flex items-center gap-1.5">
      <label title="이 원고가 속한 캠페인 — 바꾸면 캠페인 화면에 바로 반영돼요"
             className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-white px-2.5 text-ui focus-within:ring-2 focus-within:ring-x-blue ${
               campaignId ? 'border-x-border-strong text-x-text hover:bg-x-hover' : 'border-dashed border-x-border-strong text-x-muted hover:bg-x-hover hover:text-x-secondary'}`}>
        캠페인: {campaignName ?? '없음'} <span aria-hidden className="text-x-muted">⌄</span>
        <select ref={selectRef} value={campaignId ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="캠페인 선택"
                className="absolute inset-0 w-full cursor-pointer opacity-0">
          <option value="">없음</option>
          {currentMissing && <option value={campaignId ?? ''}>{campaignName ?? '현재 캠페인'}</option>}
          {open.length > 0 && <optgroup label="진행 중 · 예정">{open.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
          {withEnded && ended.length > 0 && <optgroup label="종료">{ended.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        </select>
      </label>
      {ended.length > 0 && !withEnded && (
        // 누르면 바로 select에 초점을 옮긴다 — 그냥 접힘이 풀리기만 하면 클릭한 사람에게는 아무것도 안
        // 바뀐 것처럼 보인다(리뷰 Minor 3). 라벨도 "무엇이 열리는지"를 말하도록 바꿨다.
        <button type="button" onClick={() => { setShowEnded(true); selectRef.current?.focus(); }}
                className="text-ui text-x-muted hover:text-x-secondary hover:underline">종료된 캠페인도 목록에 넣기</button>
      )}
    </span>
  );
}
