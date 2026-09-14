// 프로필 3구역 탭 — 상태는 URL(?tab=)이 단일 출처(스펙 §2). 여기엔 DOM 없는 순수 로직만.
// ?i=(명부 선택)와 같은 URL에 공존하므로, 쓰기는 반드시 mergeQuery로 — 한쪽이 상대를 지우면
// 탭이 사라지거나(i만 쓴 경우) 프로필이 통째로 사라진다(tab만 쓴 경우).
export type TabKey = 'account' | 'content' | 'deal';
export const TAB_KEYS: readonly TabKey[] = ['account', 'content', 'deal'];
export const TAB_LABEL: Record<TabKey, string> = {
  account: '계정 정보', content: '협업 콘텐츠', deal: '거래 정보',
};
export const DEFAULT_TAB: TabKey = 'account';

export function parseTab(v: string | null | undefined): TabKey {
  return (TAB_KEYS as readonly string[]).includes(v ?? '') ? (v as TabKey) : DEFAULT_TAB;
}

// 선례: src/app/w/[wsId]/library/page.tsx setTweetView — 복사 → set/delete → 비면 pathname만
export function mergeQuery(current: string, patch: Record<string, string | null>): string {
  const p = new URLSearchParams(current);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) p.delete(k); else p.set(k, v);
  }
  return p.toString();
}

// 기본 탭(account)은 파라미터 없음으로 표현한다 — "없음 = 계정 정보"가 곧 규칙
export function tabQuery(current: string, tab: TabKey): string {
  return mergeQuery(current, { tab: tab === DEFAULT_TAB ? null : tab });
}
