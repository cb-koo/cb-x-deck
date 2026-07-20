# 웹 배포 + 구글 로그인(회사 도메인 자동 허용) — 설계

날짜: 2026-07-20 · 상태: 설계(승인 대기) · 요청: 박구건 — "MVP 완성, 팀원과 웹으로 공유"

## 목표

MVP를 팀원이 웹에서 함께 쓰도록 배포한다. 단, URL만 알면 아무나 들어와 **유료 API(Anthropic·Exa·getxapi)를 과금**시키거나 클라이언트 리서치 데이터를 보는 것을 막기 위해 최소 접근통제를 붙인다.

접근통제 정책(확정):
- **구글 로그인** 필수.
- **@clinicbridge.co.kr 메일은 자동 허용**(승인 대기 없이 바로 사용).
- 그 외 메일은 **차단**(승인 화면만 표시). 외부 승인·관리자 기능은 이번 범위에서 제외하고 백로그로 미룬다.

## 범위

**포함(이번 작업)**
- Supabase Auth 기반 구글 OAuth 로그인 (`@supabase/ssr`로 Next.js 16 세션 처리).
- `/login` — 구글 로그인 버튼 하나짜리 화면.
- `middleware.ts` — 미로그인 → `/login`, 로그인했으나 비허용 도메인 → `/denied`.
- **모든 `/api/*` 라우트에서 서버 측 재검증** (허용 도메인 세션인지). 미들웨어만 신뢰하지 않는다.
- `/denied` — "회사 계정으로만 접근할 수 있어요" 안내 화면(로그아웃 버튼 포함).
- Vercel 배포 + 환경변수 등록 + 배포 검증.

**제외(백로그 — 아래 "작업 예정" 참조)**
- 관리자(`/admin`) 화면, 외부 사용자 개별 승인 플로우, 관리자 지정 기능, 승인 상태(pending/active/denied) DB 관리.

## 접근 흐름

```
방문
 └─ 세션 없음 ──────────────→ /login (구글로 로그인)
      └─ 구글 로그인 성공
           ├─ 메일 @clinicbridge.co.kr ─→ 통과 → 앱 사용
           └─ 그 외 메일 ──────────────→ /denied ("회사 계정만 가능")
```

## 아키텍처

- 커스텀 인증 서버 없음. **Supabase Auth**가 구글 OAuth·세션·토큰 갱신을 담당.
- `@supabase/ssr`로 서버 컴포넌트·라우트 핸들러·미들웨어에서 쿠키 기반 세션을 읽는다.
- 신규 파일(예정):
  - `src/lib/supabase/server.ts` — 서버용 Supabase 클라이언트(쿠키 연동).
  - `src/lib/supabase/middleware.ts` — 세션 갱신 헬퍼.
  - `src/lib/authGuard.ts` — `requireAllowedUser()`: 세션 없음/비허용 도메인이면 401 반환. 모든 API 라우트 진입부에서 호출.
  - `middleware.ts`(루트) — 페이지 레벨 게이팅 + 세션 갱신.
  - `src/app/login/page.tsx`, `src/app/auth/callback/route.ts`, `src/app/denied/page.tsx`.

허용 도메인은 상수 `ALLOWED_EMAIL_DOMAIN = 'clinicbridge.co.kr'`로 한 곳에 둔다(코드/설정 일치 원칙).

## 데이터 모델

**MVP는 인증용 신규 테이블 없음.** 허용 여부는 세션 이메일의 도메인만으로 판정한다(Supabase가 사용자 자체는 관리). 승인 상태를 저장할 `app_user` 테이블은 외부 승인 기능이 필요해지는 백로그 단계에서 도입한다.

기존 `member` 개념(워크스페이스 "봤음" 추적)은 **로그인 사용자와 별개**로 유지한다. 로그인 사용자를 `member`에 자동 매핑하는 것은 별도 제품 결정이라 이번 범위 밖(백로그에 메모).

## 게이팅(핵심 — 과금 차단)

두 겹으로 막는다:
1. `middleware.ts`: 페이지 접근 시 세션·도메인 확인 후 리다이렉트. (UX용)
2. `src/lib/authGuard.ts`의 `requireAllowedUser()`: **모든 API 라우트가 직접 호출**해 비허용 요청에 401. (실질 보안·과금 차단)

유료 API를 부르는 라우트(`/api/research/*`, `/api/suggest-keywords`, `/api/translate-*`, `/api/columns/[id]/refresh` 등)는 특히 이 가드가 없으면 무의미하므로 전 라우트 일괄 적용을 회귀 관점에서 점검한다.

## 오류 처리

- 로그인 실패/취소: `/auth/callback`에서 에러면 `/login?error=...`로 돌려보내고 사용자 언어로 안내(내부 개념어 노출 금지).
- 세션 만료: 미들웨어가 갱신 시도, 실패 시 `/login`.
- API 비인가: JSON `{ error: '로그인이 필요합니다' }` + 401. 클라이언트는 401 감지 시 `/login`으로 유도.

## 배포

- 호스트: **Vercel**. DB는 **지금 쓰는 Supabase 그대로**(옮기지 않음).
- 환경변수(Vercel에 등록): `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `GETXAPI_KEY`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. 추가로 클라이언트에서 쓰는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- 순서(닭-달걀 해소): ① Vercel에 먼저 배포해 도메인 확보 → ② 그 도메인을 구글 OAuth 리다이렉트 URI·Supabase Auth redirect URL에 등록 → ③ 재배포/검증.
- 마이그레이션: 이번 범위는 신규 테이블이 없으므로 DB 변경 없음.

### 박구건님이 콘솔에서 직접 하셔야 하는 것(제가 대신 못 함 — 구현 시 스텝별 안내)
1. Google Cloud Console — OAuth 클라이언트 생성(client ID/secret), 승인된 리다이렉트 URI 등록.
2. Supabase 대시보드 — Authentication → Google provider 켜고 client ID/secret 입력, Site URL·Redirect URL 등록.
3. Vercel — 계정 로그인/프로젝트 연결, 환경변수 입력.

## Next.js 16 주의

이 저장소의 Next.js 16은 학습 데이터와 다를 수 있음(AGENTS.md). 구현 전 `node_modules/next/dist/docs/`에서 미들웨어·라우트 핸들러·쿠키 API 관련 문서를 확인하고, `@supabase/ssr` 최신 통합 패턴을 따른다.

## 테스트/검증

- 회사 도메인 계정으로 로그인 → 앱 진입 성공.
- 비회사(예: 개인 gmail) 계정으로 로그인 → `/denied` 표시, 앱·API 접근 불가.
- 세션 없이 `/api/research/search` 등 직접 호출 → 401.
- 배포본에서 위 3가지를 실제 브라우저로 확인(스크린샷).

## 작업 예정(백로그 — 어드민/승인)

이번 배포 이후 별도 사이클로 진행:
- **관리자 화면 `/admin`**: 대기(pending) 사용자 목록 + 승인/거부, 전체 사용자 상태 관리. is_admin만 접근.
- **외부 사용자 개별 승인 플로우**: `app_user` 테이블(email·status·is_admin) 도입, 비회사 메일 로그인 시 `pending` 생성 → `/pending` 대기 화면 → 관리자 승인 시 `active`.
- **관리자 지정 기능**: 첫 관리자(gugeon.park) 시드 후 앱 내에서 다른 사용자를 관리자로 승격.
- **로그인 사용자 ↔ `member` 매핑** 여부 결정(자동 생성 vs 수동 유지).
