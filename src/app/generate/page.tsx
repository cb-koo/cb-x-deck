'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { newDraftsSince, filterDrafts, statusCounts, siblingCount, type DraftListFilter } from '@/lib/draftUi';
import { searchDrafts, filterByProcedure, applyPeriod, procedureOptions, sortDrafts, type PeriodValue, type TableSort } from '@/lib/draftViews';
import { toggleId, toggleAll, pruneSelection, siblingWarning } from '@/lib/draftSelection';
import { draftLinksText } from '@/lib/draftShare';
import { PAGE_STEP, LIST_CAP, atCap } from '@/lib/draftPaging';
import { Toast } from '@/components/Toast';
import { BulkActionBar } from '@/components/BulkActionBar';
import { DraftCard, droppedMediaOnRewrite, type MediaDropNotice } from '@/components/DraftCard';
import { DraftEditModal } from '@/components/DraftEditModal';
import { DraftWriteModal } from '@/components/DraftWriteModal';
import { RefPickerSheet, MAX_REFS_UI } from '@/components/RefPickerSheet';
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
import { RefPreviewModal } from '@/components/RefPreviewModal';
import { DraftFilterBar } from '@/components/DraftFilterBar';
import { PeriodPicker } from '@/components/PeriodPicker';
import { DraftTable } from '@/components/DraftTable';
import { DraftKanban } from '@/components/DraftKanban';
import { ShowMoreButton } from '@/components/ShowMoreButton';
import { DraftComposer, ComposerFooter, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { clampPanelWidth, PANEL_DEFAULT, PANEL_WIDTH_KEY } from '@/lib/panelResize';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import type { DraftRow } from '@/lib/draftStore';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftStatus } from '@/lib/draftStatus';
import type { InfluencerOption, DraftContent } from '@/lib/draftTypes';
import type { CampaignRow } from '@/lib/campaignStore';
import { fetchCampaigns } from '@/lib/campaignApi';
import type { DraftCost } from '@/lib/campaignCost';
import { kstToday } from '@/lib/datetime';

const COMPOSER_KEY = 'cbx-composer'; // 직전 설정 유지 (스펙 §4 "바꾸기 — 직전 값 유지")
// 보기 방식 — 렌즈(필터)와 달리 작업 방식 선호라 저장한다 (스펙 2차 §확정 결정)
type ResultView = 'cards' | 'table' | 'kanban';
const VIEW_KEY = 'cbx-generate-view';

export default function GeneratePage() {
  return (
    <Suspense>
      <Workbench />
    </Suspense>
  );
}

function Workbench() {
  const searchParams = useSearchParams();
  const [clients, setClients] = useState<Array<{ client: ClientRow; procedures: ProcedureRow[] }>>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [influencerOptions, setInfluencerOptions] = useState<InfluencerOption[]>([]); // 편집창 자동완성 후보
  const [loaded, setLoaded] = useState(false);
  // 초안(loaded)과 별도 추적 — 로딩을 API별로 독립시키면서 'loaded면 clients도 있다'는 가정이 깨졌다.
  // 이 플래그 없이 loaded로 온보딩 배너를 걸면, clients가 아직 오는 중(2~20초)에 "클라이언트를 먼저
  // 등록하면…"이 등록을 이미 마친 사용자에게 뜬다(리뷰 발견).
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(DEFAULT_COMPOSER);
  const [refRows, setRefRows] = useState<ReferenceRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addLinkOpen, setAddLinkOpen] = useState(false); // 진입점 C: 패널의 '링크로 추가' (스펙 §B)
  const [previewRefId, setPreviewRefId] = useState<string | null>(null); // 칩 미리보기 — row는 refRows에서 파생(스펙 §D)
  const [filter, setFilter] = useState<DraftListFilter>({ status: 'all', clientId: '', campaignId: '' });
  // 신규 렌즈 3축 — 기존 필터와 동일하게 세션 한정(저장 안 함) (6차 스펙)
  const [query, setQuery] = useState('');
  const [procFilter, setProcFilter] = useState(''); // 시술명, '' = 전체
  const [period, setPeriod] = useState<PeriodValue>({ kind: 'preset', preset: 'all' });
  const [editing, setEditing] = useState<DraftRow | null>(null);
  // 직접 쓰기 모달 — 저장 전엔 서버를 부르지 않으므로(설계 §B) 열림 여부 외에 페이지가 들 상태가 없다
  const [writeOpen, setWriteOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState<{ draftId: string; index: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 다시 쓰기로 이미지가 빠진 사실 (설계 §H-1) — 한 번에 한 초안만 다시 쓸 수 있으므로 슬롯도 하나면 된다
  const [mediaDrop, setMediaDrop] = useState<{ draftId: string; notice: MediaDropNotice } | null>(null);
  // 실행취소 대기 중인 삭제분. 단건도 길이 1인 배열로 다룬다 — 일괄 삭제가 특수 케이스가 아니라
  // 같은 경로를 쓰게 되고, 그 덕에 5초 타이머·토스트·되살리기가 한 벌로 유지된다 (설계 §G).
  const [pendingRemove, setPendingRemove] = useState<DraftRow[]>([]);
  // 좌패널 폭 — 드래그 리사이즈, 더블클릭 복원, 저장값은 복원 시 클램프 (스펙 §경계 조건)
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const [view, setViewState] = useState<ResultView>('cards');
  // 패널 접힘: null=자동(카드 뷰=펼침, 테이블·칸반=접힘), 'open'|'closed'=수동 고정(세션 한정)
  const [panelPref, setPanelPref] = useState<'open' | 'closed' | null>(null);
  // 피크 오버레이 — 항목 열람은 뷰 전환이 아니라 현재 뷰 위의 레이어로 (3차 스펙 §2)
  const [peekId, setPeekId] = useState<string | null>(null);
  // 표 뷰 다중 선택 — 선택은 페이지가 소유한다(설계 §화면). 일괄 처리 핸들러가 여기 있는
  // 낙관적 갱신 자리를 써야 하고, 필터가 바뀔 때 선택을 떨구는 것도 필터를 쥔 쪽의 몫이다.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  // 화면에 그리는 개수 — 데이터는 전량 로드하고 이것만 제한한다(설계 §A). 통신은 병목이 아니고,
  // 카드 수백 장이 한 번에 DOM에 올라가는 쪽이 병목이다.
  const [shownCount, setShownCount] = useState(PAGE_STEP);
  // 표 정렬 — 자르기보다 먼저 정렬해야 하므로 상태가 여기(페이지)에 있어야 한다(설계 §D).
  // 표 안에서 정렬하면 "최근 50건만 정렬한 결과"를 사용자가 전체 정렬로 읽게 된다.
  const [tableSort, setTableSort] = useState<TableSort>({ key: 'createdAt', dir: 'desc' });
  // 칸반에서 방금 옮긴 카드 — 세션 한정. 열은 최신순 정렬 + 상위 N장만 그리므로, 오래된 원고를
  // 옮기면 정렬에 밀려 화면에서 사라진다. 그 카드를 열 맨 위에 세워 "옮겼는데 없어졌다"를 막는다(설계 §H).
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());
  // 캠페인 — 목록은 카드 캠페인 칸·표 열·필터의 소스, campaignCtx는 ?campaign= 진입 시 "이 캠페인에 추가 중" 컨텍스트(캠페인 스펙 §4-1)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null); // 로드 실패 원인 — 딥링크가 이걸 '삭제됨'과 구분한다
  const [campaignCtx, setCampaignCtx] = useState<CampaignRow | null>(null);
  const campaignLinkDone = useRef(false); // ?campaign= 소비 표시 — 클라·캠페인 목록이 다 온 뒤 1회만
  // '오늘'(서울)은 마운트 시 한 번 — 카드의 밀림 판정 기준. 렌더마다 시계를 읽지 않는다(react-hooks/purity)
  const [today] = useState(() => kstToday());
  const rootRef = useRef<HTMLDivElement | null>(null);
  // 좌패널 풋터에서 생성하면 우측이 스크롤된 상태일 수 있어 결과가 소리 없이 화면 밖에 놓이지 않게 하기 위함(T11 계열)
  const resultsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem(PANEL_WIDTH_KEY);
    if (raw === null) return;
    setPanelW(clampPanelWidth(Number(raw), rootRef.current?.clientWidth ?? Infinity));
  }, []);
  function applyWidth(w: number) {
    const clamped = clampPanelWidth(w, rootRef.current?.clientWidth ?? Infinity);
    setPanelW(clamped);
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
  }
  const abortRef = useRef<AbortController | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef<Record<string, string[]>>({});
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const genStartedAt = useRef(0); // 이번 생성 요청 시각 — 폴링 병합의 하한선
  const genCount = useRef(1); // 이번 생성의 시안 수 — 스켈레톤 문구용
  const draftsRef = useRef<DraftRow[]>([]);
  useEffect(() => { draftsRef.current = drafts; }, [drafts]);
  const lastWsId = typeof window !== 'undefined' ? localStorage.getItem(LAST_WS_KEY) : null;
  useEffect(() => {
    const v = localStorage.getItem(VIEW_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 저장값 복원 (COMPOSER_KEY와 같은 관례)
    if (v === 'table' || v === 'kanban') setViewState(v);
  }, []);
  const setView = useCallback((v: ResultView) => { setViewState(v); localStorage.setItem(VIEW_KEY, v); }, []);
  // 선택은 표 뷰에만 있다(설계 §C). 카드·칸반으로 옮기면 고른 것이 화면 어디에도 보이지 않으므로 비운다 —
  // 다시 표로 돌아왔을 때 기억에 없는 선택이 남아 있는 편이 훨씬 위험하다.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 뷰 전환 시 1회 정리, 이미 비어 있으면 건드리지 않음
    if (view !== 'table') setSelectedIds((cur) => (cur.size === 0 ? cur : new Set()));
  }, [view]);
  const panelOpen = panelPref !== null ? panelPref === 'open' : view === 'cards';
  const panelOpenRef = useRef(panelOpen);
  useEffect(() => { panelOpenRef.current = panelOpen; });
  const clientNameOf = useCallback(
    (id: string | null) => (id ? (clients.find((c) => c.client.id === id)?.client.name ?? '—') : '—'),
    [clients]);
  // 직접 쓰기 모달에 넘길 표시용 이름 — 모달이 clients 배열 전체를 받아 뒤지게 하지 않는다.
  // 이름 해석은 컴포저 상태를 쥔 이 페이지의 몫이다(ComposerFooter의 요약과 같은 계산).
  const writeScope = useMemo(() => {
    const cur = clients.find((c) => c.client.id === composer.clientId) ?? null;
    return {
      clientName: cur?.client.name ?? null,
      procedureNames: cur ? cur.procedures.filter((p) => composer.procedureIds.includes(p.id)).map((p) => p.name) : [],
    };
  }, [clients, composer.clientId, composer.procedureIds]);

  // drafts에서 파생 — 원본이 사라지면(삭제 확정 등) 오버레이도 자연 소멸
  const peeked = peekId ? drafts.find((d) => d.id === peekId) ?? null : null;
  // 칩 미리보기 대상 — 원본이 refRows에서 빠지면 모달도 자연 소멸(peeked와 같은 파생 패턴)
  const previewRefRow = previewRefId ? refRows.find((x) => x.tweetId === previewRefId) ?? null : null;
  // Esc로 피크 닫기 — DraftEditModal 선례. 편집 모달·링크 추가 모달이 위에 열려 있으면 그쪽 Esc가 우선이라 여기선 무시.
  useEffect(() => {
    if (!peekId || editing || addLinkOpen || previewRefRow) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) setPeekId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [peekId, editing, addLinkOpen, previewRefRow]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로컬 저장값 복원(기존 코드베이스 관례, RefPickerSheet 선례)
    try { const s = localStorage.getItem(COMPOSER_KEY); if (s) setComposer({ ...DEFAULT_COMPOSER, ...JSON.parse(s) }); } catch { /* 무시 */ }
    // 셋을 Promise.all로 묶어 두었더니 가장 느린 하나가 화면 전체를 잡아 세웠다. /api/clients는 N+1
    // 질의라 초안 목록보다 몇 배 느리고(로컬 실측 2초, 병렬 부하가 겹치면 20초대), 그동안 결과 열에는
    // 아무것도 그려지지 않는다 — "콘텐츠창이 안 보인다"의 정체가 이것이었다. 게다가 셋 중 하나만
    // 실패해도 catch가 전부를 실패로 처리해, 초안은 멀쩡한데 한 건도 안 보였다.
    // 서로 필요로 하지 않는 세 데이터이므로 각자 도착하는 대로 화면에 반영한다.

    // 초안 — 결과 열의 주인공이라 이것만 loaded를 좌우한다.
    apiFetch('/api/drafts').then((r) => r.json())
      .then((d) => { setDrafts(d); setLoaded(true); })
      .catch(() => { setLoaded(true); setToast('초안 목록을 불러오지 못했어요 — 새로고침해 주세요'); });

    // 클라이언트 — 좌패널 생성 폼에서만 쓴다. 늦거나 실패해도 초안 열람은 막지 않는다.
    apiFetch('/api/clients').then((r) => r.json()).then((c) => {
      setClients(c); setClientsLoaded(true);
      // 복원된 clientId가 응답 목록에 없으면(유령 클라이언트) 정리 — 400 방지
      setComposer((cur) => (cur.clientId && !(c as Array<{ client: ClientRow }>).some((x) => x.client.id === cur.clientId)
        ? { ...cur, clientId: null, procedureIds: [] } : cur));
    }).catch(() => setToast('클라이언트 목록을 불러오지 못했어요 — 원고 생성 시 클라이언트를 고를 수 없어요'));

    // 자동완성은 편의일 뿐이라 실패해도 빈 목록으로 삼킨다 — 자유 입력이라는 본 기능은 그대로 동작하므로
    // 여기서 토스트를 띄우면, 쓸 수 있는 걸 못 쓰는 것처럼 보이게 만든다 (스펙 §G).
    apiFetch('/api/drafts/influencers').then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((inf) => setInfluencerOptions(Array.isArray(inf) ? inf : []));

    // 캠페인 목록 — 카드 캠페인 칸·표 열·필터의 소스. 실패해도 원고 열람은 막지 않는다(캠페인 칸이 '없음'만 보인다).
    fetchCampaigns().then((r) => {
      // 로드 실패도 '완료'로 쳐서 딥링크가 영원히 대기하지 않게 한다 — !ok를 '완료' 밖에 두면
      // ?campaign= 진입이 campaignsLoaded를 영원히 기다리다 아무 반응도 없이 멈춘다.
      if (r.ok) setCampaigns(r.data); else setCampaignsError(r.error);
      setCampaignsLoaded(true);
    }).catch(() => {}); // unauthorized는 apiFetch가 이미 /login으로 리다이렉트한다 — 여기선 더 할 일이 없다
  }, []);
  useEffect(() => () => { if (pollTimer.current) clearInterval(pollTimer.current); }, []);
  const updateComposer = useCallback((v: ComposerState) => {
    setComposer(v);
    localStorage.setItem(COMPOSER_KEY, JSON.stringify({ ...v, direction: '', count: 1 })); // 방향성·시안 수는 매번 새로
  }, []);

  // 레퍼런스 빼기 — 칩 ✕와 미리보기 '빼기'가 공유. 미리보기 대상이 빠지면 id도 함께 비워
  // 같은 트윗을 나중에 다시 넣었을 때 모달이 불쑥 열리지 않게 한다(리뷰 Important).
  const removeRef = useCallback((tweetId: string) => {
    setRefRows((cur) => cur.filter((x) => x.tweetId !== tweetId));
    setPreviewRefId((cur) => (cur === tweetId ? null : cur));
  }, []);

  // 진입점 A: /generate?ref=<tweetId> — 보관함에 있으면 레퍼런스로 연결
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (!ref) return;
    apiFetch('/api/references?scope=all').then((r) => r.json()).then((rows: ReferenceRow[]) => {
      const found = rows.find((x) => x.tweetId === ref);
      if (found) {
        setRefRows((cur) => (cur.some((x) => x.tweetId === ref) ? cur : [...cur, found]));
        // 실제로 접혀 있을 때만 펼침으로 고정 — 이미 펼쳐져 있는데 고정하면 수동 우선 규칙 때문에
        // 자동 접힘이 세션 내내 죽는다 (최종 리뷰 F2)
        if (!panelOpenRef.current) setPanelPref('open');
      } else setToast('이 트윗은 보관함에 없어요 — 덱에서 ☆ 저장한 뒤 다시 시도해주세요');
    });
  }, [searchParams]);

  // 진입점 C의 후처리 — 저장은 모달(/api/library/from-link)이 이미 끝냈고 여기선 '선택'만 한다.
  // 진입점 A(?ref=)와 같은 패턴: 전량 조회에서 방금 트윗의 row를 찾아 refRows에 붙인다(단건 API 없음, 스펙 §B).
  async function handleAddedByLink(r: AddedByLink) {
    const saved = r.alreadyInLibrary ? '이미 보관함에 있어요' : '보관함에 추가했어요';
    if (refRows.some((x) => x.tweetId === r.tweetId)) { setToast(`${saved} — 이미 레퍼런스로 선택돼 있어요`); return; }
    // 안내 문구는 이 시점 화면에서 참인 표현만 — 패널 버튼 라벨이 상태에 따라 달라서('보관함에서 고르기'/'더 고르기')
    // 특정 라벨을 콕 집으면 화면에 없는 버튼을 가리킬 수 있다(리뷰 Important, UX 원칙 4).
    if (refRows.length >= MAX_REFS_UI) { setToast(`${saved} — 레퍼런스가 ${MAX_REFS_UI}건이라 자동 선택은 안 했어요. 위 레퍼런스 목록에서 조정해주세요`); return; }
    try {
      const res = await apiFetch('/api/references?scope=all');
      if (!res.ok) throw new Error(String(res.status)); // 500 응답 body가 배열이 아니어도 폴백이 '우연'이 아니라 의도가 되게
      const rows: ReferenceRow[] = await res.json();
      const found = rows.find((x) => x.tweetId === r.tweetId);
      if (!found) { setToast(`${saved} — 목록을 갱신하지 못했어요. 레퍼런스 고르기에서 선택해주세요`); return; }
      setRefRows((cur) => (cur.some((x) => x.tweetId === r.tweetId) ? cur : [...cur, found]));
      setToast(`${saved} — 레퍼런스로 선택했어요`);
    } catch {
      setToast(`${saved} — 목록을 갱신하지 못했어요. 레퍼런스 고르기에서 선택해주세요`);
    }
  }

  // 진입점 B: /generate?draft=<id> — 인플루언서 프로필의 원고 롤업·로그에서 진입, 확대 보기로 연다.
  // 필터가 숨겨도 열린다 — peeked 파생이 필터 전 drafts를 보기 때문(101행).
  // deeplinkDone: 주소창의 draft 값을 '소비했다'는 표시. 아래 동기화 이펙트가 이걸 기다린다 —
  // 목록이 로드되기 전에 주소를 건드리면 열어야 할 대상을 우리 손으로 지워버린다(아래 참조).
  const [deeplinkDone, setDeeplinkDone] = useState(false);
  useEffect(() => {
    if (!loaded) return; // 목록이 있어야 대상을 찾을 수 있다
    const target = searchParams.get('draft');
    if (target) {
      if (draftsRef.current.some((d) => d.id === target)) setPeekId(target);
      // 못 찾으면 조용히 넘어가지 않는다 — 링크를 받은 사람에겐 "안 열린다"만 남고 이유가 없다.
      // 최근 1000건까지만 로드하므로 그보다 오래된 원고이거나, 그 사이 삭제된 경우다.
      else setToast('링크가 가리키는 원고를 찾을 수 없어요 — 삭제됐거나 너무 오래된 원고일 수 있어요');
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 딥링크 소비 표시, 로드 후 1회
    setDeeplinkDone(true);
  }, [searchParams, loaded]);

  // 확대 보기를 열면 주소창에도 남긴다 — 링크를 얻는 두 번째 경로다(카드의 링크 복사 버튼이 첫 번째).
  // 이게 없으면 원고를 열어놓고도 주소창에는 /generate만 있어서, 보고 있는 것을 그대로 보낼 수 없다.
  //
  // Next 라우터가 아니라 history.replaceState를 쓰는 이유: 이 페이지는 초안 수백 건을 들고 있어
  // 라우터 갱신이 리렌더를 부르는데, 여기서 필요한 건 주소 표시뿐이다. replace라 뒤로가기 기록도
  // 쌓이지 않는다 — 원고를 여닫을 때마다 뒤로가기가 한 칸씩 늘어나면 그게 더 성가시다.
  //
  // deeplinkDone을 기다리는 것이 핵심이다. 이 가드가 없으면 마운트 직후(목록 로드 전) 이 이펙트가
  // peekId=null 상태로 먼저 돌아 주소에서 draft를 지운다. 이 Next는 history.replaceState를 라우터와
  // 통합하고 있어서 지워진 값이 useSearchParams에도 반영되고, 그래서 목록이 로드된 뒤엔 열어야 할
  // 대상이 이미 사라져 있다 — 링크로 들어와도 /generate로 튕기는 증상이 정확히 이것이었다.
  useEffect(() => {
    if (!deeplinkDone) return;
    const url = new URL(window.location.href);
    if (peekId) url.searchParams.set('draft', peekId);
    else url.searchParams.delete('draft');
    if (url.toString() !== window.location.href) window.history.replaceState(null, '', url);
  }, [peekId, deeplinkDone]);

  // 진입점 D: /generate?campaign=<id> — 캠페인 화면 [+ 원고 추가 → 새로 만들기]에서 진입(캠페인 스펙 §4-1).
  // 클라를 자동 선택하고 배너를 켠다; 이 상태에서 만든 원고(생성·직접 쓰기)는 campaignId가 실려 그 캠페인 소속으로 저장된다.
  // 클라·캠페인 목록이 둘 다 온 뒤 1회만 — composer.clientId를 세팅하려면 그 클라가 목록에 있어야 한다(유령 클라 정리 이펙트와 순서 충돌 방지).
  useEffect(() => {
    if (campaignLinkDone.current || !clientsLoaded || !campaignsLoaded) return;
    const target = searchParams.get('campaign');
    if (!target) return;
    campaignLinkDone.current = true;
    const row = campaigns.find((c) => c.id === target);
    if (!row) {
      // 로드 자체가 실패했으면 '삭제됐을 수 있어요'로 오진하지 않는다 — 원인은 목록을 못 받은 것이다(리뷰 Important)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 이 이펙트의 setState 일괄(효과 안 첫 호출만 검사) — 두 로드가 끝난 뒤 1회
      if (campaignsError) { setToast(`캠페인 목록을 불러오지 못했어요 — ${campaignsError}`); return; }
      setToast('링크가 가리키는 캠페인을 찾을 수 없어요 — 삭제됐을 수 있어요');
      // 없는 id로 남으면 새로고침마다 같은 토스트가 뜬다 — 주소에서 지운다(?draft= replaceState와 같은 관례).
      // 컨텍스트가 성공적으로 걸린 경우는 주소를 그대로 둔다(?ref= 관례 — 성공한 딥링크는 주소를 지우지 않는다).
      const url = new URL(window.location.href);
      url.searchParams.delete('campaign');
      window.history.replaceState(null, '', url);
      return;
    }
    setCampaignCtx(row);
    setFilter((f) => ({ ...f, campaignId: row.id }));
    if (row.clientId && clients.some((c) => c.client.id === row.clientId)) {
      setComposer((cur) => (cur.clientId === row.clientId ? cur : { ...cur, clientId: row.clientId, procedureIds: [] }));
    }
    if (!panelOpenRef.current) setPanelPref('open');   // 만들러 왔으니 생성 패널을 펼친다(?ref=와 같은 규칙)
  }, [searchParams, clientsLoaded, campaignsLoaded, campaigns, clients, campaignsError]);

  // 배너 [해제] — 컨텍스트와 필터를 풀고 주소에서도 지운다(?draft= 동기화와 같은 replaceState 관례 — 라우터 리렌더 없이 주소만).
  function clearCampaignCtx() {
    setCampaignCtx(null);
    setFilter((f) => ({ ...f, campaignId: '' }));
    const url = new URL(window.location.href);
    url.searchParams.delete('campaign');
    window.history.replaceState(null, '', url);
  }

  const selectedRefIds = useMemo(() => refRows.map((x) => x.tweetId), [refRows]);

  const clientScoped = useMemo(
    () => filterDrafts(drafts, { status: 'all', clientId: filter.clientId, campaignId: filter.campaignId }),
    [drafts, filter.clientId, filter.campaignId]);
  // 클라이언트 → (시술·기간·검색) → 상태 탭 순으로 좁힌다. 칸반은 상태만 무시하므로 scoped를 쓴다.
  const scoped = useMemo(
    () => applyPeriod(filterByProcedure(searchDrafts(clientScoped, query), procFilter), period, Date.now()),
    [clientScoped, query, procFilter, period]);
  const visibleDrafts = useMemo(
    () => filterDrafts(scoped, { status: filter.status, clientId: '', campaignId: '' }), [scoped, filter.status]);
  // 조건(필터·검색·시술·기간·뷰)이 바뀌면 표시 개수를 처음으로 되돌린다. 새 조건에서 이전에
  // 늘려둔 개수가 남으면 "왜 이만큼 보이지"가 설명되지 않는다(설계 §C).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 조건 변경 시 1회 리셋(옵션-선택 리셋과 같은 관례)
    setShownCount(PAGE_STEP);
  }, [filter.status, filter.clientId, filter.campaignId, query, procFilter, period, view]);
  // 표는 정렬한 뒤에 자른다 — 순서가 뒤바뀌면 "최근 50건만 정렬한 결과"를 전체 정렬로 읽게 된다(설계 §D).
  // 카드 뷰는 정렬 개념이 없어 목록 순서(최신순) 그대로 자른다.
  const orderedDrafts = useMemo(
    () => (view === 'table' ? sortDrafts(visibleDrafts, tableSort, clientNameOf) : visibleDrafts),
    [view, visibleDrafts, tableSort, clientNameOf]);
  const shownDrafts = useMemo(() => orderedDrafts.slice(0, shownCount), [orderedDrafts, shownCount]);
  // 선택의 '보이는 것'은 실제로 그려진 것이다(설계 §E) — 이 한 줄이 일괄 삭제의 안전장치다.
  // visibleDrafts(자르기 전)에서 뽑으면 헤더 체크박스가 화면에 없는 수백 건까지 고르고 그대로 지운다.
  const visibleIds = useMemo(() => shownDrafts.map((d) => d.id), [shownDrafts]);
  // 고른 원고들의 "제목 + 링크" 묶음. shownDrafts에서 뽑으므로 복사 순서가 표에 보이는 순서와 같다 —
  // 클릭한 순서로 담으면 화면에서 본 차례와 어긋나 어느 게 빠졌는지 대조하기 어렵다.
  const selectedLinksText = useMemo(
    () => (typeof window === 'undefined' ? ''
      : draftLinksText(shownDrafts.filter((d) => selectedIds.has(d.id)), window.location.origin)),
    [shownDrafts, selectedIds]);
  // 필터·검색·기간이 바뀌거나 목록이 갱신되면 화면에서 사라진 선택을 떨군다. 사용자가 보지 못한
  // 원고가 일괄 삭제에 함께 휩쓸리는 것을 막는 유일한 장치다 (설계 §화면).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 파생 정합 유지(옵션-선택 리셋과 같은 관례), 변화가 있을 때만
    setSelectedIds((cur) => {
      const next = pruneSelection(cur, visibleIds);
      // pruneSelection은 덜어내기만 하므로 크기가 같으면 내용도 같다 — 참조를 유지해 무한 루프를 막는다
      return next.size === cur.size ? cur : next;
    });
  }, [visibleIds]);
  const counts = useMemo(() => statusCounts(scoped), [scoped]); // 탭 건수도 검색·필터 반영(라벨-값 일치)
  const procOptions = useMemo(() => procedureOptions(clientScoped), [clientScoped]);
  // 클라이언트 전환 등으로 선택 시술이 옵션에서 사라지면 리셋 — 유령 필터 방지
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 옵션-선택 정합 유지(파생 리셋), 조건부 1회
    if (procFilter && !procOptions.includes(procFilter)) setProcFilter('');
  }, [procOptions, procFilter]);

  const bannedFor = useCallback((d: DraftRow) => {
    const c = clients.find((x) => x.client.id === d.clientId);
    if (!c) return [];
    return [...c.client.bannedPhrases, ...c.procedures.filter((p) => d.procedureNames.includes(p.name)).flatMap((p) => p.bannedPhrases)];
  }, [clients]);

  // 생성 완료 시점의 최신 렌즈로 판정 — 생성 대기 중 필터를 바꿔도 낡은 클로저를 쓰지 않는다 (draftsRef와 같은 관례)
  const lensRef = useRef({ filter, query, procFilter, period });
  useEffect(() => { lensRef.current = { filter, query, procFilter, period }; });
  // 새 초안이 현재 렌즈(상태·클라이언트·검색·시술·기간)에 가려 있으면 전부 리셋 — T11의 6차 확장
  const revealIfHidden = useCallback((created: DraftRow[]) => {
    const L = lensRef.current;
    const visible = applyPeriod(
      filterByProcedure(searchDrafts(filterDrafts(created, L.filter), L.query), L.procFilter),
      L.period, Date.now()).length > 0;
    if (!visible) {
      // 배너(campaignCtx)가 켜져 있으면 표 축도 그 캠페인에 묶어 둔다 — 배너가 "이 캠페인에 추가 중"인데
      // 표 필터가 전체로 풀리면 방금 만든 원고가 뒤섞여 어디 갔는지 헷갈린다(배너-표 축 결합, 캠페인 스펙 §4-3).
      setFilter({ status: 'all', clientId: '', campaignId: campaignCtx ? campaignCtx.id : '' });
      setQuery(''); setProcFilter(''); setPeriod({ kind: 'preset', preset: 'all' });
    }
  }, [campaignCtx]);

  async function generate() {
    if (generating) return;
    stopPolling();
    genStartedAt.current = Date.now();
    genCount.current = composer.count;
    setGenerating(true);
    resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const src = {
        clientId: composer.clientId, procedureIds: composer.procedureIds,
        refTweetIds: refRows.map((x) => x.tweetId),
        mode: refRows.length > 0 ? composer.mode : 'off',
        direction: composer.direction, format: composer.format,
        count: composer.count,
        // Task 16에서 작업 기준으로 대체 — 임시: 서버가 campaignId를 무시한다
        ...(campaignCtx ? { campaignId: campaignCtx.id } : {}),   // 배너가 켜져 있으면 그 캠페인 소속으로
      };
      const r = await apiFetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({ ...src, constraintsOn: composer.constraintsOn }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      const created = body as DraftRow[];
      setDrafts((cur) => [...created, ...cur]);
      // 렌즈 전체 리셋 — T11의 6차 확장(생성 결과가 소리 없이 사라지지 않게)
      revealIfHidden(created);
      setComposer((c) => ({ ...c, count: 1 })); // 시안 수는 1회용 — 다음 생성이 조용히 N배 비용이 되지 않게
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setToast('생성 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setGenerating(false); abortRef.current = null;
    }
  }

  // 다시 쓰기 — 같은 초안의 새 버전으로. 피드백이 있으면 반영, 없으면 같은 조건 재생성.
  // baseIndex = 사용자가 보고 있던 버전(그 버전을 기준으로 다시 쓴다).
  async function rewrite(id: string, feedback: string, baseIndex: number) {
    if (rewritingId) return;
    setMediaDrop((cur) => (cur?.draftId === id ? null : cur)); // 지난 안내는 걷는다 — 이번 결과로 대체된다
    setRewritingId(id);
    try {
      const r = await apiFetch(`/api/drafts/${id}/rewrite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseIndex, ...(feedback ? { feedback } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setToast((body as { error?: string }).error ?? `오류 ${r.status}`); return; }
      const updated = body as DraftRow;
      setDrafts((cur) => cur.map((d) => (d.id === id ? updated : d)));
      // 스레드가 짧아져 뒤쪽 트윗의 이미지가 빠졌으면 알린다 (설계 §H-1) — 조용히 사라지는 것만은 막는다.
      // 비교 기준은 기준 버전(baseIndex)이 아니라 '직전 최신'이다: 서버가 미디어를 이월하는 출처가
      // 지금 최신 버전이기 때문이다(옛 버전을 기준으로 다시 써도 최신에 붙인 이미지가 따라온다 —
      // 기준 버전과 비교하면 바로 그 경우의 유실을 놓친다, 리뷰 발견). 서버가 history 끝에 직전
      // 표시본을 덧붙이므로 응답 history의 마지막이 곧 그 '직전 최신'이고, 그 index가
      // '이전 버전 보기'가 데려갈 자리다.
      const i = updated.history.length - 1;
      const prevLatest = updated.history[i];
      const notice = prevLatest ? droppedMediaOnRewrite(prevLatest, updated.edited ?? updated.content, i) : null;
      if (notice) setMediaDrop({ draftId: id, notice });
    } catch {
      setToast('다시 쓰기 중 오류가 났어요 — 잠시 후 다시 시도해주세요');
    } finally {
      setRewritingId(null);
    }
  }

  function stopPolling() {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }

  // 취소 = 기다리기만 중단(서버 생성은 계속) → 완성본을 폴링으로 자동 반영 (스펙 3-5)
  function cancelGenerate() {
    abortRef.current?.abort();
    setToast('기다리기를 취소했어요 — 완성되면 목록에 자동으로 나타나요');
    const deadline = Date.now() + 120_000; // 최대 2분
    stopPolling();
    pollTimer.current = setInterval(async () => {
      if (Date.now() > deadline) { stopPolling(); return; }
      try {
        // 폴링이 찾는 것은 방금 만들어진 것뿐이고 새 원고는 항상 최신순 맨 앞에 온다(시안 최대 5개).
        // 전량을 5초마다 다시 받으면 취소 한 번에 수 MB가 오간다(설계 §I).
        const r = await apiFetch('/api/drafts?limit=20');
        if (!r.ok) return; // 조용히 다음 주기 재시도 (스펙 §4)
        const fetched = (await r.json()) as DraftRow[];
        // 판정은 ref 미러 기준 — setDrafts 업데이터의 동기 실행(eager state)에 기대지 않는다 (최종 리뷰 반영)
        const fresh = newDraftsSince(draftsRef.current, fetched, genStartedAt.current);
        if (fresh.length === 0) return;
        // 삽입은 업데이터 안에서 재계산 — ref가 한 렌더 뒤처져도 중복 삽입이 없다
        setDrafts((cur) => [...newDraftsSince(cur, fetched, genStartedAt.current), ...cur]);
        stopPolling();
        setToast('아까 취소한 원고가 완성됐어요');
        resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        // 직접 성공 경로와 동일 — 렌즈 전체 리셋 — T11의 6차 확장
        revealIfHidden(fresh);
      } catch { /* 다음 주기 재시도 */ }
    }, 5000);
  }

  async function patchDraft(id: string, body: object) {
    const r = await apiFetch(`/api/drafts/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((d) => (d.id === id ? updated : d))); return updated; }
    setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    return null;
  }

  // 삭제 확정 — 컬렉션 DELETE 한 번으로 끝낸다(설계 §B). 단건도 ids 길이 1로 같은 길을 간다.
  // useCallback인 이유는 언마운트·이탈 이펙트의 의존성으로 들어가기 때문이다(매 렌더 새 함수면 이펙트가 재등록된다).
  const flushRemove = useCallback((rows: DraftRow[]) => {
    if (rows.length === 0) return;
    void apiFetch('/api/drafts', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: rows.map((r) => r.id) }),
    });
  }, []);

  // 삭제: 낙관적 제거 + 5초 실행취소 (보관함 패턴). 단건·일괄이 같은 경로를 쓴다 — 단건은 길이 1이다.
  function requestRemove(rows: DraftRow[]) {
    if (rows.length === 0) return;
    // 실행취소 토스트만으로는 부족하다는 실사용 피드백(2026-08-13) — 5초는 "어? 방금 뭐였지"를
    // 알아차리기엔 짧다. 확인은 한 건이든 여러 건이든 항상 받되, 되돌릴 수 있다는 사실도 같이 알린다.
    const what = rows.length === 1 ? '이 원고를' : `고른 원고 ${rows.length}개를`;
    if (!window.confirm(`${what} 삭제할까요?\n\n삭제 후 5초 안에는 실행 취소할 수 있어요.`)) return;
    setToast(null); // 죽은 에러 토스트가 삭제 직후 다시 뜨는 것을 방지
    if (removeTimer.current) clearTimeout(removeTimer.current);
    flushRemove(pendingRemove); // 앞선 실행취소 대기분을 먼저 확정
    rows.forEach((d) => { delete dismissedRef.current[d.id]; });
    setPendingRemove(rows);
    const ids = new Set(rows.map((r) => r.id));
    setDrafts((cur) => cur.filter((x) => !ids.has(x.id)));
    setSelectedIds(new Set()); // 지운 것을 고른 채로 두지 않는다 (설계 §화면 — 삭제만 선택을 비운다)
    removeTimer.current = setTimeout(() => {
      flushRemove(rows);
      setPendingRemove([]);
    }, 5000);
  }
  function undoRemove() {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRemove.length > 0) setDrafts((cur) => [...pendingRemove, ...cur]);
    setPendingRemove([]); // 되살아난 원고는 선택되지 않은 상태로 돌아온다 (설계 §화면)
  }

  // 실행취소 대기분의 ref 미러 — cleanup·beforeunload 클로저는 등록 시점 값에 묶여 있어 상태를
  // 그대로 읽으면 언제나 빈 배열을 본다(draftsRef·panelOpenRef와 같은 관례).
  const pendingRemoveRef = useRef<DraftRow[]>([]);
  useEffect(() => { pendingRemoveRef.current = pendingRemove; }, [pendingRemove]);
  // 지금까지는 5초 안에 페이지를 떠나면 서버 DELETE가 영영 나가지 않았다 — "삭제했어요"를 보고
  // 사이드바로 이동한 뒤 새로고침하면 지운 초안이 살아 있었다(설계 §G). 일괄 삭제는 그 규모가
  // 30건이 되므로 여기서 함께 고친다. sendBeacon이 아니라 일반 fetch인 이유는 언마운트가 주 경로라서다.
  useEffect(() => {
    const onLeave = () => flushRemove(pendingRemoveRef.current);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      if (removeTimer.current) clearTimeout(removeTimer.current);
      flushRemove(pendingRemoveRef.current);
    };
  }, [flushRemove]);

  // 무시/되돌리기 — 연속 클릭 레이스 방지: 렌더 클로저가 아니라 ref 미러에서 누적 계산 (리뷰 발견)
  function toggleDismiss(d: DraftRow, key: string, dismiss: boolean) {
    const base = dismissedRef.current[d.id] ?? d.dismissedFlags;
    const next = dismiss ? [...new Set([...base, key])] : base.filter((k) => k !== key);
    dismissedRef.current[d.id] = next;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, dismissedFlags: next } : x)));
    void patchDraft(d.id, { dismissedFlags: next });
  }
  function restoreAllFlags(d: DraftRow) {
    dismissedRef.current[d.id] = [];
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, dismissedFlags: [] } : x)));
    void patchDraft(d.id, { dismissedFlags: [] });
  }

  function changeStatus(d: DraftRow, status: DraftStatus) {
    const prev = d.status;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, status } : x)));
    void patchDraft(d.id, { status }).then((updated) => {
      // 실패 롤백은 이 요청이 세팅한 값이 아직 표시 중일 때만 — 연속 변경 시 뒤 갱신을 덮지 않도록 (무시 표식 레이스 픽스와 같은 계열)
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.status === status ? { ...x, status: prev } : x)));
    });
  }

  // 칸반 드롭 = 상태 변경 + 그 카드를 옮겨간 열 맨 위에 고정(설계 §H). 고정은 화면 표시일 뿐이라
  // 상태 변경이 실패해 롤백돼도 풀지 않는다 — 카드는 원래 열로 돌아가고 거기서도 맨 위에 서면 된다.
  function kanbanChangeStatus(d: DraftRow, s: DraftStatus) {
    setPinnedIds((cur) => new Set([...cur, d.id]));
    changeStatus(d, s);
  }
  // 종착 열의 '전체 보기' — 표 뷰로 전환하며 그 상태 필터를 건다(설계 §F).
  // 안내문이 아니라 실제로 데려간다 — 말만 하고 사용자가 직접 뷰를 바꾸게 하면 거짓 어포던스다.
  function goToTable(status: DraftStatus) {
    setFilter((f) => ({ ...f, status }));
    setView('table');
  }

  // 인플루언서 배정 — 편집 모달에서 카드로 옮긴 배선. changeStatus와 같은 모양(낙관적 갱신 + 실패 시 조건부 롤백).
  function assignInfluencer(d: DraftRow, next: string | null) {
    const prev = d.influencerHandle;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, influencerHandle: next } : x)));
    void patchDraft(d.id, { influencerHandle: next }).then((updated) => {
      // 이 요청이 세팅한 값이 아직 표시 중일 때만 되돌린다 — 연속 변경 시 뒤 갱신을 덮지 않도록
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.influencerHandle === next ? { ...x, influencerHandle: prev } : x)));
    });
  }

  // 캠페인 소속·예정일·비용 — 카드 캠페인 칸(DraftCard campaign prop)에서. assignInfluencer와 같은 모양.
  // 값은 하나(§2-5): 캠페인 화면이 같은 컬럼을 보므로 여기서 바꾼 것이 그대로 그쪽에 나타난다.
  function changeCampaign(d: DraftRow, campaignId: string | null) {
    const camp = campaignId ? campaigns.find((c) => c.id === campaignId) ?? null : null;
    const prev = { campaignId: d.campaignId, campaignName: d.campaignName, campaignCode: d.campaignCode };
    const next = { campaignId, campaignName: camp?.name ?? null, campaignCode: camp?.nameEn ?? null };
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, ...next } : x)));
    // Task 16에서 작업 기준으로 대체 — 임시: 서버가 campaignId를 무시한다
    void patchDraft(d.id, { campaignId }).then((updated) => {
      // 이 요청이 세팅한 값이 아직 표시 중일 때만 되돌린다 — 연속 변경 시 뒤 갱신을 덮지 않도록
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.campaignId === campaignId ? { ...x, ...prev } : x)));
    });
  }
  function changeScheduledOn(d: DraftRow, scheduledOn: string | null) {
    const prev = d.scheduledOn;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, scheduledOn } : x)));
    void patchDraft(d.id, { scheduledOn }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.scheduledOn === scheduledOn ? { ...x, scheduledOn: prev } : x)));
    });
  }
  function changeCost(d: DraftRow, cost: DraftCost | null) {
    const prev = d.cost;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, cost } : x)));
    void patchDraft(d.id, { cost }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.cost === cost ? { ...x, cost: prev } : x)));
    });
  }
  // 두 DraftCard 호출부(카드 뷰·피크)가 같은 객체 모양을 넘긴다 — 한 곳에서 만든다
  const cardCampaign = (d: DraftRow) => ({
    options: campaigns, today,
    onChange: (id: string | null) => changeCampaign(d, id),
    onChangeScheduledOn: (next: string | null) => changeScheduledOn(d, next),
    onChangeCost: (next: DraftCost | null) => changeCost(d, next),
  });

  // 일괄 변경 — 개별 patchDraft를 N번 부르지 않는다(설계 §B). 50건을 고르면 커넥션 50개가 동시에
  // 붙는데, 이 저장소는 이미 커넥션 고갈로 목록이 비는 회귀를 겪었다. 컬렉션 PATCH 한 번으로 끝낸다.
  // 롤백은 changeStatus·assignInfluencer와 같은 계열의 조건부 롤백이다(설계 §화면). 전체 스냅샷으로
  // 되돌리지 않는 이유는 그 사이 폴링으로 들어온 새 초안이나 다른 행의 변경까지 함께 지워지기 때문이다.
  async function bulkPatch(ids: string[], body: { status: DraftStatus } | { influencerHandle: string | null }) {
    if (ids.length === 0) return;
    const target = new Set(ids);
    const before = new Map(drafts.filter((d) => target.has(d.id)).map((d) => [d.id, d]));
    setDrafts((cur) => cur.map((d) => (target.has(d.id) ? { ...d, ...body } : d)));
    const r = await apiFetch('/api/drafts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, ...body }),
    });
    if (r.ok) return;
    setDrafts((cur) => cur.map((d) => {
      const was = before.get(d.id);
      if (!was) return d;
      // 이 요청이 세팅한 값이 아직 표시 중일 때만 되돌린다 — 응답을 기다리는 사이 사용자가 그 행을
      // 다시 바꿨다면 뒤 갱신을 덮지 않는다(무시 표식 레이스 픽스와 같은 계열).
      if ('status' in body) return d.status === body.status ? { ...d, status: was.status } : d;
      return d.influencerHandle === body.influencerHandle ? { ...d, influencerHandle: was.influencerHandle } : d;
    }));
    setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
  }

  function bulkStatus(status: DraftStatus) {
    void bulkPatch([...selectedIds], { status }); // 선택은 유지 — 같은 묶음에 담당자도 이어서 지정한다
  }

  function bulkInfluencer(handle: string | null) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    // 일괄 배정은 카드와 같은 입력칸을 쓰므로 새 핸들도 칠 수 있다 — 그 대신 오타 하나가 여러 건에
    // 한꺼번에 박히지 않도록 실행 직전에 "누구에게 · 몇 건"을 그대로 보여주고 확인을 받는다.
    const who = handle === null ? '배정을 해제' : `@${handle} 님에게 배정`;
    if (!window.confirm(`고른 원고 ${ids.length}개를 ${who}할까요?`)) return;
    // "배정 단위는 시안 하나"라는 원칙이 깨지는 순간엔 한 번 더 알린다(설계 §F). 막지는 않는다 —
    // 결정은 사람 몫이고, 상태 축이 전이 제약을 두지 않은 것과 같은 이유다.
    const siblings = siblingWarning(drafts, selectedIds);
    if (handle !== null && siblings >= 2) {
      const ok = window.confirm(
        `같은 조건에서 나온 시안 ${siblings}개가 함께 선택돼 있어요.\n`
        + `${siblings}개 다 같은 분께 배정하면 원고 ${siblings}개를 전달한 것으로 기록됩니다.\n\n그래도 배정할까요?`);
      if (!ok) return;
    }
    void bulkPatch(ids, { influencerHandle: handle }); // 배정도 선택 유지 — 이어서 상태를 바꾸는 흐름이 있다
  }

  // 원고 이름 — changeStatus와 같은 모양(낙관적 갱신 + 이 요청이 세팅한 값이 아직 표시 중일 때만 롤백).
  function changeTitle(d: DraftRow, next: string | null) {
    const prev = d.title;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, title: next } : x)));
    void patchDraft(d.id, { title: next ?? '' }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.title === next ? { ...x, title: prev } : x)));
    });
  }

  // 이미지 첨부·떼기 즉시 저장 (설계 §확정 판단) — 파일을 올린 순간 PATCH가 나간다. 모달의 저장
  // 버튼에만 매달면 이미지를 붙이고 Esc를 누른 사용자가 '업로드는 됐는데 첨부는 사라진' 상태를 겪는다.
  // 모양은 assignInfluencer와 같다: 낙관적 갱신 + 이 요청이 세팅한 값이 아직 표시 중일 때만 롤백.
  function saveDraftMedia(d: DraftRow, next: DraftContent) {
    const prev = d.edited;
    setDrafts((cur) => cur.map((x) => (x.id === d.id ? { ...x, edited: next } : x)));
    void patchDraft(d.id, { edited: next }).then((updated) => {
      if (!updated) setDrafts((cur) => cur.map((x) => (x.id === d.id && x.edited === next ? { ...x, edited: prev } : x)));
    });
  }

  async function regenPost(d: DraftRow, index: number) {
    setRegenBusy({ draftId: d.id, index });
    const r = await apiFetch(`/api/drafts/${d.id}/regen-post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index }),
    });
    if (r.ok) { const updated = (await r.json()) as DraftRow; setDrafts((cur) => cur.map((x) => (x.id === d.id ? updated : x))); }
    else setToast(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setRegenBusy(null);
  }

  return (
    <div ref={rootRef} style={{ ['--panel-w' as string]: `${panelW}px` }}
         className={`flex flex-col lg:h-full lg:flex-row ${resizing ? 'select-none' : ''}`}>
      {/* 좌: 생성 패널 — 접히면 lg에서 레일로. <lg 스택에서는 접기 개념 없음(항상 펼침) */}
      <div className={`flex shrink-0 flex-col bg-x-surface lg:min-h-0 ${panelOpen ? 'lg:w-[var(--panel-w)]' : 'lg:hidden'}`}>
        <div className="space-y-3 p-4 lg:flex-1 lg:overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            {/* 소개 문구는 두지 않는다 — 첫 진입에만 쓸모 있고 매번 읽지 않는다(패널 설명 정리) */}
            <h1 className="text-[20px] font-bold">콘텐츠 생성</h1>
            <button onClick={() => setPanelPref('closed')} aria-label="생성 패널 접기" title="생성 패널 접기"
                    className="hidden shrink-0 rounded p-1 text-x-muted hover:bg-x-hover lg:block">«</button>
          </div>
          {/* clientsLoaded 기준 — loaded(초안)로 걸면 clients 응답이 오기 전 몇 초 동안
              등록을 이미 마친 사용자에게 "먼저 등록하라"는 거짓 안내가 뜬다 */}
          {clientsLoaded && clients.length === 0 && (
            <p className="rounded-lg bg-x-surface p-3 text-caption text-x-secondary">
              클라이언트를 먼저 등록하면 클리닉 정보가 원고에 반영돼요 — <a href="/clients" className="font-bold text-x-blue-text hover:underline">등록하러 가기</a>
            </p>
          )}
          <DraftComposer clients={clients} value={composer} onChange={updateComposer}
                         refRows={refRows} onOpenPicker={() => setPickerOpen(true)}
                         onOpenAddLink={() => setAddLinkOpen(true)}
                         onPreviewRef={setPreviewRefId}
                         onRemoveRef={removeRef}
                         onClearRefs={() => { setRefRows([]); setPreviewRefId(null); }} />
        </div>
        <ComposerFooter clients={clients} value={composer} refRows={refRows}
                        generating={generating} onGenerate={() => generate()} onCancel={cancelGenerate}
                        onWrite={() => setWriteOpen(true)} />
      </div>
      {!panelOpen && (
        <div className="hidden w-12 shrink-0 flex-col items-center gap-1.5 border-r border-x-border bg-x-surface py-3 lg:flex">
          <button onClick={() => setPanelPref('open')} aria-label="생성 패널 펼치기" title="생성 패널 펼치기"
                  className="rounded p-1.5 text-x-secondary hover:bg-x-hover">»</button>
          <button onClick={() => setPanelPref('open')} aria-label="새 원고 만들기 — 생성 패널이 펼쳐집니다" title="새 원고"
                  className="rounded p-1.5 text-[15px] font-bold text-x-blue-text hover:bg-x-blue/10">✚</button>
          {generating && <span role="status" aria-label="원고 생성 중" className="mt-1 h-2 w-2 animate-pulse rounded-full bg-x-blue" />}
        </div>
      )}

      {/* 구분선 — lg 전용 드래그 핸들. 키보드 화살표로도 조절 (스펙 §접근성). 접힘 상태에선 리사이즈 대상이 없어 숨김 */}
      {panelOpen && (
      <div role="separator" aria-orientation="vertical" aria-label="패널 폭 조절" tabIndex={0}
           onPointerDown={(e) => { setResizing(true); e.currentTarget.setPointerCapture(e.pointerId); }}
           onPointerMove={(e) => { if (resizing && rootRef.current) applyWidth(e.clientX - rootRef.current.getBoundingClientRect().left); }}
           onPointerUp={() => setResizing(false)} onPointerCancel={() => setResizing(false)}
           onDoubleClick={() => applyWidth(PANEL_DEFAULT)}
           onKeyDown={(e) => {
             const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
             if (d) { e.preventDefault(); applyWidth(panelW + d); }
           }}
           className="hidden w-1.5 shrink-0 cursor-col-resize touch-none bg-x-border hover:bg-x-blue/50 focus:bg-x-blue/60 focus:outline-none lg:block" />
      )}

      {/* 우: 결과 영역 — 필터 헤더는 스크롤 밖 고정 행 (Dense Scan List) */}
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {/* 원고가 0건이어도 보여야 한다 — 만들러 온 상태라 "지금 만드는 것이 어디로 가는지"가 먼저다 */}
        {campaignCtx && (
          <div role="status" className="flex flex-wrap items-center gap-2 border-b border-x-blue/30 bg-x-blue/5 px-4 py-2 text-ui text-x-blue-text">
            <span><b>{campaignCtx.name}</b> 캠페인에 추가 중 — 지금 만드는 원고(생성·직접 쓰기)는 이 캠페인에 들어가요</span>
            <button onClick={clearCampaignCtx} className="ml-auto rounded-full border border-x-blue/40 px-2.5 py-0.5 text-ui hover:bg-white">해제</button>
          </div>
        )}
        {loaded && drafts.length > 0 && (
          <div className="border-b border-x-border bg-x-surface px-4 py-2">
            {/* 1행 — 무엇을 보나: 뷰 | 상태 | 클라이언트 (GitLab·Notion 관례: 모드와 필터의 레이어 분리) */}
            <div className="flex flex-wrap items-center gap-2">
              {/* 세그먼티드 컨트롤 — 배타적 모드 전환기라 필터 알약과 다른 시각 문법(채움형) (3차 스펙 §1) */}
              <div role="group" aria-label="보기 방식" className="flex h-8 shrink-0 overflow-hidden rounded-lg border border-x-border-strong">
                {(['cards', 'table', 'kanban'] as const).map((v, i) => (
                  <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
                          title={v === 'cards' ? '원고를 한 건씩 정독·편집해요' : v === 'table' ? '목록으로 훑고 정렬해요' : '단계별로 끌어서 상태를 옮겨요'}
                          className={`h-full px-3 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${view === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                    {v === 'cards' ? '카드' : v === 'table' ? '테이블' : '칸반'}
                  </button>
                ))}
              </div>
              <span aria-hidden className="h-5 w-px shrink-0 bg-x-border-strong" />
              <div className="min-w-0 flex-1">
                {/* 전체 탭 건수도 검색·시술·기간 반영 — counts와 같은 집합이어야 라벨-값 일치(6차 리뷰 High) */}
                <DraftFilterBar counts={counts} total={scoped.length} filter={filter}
                                clients={clients.map(({ client }) => ({ id: client.id, name: client.name }))}
                                campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
                                onChange={setFilter} showStatusTabs={view !== 'kanban'} />
              </div>
            </div>
            {campaignsError && (
              // 캠페인 select가 비어 보이는 이유를 알려준다 — 안 그러면 "캠페인이 하나도 없나?"로 오해한다(리뷰 Important)
              <p className="mt-1 text-[13px] text-x-secondary">캠페인 목록을 못 불러왔어요 — 새로고침해 주세요</p>
            )}
            {/* 2행 — 어떻게 좁히나: 검색(최광폭)·시술·기간 (필터 초과분은 둘째 줄+구분선 — GitLab) */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-x-border pt-2">
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder="제목·내용·방향성 검색" aria-label="초안 검색"
                     className="h-8 min-w-[200px] max-w-[360px] flex-1 rounded-md border border-x-border-strong bg-white px-2.5 text-[13px] outline-none focus:border-x-blue" />
              <select value={procFilter} onChange={(e) => setProcFilter(e.target.value)} aria-label="시술로 거르기"
                      className="h-8 rounded-md border border-x-border-strong bg-white px-2 text-[13px] outline-none focus:border-x-blue">
                <option value="">모든 시술</option>
                {procOptions.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <PeriodPicker value={period} onChange={setPeriod} />
            </div>
          </div>
        )}
        {/* 스크롤 컨테이너와 flex 정렬을 분리 — 높이 제약된 flex 컬럼에서는 overflow-hidden인 카드가
            flex 아이템으로 찌그러진다(automatic minimum size 0). 정렬은 자연 높이의 내부 div가 담당. */}
        <div ref={resultsRef} className="lg:flex-1 lg:overflow-y-auto">
          <div className={view === 'cards' ? 'flex flex-col items-center gap-4 p-6' : 'p-4'}>
          {/* 상한에 닿았을 때만 — 숫자는 LIST_CAP에서 파생시킨다(라벨-값 일치). 여기에 1000을 직접
              적으면 상한만 바꿨을 때 "1000건만 보고 있어요"가 곧바로 거짓말이 된다(설계 §B). */}
          {atCap(drafts.length, LIST_CAP) && (
            <p className="mb-3 w-full max-w-[600px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-ui text-amber-800">
              원고가 {LIST_CAP}건을 넘어 최근 {LIST_CAP}건만 보고 있어요 — 예전 원고는 아직 검색·필터에 잡히지 않아요.
            </p>
          )}
          {generating && view === 'cards' && (
            <div className="w-full max-w-[600px] animate-pulse rounded-2xl border border-x-border-strong bg-white px-4 py-3">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-full bg-x-border" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 w-1/3 rounded bg-x-border" />
                  <div className="h-3.5 w-full rounded bg-x-border" />
                  <div className="h-3.5 w-4/5 rounded bg-x-border" />
                </div>
              </div>
              <p className="mt-2 text-ui text-x-secondary">
                {genCount.current > 1 ? `시안 ${genCount.current}개 작성 중… 개수만큼 조금 더 걸려요` : '원고 작성 중… 보통 15~30초 걸려요'}
              </p>
              <p className="mt-0.5 text-caption text-x-muted">취소해도 완성되면 목록에 저장됩니다 — 생성 자체는 멈추지 않아요</p>
            </div>
          )}
          {generating && view !== 'cards' && (
            <p className="mb-3 rounded-lg bg-white px-3 py-2 text-ui text-x-secondary">원고 작성 중… 완성되면 초안으로 나타나요 — 취소해도 생성은 계속됩니다</p>
          )}

          {loaded && drafts.length === 0 && !generating && (
            <p className="w-full max-w-[600px] mx-auto rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
              아직 초안이 없어요. 방향성을 적거나 레퍼런스를 골라 첫 원고를 만들어보세요 — 만든 초안은 자동으로 저장돼요.
            </p>
          )}

          {loaded && drafts.length > 0 && !generating
            && (view === 'kanban' ? scoped.length === 0 : visibleDrafts.length === 0) && (
            <p className="w-full max-w-[600px] mx-auto rounded-2xl border border-x-border bg-x-surface p-6 text-center text-ui text-x-secondary">
              이 조건에 맞는 초안이 없어요 — 필터나 검색어를 바꿔보세요.
            </p>
          )}

          {view === 'cards' && shownDrafts.map((d) => (
            <DraftCard key={d.id} draft={d} banned={bannedFor(d)}
                       onEdit={() => setEditing(d)}
                       onRewrite={(feedback, baseIndex) => rewrite(d.id, feedback, baseIndex)}
                       rewriteBusy={rewritingId === d.id}
                       onDelete={() => requestRemove([d])}
                       onRegenPost={(i) => regenPost(d, i)}
                       regenBusyIndex={regenBusy?.draftId === d.id ? regenBusy.index : null}
                       onDismissFlag={(key, dismiss) => toggleDismiss(d, key, dismiss)}
                       onRestoreAllFlags={() => restoreAllFlags(d)}
                       onChangeStatus={(s) => changeStatus(d, s)}
                       onChangeTitle={(next) => changeTitle(d, next)}
                       siblingTotal={d.batchId ? siblingCount(drafts, d.batchId) : null}
                       influencerOptions={influencerOptions}
                       onAssignInfluencer={(next) => assignInfluencer(d, next)}
                       onSaveMedia={(next) => saveDraftMedia(d, next)}
                       mediaDropNotice={mediaDrop?.draftId === d.id ? mediaDrop.notice : null}
                       onDismissMediaDrop={() => setMediaDrop(null)}
                       campaign={cardCampaign(d)} />
          ))}
          {view === 'cards' && (
            <div className="w-full max-w-[600px]">
              <ShowMoreButton total={orderedDrafts.length} shown={shownDrafts.length}
                              onMore={() => setShownCount((n) => n + PAGE_STEP)} />
            </div>
          )}
          {view === 'table' && loaded && shownDrafts.length > 0 && (
            <>
              <DraftTable drafts={shownDrafts} clientNameOf={clientNameOf}
                          onChangeStatus={changeStatus} onOpenCard={setPeekId}
                          selectedIds={selectedIds}
                          onToggleId={(id) => setSelectedIds((cur) => toggleId(cur, id))}
                          onToggleAll={() => setSelectedIds((cur) => toggleAll(cur, visibleIds))}
                          sort={tableSort} onSortChange={setTableSort} />
              <ShowMoreButton total={orderedDrafts.length} shown={shownDrafts.length}
                              onMore={() => setShownCount((n) => n + PAGE_STEP)} />
              {selectedIds.size > 0 && (
                <BulkActionBar count={selectedIds.size} options={influencerOptions}
                               linksText={selectedLinksText}
                               onStatus={bulkStatus} onInfluencer={bulkInfluencer}
                               onDelete={() => requestRemove(drafts.filter((d) => selectedIds.has(d.id)))}
                               onClear={() => setSelectedIds(new Set())} />
              )}
            </>
          )}
          {/* 가드는 drafts 기준 — 클라이언트 필터가 0건이어도 빈 5열+드롭 안내가 그려져야
              무설명 빈 화면이 되지 않는다(T4 리뷰 발견). 초안 0건은 위의 빈 상태 문구가 담당. */}
          {view === 'kanban' && loaded && drafts.length > 0 && (
            <DraftKanban drafts={scoped} clientNameOf={clientNameOf}
                         onChangeStatus={kanbanChangeStatus} onOpenCard={setPeekId}
                         pinnedIds={pinnedIds} onGoToTable={goToTable} />
          )}
          </div>
        </div>
      </div>

      {peeked && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-x-text/40 p-6"
             onClick={() => setPeekId(null)}>
          <div role="dialog" aria-modal="true" aria-label="원고 상세" className="w-full max-w-[600px]"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setPeekId(null)} aria-label="상세 닫기" title="닫기 (Esc)"
                      className="rounded-full bg-white/90 px-2.5 py-1 text-[13px] font-bold text-x-secondary hover:bg-white">✕ 닫기</button>
            </div>
            <DraftCard draft={peeked} banned={bannedFor(peeked)}
                       onEdit={() => setEditing(peeked)}
                       onRewrite={(feedback, baseIndex) => rewrite(peeked.id, feedback, baseIndex)}
                       rewriteBusy={rewritingId === peeked.id}
                       onDelete={() => { setPeekId(null); requestRemove([peeked]); }}
                       onRegenPost={(i) => regenPost(peeked, i)}
                       regenBusyIndex={regenBusy?.draftId === peeked.id ? regenBusy.index : null}
                       onDismissFlag={(key, dismiss) => toggleDismiss(peeked, key, dismiss)}
                       onRestoreAllFlags={() => restoreAllFlags(peeked)}
                       onChangeStatus={(s) => changeStatus(peeked, s)}
                       onChangeTitle={(next) => changeTitle(peeked, next)}
                       siblingTotal={peeked.batchId ? siblingCount(drafts, peeked.batchId) : null}
                       influencerOptions={influencerOptions}
                       onAssignInfluencer={(next) => assignInfluencer(peeked, next)}
                       onSaveMedia={(next) => saveDraftMedia(peeked, next)}
                       mediaDropNotice={mediaDrop?.draftId === peeked.id ? mediaDrop.notice : null}
                       onDismissMediaDrop={() => setMediaDrop(null)}
                       campaign={cardCampaign(peeked)} />
          </div>
        </div>
      )}
      {/* onSaved는 '저장 버튼을 눌러 편집을 마쳤다'라 모달을 닫지만, onMediaSaved(이미지 즉시 저장)에서
          닫으면 두 장째를 못 붙인다 — 목록만 갱신한다 */}
      {editing && (
        <DraftEditModal draft={editing} onClose={() => setEditing(null)}
                        onSaved={(u) => { setDrafts((cur) => cur.map((d) => (d.id === u.id ? u : d))); setEditing(null); }}
                        onMediaSaved={(u) => setDrafts((cur) => cur.map((d) => (d.id === u.id ? u : d)))} />
      )}
      {/* 직접 쓰기 — 저장 성공 경로는 생성과 완전히 같다(목록 맨 위 삽입 + 렌즈에 가려지면 리셋).
          저장 이후의 초안은 출처를 구분하지 않는다는 원칙이 배선에서도 그대로다(설계 §D). */}
      {writeOpen && (
        <DraftWriteModal clientId={composer.clientId} procedureIds={composer.procedureIds}
                         clientName={writeScope.clientName} procedureNames={writeScope.procedureNames}
                         campaignId={campaignCtx?.id ?? null} campaignName={campaignCtx?.name ?? null}
                         onClose={() => setWriteOpen(false)}
                         onSaved={(row) => {
                           setDrafts((cur) => [row, ...cur]);
                           revealIfHidden([row]);
                           setWriteOpen(false);
                           resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                         }} />
      )}
      <RefPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} lastWsId={lastWsId}
                      selectedIds={selectedRefIds} seedRows={refRows} onApply={setRefRows} />
      {/* 진입점 C — 시트 내부 인스턴스와 별개(각자 open 상태). 시트가 열리면 패널이 오버레이에 덮여 동시 오픈 불가 */}
      <AddByLinkModal open={addLinkOpen} onClose={() => setAddLinkOpen(false)} defaultWsId={lastWsId}
                      onAdded={(r) => { void handleAddedByLink(r); }} />
      <RefPreviewModal row={previewRefRow} onClose={() => setPreviewRefId(null)}
                       onRemove={removeRef} />
      {pendingRemove.length > 0 && (
        <Toast message={pendingRemove.length === 1 ? '초안을 삭제했어요' : `원고 ${pendingRemove.length}개를 삭제했어요`}
               actionLabel="실행 취소" onAction={undoRemove} />
      )}
      {toast && pendingRemove.length === 0 && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
