'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';

// 새 방문협찬 폼 바닥의 [협찬 항목] — 클라이언트 '협찬 항목' 메모(클라이언트 상세 탭에서 쓴다)를 펼쳐 복사해 인플루언서에게 안내한다.
// 여기서는 읽기만 한다. 처음 펼칠 때 한 번 읽는다(폼을 열 때마다 부르지 않게).
export function SponsorItemsButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState<string | null>(null), [error, setError] = useState('');
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || memo !== null) return;
    let alive = true;
    void (async () => {
      const r = await apiFetch(`/api/clients/${clientId}`).catch(() => null);
      if (!alive) return;
      if (!r?.ok) { setError('협찬 항목을 불러오지 못했어요. 다시 눌러 주세요.'); setOpen(false); return; }
      setMemo(((await r.json()) as { client: { sponsorMemo: string } }).client.sponsorMemo ?? '');
    })();
    return () => { alive = false; };
  }, [open, memo, clientId]);
  // 바깥 클릭·Esc로 닫는다 — Esc는 패널까지 닫지 않게 여기서 멈춘다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  async function copy() {
    try { await navigator.clipboard.writeText(memo ?? ''); setCopied('done'); }
    catch { setCopied('failed'); }
  }
  return (
    <div ref={box} className="relative">
      <Button onClick={() => { setError(''); setCopied('idle'); setOpen((v) => !v); }} aria-expanded={open}
              title="이 클라이언트의 협찬 항목을 보고 복사해 인플루언서에게 안내해요" className="h-9 px-3.5 text-ui">협찬 항목</Button>
      {error && !open && <p role="alert" className="absolute bottom-full left-0 mb-2 w-[260px] text-caption text-red-600">{error}</p>}
      {open && (
        <div role="dialog" aria-label="협찬 항목" className="absolute bottom-full left-0 z-20 mb-2 w-[340px] rounded-lg border border-x-border bg-white p-3 shadow-lg">
          <p className="mb-2 text-ui font-semibold">협찬 항목</p>
          {memo === null ? <p className="text-ui text-x-muted">불러오는 중…</p>
            : memo.trim() ? <>
                <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded-md bg-x-surface p-2.5 font-sans text-ui leading-relaxed">{memo}</pre>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <small className="text-caption text-x-muted">복사해 X DM으로 안내해 주세요.</small>
                  <Button variant="primary" onClick={() => void copy()} className="h-8 px-3 text-ui">{copied === 'done' ? '복사했어요' : '복사'}</Button>
                </div>
                {copied === 'failed' && <p role="alert" className="mt-1 text-caption text-red-600">복사하지 못했어요. 글을 직접 선택해 복사해 주세요.</p>}
              </>
            : <p className="text-ui text-x-muted">아직 적어 둔 협찬 항목이 없어요.{' '}
                <Link href={`/clients?client=${clientId}&tab=sponsor`} className="text-x-blue-text underline">클라이언트 설정</Link>의 협찬 항목 탭에서 적어 주세요.</p>}
        </div>
      )}
    </div>
  );
}
