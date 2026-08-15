'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { TweetText } from './TweetText';

// 밀도 모드 본문: 6줄 클램프. 실제로 잘렸을 때만 페이드+'더 보기'를 보여준다(거짓 어포던스 금지, spec §2).
// 측정은 열 너비 변화(창 크기)에도 따라가야 해서 ResizeObserver로 유지한다.
export function ClampedText({ text, className = '' }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const p = boxRef.current?.querySelector('p');
    if (!p) return;
    const measure = () => setClipped(!expanded && p.scrollHeight > p.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(p);
    return () => ro.disconnect();
  }, [text, expanded]);
  return (
    <div>
      <div ref={boxRef} className="relative">
        <TweetText text={text} className={`${className} ${expanded ? '' : 'line-clamp-6'}`} />
        {clipped && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-white/0 to-white" />}
      </div>
      {(clipped || expanded) && (
        <button onClick={() => setExpanded((v) => !v)}
                className="mt-1.5 rounded-full bg-x-blue/10 px-3 py-1 text-ui font-medium text-x-blue-text hover:bg-x-blue/20">
          {expanded ? '접기 ▴' : '더 보기 ▾'}
        </button>
      )}
    </div>
  );
}
