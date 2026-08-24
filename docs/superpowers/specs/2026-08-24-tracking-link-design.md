# 트래킹 링크 생성기 v1 설계 (2026-08-24)

## 목적

인플루언서에게 원고를 전달할 때 **함께 게시를 요청할 랜딩페이지 링크**를 만든다.
링크에는 UTM이 반자동으로 붙어(어느 인플·어느 콘텐츠에서 온 유입인지 랜딩 쪽 분석 도구에서 식별),
short.io로 단축돼 전달하기 좋은 형태가 되며, 클릭 수는 앱 안에서 확인한다
(서비스를 옮겨다니는 전환 비용을 없애고, 트윗 반응 등 다른 데이터와 한 화면 맥락에서 보기 위해 — koo 확정).

기존 콘텐츠 트래킹 v1(게시물=트윗 반응)과 상보 관계: 게시물 트래킹은 "노출·반응", 링크 트래킹은 "랜딩 유입".
둘 다 `draft_id`·`influencer_handle` 같은 연결 키를 쓰므로 향후 원고 단위 통합 뷰를 스키마 변경 없이 만들 수 있다.

## 확정된 결정 (브레인스토밍 Q&A)

| 결정 | 내용 |
|---|---|
| 생성 진입점 | **둘 다** — 원고(DraftCard)에서 자동 채움 생성 + 트래킹 페이지에서 독립 생성 |
| UTM 구성 | **표준형** — `utm_source=x` · `utm_medium=influencer` · `utm_campaign`(자동 제안+수정) · `utm_content={핸들}-{code}` |
| short.io | 계정·도메인 보유. **REST API 직접 호출**(SDK 안 씀 — 아래 근거) |
| 클릭 통계 | **앱 안에서, append-only 스냅샷**(C안) — 새로고침마다 이력 한 줄 추가, 게시물 지표와 대칭 |
| 캠페인명 | 클라이언트명+월로 자동 제안(예: `클리닉A-202609`), 입력란에서 수정 가능 |
| 랜딩 URL | **둘 다** — client에 기본 URL 저장 + 생성 시 덮어쓰기 가능 |
| 화면 위치 | **/tracking 안 세그먼트** `[게시물 | 링크]` — 성과 추적이라는 한 주제, 사이드바 항목 추가 없음 |
| 삭제 정책 | 앱 행 삭제해도 **short.io 링크는 살려둔다** — 인플이 이미 게시한 링크가 죽으면 사고 (koo 확정) |
| 수정 정책 | **링크 수정 불가, 새로 만들기만** — 전달된 링크의 목적지가 바뀌는 상황 원천 차단 |

## v1 범위

- 링크 생성(랜딩 URL 검증 → UTM 조립 → short.io 단축 → 저장) / 목록 표 / 행별·전체 클릭 새로고침 / 행 펼침 클릭 이력 / 행 삭제
- DraftCard "트래킹 링크" 섹션(그 원고의 링크 목록 + 만들기)
- client에 기본 랜딩 URL 필드 + 클라이언트 관리 화면 입력란
- 클릭 갱신은 전부 사람이 누를 때만(opt-in — 게시물 트래킹과 동일). cron 없음

## 데이터 모델 — `migrations/028_tracking_link.sql`

```sql
create table if not exists tracking_link (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,  -- 6자 소문자 영숫자. 세 곳을 잇는 축:
                                          -- 단축 경로(cb.link/{code}) = utm_content 꼬리 = 이 행.
                                          -- GA에서 본 utm_content로 앱의 링크·원고 역추적 가능
  landing_url      text not null,         -- UTM 붙기 전 원본
  long_url         text not null,         -- UTM 붙은 최종 URL 스냅샷 — 조립 규칙이 바뀌어도 과거 링크 재현
  short_url        text not null,         -- https://{SHORTIO_DOMAIN}/{code}
  shortio_link_id  text not null,         -- short.io 링크 ID(idString) — 통계 조회 키
  utm_campaign     text not null,
  influencer_handle text not null,        -- 핸들 자연키 (draft.influencer_handle 관례)
  draft_id         uuid references draft(id) on delete set null,   -- 선택 연결(원고 삭제돼도 링크·클릭 기록 유지)
  client_id        uuid references client(id) on delete set null,
  client_name      text,                  -- 스냅샷 관례(014 선례)
  created_by       uuid references member(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_tracking_link_draft on tracking_link (draft_id);

-- 클릭은 덮어쓰지 않고 측정마다 한 줄(post_metric_snapshot과 대칭 — koo가 C안 확정:
-- short.io에 이력이 있어도 데이터 확인을 위해 서비스를 옮겨다니는 전환 비용이 크고,
-- 다른 데이터와의 관계를 보려면 우리 DB에 있어야 한다)
create table if not exists link_click_snapshot (
  id               uuid primary key default gen_random_uuid(),
  tracking_link_id uuid not null references tracking_link(id) on delete cascade,
  total_clicks     int,                   -- nullable — 출처 결손 허용(지표 스냅샷 관례)
  human_clicks     int,                   -- 봇 제외 클릭(short.io 제공 시)
  raw              jsonb,                 -- 원본 API 응답 — 재수집 없이 재처리(관례)
  captured_at      timestamptz not null default now()
);
create index if not exists idx_link_click_snapshot_latest
  on link_click_snapshot (tracking_link_id, captured_at desc);

-- 클라이언트 기본 랜딩 URL — 생성 폼 자동 채움용, 생성 시 덮어쓰기 가능
alter table client add column if not exists landing_url text not null default '';
```

설계 결정과 근거:

- **워크스페이스 컬럼 없음** — draft·influencer·tracked_post와 같은 전역 공유 관례.
- **생성 시 스냅샷을 만들지 않는다** — 링크 생성은 측정이 아니고 클릭은 0에서 시작. 첫 새로고침 전에는 "측정 전" 표시. (게시물 트래킹의 "등록=첫 측정"과 다른 이유: 게시물은 등록 시점에 이미 지표가 존재하지만 링크는 존재하지 않음)
- **code 충돌**: 앱에서 생성(`crypto` 기반 6자 = 21억 조합) 후 unique 충돌 시 재생성 재시도. short.io 쪽 경로 충돌(동일 도메인 타 링크)은 생성 API가 409로 알려주므로 같은 재시도 경로.

## UTM 조립 규칙 — `src/lib/trackingLink.ts` (순수 함수)

```
{landing_url}
  ?utm_source=x
  &utm_medium=influencer
  &utm_campaign={캠페인}          ← 제안: {클라이언트명 공백→하이픈}-{YYYYMM}, 수정 가능
  &utm_content={인플핸들}-{code}
```

- 랜딩 URL에 기존 쿼리스트링이 있으면 보존하고 이어붙인다. 단 **기존 `utm_*` 파라미터는 제거 후 교체**(이중 UTM은 분석을 오염시킴).
- 한글 캠페인명 허용(GA4에서 정상 표시) — URL 인코딩은 `URLSearchParams`가 처리.
- 랜딩 URL 검증: `https://` 필수 + URL 파싱 성공. 실패하면 생성 버튼 비활성 + 이유 표시(잘못된 링크가 인플에게 나가는 사고 방지).
- fragment(`#...`)가 있으면 쿼리 뒤로 재배치(URL 표준 순서 유지).

## short.io 연동 — `src/lib/shortio.ts`

**SDK 대신 REST 직접 호출** 근거: 쓸 엔드포인트가 2개뿐인데 공식 SDK(`@short.io/client-node` v3.3.1)는
+763KB·zod@4 동반(리포에 zod 없음). 리포에 이미 외부 API를 얇은 수제 클라이언트로 감싸는 검증된
관례(`getxapi.ts` — 재시도·`fetchImpl` 주입 테스트)가 있어 그 패턴을 따른다.

| 동작 | 엔드포인트 | 비고 |
|---|---|---|
| 링크 생성 | `POST https://api.short.io/links` | body: `{domain, originalURL, path: code, title}` — title은 "{핸들} · {캠페인}"로 대시보드 가독성 확보 |
| 클릭 통계 | `GET https://api-v2.short.io/statistics/link/{linkId}?period=total` | totalClicks·humanClicks 추출, 응답 전체 raw 저장 |

- 인증: 둘 다 `authorization: {SHORTIO_API_KEY}` 헤더. **키는 서버 전용** — 클라이언트 번들에 절대 노출 안 됨.
- env 2개: `SHORTIO_API_KEY`, `SHORTIO_DOMAIN`(예: `cb.link`). **Vercel 프로덕션 env 추가가 배포 체크리스트에 포함**. 미설정이면 생성 모달에 "short.io 연결이 아직 설정되지 않았어요 — 관리자에게 요청해 주세요" 안내(거짓 어포던스 방지).
- 오류 규격(postMetrics 3분기 관례 준용): 성공 / `unavailable`(404 — 링크가 short.io에서 지워짐: 클릭 열에 "링크 없음" 표시하되 행·이력 유지) / `error`(5xx·타임아웃 — 아무것도 저장 안 함, 재시도 안내).
- 재시도: 5xx·429에 백오프 재시도(getxapi 관례). 사용량 기록(usageStore)은 안 함 — LLM·getxapi와 달리 종량 과금이 아니라 플랜 정액.

## 생성 흐름 — 원자성

1. 입력 검증(랜딩 URL·인플 핸들·캠페인) → code 생성 → UTM 조립(long_url)
2. short.io 생성 호출 — **성공한 뒤에만** DB insert (실패 시 반쪽 행 없이 에러 토스트+재시도)
3. insert가 code unique 충돌로 실패하는 극단 경합: short.io 링크가 고아로 남지만 리다이렉트만 낭비될 뿐 무해 — 보상 삭제 로직은 넣지 않는다(YAGNI)
4. 응답에 행 전체 반환 → 모달이 성공 화면으로 전환, **단축 링크 복사 버튼이 바로 보이게**(다음 행동 = 인플에게 전달)

## API — 로직은 lib, 라우트는 얇게 (기존 관례)

| 동작 | 라우트 | 비고 |
|---|---|---|
| 목록 | `GET /api/links` | 링크+최신 클릭 스냅샷+원고 제목 한 번에 (트래킹 GET 관례) |
| 생성 | `POST /api/links` | 서버 재검증 → short.io → insert |
| 클릭 새로고침 | `POST /api/links/[id]/refresh` | 성공→스냅샷 추가 / 404→"링크 없음" / error→저장 없이 오류 |
| 클릭 이력 | `GET /api/links/[id]/snapshots` | 행 펼침 시 조회(목록 응답에 전부 싣지 않음 — 트래킹 관례) |
| 삭제 | `DELETE /api/links/[id]` | DB만 삭제(cascade). **short.io 링크는 살려둠** — 응답·토스트에 명시 |

- 인증: GET `requireAllowedUser`, 쓰기 `requireMember` (트래킹 라우트와 동일).
- 일괄 새로고침 서버 엔드포인트 없음 — 클라이언트 행별 순차 호출+진행 표시(트래킹 관례, Vercel 시간 제한·DB 풀 부담 회피).
- 클라이언트 landing_url 저장: 기존 `PATCH /api/clients/[id]` 계열에 필드 추가(clientStore 확장).

## 화면

### /tracking — `[게시물 | 링크]` 세그먼트 (koo 확정)

좌측 채움형 세그먼트(보관함 카드/표 전환과 같은 시각 문법, 8cd9f2c 선례). URL은 `?view=links`로 상태 보존.

링크 표 열(트래킹 표의 읽기 동선 관례 — 정체 → 맥락 → 숫자 → 신선도 → 행동):

| 열 | 내용 |
|---|---|
| 인플루언서 | 핸들 (InfluencerChip 재사용) |
| 원고 | 연결 원고 제목, 없으면 "—" |
| 캠페인 | utm_campaign |
| 단축 링크 | `cb.link/{code}` + [복사] — 이 표의 제1 행동 |
| 클릭 | 최신 total_clicks. 측정 전이면 "측정 전" |
| 측정 | "10분 전" (relTime — 신선도) |
| 동작 | [새로고침] · [삭제] |

- 행 펼침 = 클릭 측정 이력(게시물 표의 행 펼침과 동일한 문법·부모 열 정렬).
- [+ 링크 만들기] 버튼 + 한 줄 도움말("랜딩페이지 주소에 인플·콘텐츠 추적용 꼬리표를 붙이고 짧은 링크로 만들어요").
- 삭제 = 실행취소 토스트(기존 패턴) + "짧은 링크 자체는 계속 열려요" 명시.
- 빈 목록: 용도 한 문단 안내.

### 생성 모달 — `LinkCreateModal` (양쪽 진입점이 공유)

필드 순서 = 사람이 정할 것부터: 랜딩 URL(클라 기본값 자동 채움, 수정 가능) → 인플루언서(원고 진입이면 자동, 독립 진입이면 명부 선택 — InfluencerField 재사용) → 클라이언트(원고 진입이면 자동) → 캠페인(자동 제안, 수정 가능) → **최종 URL 미리보기**(UTM 붙은 전체 URL — 뭐가 만들어지는지 행동 전에 보여줌) → [짧은 링크 만들기].

성공 화면: 단축 링크 크게 + [복사] + "인플루언서에게 이 링크를 전달해 게시 시 함께 올려달라고 요청하세요".

### DraftCard — "트래킹 링크" 섹션

카드=표팝업=칸반팝업 공통 표면(DraftCard 단일 표면 원칙). 그 원고로 만든 링크 목록(단축 링크+복사+최신 클릭+측정 시각) + [+ 링크 만들기](인플·클라·캠페인 자동 채움 모달). 링크가 없고 인플 미배정이면 섹션 자체를 조용히 유지하되 만들기 진입 시 인플 선택을 모달에서 요구.

### 클라이언트 관리 화면

기본 랜딩 URL 입력란 1개 추가 + 한 줄 도움말("트래킹 링크를 만들 때 이 주소가 자동으로 채워져요").

## 새 파일 / 수정 파일

새 파일:
- `migrations/028_tracking_link.sql`
- `src/lib/trackingLink.ts`(+test) — code 생성·UTM 조립·캠페인 제안 (순수 함수)
- `src/lib/shortio.ts`(+test) — REST 클라이언트 (fetchImpl 주입)
- `src/lib/linkStore.ts`(+test) — 명부·클릭 기록 읽기/쓰기
- `src/app/api/links/route.ts`, `[id]/route.ts`, `[id]/refresh/route.ts`, `[id]/snapshots/route.ts`
- `src/components/LinkTable.tsx`, `LinkCreateModal.tsx`

수정:
- `src/app/tracking/page.tsx` — 세그먼트 + 링크 뷰
- `src/components/DraftCard.tsx` — 트래킹 링크 섹션
- 클라이언트 관리 화면 + `clientStore.ts` — landing_url
- `.env` 견본·배포 문서 — SHORTIO_API_KEY / SHORTIO_DOMAIN

## 테스트 (lib 단위·실 DB — 리포 관례)

- `trackingLink.test.ts`: UTM 조립(쿼리 있는 URL·기존 utm 교체·fragment·한글 캠페인 인코딩) / code 형식 / 캠페인 제안(공백→하이픈·YYYYMM) / URL 검증 거부 케이스
- `shortio.test.ts`: 가짜 fetch 주입 — 생성 성공/409/5xx 재시도 소진, 통계 성공/404/error 3분기 격리
- `linkStore.test.ts`: 생성 / code unique / 최신 스냅샷 조회 / 이력 append / cascade 삭제 / draft 삭제 시 set null
- 화면: 로컬 build+start(-p 3001, 127.0.0.1) 후 koo QA. 린트 기준선 24 유지

## 구현 시 확인 항목 (열린 검증)

1. **short.io 실계약 스모크**: 실제 키·도메인으로 생성→통계→(수동)삭제 1회 왕복. 통계 응답의 클릭 필드명(totalClicks/humanClicks)과 생성 응답의 링크 ID 필드(idString vs id)를 실응답으로 확정
2. 경로 충돌(이미 쓰는 path) 시 응답 코드가 409인지 실확인 — 재시도 분기 근거
3. 현재 플랜의 링크 수·API 레이트 리밋 확인(초과 임박 시 안내 문구 필요성 판단)

## 이 스펙이 다루지 않는 것 (백로그)

- 클릭 추이 그래프 — 데이터는 v1부터 append-only로 쌓임, 화면만 나중에
- 클릭 자동 주기 수집(cron) — 게시물 트래킹 자동화와 같은 단계에서 함께
- 게시물(트윗 반응)×링크(클릭) 원고 단위 통합 뷰 — 연결 키는 이미 공유
- 인플루언서 타임라인(influencer_log)에 링크 생성 이벤트 기록
- QR·딥링크 등 short.io 부가 기능
