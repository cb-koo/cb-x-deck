'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { relTimeFine } from '@/lib/relTime';
import { Button } from '@/components/ui';
import { LinkCreateModal } from '@/components/LinkCreateModal';
import type { TrackingLinkRow } from '@/lib/linkStore';

// 원고 카드의 트래킹 링크 섹션 — 이 원고로 만든 랜딩 링크 목록 + 만들기.
// 자급식: 호스트 3표면(카드·표팝업·칸반팝업)에 props를 배선하지 않는다(단일 표면 원칙).
// 도구층 안의 흰색 인셋 박스(레퍼런스 펼침 카드와 같은 문법)로 전용 공간을 확보한다 —
// 13px 텍스트 줄로는 '여기서 링크를 만든다'는 행동 어포던스가 안 보인다(koo QA 08-25).
// 카드가 목록에 수십 장 떠도 조용하도록, 목록 조회는 펼칠 때 처음 한다(refsOpen 문법).
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

  const toggle = useCallback(() => {
    const opening = !open;
    setOpen(opening);
    if (opening && state === 'idle') void load();
  }, [open, state, load]);

  // 만들기 성공 → 목록을 펼쳐 방금 만든 링크가 바로 보이게(다음 행동 = 복사·전달).
  // 아직 조회 전(idle)이었다면 서버에서 전체를 받아온다 — 새 행만 보이고 기존 링크가 숨는 상태를 막는다.
  const onCreated = useCallback((row: TrackingLinkRow) => {
    setRows((cur) => [row, ...cur]);
    setOpen(true);
    if (state === 'idle') void load();
  }, [state, load]);

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
        <span className="text-ui font-bold">🔗 트래킹 링크</span>
        {/* 접힌 상태에선 건수를 모른다(지연 조회) — '보기'가 열어보는 행동임을 라벨이 말한다 */}
        <button onClick={toggle} className="text-[13px] text-x-blue-text hover:underline">
          {open ? '접기 ⌃' : rows.length > 0 ? `${rows.length}건 보기 ⌄` : '만든 링크 보기 ⌄'}
        </button>
        <Button onClick={() => setCreateOpen(true)} className="ml-auto shrink-0 whitespace-nowrap">
          + 링크 만들기
        </Button>
      </div>
      <p className="mt-0.5 text-caption text-x-muted">
        게시 요청에 함께 보낼 랜딩페이지 링크를 만들어요 — 누가 얼마나 클릭했는지 추적돼요
      </p>
      {open && (
        <div className="mt-1.5 border-t border-x-border pt-1.5 text-[13px]">
          {state === 'loading' && <p className="text-x-muted">불러오는 중…</p>}
          {state === 'error' && (
            <p className="text-x-secondary">링크 목록을 불러오지 못했어요 <button onClick={() => void load()} className="text-x-blue-text hover:underline">다시 시도</button></p>
          )}
          {state === 'ready' && rows.length === 0 && (
            <p className="text-x-muted">아직 만든 링크가 없어요 — 오른쪽 위 버튼으로 시작하세요.</p>
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
        </div>
      )}
      {createOpen && (
        <LinkCreateModal open={createOpen} onClose={() => setCreateOpen(false)} configured={configured}
                         onCreated={onCreated}
                         prefill={{ draftId, influencerHandle: influencerHandle ?? undefined,
                                    clientId: clientId ?? undefined, clientName: clientName ?? undefined }} />
      )}
    </div>
  );
}
