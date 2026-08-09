// 카드 메타의 상대 시각 표기 — "오늘 활동", "3일 전 수정" 형식.
// now 인자는 테스트용 시계 주입. 미래 시각(서버·로컬 시계 오차)은 음수 일수 대신 '오늘'로 처리한다.
export function relTime(iso: string, suffix: string, now: number = Date.now()): string {
  const d = Math.floor((now - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return `오늘 ${suffix}`;
  if (d < 7) return `${d}일 전 ${suffix}`;
  if (d < 30) return `${Math.floor(d / 7)}주 전 ${suffix}`;
  return `${Math.floor(d / 30)}달 전 ${suffix}`;
}
