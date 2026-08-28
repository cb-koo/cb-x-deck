'use client';
import { Suspense, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SETTLEMENT_TABS, SETTLEMENT_TAB_LABEL, parseSettlementTab, type SettlementTab } from './tabs';
import { CandidateTable } from './CandidateTable';
import { RequestList } from './RequestList';
import { SettingsTab } from './SettingsTab';

function SettlementInner() {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const tab = parseSettlementTab(sp.get('tab'));
  const setTab = useCallback((t: SettlementTab) => {
    const p = new URLSearchParams(sp.toString());
    if (t === 'candidates') p.delete('tab'); else p.set('tab', t);
    p.delete('task');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [router, pathname, sp]);
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
        {tab === 'requests' && <RequestList focusTaskId={sp.get('task')} />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </main>
  );
}
export default function SettlementPage() {
  return <Suspense fallback={null}><SettlementInner /></Suspense>;
}
