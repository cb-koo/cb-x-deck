// 캠페인 v2(ADR 0003) — 기존 /campaigns와 병존. 좌측 목록·생성은 같은 부품, 상세만 FlowDetail.
'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/lib/toastContext';
import { kstToday } from '@/lib/datetime';
import type { CampaignRow } from '@/lib/campaignStore';
import { fetchCampaigns } from '@/lib/campaignApi';
import { pickCampaignId } from '@/lib/campaignView';
import { Button } from '@/components/ui';
import { CampaignList } from '../CampaignList';
import { CampaignCreateModal } from '../CampaignCreateModal';
import { FlowDetail } from './FlowDetail';

// 좌측 목록 접기/펼치기 — /campaigns와 같은 키를 쓴다(같은 목록이라 접힘 상태를 공유한다, CampaignsSplit 관례).
const LIST_COLLAPSED_KEY = 'campaigns-list-collapsed';
function readListCollapsed(): boolean {
  try { return localStorage.getItem(LIST_COLLAPSED_KEY) === '1'; } catch { return false; }
}
function saveListCollapsed(v: boolean) {
  try { localStorage.setItem(LIST_COLLAPSED_KEY, v ? '1' : '0'); } catch { /* 저장 못 해도 화면은 동작 */ }
}

export default function CampaignsFlowPage() {
  // useSearchParams는 Suspense 경계 필수(clients/page.tsx·generate/page.tsx·campaigns/page.tsx 선례)
  return <Suspense><CampaignsFlowSplit /></Suspense>;
}

function CampaignsFlowSplit() {
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
  const [listCollapsed, setListCollapsed] = useState<boolean>(() => readListCollapsed());
  const toggleListCollapsed = useCallback(() => {
    setListCollapsed((v) => { const next = !v; saveListCollapsed(next); return next; });
  }, []);
  // 방금 내가 지운 캠페인 id — router.replace(URL에서 ?id= 제거)와 load()의 재조회가 어느 쪽이 먼저 반영될지는
  // 보장되지 않는다(Next 라우터 전환은 비동기). load()가 먼저 rows를 갈아치우면 urlId는 아직 지운 id를 들고 있어
  // picked.missing이 true가 되어 "찾을 수 없어요" 토스트가 뜬다 — 방금 지운 사람에게는 오경보다. 순서를 맞추는 대신
  // "이 id는 내가 막 지웠다"를 기억해 그 한 번만 토스트를 건너뛴다(정말 낯선 ?id=는 그대로 토스트).
  const justDeletedRef = useRef<string | null>(null);

  // setState는 전부 await 뒤 — 동기 setState가 앞에 있으면 set-state-in-effect에 걸린다(CampaignDetail 관례)
  const load = useCallback(async () => {
    const r = await fetchCampaigns();
    if (r.ok) { setRows(r.data); setLoadErr(false); } else setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    setLoaded(true);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(CampaignDetail 관례)
  useEffect(() => { void load(); }, [load]);

  const picked = useMemo(() => pickCampaignId(rows, urlId, today), [rows, urlId, today]);
  // 무효 ?id= → 토스트 + 첫 캠페인(스펙 §7). URL도 고쳐 새로고침해도 같은 화면(clients 폴백 관례).
  useEffect(() => {
    if (!loaded || loadErr) return;
    if (picked.missing) {
      if (urlId === justDeletedRef.current) justDeletedRef.current = null;   // 방금 지운 id라 오경보 — 소모하고 넘어간다
      else show('링크가 가리키는 캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요. 첫 캠페인을 열었어요');
    }
    if (picked.id && picked.id !== urlId) router.replace(`${pathname}?id=${picked.id}`, { scroll: false });
    else if (!picked.id && urlId) router.replace(pathname, { scroll: false });
  }, [loaded, loadErr, picked, urlId, pathname, router, show]);

  const select = useCallback((id: string) => router.replace(`${pathname}?id=${id}`, { scroll: false }), [router, pathname]);

  return (
    // 상세는 연회색 바닥(bg-x-surface) 위 흰 패널들(FlowDetail) — 왼쪽 목록은 흰 배경 + 세로 구분선 그대로다(/campaigns와 같은 부품).
    // min-h-full: 내용이 짧아도 회색이 화면 아래까지 내려가야 한다(GlobalShell의 스크롤 컨테이너 높이를 채운다).
    <div className="flex min-h-full">
      <aside className={`sticky top-0 max-h-screen shrink-0 self-start overflow-y-auto border-r border-x-border bg-white transition-[width] ${listCollapsed ? 'w-11 px-1 py-4' : 'w-[280px] px-3 py-5'}`}>
        {listCollapsed ? (
          // 접힘 = 펼치기 버튼만 있는 얇은 레일(~44px) — 목록 대신 상세가 폭을 가져간다.
          <div className="flex flex-col items-center gap-2">
            <button onClick={toggleListCollapsed} aria-label="목록 펼치기" title="목록 펼치기"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-x-secondary hover:bg-x-hover">»</button>
            {rows.length > 0 && (
              <span className="rounded-full bg-x-hover px-1.5 py-0.5 text-caption text-x-muted">{rows.length}</span>
            )}
          </div>
        ) : (
          <>
            <div className="mb-1 flex justify-end">
              <button onClick={toggleListCollapsed} aria-label="목록 접기" title="목록 접기"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-x-muted hover:bg-x-hover">«</button>
            </div>
            <CampaignList rows={rows} selectedId={picked.id} today={today} loaded={loaded} loadErr={loadErr}
                          onSelect={select} onCreate={() => setCreating(true)} onRetry={() => void load()} />
          </>
        )}
      </aside>
      <main className="min-w-0 flex-1 bg-x-surface">
        {loaded && !loadErr && rows.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="mb-1 text-content">아직 캠페인이 없어요</p>
            <p className="mb-4 text-ui text-x-secondary">클라이언트 한 곳의 한 기간 원고를 캠페인으로 묶으면 진행·성과·비용을 한 화면에서 볼 수 있어요.</p>
            <Button variant="primary" onClick={() => setCreating(true)} className="text-content">+ 새 캠페인</Button>
          </div>
        )}
        {picked.id && (
          <FlowDetail key={picked.id} id={picked.id} campaigns={rows}
                      onChanged={() => void load()}
                      onDeleted={() => {
                        justDeletedRef.current = picked.id;   // load()가 router.replace보다 먼저 반영돼도 이 id는 오경보 대상에서 뺀다
                        router.replace(pathname, { scroll: false });
                        void load();
                      }} />
        )}
      </main>
      {creating && (
        <CampaignCreateModal today={today} onClose={() => setCreating(false)}
                             onCreated={async (row) => { setCreating(false); await load(); select(row.id); }} />
      )}
    </div>
  );
}
