'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import type { InfluencerRow } from '@/lib/influencerStore';

// 줄 하나의 처리 결과. 한 요청 = 핸들 하나이므로(서버 계약) 여러 줄은 여기서 순차로 돈다 —
// 한 번에 몰아 보내면 타임아웃 위험이 있고, 무엇보다 어느 줄이 왜 실패했는지 말해줄 수 없다.
type LineState =
  | { phase: 'waiting' }
  | { phase: 'running' }
  | { phase: 'done'; kind: 'created' | 'exists' | 'renamed'; handle: string }
  | { phase: 'error'; message: string };

type Item = { raw: string; state: LineState };

const DONE_LABEL: Record<'created' | 'exists' | 'renamed', string> = {
  created: '등록됨', exists: '이미 명부에 있어요', renamed: '개명 감지 — 새 핸들로 갱신됨',
};

export function AddInfluencersDialog({ onClose, onFinished }: {
  onClose: () => void;
  onFinished: (addedIds: string[]) => void;   // 처리가 끝나면 명부를 다시 읽도록 부모에게 알린다
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

  async function postOne(raw: string): Promise<{ state: LineState; id?: string }> {
    try {
      const r = await apiFetch('/api/influencers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: raw }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        created?: boolean; renamed?: boolean; influencer?: InfluencerRow | null; error?: string;
      };
      // 502(X 조회 실패·없는 핸들 포함)·400·404 모두 서버 문구를 그대로 보여준다 — 원인을 넘겨짚지 않는다
      if (!r.ok) return { state: { phase: 'error', message: body.error ?? `등록하지 못했어요 (오류 ${r.status})` } };
      // 드문 경합(등록 직후 삭제 등)에서 influencer가 null로 올 수 있다 — 성공으로 위장하지 않는다
      if (!body.influencer) {
        return { state: { phase: 'error', message: '등록 결과를 확인하지 못했어요 — 다시 시도해 주세요' } };
      }
      const kind = body.created ? 'created' : body.renamed ? 'renamed' : 'exists';
      return { state: { phase: 'done', kind, handle: body.influencer.handle }, id: body.influencer.id };
    } catch {
      return { state: { phase: 'error', message: '등록하지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요' } };
    }
  }

  // list가 주어지면 그 줄만(=실패 줄 재시도), 없으면 전부
  async function run(list: Item[], only?: number[]) {
    if (running) return;
    setRunning(true);
    const idxs = only ?? list.map((_, i) => i);
    const added: string[] = [];
    try {
      for (const i of idxs) {
        if (!alive.current) break;   // 창을 닫으면 남은 줄은 멈춘다(이미 처리한 줄은 그대로 남는다)
        setItems((prev) => prev && prev.map((it, j) => (j === i ? { ...it, state: { phase: 'running' } } : it)));
        const res = await postOne(list[i].raw);
        if (res.id) added.push(res.id);
        setItems((prev) => prev && prev.map((it, j) => (j === i ? { ...it, state: res.state } : it)));
      }
    } finally {
      setRunning(false);
      onFinished(added);   // 부모(명부)는 계속 떠 있으므로 창이 닫힌 뒤에 불려도 안전하다
    }
  }

  function start() {
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const list: Item[] = lines.map((raw) => ({ raw, state: { phase: 'waiting' } }));
    setItems(list);
    run(list);
  }

  function retryFailed() {
    if (!items) return;
    const only = items.map((it, i) => (it.state.phase === 'error' ? i : -1)).filter((i) => i >= 0);
    if (only.length > 0) run(items, only);
  }

  const failed = items?.filter((it) => it.state.phase === 'error').length ?? 0;
  const doneCount = items?.filter((it) => it.state.phase === 'done' || it.state.phase === 'error').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="인플루언서 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[15px] font-bold">인플루언서 추가</h2>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        {items === null ? (
          <>
            <label htmlFor="add-inf-lines" className="mt-3 block text-caption text-x-muted">
              한 줄에 한 계정 — @핸들이나 프로필 링크
            </label>
            <textarea id="add-inf-lines" autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={6}
                      placeholder={'@hadakan__\nhttps://x.com/another_account'}
                      className="mt-0.5 w-full rounded-md border border-x-border-strong p-2 text-ui leading-normal outline-none focus:border-x-blue" />
            <p className="mt-1 text-caption text-x-muted">
              추가할 때 계정마다 X에 한 번 물어 이름·프로필 사진·팔로워를 채워둬요. 위에서부터 한 줄씩 처리하고 결과를 줄마다 보여줘요.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" onClick={start} disabled={text.trim() === ''}>명부에 추가</Button>
              <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-caption text-x-muted">
              {running ? `${doneCount}/${items.length} 처리 중… 닫아도 여기까지 처리된 계정은 명부에 남고, 남은 줄만 멈춰요.`
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
  if (state.phase === 'running') return <span className="shrink-0 text-caption text-x-secondary">조회 중…</span>;
  if (state.phase === 'error') return <span className="max-w-[240px] shrink-0 text-caption text-red-600">{state.message}</span>;
  return (
    <span className="shrink-0 text-caption text-x-secondary">
      {state.kind === 'renamed' ? `개명 감지 — @${state.handle}로 갱신됨` : DONE_LABEL[state.kind]}
      {state.kind === 'created' && <span className="ml-1 text-x-green">✓</span>}
    </span>
  );
}
