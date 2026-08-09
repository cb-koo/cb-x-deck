// 클라이언트 사이드 내비게이션 가드 — 편집 중 유실 방지용.
//
// 사이드바의 페이지 링크는 전부 일반 <a>(하드 내비게이션)라 beforeunload가 잡지만,
// 워크스페이스 <select> 전환은 router.push(클라이언트 라우팅)라 브라우저 경고를 우회한다.
// 그 지점이 이동 전에 interceptNav()를 부르고, 편집 화면(예: /clients)이 가드를 등록한다.
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
