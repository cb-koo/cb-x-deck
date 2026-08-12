'use client';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

// 이미지 확대 보기 — X의 미디어 뷰어 미러(검은 배경 · ✕ 좌상단 · ‹ › 좌우 이동 · Esc/배경 클릭 닫기).
// X의 우측 본문 패널은 두지 않는다: X는 타임라인에서 진입하니 본문을 함께 보여줄 이유가 있지만,
// 여기서는 본문이 바로 뒤 카드에 있어 닫으면 그만이다.
// 이동 단위는 "그 트윗의 이미지들"이다 — X 뷰어도 한 트윗의 미디어 안에서만 넘긴다.
export function ImageLightbox({ urls, index, onIndexChange, onClose }: {
  urls: string[];               // 서명된 URL들 — 호출부(DraftCard)가 서명을 끝낸 뒤 넘긴다
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const hasPrev = index > 0;
  const hasNext = index < urls.length - 1;

  const prev = useCallback(() => { if (index > 0) onIndexChange(index - 1); }, [index, onIndexChange]);
  const next = useCallback(() => { if (index < urls.length - 1) onIndexChange(index + 1); }, [index, urls.length, onIndexChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }  // 피크/모달의 Esc보다 먼저 — 뷰어만 닫힌다
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    // capture 단계로 등록 — 피크 오버레이·편집 모달도 Esc를 듣고 있어서, 버블 단계면 뷰어와 함께 닫힌다
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, prev, next]);

  const navBtn = 'absolute top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[22px] leading-none text-white hover:bg-white/20';
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="이미지 크게 보기"
         className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90"
         onClick={onClose}>
      <button onClick={onClose} aria-label="닫기"
              className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full text-[22px] text-white hover:bg-white/10">✕</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[index]} alt="" onClick={(e) => e.stopPropagation()}
           className="max-h-[92vh] max-w-[92vw] object-contain" />
      {hasPrev && (
        <button onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="이전 이미지" className={`${navBtn} left-4`}>‹</button>
      )}
      {hasNext && (
        <button onClick={(e) => { e.stopPropagation(); next(); }} aria-label="다음 이미지" className={`${navBtn} right-4`}>›</button>
      )}
      {urls.length > 1 && (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-2.5 py-1 text-[13px] tabular-nums text-white">
          {index + 1} / {urls.length}
        </span>
      )}
    </div>,
    document.body,
  );
}
