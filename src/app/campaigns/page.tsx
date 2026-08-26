'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/lib/toastContext';
import { kstToday } from '@/lib/datetime';
import type { CampaignRow } from '@/lib/campaignStore';
import { fetchCampaigns } from '@/lib/campaignApi';
import { pickCampaignId } from '@/lib/campaignView';
import { Button } from '@/components/ui';
import { CampaignList } from './CampaignList';
import { CampaignCreateModal } from './CampaignCreateModal';
import { CampaignDetail } from './CampaignDetail';

export default function CampaignsPage() {
  // useSearchParams는 Suspense 경계 필수(clients/page.tsx·generate/page.tsx 선례)
  return <Suspense><CampaignsSplit /></Suspense>;
}

function CampaignsSplit() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlId = searchParams.get('id');
  const { show } = useToast();
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [creating, setCreating] = useState(false);
  // '오늘'(서울)은 마운트 시 한 번 — 렌더마다 시계를 읽지 않는다(react-hooks/purity). 자정을 넘기면 새로고침이 기준을 갱신한다.
  const [today] = useState(() => kstToday());

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(CampaignDetail 관례)
  const load = useCallback(async () => {
    const r = await fetchCampaigns();
    if (r.ok) { setRows(r.data); setLoadErr(false); } else setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    setLoaded(true);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(CampaignDetail·tracking 관례)
  useEffect(() => { void load(); }, [load]);

  const picked = useMemo(() => pickCampaignId(rows, urlId, today), [rows, urlId, today]);
  // 무효 ?id= → 토스트 + 첫 캠페인(스펙 §7). URL도 고쳐 새로고침해도 같은 화면(clients 폴백 관례).
  useEffect(() => {
    if (!loaded || loadErr) return;
    if (picked.missing) show('링크가 가리키는 캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요. 첫 캠페인을 열었어요');
    if (picked.id && picked.id !== urlId) router.replace(`${pathname}?id=${picked.id}`, { scroll: false });
    else if (!picked.id && urlId) router.replace(pathname, { scroll: false });
  }, [loaded, loadErr, picked, urlId, pathname, router, show]);

  const select = useCallback((id: string) => router.replace(`${pathname}?id=${id}`, { scroll: false }), [router, pathname]);

  return (
    <div className="flex">
      <aside className="sticky top-0 max-h-screen w-[280px] shrink-0 self-start overflow-y-auto border-r border-x-border px-3 py-5">
        <CampaignList rows={rows} selectedId={picked.id} today={today} loaded={loaded} loadErr={loadErr}
                      onSelect={select} onCreate={() => setCreating(true)} onRetry={() => void load()} />
      </aside>
      <main className="min-w-0 flex-1">
        {loaded && !loadErr && rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="mb-1 text-content font-bold">아직 캠페인이 없어요</p>
            <p className="mb-4 text-ui text-x-secondary">클라이언트 한 곳의 한 기간 원고를 캠페인으로 묶으면 진행·성과·비용을 한 화면에서 볼 수 있어요.</p>
            <Button variant="primary" onClick={() => setCreating(true)} className="text-content">+ 새 캠페인</Button>
          </div>
        )}
        {picked.id && (
          <CampaignDetail key={picked.id} id={picked.id} campaigns={rows} onChanged={() => void load()}
                          onDeleted={() => { router.replace(pathname, { scroll: false }); void load(); }} />
        )}
      </main>
      {creating && (
        <CampaignCreateModal today={today} onClose={() => setCreating(false)}
                             onCreated={async (row) => { setCreating(false); await load(); select(row.id); }} />
      )}
    </div>
  );
}
