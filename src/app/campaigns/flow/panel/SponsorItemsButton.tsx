'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';

// 새 방문협찬 폼 유형 칸과 인플루언서 칸 사이의 [협찬 항목] — 클라이언트 '협찬 항목' 메모(클라이언트 상세 탭에서 쓴다)를 펼쳐 복사해 인플루언서에게 안내한다.
// 여기서는 읽기만 한다. 처음 펼칠 때 한 번 읽는다(폼을 열 때마다 부르지 않게).
export function SponsorItemsButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState<string | null>(null), [error, setError] = useState('');
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

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
  // 배경 클릭(모달 아래)·Esc로 닫는다 — Esc는 패널까지 닫지 않게 여기서 멈춘다
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  async function copy() {
    try { await navigator.clipboard.writeText(memo ?? ''); setCopied('done'); }
    catch { setCopied('failed'); }
  }
  return (
    <div>
      {/* 패널 카드와 같은 rounded-xl, 파란 틴트로 눌리는 버튼임을 보인다 */}
      <button type="button" onClick={() => { setError(''); setCopied('idle'); setOpen((v) => !v); }} aria-expanded={open}
              title="이 클라이언트의 협찬 항목을 보고 복사해 인플루언서에게 안내해요"
              className="h-10 w-full rounded-xl border border-x-blue/40 bg-x-blue/10 text-ui font-semibold text-x-blue-text transition-colors hover:bg-x-blue/15">협찬 항목</button>
      {error && !open && <p role="alert" className="mt-1 text-caption text-red-600">{error}</p>}
      {/* 가운데 모달 — 항목이 길어 패널 폭 팝오버로는 읽기 어렵다. 패널(aside) 안에 그려도 fixed라 화면 기준으로 뜬다 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
             onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="협찬 항목" className="flex max-h-[85vh] w-[720px] max-w-full flex-col rounded-xl border border-x-border bg-white shadow-xl">
            <header className="flex items-center justify-between border-b border-x-border px-[22px] py-[17px]">
              <h2 className="text-[18px] font-bold">협찬 항목</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="rounded-full p-1.5 text-x-secondary hover:bg-x-hover">✕</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-4">
              {memo === null ? <p className="text-content text-x-muted">불러오는 중…</p>
                : memo.trim() ? <pre className="whitespace-pre-wrap rounded-md bg-x-surface p-4 font-sans text-content leading-relaxed">{memo}</pre>
                : <p className="text-content text-x-muted">아직 적어 둔 협찬 항목이 없어요.{' '}
                    <Link href={`/clients?client=${clientId}&tab=sponsor`} className="text-x-blue-text underline">클라이언트 설정</Link>의 협찬 항목 탭에서 적어 주세요.</p>}
            </div>
            {memo?.trim() && (
              <footer className="flex items-center justify-between gap-2.5 border-t border-x-border px-[22px] py-3.5">
                {copied === 'failed'
                  ? <p role="alert" className="text-caption text-red-600">복사하지 못했어요. 글을 직접 선택해 복사해 주세요.</p>
                  : <small className="text-caption text-x-muted">복사해 X DM으로 안내해 주세요.</small>}
                <Button variant="primary" onClick={() => void copy()} className="h-9 px-4 text-content">{copied === 'done' ? '복사했어요' : '복사'}</Button>
              </footer>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
