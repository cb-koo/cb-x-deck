'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import type { TrackedPostRow } from '@/lib/trackingStore';

// 여러 링크 한꺼번에 등록 — 골격은 AddInfluencersDialog와 동일(한 줄에 하나·순차 처리·줄마다 결과·실패 줄 재시도).
// 등록 폼은 단건용으로 남긴다: 한 줄짜리 칸에 여러 개를 받으려던 시도는 "복수 입력창이라는 느낌이
// 들지 않는다"는 QA(08-15)로 접었다 — 흔한 일(하나 등록)은 가볍게, 가끔의 일(여럿)은 전용 공간에서.
type LineState =
  | { phase: 'waiting' }
  | { phase: 'running' }
  | { phase: 'done'; kind: 'added' | 'dup' }
  | { phase: 'error'; message: string };

type Item = { raw: string; state: LineState };

// 페이지의 addOne 결과 모양 그대로 — 목록 갱신(행 삽입·재등록 철회)은 addOne이 하고, 여기는 줄 상태만 그린다.
export type AddOneResult = { kind: 'added' | 'dup'; row: TrackedPostRow } | { kind: 'fail'; msg: string };

export function TrackAddManyDialog({ onClose, onAddOne }: {
  onClose: () => void;
  onAddOne: (url: string) => Promise<AddOneResult>;
}) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);   // null = 아직 입력 단계
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  // 본문에서 true로 되돌린다 — StrictMode의 mount→unmount→mount에서 cleanup만 돌면 영영 false가 된다
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // list가 주어지면 그 줄만(=실패 줄 재시도), 없으면 전부
  async function run(list: Item[], only?: number[]) {
    if (running) return;
    setRunning(true);
    const idxs = only ?? list.map((_, i) => i);
    try {
      for (const i of idxs) {
        if (!alive.current) break;   // 창을 닫으면 남은 줄은 멈춘다(이미 처리한 줄은 목록에 그대로 남는다)
        // 트윗 주소가 아니면 API를 부르지 않고 그 자리에서 알려준다 — 단건 폼의 인라인 검증과 같은 파서·문구
        const parsed = parseTweetLink(list[i].raw);
        if (!parsed.ok) {
          const reason = parsed.reason;
          setItems((prev) => prev && prev.map((it, j) =>
            (j === i ? { ...it, state: { phase: 'error', message: tweetLinkParseMessage(reason) } } : it)));
          continue;
        }
        setItems((prev) => prev && prev.map((it, j) => (j === i ? { ...it, state: { phase: 'running' } } : it)));
        const res = await onAddOne(list[i].raw);
        setItems((prev) => prev && prev.map((it, j) => (j === i
          ? { ...it, state: res.kind === 'fail' ? { phase: 'error', message: res.msg } : { phase: 'done', kind: res.kind } }
          : it)));
      }
    } finally {
      setRunning(false);
    }
  }

  function start() {
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const list: Item[] = lines.map((raw) => ({ raw, state: { phase: 'waiting' } }));
    setItems(list);
    void run(list);
  }

  function retryFailed() {
    if (!items) return;
    const only = items.map((it, i) => (it.state.phase === 'error' ? i : -1)).filter((i) => i >= 0);
    if (only.length > 0) void run(items, only);
  }

  const lineCount = text.split('\n').map((s) => s.trim()).filter(Boolean).length;
  const failed = items?.filter((it) => it.state.phase === 'error').length ?? 0;
  const doneCount = items?.filter((it) => it.state.phase === 'done' || it.state.phase === 'error').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="여러 게시물 추적" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[15px] font-bold">여러 게시물 추적</h2>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        {items === null ? (
          <>
            <label htmlFor="track-many-lines" className="mt-3 block text-caption text-x-muted">
              한 줄에 게시물 링크 하나
            </label>
            <textarea id="track-many-lines" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={6}
                      placeholder={'https://x.com/계정/status/…\nhttps://x.com/계정/status/…'}
                      autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
            <p className="mt-1 text-caption text-x-muted">
              위에서부터 한 줄씩 지표를 가져와 목록에 추가하고, 결과를 줄마다 보여줘요.
            </p>
            <div className="mt-4 flex items-center gap-3">
              {/* 비용 유발 액션은 버튼에 값을 적어 opt-in으로(UX 원칙 6) */}
              <Button variant="primary" onClick={start} disabled={lineCount === 0}>
                {lineCount > 1 ? `추적 시작 (${lineCount}건 — API 호출 ${lineCount}회)` : '추적 시작'}
              </Button>
              <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-caption text-x-muted">
              {running ? `${doneCount}/${items.length} 처리 중… 닫아도 여기까지 등록된 게시물은 목록에 남고, 남은 줄만 멈춰요.`
                       : `${items.length}줄 처리 완료`}
            </p>
            <ul className="mt-2 max-h-[46vh] space-y-1 overflow-y-auto">
              {items.map((it, i) => (
                <li key={`${i}-${it.raw}`} className="flex items-start gap-2 rounded-lg border border-x-border px-3 py-1.5 text-ui">
                  <span className="min-w-0 flex-1 truncate">{it.raw}</span>
                  <ResultLabel state={it.state} />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center gap-3">
              {failed > 0 && !running && (
                <Button variant="primary" onClick={retryFailed}>실패한 {failed}줄 다시 시도</Button>
              )}
              <Button variant={failed > 0 && !running ? 'subtle' : 'primary'} onClick={onClose} disabled={running}>
                {running ? '처리 중…' : '닫기'}
              </Button>
              {running && <button onClick={onClose} className="text-ui text-x-secondary">그만두고 닫기</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResultLabel({ state }: { state: LineState }) {
  if (state.phase === 'waiting') return <span className="shrink-0 text-caption text-x-muted">대기 중</span>;
  if (state.phase === 'running') return <span className="shrink-0 text-caption text-x-secondary">가져오는 중…</span>;
  if (state.phase === 'error') {
    return <span role="alert" className="max-w-[240px] shrink-0 text-caption text-red-600">{state.message}</span>;
  }
  return (
    <span className="shrink-0 text-caption text-x-secondary">
      {state.kind === 'dup' ? '이미 추적 중이에요' : '추적 시작됨'}
      {state.kind === 'added' && <span className="ml-1 text-x-green">✓</span>}
    </span>
  );
}
