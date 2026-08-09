// UUID 형식 가드 — 형식이 아니면 DB까지 가기 전에 끊는다 (postgres 22P02 → 500 방지).
// tweetStore의 파일-로컬 정의를 공용으로 승격한 것.
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(id: string): boolean {
  return UUID_RE.test(id);
}
