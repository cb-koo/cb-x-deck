# 클라이언트 페이지 백로그 2건 설계 (마지막 수정 표기 · 전환 유실 가드)

2026-08-09 · 본편: `2026-08-09-clients-page-redesign-design.md`의 백로그 후속.

## 검토에서 바로잡은 것

본편 스펙은 "사이드바로 다른 페이지 이동(클라이언트 사이드 라우팅)은 beforeunload가 걸리지 않는다"고
적었으나 **사실이 아니다** — Sidebar의 페이지 링크는 전부 일반 `<a href>`(하드 내비게이션)라
이미 배포된 beforeunload가 브라우저 경고로 잡는다. 클라이언트 사이드 이탈 경로는
**워크스페이스 `<select>` 전환(`router.push(swapWorkspacePath(...))`) 하나뿐**이다.
따라서 Next 라우터 차단 장치는 불필요하고, 이 한 지점만 가드한다.

## A. 마지막 수정 표기 (`client.updated_at`)

- **마이그레이션 `020_client_updated_at.sql`** (재실행 안전):
  `add column if not exists` → `update ... set updated_at = created_at where updated_at is null`
  → `set default now()` → `set not null`. 기존 코드는 이 컬럼을 모르므로 배포 전 선적용 안전.
- **갱신 시점**: `updateClient`(정보·이름·금지 표현) + 시술 추가/수정/삭제(부모 클라이언트를 touch).
  카드 표기가 클라이언트 단위이므로 시술 변경도 "이 클라이언트가 최근 손질됐다"에 포함.
  누가 수정했는지(멤버 귀속)는 범위 밖 — 필요해지면 별도 컬럼.
- **표기**: 좌측 rail 캡션에 `시술 N · 금지 N · 오늘 수정` 형식으로 추가.
- **relTime 공용화**: workspaces/page.tsx의 로컬 relTime을 `src/lib/relTime.ts`로 추출,
  `relTime(iso, suffix, now?)` (시계 주입은 테스트용). **미래 시각이 `-1일 전`으로 찍히던
  workspaces 백로그 버그를 `d <= 0 → 오늘`로 함께 수정.**

## B. 워크스페이스 전환 유실 가드 (`navGuard`)

- `src/lib/navGuard.ts`: 페이지가 가드를 등록하는 최소 모듈.
  `setNavGuard(fn): cleanup` / `interceptNav(href): boolean` — 가드가 true를 돌려주면
  호출측은 이동을 중단하고, 가드(clients 페이지)가 확인 모달과 후속 이동을 책임진다.
- Sidebar select: 이동 전 `interceptNav(target)` 확인, 차단되면 `e.target.value`를 원복
  (controlled select의 DOM 어긋남 방지).
- clients 페이지: 기존 `pendingId`(클라이언트 전환)를
  `pending: {kind:'client';id} | {kind:'href';href}`로 통합 — 모달·버튼 로직은 그대로,
  "이동" 실행만 kind에 따라 `applySelect` / `router.push`.

## 검증

- `relTime`·`navGuard`: 순수 모듈 단독 테스트 / `clientStore`: 실 DB 테스트에 updated_at 갱신 케이스 추가
  (비교는 벽시계 경합을 피해 `now() - interval '1 hour'`로 되돌린 뒤 갱신 확인).
- lint 기준선 24 · tsc · build. 화면 확인은 사용자(OAuth 게이팅).
