'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';

export interface AddedByLink { tweetId: string; alreadyInLibrary: boolean; workspaceId: string }

// 링크로 트윗 추가 — 보관함 페이지·레퍼런스 선택창 공용 (스펙 2026-08-10 §③).
// z-50: RefPickerSheet(z-40) 위에 뜨는 진입점이 있다.
export function AddByLinkModal({ open, onClose, fixedWsId, defaultWsId, onAdded }: {
  open: boolean; onClose: () => void;
  fixedWsId?: string; defaultWsId?: string | null;
  onAdded: (r: AddedByLink) => void;
}) {
  const [url, setUrl] = useState('');
  const [memo, setMemo] = useState('');
  const [wsId, setWsId] = useState(fixedWsId ?? defaultWsId ?? '');
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때마다 초기화(모달 재사용, ColumnSettings 관례)
  useEffect(() => { if (open) { setUrl(''); setMemo(''); setServerErr(null); setWsId(fixedWsId ?? defaultWsId ?? ''); } }, [open, fixedWsId, defaultWsId]);
  useEffect(() => {
    if (!open || fixedWsId) return; // 드롭다운은 레퍼런스 선택창 진입에서만
    apiFetch('/api/workspaces').then((r) => r.json()).then((list: Array<{ id: string; name: string }>) => {
      setWorkspaces(list);
      setWsId((cur) => (cur && list.some((w) => w.id === cur) ? cur : (list[0]?.id ?? '')));
    });
  }, [open, fixedWsId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const parsed = parseTweetLink(url);
  const showParseErr = url.trim().length > 0 && !parsed.ok && parsed.reason !== 'empty';

  async function submit() {
    if (!parsed.ok || !wsId || busy) return;
    setBusy(true); setServerErr(null);
    try {
      const res = await apiFetch('/api/library/from-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, workspaceId: wsId, ...(memo.trim() ? { memo: memo.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setServerErr(data.error ?? '추가하지 못했어요 — 잠시 후 다시 시도해주세요'); return; } // 실패 시 입력 보존
      onAdded({ tweetId: data.tweetId, alreadyInLibrary: data.alreadyInLibrary, workspaceId: wsId });
      onClose();
    } catch {
      setServerErr('추가하지 못했어요 — 네트워크를 확인하고 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="w-full max-w-[480px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="링크로 트윗 추가" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[15px] font-bold">링크로 트윗 추가</h2>
          <button onClick={onClose} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>

        <label htmlFor="add-link-url" className="mt-3 block text-caption text-x-muted">트윗 링크</label>
        <input id="add-link-url" autoFocus value={url} onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="https://x.com/계정/status/…"
               className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
        <p className="mt-1 text-caption text-x-muted">X에서 공유 → 링크 복사한 주소를 붙여넣으면 팀 보관함에 저장돼요</p>
        {showParseErr && <p className="mt-1 text-caption text-red-600">{tweetLinkParseMessage(parsed.ok ? 'invalid' : parsed.reason)}</p>}

        {!fixedWsId && (
          <>
            <label htmlFor="add-link-ws" className="mt-3 block text-caption text-x-muted">저장할 워크스페이스</label>
            <select id="add-link-ws" value={wsId} onChange={(e) => setWsId(e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue">
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </>
        )}

        <label htmlFor="add-link-memo" className="mt-3 block text-caption text-x-muted">
          메모 남기기 <span className="text-x-muted">(선택 · 이 트윗의 어떤 점이 좋았는지 — 원고 생성 때 참고돼요)</span>
        </label>
        <input id="add-link-memo" value={memo} onChange={(e) => setMemo(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(); }}
               placeholder="예: 후킹 문장 구조가 좋음"
               className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />

        {serverErr && <p className="mt-2 text-caption text-red-600">{serverErr}</p>}

        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!parsed.ok || !wsId || busy}>
            {busy ? '가져오는 중…' : '보관함에 추가'}
          </Button>
          <button onClick={onClose} className="text-ui text-x-secondary">취소</button>
        </div>
      </div>
    </div>
  );
}
