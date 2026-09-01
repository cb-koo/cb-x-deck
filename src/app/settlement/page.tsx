'use client';
import { Suspense, useCallback, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { SETTLEMENT_TABS, SETTLEMENT_TAB_LABEL, parseSettlementTab, type SettlementTab } from './tabs';
import { CandidateTable } from './CandidateTable';
import { RequestList } from './RequestList';
import { SettingsTab } from './SettingsTab';
import { ExternalLogTab } from './ExternalLogTab';

function SettlementInner() {
  const pathname = usePathname(); const sp = useSearchParams();
  // 탭은 URL이 아니라 지역 상태다 — router.replace는 App Router의 소프트 내비게이션(라우트 세그먼트 서버 왕복)을
  // 포함해서, 왕복이 밀리면 탭 클릭이 씹힌 것처럼 보였다(사용자 신고). URL 초기값은 마운트 시 1회만 읽는다 —
  // 딥링크 두 개(캠페인 표 배지 → ?tab=requests&task=, 요청 펼침 → ?tab=log&request=)가 여기서 소비된다.
  const [tab, setTabState] = useState<SettlementTab>(() => parseSettlementTab(sp.get('tab')));
  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => sp.get('task'));
  const [focusRequestId, setFocusRequestId] = useState<string | null>(() => sp.get('request'));
  const setTab = useCallback((t: SettlementTab) => {
    setTabState(t);
    setFocusTaskId(null);      // 탭을 바꾸면 딥링크로 들어온 '요청 하나만 보기' 필터는 해제한다(기존 동작 유지 + request도 함께)
    setFocusRequestId(null);
    // 네이티브 History API로 URL만 갱신한다 — Next 라우터의 서버 왕복을 기다리지 않는다(pathname/searchParams와는
    // 계속 동기화된다: node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md
    // "Native History API" 절 — pushState/replaceState calls integrate into the Next.js Router).
    // replaceState를 쓴다 — 새 히스토리 항목을 쌓지 않는다(기존 router.replace와 같은 의미).
    const p = new URLSearchParams(window.location.search);
    if (t === 'candidates') p.delete('tab'); else p.set('tab', t);
    p.delete('task');
    p.delete('request');
    const qs = p.toString();
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }, [pathname]);
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-6">
      <h1 className="text-[20px] font-bold">정산</h1>
      <p className="mt-1 text-ui text-x-muted">캠페인에서 게시 확인된 작업이 자동으로 모여요. 확인하고 골라서 요청을 만들어요.</p>
      <nav className="mt-4 flex gap-1 border-b border-x-border" aria-label="정산 탭">
        {SETTLEMENT_TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}
                  className={`px-3.5 py-2 text-ui ${tab === t ? 'border-b-2 border-x-blue font-semibold text-x-text' : 'text-x-secondary hover:text-x-text'}`}>
            {SETTLEMENT_TAB_LABEL[t]}
          </button>
        ))}
      </nav>
      <div className="mt-5">
        {tab === 'candidates' && <CandidateTable />}
        {tab === 'requests' && <RequestList focusTaskId={focusTaskId} />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'log' && <ExternalLogTab focusRequestId={focusRequestId} />}
      </div>
    </main>
  );
}
export default function SettlementPage() {
  return <Suspense fallback={null}><SettlementInner /></Suspense>;
}
