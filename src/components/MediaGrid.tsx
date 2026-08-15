import type { ReactNode } from 'react';
import type { DeckMedia } from '@/lib/types';

// 초안 카드에서 이미지별 액션(떼기·받기·복사) 오버레이를 그리기 위해 선택적 슬롯 추가 — 별도 그리드를 피해 X 레이아웃 드리프트 방지
// compact: 보관함 밀도 모드 — 단일 이미지 세로 상한 208px(기본 384px), 2장 이상은 정사각 대신 16:9 셀
export function MediaGrid({ media, renderOverlay, compact }: { media: DeckMedia[]; renderOverlay?: (i: number) => ReactNode; compact?: boolean }) {
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
               className={`h-full w-full object-cover ${imgs.length === 1 ? (compact ? 'max-h-52' : 'max-h-96') : compact ? 'aspect-video' : 'aspect-square'}`} />
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
