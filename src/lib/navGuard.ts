// 클라이언트 사이드 내비게이션 가드 — 편집 중 유실 방지용.
//
// 사이드바의 페이지 링크(Link)는 onNavigate에서, 워크스페이스 <select> 전환은 onChange에서
// 각각 interceptNav()를 부른다 — 둘 다 클라이언트 라우팅이라 브라우저의 beforeunload 경고를
// 우회하기 때문이다. 편집 화면(예: /clients)이 가드를 등록한다.
//
// 가드가 true를 돌려주면 호출측은 이동을 중단한다 — 확인 모달과 후속 이동(저장하고 이동 등)은
// 가드를 등록한 쪽의 책임이다.
type Guard = (href: string) => boolean;

let current: Guard | null = null;

export function setNavGuard(guard: Guard): () => void {
  current = guard;
  return () => { if (current === guard) current = null; };
}

export function interceptNav(href: string): boolean {
  return current?.(href) ?? false;
}
