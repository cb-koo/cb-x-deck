'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// 아이콘 버튼용 이름표. 아이콘만 남긴 액션 행(편집·다시 쓰기·복사·번역·받기)에서 뜻을 알려준다.
//
// 왜 브라우저 기본 title이 아닌가: InfoTip과 같은 이유다 — 이 저장소는 title로 냈다가 "아무 설명도
// 안 뜬다"는 피드백을 받았다. 뜨기까지 1초 가까이 걸리고, 조건에 따라 아예 안 뜨며, 키보드로는 볼 수 없다.
// 왜 CSS 툴팁이 아닌가: 카드 루트가 overflow-hidden이라(둥근 모서리를 위해) 카드 경계에서 잘린다.
// 그래서 좌표를 재서 body로 포털한다.
//
// InfoTip과 나누어 둔 이유: InfoTip은 자기 ⓘ 버튼을 스스로 그리는 컴포넌트라 감싸는 용도로 못 쓴다.
// 이쪽은 임의의 자식을 감싸고, 자식이 이미 가진 접근성 이름(aria-label)은 건드리지 않는다.
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const tipId = useId();

  const place = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    // 대상 위쪽 가운데. 화면 위로 넘치면 아래로 뒤집는다 — 뒤집으면 세로 이동(translate)도 함께 꺼야
    // 한다(위로 띄울 때만 자기 높이만큼 올린다). 좌우는 화면 안으로 클램프.
    const below = r.top - 8 < 40;
    setPos({
      top: below ? r.bottom + 8 : r.top - 8,
      left: Math.max(8, Math.min(r.left + r.width / 2, window.innerWidth - 8)),
      below,
    });
  }, []);

  const show = useCallback(() => { place(); setOpen(true); }, [place]);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) hide(); };
    const onMove = () => place();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);  // 결과 열이 스크롤된다 — 앵커를 따라가야 한다
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, hide, place]);

  return (
    <span ref={wrapRef} className="inline-flex"
          onMouseEnter={show} onMouseLeave={hide} onFocusCapture={show} onBlurCapture={hide}
          /* 눌렀으면 뜻을 안 것이다 — 액션이 실행되는 동안 이름표가 남아 가리지 않게 걷는다 */
          onClickCapture={hide}>
      {children}
      {open && createPortal(
        <div id={tipId} role="tooltip" style={{ top: pos.top, left: pos.left }}
             className={`pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded-md bg-x-text px-2 py-1 text-[12px] leading-none text-white shadow-lg ${pos.below ? '' : '-translate-y-full'}`}>
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
