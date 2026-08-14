'use client';
import { useEffect } from 'react';
import { RefTweetCard } from '@/components/RefTweetCard';
import { tweetPermalink } from '@/lib/tweetLink';
import type { ReferenceRow } from '@/lib/referenceStore';

// 레퍼런스 미리보기 — 패널 칩 클릭으로 연다. 데이터가 부모 refRows에 이미 있어 조회 없이 즉시 뜬다(스펙 §B).
// z-50: AddByLinkModal과 같은 층. 시트(z-40)와는 동시에 열릴 수 없다 — 시트가 열리면 패널이 오버레이에 덮인다.
export function RefPreviewModal({ row, onClose, onRemove }: {
  row: ReferenceRow | null; onClose: () => void; onRemove: (tweetId: string) => void;
}) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="max-h-full w-full max-w-[480px] overflow-y-auto rounded-2xl bg-white" role="dialog" aria-modal="true"
           aria-label="참고할 레퍼런스" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center border-b border-x-border bg-white px-4 py-3">
          <h2 className="text-[15px] font-bold">참고할 레퍼런스</h2>
          <button onClick={onClose} aria-label="닫기" autoFocus className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border">✕</button>
        </div>
        <div className="relative flex gap-3 px-4 pb-3.5 pt-3">
          <RefTweetCard row={row} />
        </div>
        {/* 확인 후의 다음 행동을 그 자리에 — 빼기(이건 아니네) / 원문(맥락 더 볼래) (스펙 의도) */}
        <div className="flex items-center gap-3 border-t border-x-border px-4 py-3">
          <button onClick={() => { onRemove(row.tweetId); onClose(); }}
                  className="text-ui text-x-secondary hover:text-red-500 hover:underline">
            이 레퍼런스 빼기
          </button>
          <a href={tweetPermalink(row.authorHandle, row.tweetId)} target="_blank" rel="noopener noreferrer"
             className="ml-auto text-ui text-x-blue-text hover:underline">
            X에서 원문 보기 ↗
          </a>
        </div>
      </div>
    </div>
  );
}
