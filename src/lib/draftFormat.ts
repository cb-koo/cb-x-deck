import type { DraftFormat } from './draftTypes.ts';

// 칸 수에서 형식을 파생한다. format 컬럼을 실제 칸 수와 맞춰두지 않으면 표시가 아니라 동작이 깨진다 —
// generate.ts의 다시쓰기가 draft.format을 프롬프트에 넣고 'single'이면 결과를 1칸으로 잘라내기 때문에,
// 손으로 늘린 칸이 다시쓰기 한 번에 사라진다(설계 §E).
export function formatForPosts(count: number): DraftFormat {
  return count > 1 ? 'thread' : 'single';
}

// 칸 추가·삭제는 텍스트 배열과 미디어 배열에 똑같이 적용돼야 한다(둘의 길이가 어긋나면
// edited JSON이 깨진다). 그래서 배열 종류를 가리지 않는 제네릭으로 둔다.
export function addSlot<T>(arr: T[], empty: T): T[] {
  return [...arr, empty];
}

export function removeSlot<T>(arr: T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return [...arr];
  return arr.filter((_, i) => i !== index);
}
