# 워크스페이스 전환 시 보던 화면 유지 설계

날짜: 2026-08-09 · 상태: 사용자 승인됨 ("보던 화면 전체 유지" 선택)

## 배경

사이드바 select 전환이 무조건 `/w/{id}`(덱 카드 보기)로 보낸다 — 표 보기(?view=table)도, 보관함·리서치·브리핑 화면도 전환하면 덱으로 떨어진다.

## 동작

- 전환 시 현재 경로의 `/w/{wsId}` 부분만 새 id로 치환, 하위 경로·쿼리 보존:
  - `/w/A?view=table` → `/w/B?view=table` / `/w/A/library` → `/w/B/library` / `/w/A/research?q=x` → `/w/B/research?q=x`
- 워크스페이스 밖 경로(`/generate`·`/clients`·`/usage`·`/workspaces`)에서 전환: 기존대로 `/w/{id}` (대응 화면 없음).
- 하위 경로 4종(덱·리서치·브리핑·보관함)은 전 워크스페이스에 존재 — 없는 조합 없음. 옛 `/w/{id}/usage`는 redirect 스텁이 `/usage`로 처리.

## 구현 구조

- 순수 함수 `swapWorkspacePath(pathname: string, search: string, wsId: string): string` — `src/lib/wsNav.ts` 신설(테스트 가능하게 lib 분리 — 저장소 관례). `search`는 `window.location.search` 형식(선행 `?` 포함 또는 빈 문자열).
- `Sidebar.tsx` select onChange 한 줄이 이 함수를 호출.

## 테스트

`src/lib/wsNav.test.ts` (DB 불필요): 덱 루트 / ?view=table / /library / /research?q=x / 전역 경로(/generate, /workspaces) 폴백.
