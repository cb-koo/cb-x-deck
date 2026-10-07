'use client';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import {
  campaignRowLabel, campaignSections, campaignsByClient, matchesCampaignQuery, type WeekGroup,
} from '@/lib/campaignListView';
import { Button } from '@/components/ui';
import { SidebarRow, type RowMenuAction } from './sidebar/SidebarRow';

// 캠페인 v2 왼쪽 목록(스펙 2026-10-08 §2·§3) — 360px. 위: 제목·새 캠페인·검색·묶어 보기.
// 주차로 묶으면 장기 캠페인 / 주차 캠페인 / 지난 캠페인 세 섹션, 클라이언트로 묶으면 클라이언트별 묶음(섹션 제목 없음).
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
  onMenuAction: (id: string, action: RowMenuAction) => void;
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

  // 클라이언트로 묶으면 행 제목 자리에 클라이언트 이름이 반복된다 — 묶음 제목이 이미 말하므로 캠페인 이름에서
  // '{클라이언트}_'를 뗀 나머지(주차·꼬리말)를 보여 준다.
  function rowLabel(c: CampaignRow): { title: string; suffix: string | null } {
    if (groupBy === 'client' && c.clientName && c.name.startsWith(`${c.clientName}_`)) {
      return { title: c.name.slice(c.clientName.length + 1), suffix: null };
    }
    if (groupBy === 'client' && c.clientName) return { title: c.name, suffix: null };
    return campaignRowLabel(c);
  }

  const renderRow = (c: CampaignRow) => {
    const { title, suffix } = rowLabel(c);
    return (
      <SidebarRow key={c.id} c={c} title={title} suffix={suffix} today={today}
                  selected={c.id === selectedId} menuOpen={menuFor === c.id}
                  onSelect={() => onSelect(c.id)}
                  onMenuToggle={() => setMenuFor((m) => (m === c.id ? null : c.id))}
                  onMenuClose={closeMenu}
                  onAction={(a) => { setMenuFor(null); onMenuAction(c.id, a); }} />
    );
  };

  const renderGroup = (key: string, label: string, groupRows: CampaignRow[], open: boolean, past: boolean, empty?: ReactNode) => (
    <div key={key}>
      <button type="button" onClick={() => toggle(key, open)} aria-expanded={open}
              className="group/g flex h-11 w-full items-center gap-1.5 pl-[9px] pr-4 text-left">
        <span aria-hidden className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full group-hover/g:bg-x-hover">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={past ? '#9aa5ad' : '#536471'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} />
          </svg>
        </span>
        <span className={`truncate text-[15px] ${past ? 'font-medium text-x-muted' : 'font-semibold text-x-text'}`}>{label}</span>
        <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[13px] leading-4 tabular-nums ${past ? 'bg-x-hover text-x-muted' : 'bg-[#f1f5f8] text-x-secondary'}`}>
          {groupRows.length}개
        </span>
      </button>
      {open && (groupRows.length > 0 ? groupRows.map(renderRow) : empty)}
    </div>
  );

  const sectionTitle = (text: string, first: boolean, right?: ReactNode) => (
    <div className={`flex items-baseline justify-between px-4 pb-2 ${first ? 'pt-3' : 'pt-5'}`}>
      <h3 className="text-[13px] font-bold leading-4 tracking-[0.06em] text-x-muted">{text}</h3>
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
    let first = true;
    const isFirst = () => { const f = first; first = false; return f; };
    return (
      <>
        {long.length > 0 && (
          <section>
            {sectionTitle('장기 캠페인', isFirst())}
            <div className="pb-1">{long.map(renderRow)}</div>
          </section>
        )}
        {weekGroups.length > 0 && (
          <section>
            {sectionTitle('주차 캠페인', isFirst())}
            {weekGroups.map((g) => renderGroup(g.key, g.label, g.rows, isOpen(g.key, weekDefaultOpen(g), g.rows), false,
              <p className="flex h-11 items-center pl-[45px] pr-4 text-[14px] text-x-muted">아직 캠페인이 없어요</p>))}
          </section>
        )}
        {pastGroups.length > 0 && (
          <section>
            {sectionTitle('지난 캠페인', isFirst(), hasMorePast ? (
              <button type="button" onClick={() => setShowAllPast((v) => !v)} aria-expanded={showAllPast}
                      className="text-[13px] text-x-blue-text hover:underline">
                {showAllPast ? '접기' : `더 보기 (${pastGroups.length - PAST_SHOWN}주)`}
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
        {groups.map((g) => renderGroup(g.key, g.label, g.rows, isOpen(g.key, g.open, g.rows), false))}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-20 border-b border-x-border bg-white p-4">
        <div className="flex h-9 items-center justify-between gap-2">
          <h2 className="text-[20px] font-extrabold tracking-[-0.01em]">캠페인</h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onCreate}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-x-text px-4 text-[14px] font-semibold text-white hover:bg-[#272c30]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              새 캠페인
            </button>
            <button type="button" onClick={onCollapse} aria-label="목록 접기" title="목록 접기"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-x-muted hover:bg-x-hover">«</button>
          </div>
        </div>
        <div className="relative mt-3">
          <label htmlFor="campaign-search" className="sr-only">캠페인 검색</label>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6c7781" strokeWidth="2" strokeLinecap="round" aria-hidden
               className="pointer-events-none absolute left-[13px] top-3">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <input id="campaign-search" type="text" value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }}
                 placeholder="캠페인·클라이언트 검색"
                 className="h-10 w-full rounded-[10px] border border-x-border bg-x-hover pl-[38px] pr-9 text-[14px] text-x-text outline-none focus:border-x-blue focus:bg-white" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="검색어 지우기"
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full text-x-muted hover:bg-x-border">✕</button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span className="text-[13px] text-x-muted">묶어 보기</span>
          <div role="group" aria-label="묶어 보기" className="inline-flex h-8 rounded-full border border-x-border-strong p-0.5">
            {(['week', 'client'] as const).map((v) => (
              <button key={v} type="button" onClick={() => chooseGroupBy(v)} aria-pressed={groupBy === v}
                      className={`rounded-full px-3 text-[13px] ${groupBy === v ? 'bg-x-text font-semibold text-white' : 'text-x-secondary hover:text-x-text'}`}>
                {v === 'week' ? '주차' : '클라이언트'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 pb-6">
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
