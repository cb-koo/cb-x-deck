// 표 뷰 다중 선택의 계산 — 순수 함수로 두는 이유는 컴포넌트 테스트 하네스가 없기 때문이다.
// 규칙 하나가 전부를 지배한다: "보이지 않는 것은 건드리지 않는다". 필터에 걸려 화면에 없는 원고가
// 전체 선택·전체 해제에 휩쓸리면, 사용자가 보지 못한 원고가 함께 지워진다.

export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function allSelected(selected: ReadonlySet<string>, visibleIds: string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
}

export function toggleAll(selected: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const next = new Set(selected);
  if (allSelected(selected, visibleIds)) visibleIds.forEach((id) => next.delete(id));
  else visibleIds.forEach((id) => next.add(id));
  return next;
}

// 필터·검색이 바뀌거나 목록이 갱신됐을 때 — 더 이상 보이지 않는 선택을 떨군다.
export function pruneSelection(selected: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}

// 함께 선택된 형제 시안(같은 batchId)의 최대 개수. 2 이상이면 일괄 배정 전에 경고한다 —
// "배정 단위는 시안 하나"라는 원칙(draftStore.ts influencer_handle 주석)이 깨지는 순간이기 때문이다.
// batchId가 null인 초안들은 단일 생성이라 서로 형제가 아니다.
export function siblingWarning(
  rows: Array<{ id: string; batchId: string | null }>, selectedIds: ReadonlySet<string>,
): number {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.batchId === null || !selectedIds.has(r.id)) continue;
    counts.set(r.batchId, (counts.get(r.batchId) ?? 0) + 1);
  }
  return selectedIds.size === 0 ? 0 : Math.max(1, ...counts.values(), 1);
}
