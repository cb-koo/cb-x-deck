'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { LinkTable, type LinkHistoryState } from '@/components/LinkTable';
import { LinkCreateModal } from '@/components/LinkCreateModal';
import type { TrackingLinkRow, LinkClickSnapshotRow } from '@/lib/linkStore';

const FETCH_FAILED = '클릭 수를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

// 링크 탭의 상태 소유자 — tracking page의 검증된 조각(load·refreshOne·toggleExpand·requestRemove)을
// 단순화해 옮겼다: 선택·일괄 새로고침·등록 플래시는 없고, 삭제는 1건 단위다.
export function LinksView() {
  const { show, hide } = useToast();
  const [rows, setRows] = useState<TrackingLinkRow[]>([]);
  const [configured, setConfigured] = useState(true); // 낙관 시작 — 응답이 정정한다(버튼을 거짓 어포던스로 두지 않되, 없는 문제를 먼저 말하지도 않는다)
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(new Set());
  // 클릭 이력 — 펼친 행 하나만 들고 있는다(표 안의 표가 여럿이면 되레 못 읽는다)
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<LinkClickSnapshotRow[]>([]);
  const [historyState, setHistoryState] = useState<LinkHistoryState>('loading');
  // 목록에서 빼기는 5초 실행취소 뒤에 커밋된다: pendingRemove = 숨김(커밋 완료까지).
  // 한 번에 하나 — 새 요청이 오면 앞 건을 즉시 커밋한다(library/tracking과 같은 규칙).
  const [pendingRemove, setPendingRemove] = useState<ReadonlySet<string>>(new Set());
  // 비동기 콜백이 재개될 때 클로저의 옛 값을 보지 않게 최신값을 ref로 곁눈질한다.
  // 동기화는 아래 effect가 한다(렌더 중 ref 대입은 이 저장소 린트 규칙이 막는다).
  const expandedRef = useRef<string | null>(null);
  const pendingRef = useRef<ReadonlySet<string>>(new Set());
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // setState는 전부 await 뒤에 둔다 — 동기 setState를 앞에 넣으면 set-state-in-effect에 걸린다(tracking 관례)
  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/links');
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { configured: boolean; rows: TrackingLinkRow[] };
      setRows(data.rows);
      setConfigured(data.configured);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다(tracking·clients 관례)
    } finally {
      setLoaded(true);
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(tracking 관례)
  useEffect(() => { load(); }, [load]);

  // 한 건 새로고침. 실패(502)면 행을 건드리지 않는다 — 못 가져온 것은 링크의 상태가 아니라 우리 사정이다.
  const refreshOne = useCallback(async (id: string) => {
    setRefreshingIds((cur) => new Set(cur).add(id));
    try {
      const res = await apiFetch(`/api/links/${id}/refresh`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as { row?: TrackingLinkRow; error?: string };
      if (!res.ok || !data.row) { show(data.error ?? FETCH_FAILED); return; }
      const row = data.row;
      setRows((cur) => cur.map((r) => (r.id === row.id ? row : r)));
    } catch {
      show(FETCH_FAILED);
    } finally {
      setRefreshingIds((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
    }
  }, [show]);

  // 펼침 = 그 행의 클릭 이력을 그때 조회한다(목록 응답에 전부 실어 보내지 않기 위해).
  // 다시 누르면 접고, 다른 행을 누르면 그 행으로 옮겨간다.
  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setHistoryState('loading');
    setHistory([]);
    try {
      const r = await apiFetch(`/api/links/${id}/snapshots`);
      if (!r.ok) throw new Error(String(r.status));
      const list = (await r.json()) as LinkClickSnapshotRow[];
      // 늦게 도착한 응답이 이미 다른 행으로 옮겨간 화면을 덮어쓰지 않게 — 요청 시점의 id로 확인
      if (id !== expandedRef.current) return;
      setHistory(list);
      setHistoryState('ready');
    } catch {
      if (id === expandedRef.current) setHistoryState('error'); // 실패를 빈 이력으로 위장하지 않는다
    }
  }, [expandedId]);

  // 커밋: 발화 시점의 pendingRef를 지운다 — 예약 시점 목록을 쓰면 그 사이 철회된 행까지 지운다.
  // DELETE 후 서버 상태로 다시 맞춘다 — 실패했다면 그 행이 되돌아와야 정직하다.
  const commitRemove = useCallback(async (ids: string[]) => {
    for (const id of ids) {
      await apiFetch(`/api/links/${id}`, { method: 'DELETE' });
    }
    await load();
    setPendingRemove((cur) => {
      const next = new Set(cur);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, [load]);

  const undoRemove = useCallback(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    removeTimer.current = null;
    hide();
    setPendingRemove(new Set()); // 행 복원, 아무것도 삭제 안 함
  }, [hide]);

  // 토스트 노출 ⟺ 실행취소 가능 구간을 유지한다 — 바뀌는 지점마다 show/hide를 짝지어 부른다
  // (effect로 배선하면 react-hooks/set-state-in-effect 위반).
  // 확인 창은 두지 않는다: 짧은 링크 자체는 살아 있어 되돌릴 수 없는 손실이 아니고(문구가 그 사실을 말한다),
  // 5초 실행취소로 충분하다.
  const requestRemove = useCallback((row: TrackingLinkRow) => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    if (pendingRef.current.size > 0) void commitRemove([...pendingRef.current]); // 대기 중 앞 건은 즉시 커밋
    setPendingRemove(new Set([row.id]));
    if (expandedRef.current === row.id) setExpandedId(null); // 지운 행의 이력을 펼친 채로 두지 않는다
    // duration:null = 자동 소멸 없음, dismissible:false = ✕ 없음.
    // 5초 뒤 삭제가 커밋되므로 토스트가 먼저 사라지거나 사용자가 닫아 실행취소 기회를 잃으면 안 된다.
    show('링크를 목록에서 뺐어요 — 짧은 링크 자체는 계속 열려요', {
      actionLabel: '실행취소', onAction: undoRemove, duration: null, dismissible: false,
    });
    removeTimer.current = setTimeout(() => {
      hide(); // 실행취소 불가 시점 → 토스트 내림
      void commitRemove([...pendingRef.current]);
    }, 5000);
  }, [commitRemove, show, hide, undoRemove]);

  // 생성 성공 — 모달은 성공 화면을 유지하므로(닫기는 사용자가) 목록만 먼저 갱신해 둔다.
  // 맨 위 = 최신 생성순의 제자리다(목록은 created_at desc).
  const onCreated = useCallback((row: TrackingLinkRow) => {
    setRows((cur) => [row, ...cur]);
  }, []);

  // ref 최신화 — 언마운트 cleanup은 이 ref를 deps 없이 참조해야 한다(pendingRemove를 deps로 쓰면
  // undo/타임아웃마다 cleanup이 돌아 삭제가 잘못 커밋된다. tracking/library와 동일 이유).
  useEffect(() => { pendingRef.current = pendingRemove; }, [pendingRemove]);
  useEffect(() => { expandedRef.current = expandedId; }, [expandedId]);
  useEffect(() => () => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    hide();   // 프로바이더는 레이아웃에 있어 화면을 떠나도 살아있다 — 지속 토스트를 남기지 않는다
    pendingRef.current.forEach((id) => { void apiFetch(`/api/links/${id}`, { method: 'DELETE' }); });
  }, [hide]);

  const visible = rows.filter((r) => !pendingRemove.has(r.id));

  return (
    <>
      {/* 만들기는 항상 진입 가능하다 — short.io 설정이 없으면 모달이 그 이유를 말한다(거짓 어포던스 회피) */}
      <div className="mb-2 flex items-center justify-end">
        <Button variant="primary" onClick={() => setCreateOpen(true)} className="whitespace-nowrap"
                title="인플루언서·캠페인 꼬리표가 붙은 짧은 링크를 만들어요">
          + 링크 만들기
        </Button>
      </div>

      {!loaded && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loaded && loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">링크 목록을 불러오지 못했습니다</p>
          <Button onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      {loaded && !loadErr && visible.length === 0 && (
        <p className="py-8 text-center text-ui text-x-secondary">
          인플루언서에게 전달할 랜딩페이지 링크를 만들고 클릭을 추적하는 곳이에요. &lsquo;링크 만들기&rsquo;로 시작하세요.
        </p>
      )}
      {loaded && !loadErr && visible.length > 0 && (
        <LinkTable rows={visible} refreshingIds={refreshingIds}
                   expandedId={expandedId} onToggleExpand={(id) => void toggleExpand(id)}
                   history={history} historyState={historyState}
                   onRefresh={(row) => void refreshOne(row.id)} onRemove={requestRemove} />
      )}

      <LinkCreateModal open={createOpen} onClose={() => setCreateOpen(false)}
                       onCreated={onCreated} configured={configured} />
    </>
  );
}
