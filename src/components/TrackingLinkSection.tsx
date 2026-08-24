'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { useToast } from '@/lib/toastContext';
import { relTimeFine } from '@/lib/relTime';
import { Button } from '@/components/ui';
import { LinkCreateModal } from '@/components/LinkCreateModal';
import type { TrackingLinkRow } from '@/lib/linkStore';

// 원고 카드의 트래킹 링크 섹션 — 이 원고로 만든 랜딩 링크 목록 + 만들기.
// 자급식: 호스트 3표면(카드·표팝업·칸반팝업)에 props를 배선하지 않는다(단일 표면 원칙).
// 도구층 안의 흰색 인셋 박스(레퍼런스 펼침 카드와 같은 문법)로 전용 공간을 확보한다 —
// 13px 텍스트 줄로는 '여기서 링크를 만든다'는 행동 어포던스가 안 보인다(koo QA 08-25).
// 목록은 토글 없이 상시 표시(koo QA 2차) — 없으면 '없다'가 보이는 것도 정보다.
// 조회는 마운트 시 1회, draft_id 인덱스를 타는 가벼운 쿼리라 카드 수십 장에도 부담이 작다.
export function TrackingLinkSection({ draftId, influencerHandle, clientId, clientName }: {
  draftId: string;
  influencerHandle: string | null;
  clientId: string | null;
  clientName: string | null;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [rows, setRows] = useState<TrackingLinkRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { show } = useToast();
  // 언마운트 후 setTimeout 콜백이 죽은 컴포넌트에 setState하지 않도록(LinkTable.tsx 관례) 타이머를 ref로 들고 정리한다.
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await apiFetch(`/api/links?draftId=${draftId}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { configured: boolean; rows: TrackingLinkRow[] };
      setRows(data.rows);
      setConfigured(data.configured);
      setState('ready');
    } catch {
      setState('error'); // 실패를 '링크 없음'으로 위장하지 않는다
    }
  }, [draftId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백(tracking 페이지 관례)
  useEffect(() => { void load(); }, [load]);

  const onCreated = useCallback((row: TrackingLinkRow) => {
    setRows((cur) => [row, ...cur]); // 방금 만든 링크가 바로 보인다(다음 행동 = 복사·전달)
  }, []);

  // 카드에서는 확인 창 + 즉시 삭제(가벼운 관리 표면) — 5초 실행취소는 트래킹 페이지의 문법.
  // 잘못 만든 링크의 정리 용도: 수정은 스펙대로 불가, 지우고 새로 만든다. short.io 링크는 살려둔다.
  const remove = useCallback(async (row: TrackingLinkRow) => {
    if (!window.confirm(`이 링크를 뺄까요?\n\n${row.shortUrl.replace(/^https?:\/\//, '')}\n쌓인 클릭 기록도 함께 지워져요. 짧은 링크 자체는 계속 열려 있어요.`)) return;
    try {
      const r = await apiFetch(`/api/links/${row.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(String(r.status));
      setRows((cur) => cur.filter((x) => x.id !== row.id));
      show('링크를 뺐어요 — 짧은 링크 자체는 계속 열려 있어요');
    } catch {
      show('링크를 빼지 못했어요 — 잠시 후 다시 시도해 주세요');
    }
  }, [show]);

  const copy = useCallback(async (row: TrackingLinkRow) => {
    try {
      await navigator.clipboard.writeText(row.shortUrl);
      setCopiedId(row.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch { /* 클립보드 거부 — 링크가 화면에 있으니 수동 복사 가능 */ }
  }, []);

  return (
    <div className="mb-1.5 rounded-lg border border-x-border bg-white px-3 py-2">
      <div className="flex items-center gap-2.5">
        <span className="text-ui font-bold">🔗 트래킹 링크{rows.length > 0 ? ` ${rows.length}건` : ''}</span>
        <Button onClick={() => setCreateOpen(true)} className="ml-auto shrink-0 whitespace-nowrap">
          + 링크 만들기
        </Button>
      </div>
      <div className="mt-1 text-[13px]">
        {state === 'loading' && <p className="text-x-muted">불러오는 중…</p>}
        {state === 'error' && (
          <p className="text-x-secondary">링크 목록을 불러오지 못했어요 <button onClick={() => void load()} className="text-x-blue-text hover:underline">다시 시도</button></p>
        )}
        {state === 'ready' && rows.length === 0 && (
          // 공란이되 '없음'이 읽히는 형태 — 기능 설명을 겸해 다음 행동(만들기)까지 안내(UX 원칙 2)
          <p className="text-x-muted">아직 만든 링크가 없어요 — 게시 요청에 함께 보낼 랜딩페이지 링크를 만들면 클릭이 추적돼요.</p>
        )}
        {state === 'ready' && rows.map((r) => (
          <p key={r.id} className="flex items-baseline gap-2 py-0.5">
            <a href={r.shortUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">
              {r.shortUrl.replace(/^https?:\/\//, '')}
            </a>
            <button onClick={() => void copy(r)} className="text-x-blue-text hover:underline">
              {copiedId === r.id ? '복사됨 ✓' : '복사'}
            </button>
            <button onClick={() => void remove(r)} title="목록에서 빼고 클릭 기록도 지워요 — 짧은 링크 자체는 계속 열려요"
                    className="text-x-muted hover:text-red-600 hover:underline">삭제</button>
            <span className="ml-auto shrink-0 text-x-muted">
              {r.clicks === null ? '측정 전' : `클릭 ${r.clicks.totalClicks ?? '—'}`}
              {r.capturedAt ? ` · ${relTimeFine(r.capturedAt, '측정')}` : ''}
            </span>
          </p>
        ))}
      </div>
      {createOpen && (
        <LinkCreateModal open={createOpen} onClose={() => setCreateOpen(false)} configured={configured}
                         onCreated={onCreated}
                         prefill={{ draftId, influencerHandle: influencerHandle ?? undefined,
                                    clientId: clientId ?? undefined, clientName: clientName ?? undefined }} />
      )}
    </div>
  );
}
