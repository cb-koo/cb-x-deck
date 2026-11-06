// 클라이언트 활성 여부(087, ISSUE-013) — 화면·서버 공용. 비활성 클라이언트는 새 작업 목록(캠페인 만들기·원고 생성·트래킹 링크·
// 확장 프로그램)에서 뺀다. 지난 캠페인·정산·성과·리포트는 그대로(리포트는 다시 기획할 때 '비활성 포함' 보기를 넣기로, koo 11-06).
export const isActiveClient = (c: { deactivatedAt: string | null }): boolean => c.deactivatedAt === null;
/** 새 작업 목록용 — 비활성은 빼되, 지금 골라져 있는 클라이언트(keepId)는 남긴다(이미 그 클라이언트인 캠페인의 선택 칸이 비지 않게). */
export function activeClientsFor<T extends { id: string; deactivatedAt: string | null }>(clients: T[], keepId?: string | null): T[] {
  return clients.filter((c) => isActiveClient(c) || c.id === keepId);
}
export const INACTIVE_CLIENT_MESSAGE = '비활성화된 클라이언트예요 — 클라이언트 화면에서 다시 활성화한 뒤 만들어 주세요';
