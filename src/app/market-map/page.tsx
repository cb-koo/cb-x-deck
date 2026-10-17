'use client';
// 클리닉 지도 — 지도 라이브러리는 브라우저에서만 돈다(window·WebGL). 이 화면에서만 불러와 다른 화면 번들에 들어가지 않는다.
import dynamic from 'next/dynamic';

const MarketMapApp = dynamic(() => import('./MarketMapApp'), {
  ssr: false,
  loading: () => <div className="px-6 py-8 text-content text-x-muted">클리닉 지도를 불러오는 중…</div>,
});

export default function MarketMapPage() {
  return <MarketMapApp />;
}
