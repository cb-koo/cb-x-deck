// 캠페인 v2(ADR 0003) — 기존 /campaigns와 병존. 생성 창은 같은 부품, 좌측 목록은 CampaignSidebar(10-08 개편), 상세는 FlowDetail.
'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useToast } from '@/lib/toastContext';
import { kstToday } from '@/lib/datetime';
import type { CampaignRow } from '@/lib/campaignStore';
import { fetchCampaigns } from '@/lib/campaignApi';
import { pickCampaignId } from '@/lib/campaignView';
import { Button } from '@/components/ui';
import { CampaignCreateModal } from '../CampaignCreateModal';
import { FlowDetail } from './FlowDetail';
import { CampaignSidebar } from './CampaignSidebar';
import type { RowMenuAction } from './sidebar/SidebarRow';

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
  // 캠페인 전환은 서버를 거치지 않는다(koo 09-27 '가끔 눌러도 안 움직임') — router.replace는 주소만 바꿔도
  // 서버 왕복(로그인 확인 + 화면 조각)을 기다린 뒤에야 화면을 바꾸고, 그동안 아무 표시가 없다. 그 응답은 브라우저
  // 캐시 대상이라 예전 '20초 멈춤'(proxy.ts의 /api no-store 주석)과 같은 대기에도 걸린다. 이 화면은 데이터를
  // 브라우저에서 따로 읽으므로(fetchCampaigns·FlowDetail) 그 왕복이 필요 없다 — 기본 history API는 Next 라우터와
  // 연동돼 useSearchParams가 그대로 따라온다(node_modules/next/dist/docs … linking-and-navigating 'Native History API').
  const pathname = usePathname();
  const setUrlId = useCallback((id: string | null) => {
    window.history.replaceState(null, '', id ? `${pathname}?id=${id}` : pathname);
  }, [pathname]);
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
  // 방금 내가 지운 캠페인 id — 주소 바꾸기(URL에서 ?id= 제거)와 load()의 재조회가 어느 쪽이 먼저 반영될지는
  // 보장되지 않는다(useSearchParams 반영은 다음 렌더). load()가 먼저 rows를 갈아치우면 urlId는 아직 지운 id를 들고 있어
  // picked.missing이 true가 되어 "찾을 수 없어요" 토스트가 뜬다 — 방금 지운 사람에게는 오경보다. 순서를 맞추는 대신
  // "이 id는 내가 막 지웠다"를 기억해 그 한 번만 토스트를 건너뛴다(정말 낯선 ?id=는 그대로 토스트).
  const justDeletedRef = useRef<string | null>(null);
  // 작성 중인 컴포저를 잃지 않는다(Task 4d §6, "마지막 문") — FlowDetail은 key={picked.id}로 그려서
  // (아래) 다른 캠페인을 고르면 통째로 언마운트된다. 패널 안쪽 가드(FlowDetail의 openPanel 등)는 같은
  // 캠페인 안에서 다른 작업으로 넘어갈 때만 닿고, 이 목록 클릭에는 안 닿는다. 렌더 중에 읽지 않는다
  // (React Compiler 규칙) — select(아래)는 클릭 핸들러 안에서만 읽는다. FlowDetail이 매 렌더 상태로
  // 올리지 않고 ref로만 받는 이유는 새 작업 dirty(newDirtyRef)와 같다 — 이 값 때문에 페이지 전체가
  // 리렌더될 필요는 없다. boolean이 아니라 문장 자체를 든다 — FlowDetail이 어느 탭(직접 쓰기·생성)이
  // 작성 중인지 알아 문장을 이미 고른 채로 올려 준다(FlowDetail의 onLeaveConfirmChange 주석). 여기서
  // 새로 문장을 짓지 않는다.
  const leaveConfirmRef = useRef<string | null>(null);
  const onComposerLeaveConfirmChange = useCallback((message: string | null) => { leaveConfirmRef.current = message; }, []);

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
    if (picked.id && picked.id !== urlId) setUrlId(picked.id);
    else if (!picked.id && urlId) setUrlId(null);
  }, [loaded, loadErr, picked, urlId, setUrlId, show]);

  // 작성 중인 컴포저가 있으면 확인한다(Task 4d §6) — 문구는 FlowDetail이 이미 고른 것을 그대로 쓴다(새로
  // 짓지 않는다, 브리프 지시). 여기서 읽는 leaveConfirmRef.current는 클릭 핸들러 안이라 렌더 중이 아니다
  // (React Compiler 규칙 위반 아님).
  const select = useCallback((id: string): boolean => {
    if (leaveConfirmRef.current && !window.confirm(leaveConfirmRef.current)) return false;
    setUrlId(id);
    return true;
  }, [setUrlId]);
  // 목록 ⋯ 메뉴(스펙 §3-5) — 새 편집 화면 없이 그 캠페인을 열고 상세 머리글(CampaignHeader)의 기존 편집 상태를 연다.
  // 한 번만 쓰는 신호다: 머리글이 실행하면 onHeaderActionDone으로 지운다(새로고침·재마운트로 삭제 확인이 또 뜨지 않게).
  // 같은 메뉴를 연달아 골라도 다시 열리도록 seq를 붙인다(draftOpenReq와 같은 관례).
  const [headerAction, setHeaderAction] = useState<{ id: string; kind: RowMenuAction; seq: number } | null>(null);
  const headerActionSeqRef = useRef(0);
  const onMenuAction = useCallback((id: string, kind: RowMenuAction) => {
    if (id !== picked.id && !select(id)) return;   // 작성 중 확인에서 '취소'하면 아무것도 열지 않는다
    headerActionSeqRef.current += 1;
    setHeaderAction({ id, kind, seq: headerActionSeqRef.current });
  }, [picked.id, select]);
  const onHeaderActionDone = useCallback(() => setHeaderAction(null), []);

  return (
    // 상세는 연회색 바닥(bg-x-surface) 위 흰 패널들(FlowDetail) — 왼쪽 목록은 흰 배경 + 세로 구분선 그대로다(/campaigns와 같은 부품).
    // min-h-full: 내용이 짧아도 회색이 화면 아래까지 내려가야 한다(GlobalShell의 스크롤 컨테이너 높이를 채운다).
    <div className="flex min-h-full">
      {/* data-campaign-list: 작업 패널의 '바깥 누르면 닫기'가 이 목록은 건너뛴다(TaskPanel) — 거기서 확인 창이 뜨면
          그 클릭이 사라져 캠페인이 안 바뀌었다. 작성 중 확인은 select가 한 번만 묻는다(FlowDetail이 문장을 올린다). */}
      <aside data-campaign-list className={`sticky top-0 max-h-screen shrink-0 self-start overflow-y-auto border-r border-x-border bg-white transition-[width] ${listCollapsed ? 'w-11 px-1 py-4' : 'h-screen w-[360px]'}`}>
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
          <CampaignSidebar rows={rows} selectedId={picked.id} today={today} loaded={loaded} loadErr={loadErr}
                           onSelect={(id) => { select(id); }} onCreate={() => setCreating(true)} onRetry={() => void load()}
                           onCollapse={toggleListCollapsed} onMenuAction={onMenuAction} />
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
          <FlowDetail key={picked.id} id={picked.id}
                      onChanged={() => void load()}
                      onDeleted={() => {
                        justDeletedRef.current = picked.id;   // load()가 주소 바꾸기보다 먼저 반영돼도 이 id는 오경보 대상에서 뺀다
                        setUrlId(null);
                        void load();
                      }}
                      onLeaveConfirmChange={onComposerLeaveConfirmChange}
                      headerAction={headerAction?.id === picked.id ? headerAction : null}
                      onHeaderActionDone={onHeaderActionDone} />
        )}
      </main>
      {creating && (
        <CampaignCreateModal today={today} onClose={() => setCreating(false)}
                             onCreated={async (row) => { setCreating(false); await load(); select(row.id); }} />
      )}
    </div>
  );
}
