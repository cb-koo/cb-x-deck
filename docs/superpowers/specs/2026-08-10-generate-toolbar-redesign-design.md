# /generate 툴바 재설계 설계 (2026-08-10, 워크벤치 7차)

## 배경

6차까지 헤더에 컨트롤 5종(뷰 세그먼트·상태 탭·클라이언트·검색·시술·기간)이 누적되며 정렬·크기가 흐트러짐(사용자 피드백: 정렬 불량·필드 과소·기간 캘린더 요구). 리서치(`~/claude-outputs/20260810-generate-toolbar-research.md`)로 방향 확정, 시안 승인됨.

## 확정 구조

### 2행 툴바 (사이 hairline)
- **1행 "무엇을 보나"**: 뷰 세그먼트 | 세로 hairline | 상태 탭+건수 … 클라이언트 셀렉트(우측 끝) — 현재의 DraftFilterBar 배치 유지. 칸반에선 탭이 빠져도(세그먼트|hairline|…|클라이언트) 정렬 유지.
- **가로 hairline** (border-t, x-border)
- **2행 "어떻게 좁히나"**: 검색(좌측, 최광폭 — flex-1 + max-w-[360px], 🔍 없이 placeholder로 대상 명시) + 시술 셀렉트 + 기간 버튼.

### 32px(h-8) 높이 레일 통일
전 컨트롤(세그먼트 버튼·상태 알약·클라이언트/시술 셀렉트·검색 인풋·기간 버튼) `h-8` + `text-[13px]`. 모서리는 종류별 유지(세그먼트 rounded-lg / 탭 pill / 인풋·셀렉트 rounded-md). DraftFilterBar의 탭·셀렉트도 h-8로 조정(로직 불변).

### 기간: 트리거 버튼 + 팝오버 (신규 컴포넌트 PeriodPicker)
- 값 모델 확장: `type PeriodValue = { kind: 'preset'; preset: 'all'|'today'|'7d'|'30d' } | { kind: 'range'; from: string; to: string }` (from/to = 'YYYY-MM-DD').
- 트리거 버튼 라벨 = 현재 값 표기: "전체 기간" / "오늘" / "최근 7일" / "최근 30일" / "8.1 – 8.10"(range). aria-haspopup·aria-expanded.
- 팝오버: 프리셋 버튼 4개(현재 값 하이라이트) + 구분선 + "직접 지정" 라벨 + 네이티브 `<input type="date">` 2개(시작·끝). 프리셋 클릭=즉시 적용+닫힘, 날짜는 둘 다 채워지면 적용(팝오버는 유지 — 연달아 조정 가능), 바깥 클릭·Esc 닫힘.
- **팝오버 폭: 날짜 입력 2개가 절대 잘리지 않게** — `min-w-[300px]`, date input은 각 `w-full`(세로 배치) 또는 잘림 없는 고정폭. 시안 피드백 반영 사항.
- range 해석: from의 로컬 자정 ≤ createdAt < to+1일의 로컬 자정(양끝 포함). from만 있으면 이후 전부, to만 있으면 이전 전부. from > to면 적용하지 않고 안내 캡션("시작이 끝보다 늦어요").
- 커스텀 캘린더 그리드는 백로그 — 브라우저 네이티브 캘린더 사용(내부 도구 관례, 리서치 출처 3곳 일치).

## 로직 변경

- draftViews: `applyPeriod(list, value: PeriodValue, now): T[]` — preset이면 기존 filterByPeriod 위임, range면 경계 규칙대로. `formatPeriodLabel(value): string`(트리거 라벨, "M.D – M.D"). 단위 테스트(경계 포함·역전 range·단측 range).
- page.tsx: `period` 상태를 `PeriodValue`로 교체(초기 `{kind:'preset', preset:'all'}`), scoped 체인·lensRef·revealIfHidden 리셋도 PeriodValue로. 기존 `filterByPeriod`·`Period` 타입은 applyPeriod 내부용으로 유지.
- 세션 렌즈 정책(저장 안 함) 유지.

## 검증

- applyPeriod·formatPeriodLabel 단위 테스트, tsc 0, lint 24 기준선, 전체 회귀. 화면은 사용자 dev 검수(정렬·32px 레일·팝오버 잘림 없음 중점).

## 범위 제외 (백로그)

- 커스텀 캘린더 그리드(범위 하이라이트), 적용된 필터 칩+전체 초기화 행, 저장된 뷰, 필터-인-서치 토큰 구문
