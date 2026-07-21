// 투어 '본 여부'를 브라우저 localStorage에 저장한다.
// 브라우저=실사용자(도메인 게이팅 OAuth) 기준이라 멤버별 DB 추적 없이 충분.
const KEY_PREFIX = 'tour-seen:';

export function hasSeenTour(id: string): boolean {
  if (typeof window === 'undefined') return true; // SSR: 자동시작 방지 위해 '본 것'으로 취급
  try {
    return localStorage.getItem(KEY_PREFIX + id) === '1';
  } catch {
    return true;
  }
}

export function markTourSeen(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY_PREFIX + id, '1');
  } catch {
    /* 사파리 프라이빗 모드 등 — 조용히 무시 */
  }
}

export function resetTourSeen(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    /* 무시 */
  }
}
