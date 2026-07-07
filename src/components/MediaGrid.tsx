import type { DeckMedia } from '@/lib/types';

export function MediaGrid({ media }: { media: DeckMedia[] }) {
  const imgs = media.slice(0, 4);
  if (imgs.length === 0) return null;
  const gridClass =
    imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  return (
    <div className={`mt-3 grid ${gridClass} gap-0.5 overflow-hidden rounded-2xl border border-[#cfd9de]`}>
      {imgs.map((m, i) => (
        <div key={i} className={imgs.length === 3 && i === 0 ? 'row-span-2' : ''}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.url} alt="" loading="lazy"
               className={`h-full w-full object-cover ${imgs.length === 1 ? 'max-h-96' : 'aspect-square'}`} />
        </div>
      ))}
    </div>
  );
}
