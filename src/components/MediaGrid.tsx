import type { ReactNode } from 'react';
import type { DeckMedia } from '@/lib/types';

// 초안 카드에서 이미지별 액션(떼기·받기·복사) 오버레이를 그리기 위해 선택적 슬롯 추가 — 별도 그리드를 피해 X 레이아웃 드리프트 방지
export function MediaGrid({ media, renderOverlay }: { media: DeckMedia[]; renderOverlay?: (i: number) => ReactNode }) {
  const imgs = media.slice(0, 4);
  if (imgs.length === 0) return null;
  const gridClass =
    imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <div className={`mt-3 grid ${gridClass} gap-0.5 overflow-hidden rounded-2xl border border-x-border-strong`}>
      {imgs.map((m, i) => (
        <div key={i} className={`${imgs.length === 3 && i === 0 ? 'row-span-2' : ''}${renderOverlay ? ' relative' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt="" loading="lazy"
               className={`h-full w-full object-cover ${imgs.length === 1 ? 'max-h-96' : 'aspect-square'}`} />
          {renderOverlay && (
            <div className="absolute inset-0">
              {renderOverlay(i)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
