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

// relTime과 같은 목적이지만 하루 이내를 시/분 단위까지 쪼갠다("방금", "5분 전", "3시간 전") —
// 추적 표의 '측정' 열처럼 사용자가 "얼마나 최신인지"를 보고 API 호출(새로고침) 여부를 판단하는
// 화면엔 하루 단위(relTime)가 너무 뭉툭하다. 원래 Column.tsx의 lastRefreshedLabel을 그대로 옮긴 것.
export function relTimeFine(iso: string, suffix: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.floor((now - t) / 60000);
  if (min < 1) return `방금 ${suffix}`;
  if (min < 60) return `${min}분 전 ${suffix}`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전 ${suffix}`;
  return `${Math.floor(min / 1440)}일 전 ${suffix}`;
}
