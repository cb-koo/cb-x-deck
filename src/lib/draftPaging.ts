// 화면에 그리는 개수의 계산 — 데이터를 자르는 것이 아니라 '그리는 양'만 자른다(설계 §A).
// 통신은 병목이 아니다(1000건 gzip 450KB). 병목은 카드 500장이 한 번에 DOM에 올라가는 쪽이다.

export const PAGE_STEP = 50; // '더 보기' 한 번에 늘어나는 개수

// 목록 조회 상한. 라우트(서버)와 안내 문구(클라이언트)가 같은 수를 봐야 한다 —
// 두 곳에 따로 적으면 한쪽만 바뀌었을 때 "1000건만 보고 있어요"가 거짓말이 된다.
export const LIST_CAP = 1000;

// 아직 안 그린 개수. 이 수를 버튼에 적는 것이 이 설계의 핵심이다 —
// 지금의 진짜 문제는 잘리는 것이 아니라 잘렸다는 걸 아무도 모르는 것이다(설계 §C).
export function remaining(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

// 서버가 상한 개수를 꽉 채워 돌려줬다 = 더 있을 수 있다. 정확히 상한과 같을 때도 참이 되지만
// 안내 문구("최근 N건만 보고 있어요")가 그 경우에도 사실이라 해롭지 않다(설계 §B).
export function atCap(loaded: number, cap: number): boolean {
  return loaded >= cap;
}
