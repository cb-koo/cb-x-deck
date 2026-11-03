'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SETTLEMENT_TABS, SETTLEMENT_TAB_LABEL, parseSettlementTab, type SettlementTab } from './tabs';
import { PendingTab } from './PendingTab';
import { RequestList } from './RequestList';
import { SettingsTab } from './SettingsTab';
import { ExternalLogTab } from './ExternalLogTab';
import { fetchPending, fetchRequests } from '@/lib/settlementApi';
import { searchTokens, matchesSearch, type SearchFields } from '@/lib/settlementSearch';

// 검색이 걸리는 탭 — 설정·호출 기록은 작업 목록이 아니라 검색창을 두지 않는다
const SEARCH_TABS: readonly SettlementTab[] = ['candidates', 'requests'];

function SettlementInner() {
  const pathname = usePathname(); const sp = useSearchParams();
  // 탭은 URL이 아니라 지역 상태다 — router.replace는 App Router의 소프트 내비게이션(라우트 세그먼트 서버 왕복)을
  // 포함해서, 왕복이 밀리면 탭 클릭이 씹힌 것처럼 보였다(사용자 신고). URL 초기값은 마운트 시 1회만 읽는다 —
  // 딥링크 세 개(캠페인 표 배지 → ?tab=requests&task=, 요청 펼침 → ?tab=log&request=,
  // 캠페인 v2 → ?tab=candidates&campaign=)가 여기서 소비된다.
  const [tab, setTabState] = useState<SettlementTab>(() => parseSettlementTab(sp.get('tab')));
  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => sp.get('task'));
  const [focusRequestId, setFocusRequestId] = useState<string | null>(() => sp.get('request'));
  const [focusCampaignId, setFocusCampaignId] = useState<string | null>(() => sp.get('campaign'));
  // 검색어는 두 탭이 같이 쓴다 — 탭을 바꿔도 남는다(koo 11-02: 문의 온 인플루언서가 '보냈나·안 보냈나'를 탭 오가며 찾지 않게)
  const [q, setQ] = useState('');
  const tokens = useMemo(() => searchTokens(q), [q]);
  // 다른 탭 건수 — 검색을 시작할 때·탭을 바꿀 때 두 목록을 한 번 읽어 화면에서 센다(타이핑마다 다시 읽지 않는다)
  const [lists, setLists] = useState<{ candidates: SearchFields[]; requests: SearchFields[] } | null>(null);
  const searching = tokens.length > 0;
  useEffect(() => {
    if (!searching || lists) return;
    let off = false;
    void Promise.all([fetchPending(), fetchRequests({})]).then(([p, r]) => {
      if (off || !p.ok || !r.ok) return;
      setLists({ candidates: [...p.data.rows.map((x) => x.cand), ...p.data.unsendable], requests: r.data });
    });
    return () => { off = true; };
  }, [searching, lists]);
  const otherTab: SettlementTab | null = tab === 'candidates' ? 'requests' : tab === 'requests' ? 'candidates' : null;
  const otherCount = otherTab && lists && searching ? lists[otherTab as 'candidates' | 'requests'].filter((x) => matchesSearch(x, tokens)).length : null;
  const setTab = useCallback((t: SettlementTab) => {
    setTabState(t);
    setLists(null);            // 다른 탭 건수는 탭을 옮길 때 새로 센다 — 그 사이 보낸·고친 건이 반영되게
    setFocusTaskId(null);      // 탭을 바꾸면 딥링크로 들어온 좁힘(요청 하나만·캠페인 하나만)은 전부 해제한다 — URL에서도 아래에서 같이 지운다
    setFocusRequestId(null);
    setFocusCampaignId(null);  // 안 지우면 탭을 떠났다 돌아올 때마다 캠페인 필터가 되살아나 사용자가 고른 값을 덮는다
    // 네이티브 History API로 URL만 갱신한다 — Next 라우터의 서버 왕복을 기다리지 않는다(pathname/searchParams와는
    // 계속 동기화된다: node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md
    // "Native History API" 절 — pushState/replaceState calls integrate into the Next.js Router).
    // replaceState를 쓴다 — 새 히스토리 항목을 쌓지 않는다(기존 router.replace와 같은 의미).
    const p = new URLSearchParams(window.location.search);
    if (t === 'candidates') p.delete('tab'); else p.set('tab', t);
    p.delete('task');
    p.delete('request');
    p.delete('campaign');
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }, [pathname]);
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-6">
      <h1 className="text-[20px] font-bold">정산</h1>
      <p className="mt-1 text-ui text-x-muted">게시 확인된 작업은 매주 월요일 07:00 정산팀에 자동 전송돼요. 확인·보완이 필요한 작업은 정산 요청 대기에 남아요.</p>
      <nav className="mt-4 flex gap-1 border-b border-x-border" aria-label="정산 탭">
        {SETTLEMENT_TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
                  className={`px-3.5 py-2 text-ui ${tab === t ? 'border-b-2 border-x-blue font-semibold text-x-text' : 'text-x-secondary hover:text-x-text'}`}>
            {SETTLEMENT_TAB_LABEL[t]}
          </button>
        ))}
      </nav>
      {SEARCH_TABS.includes(tab) && (
        <div className="mt-4">
          <div className="relative max-w-[480px]">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="정산 검색"
                   placeholder="인플루언서, 캠페인, 클라이언트 이름으로 찾기"
                   className="w-full rounded-lg border border-x-border bg-white px-3 py-2 text-[15px] placeholder:text-x-muted focus:border-x-blue focus:outline-none" />
          </div>
          <p className="mt-1.5 text-ui text-x-muted">
            {!searching ? '예: @rena, 4주차, 백수약국 — 띄어 쓰면 낱말이 모두 들어간 것만 보여요'
              : otherCount === null ? '찾는 중…'
              : otherCount === 0 ? `${SETTLEMENT_TAB_LABEL[otherTab!]}에는 없어요`
              : <>{SETTLEMENT_TAB_LABEL[otherTab!]}에도 {otherCount}건 있어요 <button type="button" onClick={() => setTab(otherTab!)} className="text-x-blue-text hover:underline">보기 →</button></>}
          </p>
        </div>
      )}
      <div className="mt-5">
        {tab === 'candidates' && <PendingTab onGoRequests={() => setTab('requests')} initialCampaignId={focusCampaignId} tokens={tokens} />}
        {tab === 'requests' && <RequestList focusTaskId={focusTaskId} tokens={tokens} onClearSearch={() => setQ('')} />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'log' && <ExternalLogTab focusRequestId={focusRequestId} />}
      </div>
    </main>
  );
}
export default function SettlementPage() {
  return <Suspense fallback={null}><SettlementInner /></Suspense>;
}
