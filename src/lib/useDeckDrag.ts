'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { ColumnRow } from './types';
import { arrayMove, dropIndex, shiftFor, edgeScrollVelocity, type ColumnBox } from './deckReorder';

const ACTIVATION_PX = 5;   // 이만큼 움직여야 드래그로 인정 — 그냥 클릭했을 때 순서가 바뀌는 것을 막는다

type Drag = {
  fromIndex: number;
  pointerId: number;
  startClientX: number;
  clientX: number;
  grabOffset: number;        // 잡은 지점 − 컬럼 왼쪽 끝 (콘텐츠 좌표)
  containerLeft: number;     // 컨테이너의 뷰포트 기준 왼쪽
  containerWidth: number;
  prevScrollBehavior: string;
  boxes: ColumnBox[];
  els: HTMLElement[];
  active: boolean;           // 임계값을 넘었는가
  reduce: boolean;           // prefers-reduced-motion
  toIndex: number;
  lastTo: number;
  lastDraggedLeft: number;
  raf: number | null;
  lastT: number;
};

export function useDeckDrag({ columns, containerRef, getColumnEl, onCommit }: {
  columns: ColumnRow[];
  containerRef: React.RefObject<HTMLElement | null>;
  getColumnEl: (id: string) => HTMLElement | null;
  onCommit: (ids: string[]) => void;
}) {
  const drag = useRef<Drag | null>(null);
  // 리스너 해제를 위해 같은 함수 참조를 유지한다
  const handlers = useRef<{ move: (e: PointerEvent) => void; up: (e: PointerEvent) => void; cancel: (e: PointerEvent) => void; key: (e: KeyboardEvent) => void } | null>(null);
  // finish에서 커밋 직전 "지금" 컬럼 목록과 비교하기 위한 최신 스냅샷.
  // finish 자신의 클로저에 columns를 직접 담으면 드래그 시작 시점 값에 박제되므로 ref로 우회한다.
  const columnsRef = useRef(columns);
  useEffect(() => { columnsRef.current = columns; }, [columns]);

  const finish = useCallback((commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.raf !== null) cancelAnimationFrame(d.raf);
    if (handlers.current) {
      window.removeEventListener('pointermove', handlers.current.move);
      window.removeEventListener('pointerup', handlers.current.up);
      window.removeEventListener('pointercancel', handlers.current.cancel);
      window.removeEventListener('keydown', handlers.current.key);
      handlers.current = null;
    }
    document.body.style.userSelect = '';
    const container = containerRef.current;
    if (container) container.style.scrollBehavior = d.prevScrollBehavior;
    // will-change를 남겨두면 GPU 메모리를 계속 잡아먹는다 — 반드시 해제한다
    for (const el of d.els) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.willChange = '';
      el.style.opacity = '';
      el.style.zIndex = '';
      el.style.boxShadow = '';
    }
    if (commit && d.active && d.toIndex !== d.fromIndex) {
      // 드래그 시작 시점 스냅샷(d.boxes)의 id 순서와 지금의 columns 순서가 같은지 확인한다.
      // 드래그 도중 다른 팀원이 컬럼을 추가/삭제하면(워크스페이스 공유) d.boxes·d.els는
      // 이미 현실과 어긋난 캐시다 — 그 좌표로 계산한 toIndex로 순서를 확정하면 방금 바뀐
      // 목록을 엉뚱하게 덮어쓰게 된다. 서버가 409로 걸러주긴 하지만 그걸 암묵적으로
      // 믿지 않고, id 배열(길이+순서)이 다르면 커밋을 건너뛴다. 시각 복원(위 스타일 리셋)은
      // 이미 끝났으니 그대로 둔다.
      const startIds = d.boxes.map((b) => b.id);
      const currentIds = columnsRef.current.map((c) => c.id);
      const unchanged = startIds.length === currentIds.length
        && startIds.every((id, i) => id === currentIds[i]);
      if (unchanged) {
        // 스타일을 먼저 지우고 같은 태스크 안에서 상태를 바꾼다 — 사이에 페인트가 끼지 않아 튀지 않는다
        onCommit(arrayMove(currentIds, d.fromIndex, d.toIndex));
      }
    }
  }, [containerRef, onCommit]);

  // 언마운트 시(드래그 도중이라도) 최신 finish를 호출할 수 있도록 ref에 담아둔다.
  // finish는 매 렌더 새로 만들어질 수 있으므로 빈 의존성 배열의 언마운트 클린업이
  // finish를 직접 잡으면 낡은 클로저(오래된 onCommit 등)를 참조하게 된다.
  const finishRef = useRef(finish);
  useEffect(() => { finishRef.current = finish; }, [finish]);

  useEffect(() => () => {
    // 드래그 도중 컴포넌트가 언마운트되면(예: 다른 화면으로 이동) 리스너·rAF·인라인 스타일·
    // body/container 스타일이 정리되지 않고 앱 세션 내내 남는다(예: 텍스트 선택 불가).
    // 커밋은 하지 않는다 — 취소만 한다.
    finishRef.current(false);
  }, []);

  // rAF 콜백은 스스로를 재귀 예약한다. `frame` 상수를 자기 본문 안에서 직접 참조하면
  // react-hooks/immutability(선언 전 참조) 린트 에러가 나므로, ref에 최신 함수를 담아 그걸 통해 재귀한다.
  const frameRef = useRef<(() => void) | null>(null);

  const frame = useCallback(() => {
    const d = drag.current;
    const container = containerRef.current;
    if (!d || !container) return;
    d.raf = requestAnimationFrame(() => frameRef.current?.());

    // ── 읽기 먼저. 쓰기 뒤에 읽으면 강제 동기 레이아웃이 걸린다.
    const now = performance.now();
    const dt = Math.min(0.05, (now - d.lastT) / 1000);   // 탭 전환 등으로 프레임이 튀어도 폭주하지 않게 상한
    d.lastT = now;
    const scrollLeft = container.scrollLeft;
    const maxScroll = container.scrollWidth - container.clientWidth;

    // ── 가장자리 자동 스크롤
    let nextScroll = scrollLeft;
    const v = edgeScrollVelocity(d.clientX, d.containerLeft, d.containerWidth);
    if (v !== 0) {
      // 그 방향으로 실제 움직인 뒤에만 스크롤한다. 없으면 오른쪽 끝 컬럼을 집는 순간
      // 스트립이 날아간다 — 새 컬럼이 항상 오른쪽 끝에 생기는 구조라 자주 걸린다.
      const moved = d.clientX - d.startClientX;
      if ((v < 0 && moved < 0) || (v > 0 && moved > 0)) {
        nextScroll = Math.max(0, Math.min(maxScroll, scrollLeft + v * dt));
      }
    }

    // ── 계산 (캐시된 boxes만 사용 — 여기서 다시 재면 매 프레임 리플로)
    const draggedLeft = d.clientX - d.containerLeft + nextScroll - d.grabOffset;
    const to = dropIndex(d.boxes, d.fromIndex, draggedLeft);

    // ── 쓰기
    if (nextScroll !== scrollLeft) container.scrollLeft = nextScroll;
    if (draggedLeft !== d.lastDraggedLeft) {
      d.lastDraggedLeft = draggedLeft;
      const el = d.els[d.fromIndex];
      el.style.transform = `translateX(${draggedLeft - d.boxes[d.fromIndex].left}px) rotate(1.5deg)`;
    }
    if (to !== d.lastTo) {
      d.lastTo = to;
      d.toIndex = to;
      const shifts = shiftFor(d.boxes, d.fromIndex, to);
      d.els.forEach((el, i) => {
        if (i === d.fromIndex) return;
        el.style.transform = shifts[i] ? `translateX(${shifts[i]}px)` : '';
      });
    }
  }, [containerRef]);
  // ref 갱신은 렌더 중이 아니라 커밋 이후에 — 렌더 중 ref 쓰기는 react-hooks/refs 위반이다.
  useEffect(() => { frameRef.current = frame; }, [frame]);

  const beginVisual = useCallback((d: Drag) => {
    document.body.style.userSelect = 'none';
    d.els.forEach((el, i) => {
      el.style.willChange = 'transform';
      if (i === d.fromIndex) {
        el.style.transition = 'none';
        el.style.opacity = '.85';
        el.style.zIndex = '30';
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,.18)';
      } else {
        el.style.transition = d.reduce ? 'none' : 'transform 150ms ease';
      }
    });
  }, []);

  const startDrag = useCallback((index: number, e: React.PointerEvent) => {
    if (drag.current || columns.length < 2) return;
    const container = containerRef.current;
    if (!container) return;
    const els = columns.map((c) => getColumnEl(c.id));
    if (els.some((el) => !el)) return;

    // 측정은 여기서 딱 한 번. 매 프레임 재측정하면 강제 동기 레이아웃이 쌓여 확실히 끊긴다.
    const cRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const boxes: ColumnBox[] = (els as HTMLElement[]).map((el, i) => {
      const r = el.getBoundingClientRect();
      return { id: columns[i].id, left: r.left - cRect.left + scrollLeft, width: r.width };
    });

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const prevScrollBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';   // 자동 스크롤이 부드러운 스크롤 설정과 싸우지 않게

    const d: Drag = {
      fromIndex: index,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      clientX: e.clientX,
      grabOffset: e.clientX - cRect.left + scrollLeft - boxes[index].left,
      containerLeft: cRect.left,
      containerWidth: cRect.width,
      prevScrollBehavior,
      boxes,
      els: els as HTMLElement[],
      active: false,
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      toIndex: index,
      lastTo: index,
      lastDraggedLeft: NaN,
      raf: null,
      lastT: 0,
    };
    drag.current = d;

    const move = (ev: PointerEvent) => {
      const cur = drag.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      cur.clientX = ev.clientX;   // 좌표만 저장. 계산과 DOM 쓰기는 rAF에서 프레임당 1회.
      if (!cur.active && Math.abs(ev.clientX - cur.startClientX) >= ACTIVATION_PX) {
        cur.active = true;
        beginVisual(cur);
        cur.lastT = performance.now();
        cur.raf = requestAnimationFrame(frame);
      }
    };
    // move와 같은 패턴으로 pointerId를 검사한다. 검사가 없으면 멀티터치 기기에서
    // 무관한 두 번째 손가락을 뗄 때 진행 중인 드래그가 조기에 끝나고 저장까지 된다.
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      finish(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      finish(false);
    };
    const key = (ev: KeyboardEvent) => {
      // 끌다가 마음이 바뀌는 것은 흔한 일이다. 되돌릴 길이 없으면 애초에 시도하지 않는다.
      if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    };
    handlers.current = { move, up, cancel, key };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  }, [columns, containerRef, getColumnEl, beginVisual, frame, finish]);

  const moveByKeyboard = useCallback((index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= columns.length) return;
    const id = columns[index].id;
    onCommit(arrayMove(columns.map((c) => c.id), index, to));
    // 위치 변화 안내는 여기서 하지 않는다 — 그립이 role="slider"라 aria-valuetext가 바뀌면
    // 스크린리더가 자동으로 읽는다. 별도 안내 채널을 두면 같은 내용이 두 번 읽힌다.
    // 재렌더 뒤에 옮겨간 컬럼을 화면에 보이게 한다
    requestAnimationFrame(() => getColumnEl(id)?.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' }));
  }, [columns, getColumnEl, onCommit]);

  return { startDrag, moveByKeyboard };
}
