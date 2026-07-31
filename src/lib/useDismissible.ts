'use client';
import { useEffect, type RefObject } from 'react';

// <details> 드롭다운을 바깥 클릭과 Esc로 닫는다.
//
// React 상태를 두지 않는 이유: <details>는 열림 상태를 이미 DOM(open 속성)에 들고 있고,
// 이 저장소는 react-hooks/set-state-in-effect가 에러라 상태를 이중으로 들면 손해만 본다.
// Column.tsx가 같은 이유로 removeAttribute('open')을 쓴다 — 같은 방식을 공유한다.
export function useDismissible(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const close = () => ref.current?.removeAttribute('open');

    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el || !el.open) return;
      if (e.target instanceof Node && el.contains(e.target)) return;   // 패널 안을 누른 것
      close();
    };
    // IME 조합 중 Esc는 조합 취소다 — 패널을 닫으면 입력하던 글자가 사라진 것처럼 느껴진다.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && ref.current?.open) close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref]);
}
