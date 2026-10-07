'use client';
import { useEffect, useRef } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { campaignDot, type CampaignDot } from '@/lib/campaignListView';

// 캠페인 목록 한 행(스펙 §3-3) — 색 점 + 이름(+꼬리말) + 진행 막대 + `게시 n/m`, 한 줄 52px.
// 마우스를 올리거나 포커스가 들어오면 `게시 n/m` 자리에 ⋯ 버튼(§3-5). 선택 버튼과 ⋯ 버튼은 형제다 —
// 버튼 안에 버튼을 넣을 수 없어서 ⋯는 행 오른쪽 위에 겹쳐 놓는다.

export type RowMenuAction = 'name' | 'client' | 'delete';

// 점 색 — 바탕 + 25% 고리(시안 .dot). 색은 판단(campaignDot)이 정하고 여기선 칠하기만 한다.
const DOT_STYLE: Record<CampaignDot, string> = {
  grey: 'bg-[#9aa5ad] shadow-[0_0_0_2px_rgba(154,165,173,0.25)]',
  green: 'bg-[#16a34a] shadow-[0_0_0_2px_rgba(22,163,74,0.25)]',
  yellow: 'bg-[#d97706] shadow-[0_0_0_2px_rgba(217,119,6,0.25)]',
  red: 'bg-[#dc2626] shadow-[0_0_0_2px_rgba(220,38,38,0.25)]',
};
const BAR_W = 56;

export function SidebarRow({ c, title, suffix, today, selected, menuOpen, onSelect, onMenuToggle, onMenuClose, onAction }: {
  c: CampaignRow; title: string; suffix: string | null; today: string; selected: boolean; menuOpen: boolean;
  onSelect: () => void; onMenuToggle: () => void; onMenuClose: () => void; onAction: (a: RowMenuAction) => void;
}) {
  const { dot, reason } = campaignDot(c, today);
  const { planned, posted, assigned } = c.progress;
  const postedW = planned > 0 ? Math.round((posted / planned) * BAR_W) : 0;
  const assignedW = planned > 0 ? Math.round((assigned / planned) * BAR_W) : 0;
  const fullName = suffix ? `${title} · ${suffix}` : title;

  return (
    <div className={`group relative h-[52px] ${selected ? 'bg-[#eaf4fd] shadow-[inset_3px_0_0_#1d9bf0]' : 'hover:bg-x-hover'}`}>
      <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
              className="flex h-full w-full items-center pl-[18px] pr-3.5 text-left">
        {/* 점 + 판단 말풍선 — 점 둘레 24px가 마우스 자리(8px 점만으론 맞추기 어렵다). 이유는 화면 낭독기에도 읽힌다. */}
        <span className="group/dot relative -ml-2 mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
          <span aria-hidden className={`h-2 w-2 rounded-full ${DOT_STYLE[dot]}`} />
          <span className="sr-only">{reason}</span>
          <span aria-hidden
                className="pointer-events-none absolute left-0 top-[26px] z-30 hidden whitespace-nowrap rounded-lg bg-x-text px-3 py-2 text-[13px] leading-[14px] text-white shadow-[0_2px_6px_rgba(15,20,25,0.10)] group-hover/dot:block">
            {reason}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-baseline overflow-hidden whitespace-nowrap" title={fullName}>
          <span className="truncate text-[15px] font-semibold text-x-text">{title}</span>
          {suffix && (
            <span className="flex min-w-0 items-baseline text-[13.5px] text-x-muted">
              <span aria-hidden className="mx-1.5">·</span>
              <span className="truncate">{suffix}</span>
            </span>
          )}
        </span>
        <span aria-hidden className="ml-2 flex h-1.5 w-14 shrink-0 overflow-hidden rounded-[3px] bg-[#eef2f4]">
          {postedW > 0 && <i className="block h-full bg-x-blue" style={{ width: postedW }} />}
          {assignedW > 0 && <i className="block h-full bg-[#cfe6f7]" style={{ width: assignedW }} />}
        </span>
        <span className={`w-16 shrink-0 whitespace-nowrap text-right text-[13.5px] tabular-nums text-x-secondary ${menuOpen ? 'invisible' : 'group-hover:invisible group-has-[:focus-visible]:invisible'}`}>
          {planned > 0 ? `게시 ${posted}/${planned}` : '작업 없음'}
        </span>
      </button>
      <span className={`absolute right-3.5 top-2.5 ${menuOpen ? '' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}>
        <button type="button" onClick={onMenuToggle} aria-label={`${fullName} 캠페인 메뉴`}
                aria-haspopup="menu" aria-expanded={menuOpen}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-x-text hover:bg-[#eff3f4] ${menuOpen ? 'bg-[#eff3f4]' : ''}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
            <path d="M5 12h.01M12 12h.01M19 12h.01" />
          </svg>
        </button>
        {menuOpen && <RowMenu onClose={onMenuClose} onAction={onAction} />}
      </span>
    </div>
  );
}

// ⋯ 메뉴(시안 Menu — 보관 제외). 새 편집 화면은 없다: 고르면 상세 머리글의 기존 편집 상태가 열린다(§3-5).
function RowMenu({ onClose, onAction }: { onClose: () => void; onAction: (a: RowMenuAction) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function onDown(e: MouseEvent) {
      // ⋯ 버튼 자체(부모 span)를 누른 건 버튼의 토글이 처리한다 — 여기서도 닫으면 닫혔다 바로 다시 열린다
      const holder = ref.current?.parentElement;
      if (holder && !holder.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const trigger = ref.current?.parentElement?.querySelector<HTMLButtonElement>('button[aria-haspopup]');
      onClose();
      trigger?.focus();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const item = 'flex h-11 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-x-hover focus:bg-x-hover focus:outline-none';
  return (
    <div ref={ref} role="menu"
         className="absolute right-0 top-9 z-40 w-60 rounded-xl border border-x-border bg-white py-1.5 shadow-[0_8px_24px_rgba(15,20,25,0.12)]">
      <button type="button" role="menuitem" className={`${item} text-x-text`} onClick={() => onAction('name')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" />
        </svg>
        이름·기간 바꾸기
      </button>
      <button type="button" role="menuitem" className={`${item} text-x-text`} onClick={() => onAction('client')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#536471" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4" />
        </svg>
        클라이언트 바꾸기
      </button>
      <div role="separator" className="my-1.5 h-px bg-x-border" />
      <button type="button" role="menuitem" className={`${item} text-red-600`} onClick={() => onAction('delete')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
        </svg>
        삭제
      </button>
    </div>
  );
}
