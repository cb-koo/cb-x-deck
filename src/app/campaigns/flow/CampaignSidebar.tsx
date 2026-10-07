'use client';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import {
  campaignRowLabel, campaignSections, campaignsByClient, isLongCampaign, matchesCampaignQuery, splitClientRows, type WeekGroup,
} from '@/lib/campaignListView';
import { Button } from '@/components/ui';
import { SidebarRow } from './sidebar/SidebarRow';
import type { HeaderAction } from '../CampaignHeader';

// 캠페인 v2 왼쪽 목록(스펙 2026-10-08 §2·§3) — 360px. 위: 제목·새 캠페인·검색·묶어 보기.
// 주차로 묶으면 장기 캠페인 / 주차 캠페인 / 지난 캠페인 세 섹션, 클라이언트로 묶으면 클라이언트별 묶음(섹션 제목 없음).
// 위계 3단계(시안 WeekMode/ClientMode): 섹션 제목(위 구분선) → 묶음 머리(맨 셰브론·회색 제목·숫자) → 들여 쓴 행.
// 클라이언트 묶음 안은 진행 중·예정 먼저(장기 맨 위, 꼬리말 '장기'), 그다음 `지난` 라벨과 흐린 지난 행.
// 묶기·순서·색 점 판단은 전부 campaignListView(순수 함수)가 하고, 여기선 펼침 상태·검색어·메뉴만 들고 그린다.
// 옛 /campaigns 화면은 CampaignList를 그대로 쓴다(이 부품은 v2 전용).

type GroupBy = 'week' | 'client';
const GROUP_BY_KEY = 'campaign-list-group-by';
function readGroupBy(): GroupBy {
  try { return localStorage.getItem(GROUP_BY_KEY) === 'client' ? 'client' : 'week'; } catch { return 'week'; }
}
function saveGroupBy(v: GroupBy) {
  try { localStorage.setItem(GROUP_BY_KEY, v); } catch { /* 저장 못 해도 화면은 동작 */ }
}
// 지난 캠페인은 최근 2개 주차만, 나머지는 '더 보기'(§2)
const PAST_SHOWN = 2;

export function CampaignSidebar({ rows, selectedId, today, loaded, loadErr, onSelect, onCreate, onRetry, onCollapse, onMenuAction }: {
  rows: CampaignRow[]; selectedId: string | null; today: string;
  loaded: boolean; loadErr: boolean;
  onSelect: (id: string) => void; onCreate: () => void; onRetry: () => void; onCollapse: () => void;
  onMenuAction: (id: string, action: HeaderAction['kind']) => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>(() => readGroupBy());
  const [q, setQ] = useState('');
  // 사용자가 직접 접거나 편 묶음만 기억한다 — 나머지는 기본값(스펙 §3-2·§3-4)을 따른다.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const [showAllPast, setShowAllPast] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // 메뉴의 바깥 클릭·Esc 리스너가 이 함수에 걸려 있다 — 렌더마다 새 함수면 목록 새로고침 때 리스너가 다시 붙으며 포커스가 첫 항목으로 튄다
  const closeMenu = useCallback(() => setMenuFor(null), []);

  const searching = q.trim() !== '';
  const filtered = useMemo(() => (searching ? rows.filter((c) => matchesCampaignQuery(c, q)) : rows), [rows, q, searching]);
  const sections = useMemo(() => campaignSections(filtered, today), [filtered, today]);
  const byClient = useMemo(() => campaignsByClient(filtered, today), [filtered, today]);

  function chooseGroupBy(v: GroupBy) { setGroupBy(v); saveGroupBy(v); }
  function toggle(key: string, current: boolean) { setOpenOverride((m) => ({ ...m, [`${groupBy}:${key}`]: !current })); }
  // 펼침 = 검색 중이면 전부 / 사용자가 고른 값 / 기본값(선택된 캠페인이 든 묶음은 펼친다 — 주소로 연 캠페인이 숨지 않게)
  function isOpen(key: string, defaultOpen: boolean, groupRows: CampaignRow[]): boolean {
    if (searching) return true;
    const o = openOverride[`${groupBy}:${key}`];
    if (o !== undefined) return o;
    return defaultOpen || groupRows.some((c) => c.id === selectedId);
  }
  function weekDefaultOpen(g: WeekGroup<CampaignRow>): boolean {
    if (g.tone === 'current') return true;
    if (g.tone === 'upcoming') return g.rows.length > 0;
    return false;   // 지난 주차는 전부 접힘
  }

  const renderRow = (c: CampaignRow, opts?: { top?: boolean; past?: boolean }) => {
    const byClient = groupBy === 'client';
    const label = campaignRowLabel(c, { groupedByClient: byClient });
    // 클라이언트 묶음 안에선 장기 캠페인에 꼬리말 '장기'(주차 모드는 섹션 제목이 이미 말한다)
    const suffix = byClient && isLongCampaign(c) ? '장기' : label.suffix;
    return (
      <SidebarRow key={c.id} c={c} title={label.title} suffix={suffix} today={today}
                  selected={c.id === selectedId} menuOpen={menuFor === c.id}
                  top={opts?.top} past={opts?.past}
                  onSelect={() => onSelect(c.id)}
                  onMenuToggle={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                  onMenuClose={closeMenu}
                  onAction={(a) => { setMenuFor(null); onMenuAction(c.id, a); }} />
    );
  };

  // body: 펼쳤을 때 그릴 내용(기본 = 들여 쓴 행 목록). 클라이언트 모드는 진행 중 / 지난을 나눠 그린다.
  const renderGroup = (key: string, label: string, groupRows: CampaignRow[], open: boolean, past: boolean,
                       opts?: { empty?: ReactNode; body?: ReactNode }) => (
    <div key={key}>
      <button type="button" onClick={() => toggle(key, open)} aria-expanded={open}
              className="flex h-10 w-full items-center gap-0.5 px-4 text-left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={past ? '#9aa5ad' : '#536471'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
        </svg>
        <span className={`truncate whitespace-nowrap text-[14px] ${past ? 'font-medium text-[#9aa5ad]' : 'font-semibold text-[#536471]'}`}>{label}</span>
        <span className="ml-auto shrink-0 text-[13px] tabular-nums text-[#9aa5ad]">{groupRows.length}</span>
      </button>
      {open && (groupRows.length > 0 ? (opts?.body ?? groupRows.map((c) => renderRow(c))) : opts?.empty)}
    </div>
  );

  // 섹션 제목(L1) — 첫 섹션 말고는 위에 가는 구분선
  const sectionTitle = (text: string, first: boolean, right?: ReactNode) => (
    <div className={`flex items-baseline justify-between px-4 pb-2 pt-5 ${first ? '' : 'mt-3 border-t border-[#eff3f4]'}`}>
      <h3 className="text-[13px] font-bold leading-4 tracking-[0.02em] text-[#0f1419]">{text}</h3>
      {right}
    </div>
  );

  function renderWeekMode() {
    const { long, upcoming, past } = sections;
    // 검색 중엔 일치하는 캠페인이 없는 묶음을 숨긴다(§3-4) — 평소엔 이번 주·다음 주를 0개여도 그린다(§3-2)
    const weekGroups = searching ? upcoming.filter((g) => g.rows.length > 0) : upcoming;
    const pastGroups = searching ? past.filter((g) => g.rows.length > 0) : past;
    const selectedPastIdx = pastGroups.findIndex((g) => g.rows.some((c) => c.id === selectedId));
    const pastLimit = searching || showAllPast ? pastGroups.length : Math.max(PAST_SHOWN, selectedPastIdx + 1);
    const visiblePast = pastGroups.slice(0, pastLimit);
    const hasMorePast = !searching && pastGroups.length > PAST_SHOWN;
    // 더 보기 N = 선택된 주가 강제로 펼쳐 둔 것까지 빼고 아직 숨겨진 지난 주 수
    const hiddenPast = Math.max(0, pastGroups.length - Math.max(PAST_SHOWN, selectedPastIdx + 1));
    let first = true;
    const isFirst = () => { const f = first; first = false; return f; };
    return (
      <>
        {long.length > 0 && (
          <section>
            {sectionTitle('장기 캠페인', isFirst())}
            {long.map((c) => renderRow(c, { top: true }))}
          </section>
        )}
        {weekGroups.length > 0 && (
          <section>
            {sectionTitle('주차 캠페인', isFirst())}
            {weekGroups.map((g) => renderGroup(g.key, g.label, g.rows, isOpen(g.key, weekDefaultOpen(g), g.rows), false, {
              empty: <p className="flex h-11 items-center pl-[34px] pr-4 text-[13.5px] text-[#6c7781]">아직 캠페인이 없어요</p>,
            }))}
          </section>
        )}
        {pastGroups.length > 0 && (
          <section>
            {sectionTitle('지난 캠페인', isFirst(), hasMorePast ? (
              <button type="button" onClick={() => setShowAllPast((v) => !v)} aria-expanded={showAllPast}
                      className="text-[13px] font-normal tracking-normal text-[#1573ad] hover:underline">
                {showAllPast ? '접기' : `더 보기 (${hiddenPast}주)`}
              </button>
            ) : undefined)}
            {visiblePast.map((g) => renderGroup(g.key, g.label, g.rows, isOpen(g.key, false, g.rows), true))}
          </section>
        )}
      </>
    );
  }

  function renderClientMode() {
    const groups = searching ? byClient.filter((g) => g.rows.length > 0) : byClient;
    return (
      <div className="pt-2">
        {groups.map((g, i) => {
          const { current, past } = splitClientRows(g.rows, today);
          const body = (
            <>
              {current.map((c) => renderRow(c))}
              {past.length > 0 && <div className="pb-1 pl-[34px] pr-4 pt-[10px] text-[12.5px] font-medium leading-[14px] text-[#9aa5ad]">지난</div>}
              {past.map((c) => renderRow(c, { past: true }))}
            </>
          );
          return (
            <div key={g.key}>
              {i > 0 && <div aria-hidden className="mx-4 my-2 h-px bg-[#eff3f4]" />}
              {renderGroup(g.key, g.label, g.rows, isOpen(g.key, g.open, g.rows), false, { body })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 border-b border-[#eff3f4] bg-white p-4">
        <div className="flex h-8 items-center gap-2">
          <h2 className="flex-1 text-[20px] font-extrabold tracking-[-0.01em] text-[#0f1419]">캠페인</h2>
          <button type="button" onClick={onCreate}
                  className="inline-flex h-8 items-center gap-[5px] rounded-full bg-[#0f1419] pl-[11px] pr-[14px] text-[13.5px] font-semibold text-white hover:bg-[#272c30]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            새 캠페인
          </button>
          <button type="button" onClick={onCollapse} aria-label="목록 접기" title="목록 접기"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#536471] hover:bg-[#f5f7f8]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
            </svg>
          </button>
        </div>
        <div className="relative mt-3">
          <label htmlFor="campaign-search" className="sr-only">캠페인 검색</label>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6c7781" strokeWidth="2" strokeLinecap="round" aria-hidden
               className="pointer-events-none absolute left-[13px] top-[11px]">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input id="campaign-search" type="text" value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }}
                 placeholder="캠페인·클라이언트 검색"
                 className={`h-[38px] w-full rounded-[10px] border border-transparent bg-[#f5f7f8] pl-[38px] text-[14px] text-[#0f1419] outline-none placeholder:text-[#6c7781] focus:border-[#1d9bf0] focus:bg-white ${q ? 'pr-9' : 'pr-[14px]'}`} />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="검색어 지우기"
                    className="absolute right-1.5 top-[5px] flex h-7 w-7 items-center justify-center rounded-full text-x-muted hover:bg-x-border">✕</button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[13px] text-[#6c7781]">묶어 보기</span>
          <div role="group" aria-label="묶어 보기" className="inline-flex h-8 gap-0.5 rounded-[9px] bg-[#f0f2f4] p-[3px]">
            {(['week', 'client'] as const).map((v) => (
              <button key={v} type="button" onClick={() => chooseGroupBy(v)} aria-pressed={groupBy === v}
                      className={`rounded-[7px] px-[14px] text-[13.5px] ${groupBy === v ? 'bg-white font-semibold text-[#0f1419] shadow-[0_1px_2px_rgba(15,20,25,0.10),0_0_0_0.5px_rgba(15,20,25,0.06)]' : 'text-[#536471]'}`}>
                {v === 'week' ? '주차' : '클라이언트'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 pb-4">
        {!loaded && <p className="px-4 py-4 text-content text-x-muted">불러오는 중…</p>}
        {loaded && loadErr && (
          <div className="px-4 py-4">
            <p className="mb-2 text-content text-x-secondary">목록을 불러오지 못했습니다</p>
            <Button onClick={onRetry}>다시 시도</Button>
          </div>
        )}
        {loaded && !loadErr && searching && filtered.length === 0 && (
          <p className="px-4 py-6 text-content text-x-muted">찾는 캠페인이 없어요</p>
        )}
        {loaded && !loadErr && !(searching && filtered.length === 0) && (groupBy === 'week' ? renderWeekMode() : renderClientMode())}
      </div>
    </div>
  );
}
