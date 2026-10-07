'use client';
import { useEffect, useRef } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import type { HeaderAction } from '../../CampaignHeader';
import { campaignDot, type CampaignDot } from '@/lib/campaignListView';

// 캠페인 목록 한 행(스펙 §3-3, 시안 WeekMode/ClientMode .row) — 색 점 + 이름(+꼬리말) + 진행 막대 + `n/m`, 한 줄 44px.
// 마우스를 올리거나 포커스가 들어오면 `n/m` 자리에 ⋯ 버튼(§3-5). 선택 버튼과 ⋯ 버튼은 형제다 —
// 버튼 안에 버튼을 넣을 수 없어서 ⋯는 행 오른쪽에 겹쳐 놓는다.
// 묶음 안 행은 들여 쓰고(왼쪽 26px), 장기 캠페인 섹션 바로 아래 행(top)은 들이지 않는다(왼쪽 8px).

type RowMenuAction = HeaderAction['kind'];

// 점 색(시안 .y/.r/.g, 고리 없음). 색은 판단(campaignDot)이 정하고 여기선 칠하기만 한다. 회색은 시안에 없어 기존 값.
const DOT_STYLE: Record<CampaignDot, string> = {
  grey: 'bg-[#9aa5ad]',
  green: 'bg-[#15803d]',
  yellow: 'bg-[#d97706]',
  red: 'bg-[#dc2626]',
};
const BAR_W = 48;

export function SidebarRow({ c, title, suffix, today, selected, menuOpen, top = false, past = false, onSelect, onMenuToggle, onMenuClose, onAction }: {
  c: CampaignRow; title: string; suffix: string | null; today: string; selected: boolean; menuOpen: boolean;
  top?: boolean; past?: boolean;
  onSelect: () => void; onMenuToggle: () => void; onMenuClose: () => void; onAction: (a: RowMenuAction) => void;
}) {
  const { dot, reason } = campaignDot(c, today);
  const { planned, posted, assigned } = c.progress;
  const postedW = planned > 0 ? Math.round((posted / planned) * BAR_W) : 0;
  const assignedW = planned > 0 ? Math.round((assigned / planned) * BAR_W) : 0;
  const fullName = suffix ? `${title} · ${suffix}` : title;

  return (
    <div className={`group relative mx-2 h-11 rounded-[8px] ${selected ? 'bg-[#eef1f3]' : menuOpen ? 'bg-[#f5f7f8]' : 'hover:bg-[#f5f7f8]'}`}>
      <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
              className={`flex h-full w-full items-center pr-2 text-left text-[#0f1419] ${top ? 'pl-2' : 'pl-[26px]'}`}>
        {/* 점 + 판단 말풍선 — 점 둘레 23x24px가 마우스 자리(7px 점만으론 맞추기 어렵다). 음수 여백으로 점 자리·간격(오른쪽 10px)은 시안 그대로. */}
        <span className="group/dot relative ml-[-8px] mr-[2px] flex h-6 w-[23px] shrink-0 items-center justify-center">
          <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${DOT_STYLE[dot]}`} />
          <span className="sr-only">{reason}</span>
          <span aria-hidden
                className="pointer-events-none absolute left-0 top-[26px] z-30 hidden whitespace-nowrap rounded-lg bg-x-text px-3 py-2 text-[13px] leading-[14px] text-white shadow-[0_2px_6px_rgba(15,20,25,0.10)] group-hover/dot:block">
            {reason}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 items-baseline overflow-hidden whitespace-nowrap" title={fullName}>
          <span className={`truncate text-[15px] ${selected ? 'font-bold' : 'font-medium'} ${past ? 'text-[#6c7781]' : 'text-[#0f1419]'}`}>{title}</span>
          {suffix && (
            <span className="flex min-w-0 items-baseline text-[13.5px] text-[#6c7781]">
              <span aria-hidden className="relative -top-px mx-[5px] inline-block h-[3px] w-[3px] shrink-0 self-center rounded-full bg-[#9aa5ad]" />
              <span className="truncate">{suffix}</span>
            </span>
          )}
        </span>
        <span aria-hidden className="ml-[10px] flex h-1 w-12 shrink-0 overflow-hidden rounded-[2px] bg-[#eef2f4]">
          {postedW > 0 && <i className="block h-full bg-[#1d9bf0]" style={{ width: postedW }} />}
          {assignedW > 0 && <i className="block h-full bg-[#cfe6f7]" style={{ width: assignedW }} />}
        </span>
        <span className={`ml-[10px] min-w-[34px] shrink-0 whitespace-nowrap text-right text-[13.5px] tabular-nums text-[#6c7781] ${menuOpen ? 'invisible' : 'group-hover:invisible group-has-[:focus-visible]:invisible'}`}>
          {planned > 0 ? `${posted}/${planned}` : '작업 없음'}
        </span>
      </button>
      <span className={`absolute right-2 top-2 ${menuOpen ? '' : 'opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'}`}>
        <button type="button" onClick={onMenuToggle} aria-label={`${fullName} 캠페인 메뉴`}
                aria-haspopup="menu" aria-expanded={menuOpen}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e6eaed] text-[#0f1419]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
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
         className="absolute right-0 top-8 z-40 w-60 rounded-xl border border-x-border bg-white py-1.5 shadow-[0_8px_24px_rgba(15,20,25,0.12)]">
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
