'use client';
import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { relTimeFine } from '@/lib/relTime';
import { LinkCreateModal } from '@/components/LinkCreateModal';
import type { TrackingLinkRow } from '@/lib/linkStore';

// 원고 카드의 트래킹 링크 섹션 — 이 원고로 만든 랜딩 링크 목록 + 만들기.
// 자급식: 호스트 3표면(카드·표팝업·칸반팝업)에 props를 배선하지 않는다(단일 표면 원칙).
// 카드가 목록에 수십 장 떠도 조용하도록, 펼칠 때 처음 조회한다(refsOpen 문법).
export function TrackingLinkSection({ draftId, influencerHandle, clientId, clientName }: {
  draftId: string;
  influencerHandle: string | null;
  clientId: string | null;
  clientName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [rows, setRows] = useState<TrackingLinkRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const toggle = useCallback(() => {
    const opening = !open;
    setOpen(opening);
    if (opening && state === 'idle') void load();
  }, [open, state, load]);

  const copy = useCallback(async (row: TrackingLinkRow) => {
    try {
      await navigator.clipboard.writeText(row.shortUrl);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* 클립보드 거부 — 링크가 화면에 있으니 수동 복사 가능 */ }
  }, []);

  return (
    <div className="py-0.5 text-[13px]">
      <button onClick={toggle} className="text-left">
        🔗 트래킹 링크{rows.length > 0 ? ` ${rows.length}건` : ''} <span className="text-x-blue-text">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="mt-1">
          {state === 'loading' && <p className="text-x-muted">불러오는 중…</p>}
          {state === 'error' && (
            <p className="text-x-secondary">링크 목록을 불러오지 못했어요 <button onClick={() => void load()} className="text-x-blue-text hover:underline">다시 시도</button></p>
          )}
          {state === 'ready' && rows.length === 0 && (
            <p className="text-x-muted">아직 만든 링크가 없어요 — 게시 요청에 함께 보낼 랜딩페이지 링크를 만들 수 있어요.</p>
          )}
          {state === 'ready' && rows.map((r) => (
            <p key={r.id} className="flex items-baseline gap-2 py-0.5">
              <a href={r.shortUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">
                {r.shortUrl.replace(/^https?:\/\//, '')}
              </a>
              <button onClick={() => void copy(r)} className="text-x-blue-text hover:underline">
                {copiedId === r.id ? '복사됨 ✓' : '복사'}
              </button>
              <span className="ml-auto shrink-0 text-x-muted">
                {r.clicks === null ? '측정 전' : `클릭 ${r.clicks.totalClicks ?? '—'}`}
                {r.capturedAt ? ` · ${relTimeFine(r.capturedAt, '측정')}` : ''}
              </span>
            </p>
          ))}
          {state === 'ready' && (
            <button onClick={() => setCreateOpen(true)} className="mt-0.5 text-x-blue-text hover:underline">+ 링크 만들기</button>
          )}
        </div>
      )}
      {createOpen && (
        <LinkCreateModal open={createOpen} onClose={() => setCreateOpen(false)} configured={configured}
                         onCreated={(row) => setRows((cur) => [row, ...cur])}
                         prefill={{ draftId, influencerHandle: influencerHandle ?? undefined,
                                    clientId: clientId ?? undefined, clientName: clientName ?? undefined }} />
      )}
    </div>
  );
}
