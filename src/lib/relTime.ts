// 카드 메타의 상대 시각 표기 — "오늘 활동", "3일 전 수정" 형식.
// now 인자는 테스트용 시계 주입. 미래 시각(서버·로컬 시계 오차)은 음수 일수 대신 '오늘'로 처리한다.
export function relTime(iso: string, suffix: string, now: number = Date.now()): string {
  // 해석 불가한 값이면 아무 말도 하지 않는다 — 그냥 두면 'NaN달 전 수정'이 화면에 찍힌다.
  // 모르는 것을 틀리게 말하느니 안 말하는 편이 낫다.
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const d = Math.floor((now - t) / 86400000);
  if (d <= 0) return `오늘 ${suffix}`;
  if (d < 7) return `${d}일 전 ${suffix}`;
  if (d < 30) return `${Math.floor(d / 7)}주 전 ${suffix}`;
  return `${Math.floor(d / 30)}달 전 ${suffix}`;
}
