// 제자리 수정(2026-09-07 스펙 §2) 전환 스위치 — 환경 변수 한 곳에서만 읽는다.
// 꺼짐(기본): 외부 API는 옛 의미(revision 0 요청/1 취소, revised_at null), 상태 POST의 revision 무시, 수정 기능 닫힘.
// 켜짐: revision = 수정 횟수, revised_at 노출, 상태 POST revision 필수(불일치 409), 요청 내역에 [고친 값으로 다시 반영].
// 우리가 먼저 배포(꺼짐) → 그쪽 배포 → 슬랙으로 시각 합의 → 운영·스테이징 env에 on + 재배포.
export function isRevisionV2(): boolean {
  return process.env.SETTLEMENT_REVISION_V2 === 'on';
}

// 테스트 전용 — 스위치 양쪽을 한 프로세스에서 본다. 동기 콜백만(비동기 테스트는 직접 env를 바꾸고 finally로 복구).
export function withRevisionV2<T>(on: boolean, fn: () => T): T {
  const prev = process.env.SETTLEMENT_REVISION_V2;
  process.env.SETTLEMENT_REVISION_V2 = on ? 'on' : 'off';
  try { return fn(); } finally { if (prev === undefined) delete process.env.SETTLEMENT_REVISION_V2; else process.env.SETTLEMENT_REVISION_V2 = prev; }
}
