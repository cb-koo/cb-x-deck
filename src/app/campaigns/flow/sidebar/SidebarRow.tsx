'use client';
import type { CampaignRow } from '@/lib/campaignStore';
import { campaignDot, type CampaignDot } from '@/lib/campaignListView';

// 캠페인 목록 한 행(스펙 §3-3, 시안 WeekMode/ClientMode .row) — 색 점 + 이름(+꼬리말) + 진행 막대 + `n/m`, 한 줄 44px.
// 묶음 안 행은 들여 쓰고(왼쪽 26px), 장기 캠페인 섹션 바로 아래 행(top)은 들이지 않는다(왼쪽 8px).

// 점 색(시안 .y/.r/.g, 고리 없음). 색은 판단(campaignDot)이 정하고 여기선 칠하기만 한다. 회색은 시안에 없어 기존 값.
const DOT_STYLE: Record<CampaignDot, string> = {
  grey: 'bg-[#9aa5ad]',
  green: 'bg-[#15803d]',
  yellow: 'bg-[#d97706]',
  red: 'bg-[#dc2626]',
};
const BAR_W = 48;

export function SidebarRow({ c, title, suffix, today, selected, top = false, past = false, onSelect }: {
  c: CampaignRow; title: string; suffix: string | null; today: string; selected: boolean;
  top?: boolean; past?: boolean;
  onSelect: () => void;
}) {
  const { dot, reason } = campaignDot(c, today);
  const { planned, posted, assigned } = c.progress;
  const postedW = planned > 0 ? Math.round((posted / planned) * BAR_W) : 0;
  const assignedW = planned > 0 ? Math.round((assigned / planned) * BAR_W) : 0;
  const fullName = suffix ? `${title} · ${suffix}` : title;

  return (
    <div className={`relative mx-2 h-11 rounded-[8px] ${selected ? 'bg-[#eef1f3]' : 'hover:bg-[#f5f7f8]'}`}>
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
        <span className="ml-[10px] min-w-[34px] shrink-0 whitespace-nowrap text-right text-[13.5px] tabular-nums text-[#6c7781]">
          {planned > 0 ? `${posted}/${planned}` : '작업 없음'}
        </span>
      </button>
    </div>
  );
}
