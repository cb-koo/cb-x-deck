// 사이드바 워크스페이스 전환 시 목적지 계산 — 보던 화면(하위 경로·쿼리)을 유지한다.
// 예전엔 무조건 /w/{id}로 보내 표 보기·보관함 등에서 전환하면 덱으로 떨어졌다 (전환 유지 스펙).
const WS_PATH_RE = /^\/w\/[^/]+/;

/**
 * @param pathname 현재 경로 (usePathname)
 * @param search   현재 쿼리 — window.location.search 형식(선행 '?' 포함) 또는 ''
 * @param wsId     이동할 워크스페이스 id
 */
export function swapWorkspacePath(pathname: string, search: string, wsId: string): string {
  // 워크스페이스 밖 화면(/generate 등)엔 대응 화면이 없다 — 새 워크스페이스의 덱으로
  if (!WS_PATH_RE.test(pathname)) return `/w/${wsId}`;
  const nextPath = pathname.replace(WS_PATH_RE, `/w/${wsId}`);
  return search ? `${nextPath}${search}` : nextPath;
}
