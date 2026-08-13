import type { DraftStatus } from './draftStatus.ts';

// 칸반은 "지금 할 일" 보드다(설계 §F). 상태 축은 원래 진행도 라벨이라
// draft→review→approved는 아직 할 일이 남은 상태이고, delivered·unused는 결정이 끝난 종착이다.
// 종착 상태는 시간이 갈수록 쌓이기만 한다 — 1년 뒤 '전달됨' 열의 900장을 스크롤할 일은 없고,
// 그건 검색·정렬을 가진 표 뷰가 할 일이다.
export const KANBAN_ACTIVE: DraftStatus[] = ['draft', 'review', 'approved'];
export const KANBAN_DONE: DraftStatus[] = ['delivered', 'unused'];

export function isDoneColumn(status: DraftStatus): boolean {
  return (KANBAN_DONE as string[]).includes(status);
}

// 열마다 그리는 상한. 종착 열이 작은 것은 "여기는 확인용 창구"라는 뜻이고,
// 그래서 종착 열에는 표 뷰로 데려가는 버튼이 함께 붙는다(설계 §F).
export function columnLimit(status: DraftStatus): number {
  return isDoneColumn(status) ? 10 : 50;
}

// 방금 드래그로 옮긴 카드를 열 맨 앞에 세운다.
//
// 이게 없으면: 열은 최신순으로 정렬되는데(groupByStatus) 상위 N장만 그리므로,
// 3개월 된 원고를 '전달됨'으로 떨구는 순간 그 카드는 200번째쯤으로 정렬돼 화면에서 사라진다.
// 사용자에겐 "옮겼는데 없어졌다"이다(설계 §H). 실제 칸반 도구들이 드롭한 자리에 카드를
// 남겨두는 것과 같은 처리다.
//
// 고정끼리는 원본 순서를 유지한다 — 여러 장을 옮겼을 때 서로 자리가 뒤바뀌면 그것도 놀라움이다.
export function orderColumn<T extends { id: string }>(rows: T[], pinnedIds: ReadonlySet<string>): T[] {
  if (pinnedIds.size === 0) return [...rows];
  const pinned = rows.filter((r) => pinnedIds.has(r.id));
  const rest = rows.filter((r) => !pinnedIds.has(r.id));
  return [...pinned, ...rest];
}
