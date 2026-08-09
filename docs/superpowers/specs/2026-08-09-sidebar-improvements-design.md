# 사이드바 개선 4건 설계 (실패 상태 · Link 전환 · 접근성 · 로그아웃)

2026-08-09 · 출발점: 좌측 메뉴 패널 UI/UX 검토에서 확정된 개선 후보 ①~④.

## 배경 — 각 항목의 문제와 의도

**① 목록 로드 실패 시 사이드바 전체가 조용히 사라짐** (`GlobalShell.tsx:20` `if (!r.ok) return`)
`/clients`·`/generate`·`/usage`·`/workspaces`에서 워크스페이스 API가 실패하면 내비게이션
수단 전체가 없어지고 실패 표시도 없다. "실패를 빈 상태로 위장하지 않는다" 원칙의 마지막 위반 지점.

**② 모든 메뉴가 하드 내비게이션(`<a href>`)**
클릭마다 전체 리로드 + 사이드바 데이터 재요청. Next `<Link>`로 SPA 전환·프리페치.
⚠️ 하드 내비게이션이었기 때문에 `/clients` 편집 유실 방지(beforeunload)가 작동하고 있었다 —
Link 전환 시 각 링크 `onNavigate`에 `interceptNav`(기존 navGuard 모듈)를 반드시 함께 연결한다.

**③ 접근성 2건**: 활성 메뉴가 볼드(시각)뿐 — `aria-current="page"` 부재 /
워크스페이스 `<select>`에 프로그램적으로 연결된 라벨 없음(위 캡션 `<p>`는 연결 안 됨).

**④ 로그아웃 부재**: 로그아웃은 `/denied` 전용. 정상 사용자는 계정 전환 불가.

## 설계

### Sidebar (`src/components/Sidebar.tsx`)

- **props 확장**: `wsId: string | null` + `wsError?: boolean` + `onRetryWs?: () => void`.
  기존 호출부(`/w/[wsId]/layout.tsx`)는 항상 string을 주므로 무변경 호환.
- **wsId가 null일 때**(로드 실패): 워크스페이스 select·워크스페이스 종속 메뉴(리서치/덱/브리핑/보관함)
  대신 그 자리에 "워크스페이스 목록을 불러오지 못했습니다" + `다시 시도` 버튼.
  전역 메뉴(콘텐츠 생성·클라이언트)·API 사용량·나 영역은 **항상 렌더**.
- **`<a>` → `<Link>` 전체 전환** (페이지 링크 6곳: nav 4 + globalNav 2 + 워크스페이스 관리 + API 사용량):
  `onNavigate={(e) => { if (interceptNav(href)) e.preventDefault(); }}`.
  가드는 현재 `/clients`만 등록하므로 다른 페이지에선 no-op.
  워크스페이스 select의 기존 가드(`e.target.value` 원복 포함)는 그대로.
- **접근성**: 활성 링크에 `aria-current="page"` / select에 `aria-label="워크스페이스 선택"`.
- **로그아웃**: "나" 영역의 멤버 이름 오른쪽에 caption 크기 `로그아웃` 버튼.
  `/denied`와 동일 패턴: `createClient()` → `supabase.auth.signOut()` → `window.location.href = '/login'`.
  전체 페이지 이탈(하드 이동)이므로 편집 중이면 beforeunload가 자연히 잡는다 — 추가 가드 불필요.
- **투어 앵커 유지**: `data-tour="sidebar"`·`nav-deck`·`nav-briefing` 그대로.

### GlobalShell (`src/components/GlobalShell.tsx`)

- 상태 3분기: 로딩(현행처럼 사이드바 생략 — 짧은 구간) / 실패(`<Sidebar wsId={null} wsError onRetryWs={load} />`) /
  성공(현행). fetch 로직을 `load` 함수로 추출해 재시도에 재사용.
- 워크스페이스 0개(정상 응답, target 없음)도 wsId null로 사이드바 렌더 — 전역 메뉴는 쓸 수 있어야 한다.
  이때 오류 문구 대신 "워크스페이스가 없습니다 → 관리에서 만들기" 안내(wsError=false 구분).

## 범위 밖 (검토에서 변경 비추천으로 확정)

메뉴 순서 변경 · API 사용량 글씨 크기 · 사이드바 접기(트리거 조건부) · 시안 생략
(시각 변화가 오류 문구·로그아웃 링크 수준이라 텍스트 스펙으로 충분 — 화면 확인 단계에서 조정).

## 검증

- 컴포넌트 하네스 없음 → tsc·lint(기준선 24)·build + 사용자 화면 확인.
- 화면 확인 핵심: Link 전환 후에도 `/clients` 편집 중 사이드바 이동 시 보호가 작동하는가
  (이제 브라우저 경고가 아니라 **앱 모달**로 뜬다 — 더 나은 UX), 실패 상태(네트워크 차단으로 재현),
  로그아웃 → /login 왕복.
