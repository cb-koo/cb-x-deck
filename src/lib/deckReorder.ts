// 덱 컬럼 재정렬의 순수 계산. DOM·React 의존 없음 — 그래야 자동 테스트로 검증할 수 있다.
// 좌표는 모두 '콘텐츠 좌표계'(가로 스크롤 컨테이너의 스크롤 시작점 = 0) 기준.

export type ColumnBox = { id: string; left: number; width: number };

/**
 * 잡은 컬럼의 왼쪽 끝이 draggedLeft일 때 놓일 인덱스.
 * 판정 기준은 '잡은 컬럼의 중심이 상대 컬럼의 중심을 지났는가' — 폭이 제각각이어도
 * 일관되게 동작한다. 반환값은 잡은 컬럼을 뺀 뒤 다시 끼워 넣을 위치이므로
 * arrayMove(items, fromIndex, 반환값)에 그대로 쓸 수 있다.
 */
export function dropIndex(boxes: ColumnBox[], fromIndex: number, draggedLeft: number): number {
  const center = draggedLeft + boxes[fromIndex].width / 2;
  let idx = 0;
  for (let i = 0; i < boxes.length; i++) {
    if (i === fromIndex) continue;
    if (center > boxes[i].left + boxes[i].width / 2) idx++;
  }
  return idx;
}

/** from 위치의 항목을 to 위치로 옮긴 새 배열. */
export function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const out = items.slice();
  const [moved] = out.splice(from, 1);
  out.splice(to, 0, moved);
  return out;
}

/**
 * 드래그 중 각 컬럼에 적용할 가로 이동량(px). 잡은 컬럼 자신은 0
 * (포인터를 따라 별도로 움직인다). 잡은 컬럼이 비운 자리를 나머지가 그 폭만큼 메운다.
 */
export function shiftFor(boxes: ColumnBox[], fromIndex: number, toIndex: number): number[] {
  const w = boxes[fromIndex].width;
  return boxes.map((_, i) => {
    if (i === fromIndex) return 0;
    if (fromIndex < toIndex && i > fromIndex && i <= toIndex) return -w;
    if (fromIndex > toIndex && i >= toIndex && i < fromIndex) return w;
    return 0;
  });
}

/**
 * 가장자리 자동 스크롤 속도(px/초). 음수 = 왼쪽.
 * 뷰포트 폭의 25% 지점부터 시작해 5% 지점에서 최고 속도에 닿고, 그 사이는 제곱 가속이다.
 * 픽셀 고정이 아니라 비율인 이유는 화면 크기가 달라도 같은 체감을 주기 위해서다.
 * (근거: react-beautiful-dnd 자동 스크롤 설계)
 */
export function edgeScrollVelocity(
  pointerX: number,
  viewLeft: number,
  viewWidth: number,
  max = 1700,
): number {
  const start = viewWidth * 0.25;
  const full = viewWidth * 0.05;
  const ramp = (dist: number) => {
    if (dist >= start) return 0;
    const p = Math.min(1, (start - dist) / Math.max(1, start - full));
    return p * p * max;
  };
  const left = ramp(pointerX - viewLeft);
  if (left > 0) return -left;
  return ramp(viewLeft + viewWidth - pointerX);
}
