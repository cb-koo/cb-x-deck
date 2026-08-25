'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ⓘ 설명 — 이름만으로 알 수 없는 컨트롤에만 붙인다.
//
// 브라우저 기본 title로 먼저 냈다가 "아무 설명도 안 뜬다"는 피드백을 받아 직접 만들었다.
// 기본 title은 뜨기까지 1초 가까이 걸리고, 조건에 따라 아예 안 뜨며, 키보드 사용자는 볼 방법이 없다.
// 설명을 볼 수 없으면 설명이 없는 것과 같으므로 이 컴포넌트가 세 가지를 모두 해결한다.
const W = 240;      // px — 300px 패널 안에서도 화면 밖으로 나가지 않는 폭
const H_EST = 120;  // 위/아래 뒤집기 '판단'에만 쓰는 높이 근사치

export function InfoTip({ text, label = '설명 보기' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tipId = useId();

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    // 앵커가 hidden 패널 안으로 들어가면 rect가 전부 0이다 — 그 좌표로 배치하면 좌상단으로 튄다.
    // 숨은 앵커의 툴팁은 열려 있을 이유가 없으니 닫는다(프로필 탭 전환, 스펙 §3).
    if (!r || (r.width === 0 && r.height === 0)) { setOpen(false); return; }
    // 좌측 정렬 후 화면 경계로 클램프 — 패널이 화면 왼쪽 끝에 붙어 있어도 잘리지 않는다
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - W - 8));
    const below = r.bottom + 6;
    const flip = below + H_EST > window.innerHeight && r.top - H_EST - 6 > 0;
    setPos({ top: flip ? r.top - H_EST - 6 : below, left });
  }, []);

  const show = useCallback(() => { place(); setOpen(true); }, [place]);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) hide(); };
    // 패널은 스크롤되는 컨테이너다 — 좌표 고정이라 앵커가 움직이면 따라가야 한다(scroll은 capture로)
    const onMove = () => place();
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, hide, place]);

  return (
    <>
      {/* span이 아니라 button — 키보드 탭으로 닿아야 설명을 볼 수 있다. 폼 안에 있으므로 type="button" 필수 */}
      <button ref={btnRef} type="button" aria-label={label} aria-describedby={open ? tipId : undefined}
              onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
              onClick={(e) => { e.preventDefault(); (open ? hide : show)(); }}
              className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-x-border-strong text-[10px] leading-none text-x-muted hover:border-x-blue hover:text-x-blue-text focus:outline-none focus-visible:ring-2 focus-visible:ring-x-blue">
        ⓘ
      </button>
      {open && createPortal(
        <div id={tipId} role="tooltip" style={{ top: pos.top, left: pos.left, width: W }}
             className="pointer-events-none fixed z-[60] rounded-lg bg-x-text px-2.5 py-2 text-caption leading-relaxed text-white shadow-lg">
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
