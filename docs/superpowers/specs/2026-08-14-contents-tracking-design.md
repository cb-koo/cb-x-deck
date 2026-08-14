# 콘텐츠 트래킹 v1 설계 (2026-08-14)

## 목적

인플루언서에게 전달한 원고가 게시된 뒤 "그 게시물이 어떻게 반응받고 있나"를 팀이 한 화면에서 확인한다.
v1은 **수동 등록**: 게시물 링크를 붙여넣으면 지표를 가져와 추적 목록에 넣는다.
확정된 발전 방향(이 스펙의 범위 아님, 그러나 설계가 막지 않아야 함):

1. **자동 트래킹** — 전달된 원고 → 인플 계정 폴링 → 게시물 자동 발견(제안까지 기계, 확정은 사람)
2. **시계열 추이** — 지표 변화 그래프
3. **바이럴 조기 감지** — 게시 초반 반응 속도를 계정 평소 대비로 판정, 앱 내+Slack 알림

근거 리서치: `docs/research/content-tracking-db-research-20260814.md` (스키마 통례 검증 + 자동화 단계 참고자료).

## v1 범위

- 페이지 `/tracking` (사이드바 도구 그룹, "트래킹", 인플루언서 다음)
- 링크 등록(등록 = 첫 측정) / 추적 목록 / 행별·전체 새로고침 / 원고 연결 / 추적 중단
- 지표 갱신은 전부 사람이 누를 때만(API 비용 opt-in). cron 없음
- 필터·검색 없음(목록이 커져 불편해지면 추가)

## 데이터 모델 — 장부 두 권

**`tracked_post`** (추적 대상 명부 — 한 행 = 게시물 하나):

```sql
-- migrations/027_tracked_post.sql
-- 026은 보존 브랜치(cb-koo/influencer-db)의 026이 프로덕션 DB에 적용돼 있어 건너뜀
create table tracked_post (
  id            uuid primary key default gen_random_uuid(),
  tweet_id      text not null unique,        -- parseTweetLink 정규화 ID. 중복 등록 차단.
                                             -- text인 이유: 리포 전체 관례 + JS 정밀도(Snowflake ID > 2^53)
  author_handle text,                        -- 작성자 = 인플루언서 (핸들 자연키 — draft.influencer_handle과 같은 관례)
  text          text not null default '',    -- 본문 스냅샷(등록 시점) — 삭제·수정 후에도 기록 보존
  posted_at     timestamptz,                 -- 트윗 게시 시각 — 경과 표기·향후 속도 계산의 기준점
  draft_id      uuid references draft(id) on delete set null,  -- 선택 연결(원고 삭제돼도 추적 유지)
  source        text not null default 'manual',                -- 'manual' | 'auto'(자동화 단계)
  unavailable_at timestamptz,                -- 조회 불가 확인 시각(삭제·비공개·정지). null = 정상
                                             -- (deleted_at이 아닌 이유: 삭제로 단정할 수 없는 상태 포함 — 이름도 아는 만큼만)
  created_by    uuid references member(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table post_metric_snapshot (
  id              uuid primary key default gen_random_uuid(),
  tracked_post_id uuid not null references tracked_post(id) on delete cascade,
  views           bigint,                    -- 전 지표 nullable — 출처별 결손 허용
  likes int, retweets int, replies int, bookmarks int, quotes int,
  raw             jsonb,                     -- 원본 API 응답 — 스키마 진화 시 재수집 없이 재처리 (리서치: 통례)
  captured_at     timestamptz not null default now()
);
create index on post_metric_snapshot (tracked_post_id, captured_at desc);  -- "최신 스냅샷" 조회 보장
```

설계 결정과 근거:

- **2테이블 append-only**: 지표는 덮어쓰지 않고 측정마다 한 줄 추가. v1 화면은 최신만 쓰지만 첫날부터 이력이 쌓여 시계열·바이럴 단계에서 스키마 변경 0. 리서치에서 업계 통례로 검증됨.
- **인플루언서 FK 없음**: 게시물 작성자 = 인플루언서이므로 `author_handle`이 곧 연결(핸들 자연키). 명부(influencer)와는 읽기 시점 조인. "작성자 따로 연결 인플 따로"의 모순 가능성 차단 + 등록 시 선택 UI 불필요.
- **워크스페이스 컬럼 없음**: draft·influencer와 같은 전역 공유 관례.
- **데이터 증가 대비**: 스냅샷 행 ~100B, 자동화 후에도 게시물당 평생 ~100~200행 — 수십 MB 규모. 솎아내기·파티셔닝은 수백만 행 트리거(리서치)라 하지 않음. append-only 구조라 나중에 보존 정책을 delete 배치로 추가 가능.
- 자동화 단계에 추가될 것(지금 안 넣음): `next_poll_at`·연속 실패 카운트(대상 행 컬럼이 통례), 자동 발견분 확정 대기 상태, 갱신 컷오프. 전부 컬럼 추가로 충분.

## 수집 레이어 — `src/lib/postMetrics.ts`

목적: 지금은 getxapi, 나중에 X 공식 API·서드파티로 갈아끼워도 나머지 코드가 안 바뀌게 하는 층.

규격(트윗 ID 입력 → 셋 중 하나):

| 결과 | 의미 | 처리 |
|---|---|---|
| `ok` | 조회 성공 | 핸들·본문·게시시각·지표 6종·raw 반환 → 저장 |
| `unavailable` | X가 명시적으로 "없음" 응답 (404/400 = 삭제·비공개·정지) | `unavailable_at` 기록, 화면에 "볼 수 없음" |
| `error` | 통신 실패·5xx·타임아웃 — 판단 불가 | **아무것도 저장 안 함**, 사용자에게 재시도 안내 |

- **복귀 수용**: unavailable였던 행이 이후 새로고침에서 ok가 되면 `unavailable_at`을 비운다(비공개 해제 등). "볼 수 없음" 딱지가 실제와 어긋난 채 영구히 남지 않게.
- **unavailable과 error는 절대 섞이지 않는다.** 애매하면 error(기록 안 함) — 틀린 기록보다 빈 기록. 근거: error를 unavailable로 오판하면 멀쩡한 게시물에 "볼 수 없음" 딱지(잘못된 정보를 사실처럼 표시), 반대면 삭제를 영영 모름.
- 코드 전제 확인됨: `getTweetDetail`(getxapi.ts:82)이 이미 404/400→null, 일시 오류→예외로 구분. 5xx/429 재시도·백오프·사용량 기록(recordUsageSafe)도 기존 클라이언트가 처리.
- 지표 정규화는 기존 `mapRawTweet`(mappers.ts:50)의 6종 매핑 재사용.
- 교체: 같은 규격의 구현체 추가 + 환경변수 선택. 공식 API도 같은 6종 제공. 다른 플랫폼(인스타 등)은 "교체"가 아니라 명부 스키마 확장이 필요한 별도 기획.

## 화면 — `/tracking`

**상단 등록 영역**: 링크 입력 + [추적 시작] 버튼 + 한 줄 도움말("X 게시물 링크를 붙여넣으면 현재 지표를 가져와 아래 목록에 추가해요").

- 입력 즉시 `parseTweetLink`(tweetLink.ts — 링크로 트윗 추가와 동일 검증) 인라인 검사, 트윗 링크 아니면 버튼 비활성+이유
- 중복이면 새로 만들지 않고 "이미 추적 중이에요" + 해당 행 강조
- 성공 시 목록 맨 위에 지표와 함께 등장(등록 = 첫 측정)

**추적 목록 테이블**:

| 열 | 내용 |
|---|---|
| 게시물 | 핸들 + 본문 앞부분, 클릭 → X 원문(`tweetPermalink`) |
| 게시 | "3일 전" 경과(relTime) — 지표 해석의 기준점 |
| 지표 6종 | 조회·좋아요·RT·답글·북마크·인용 (최신 측정값) |
| 측정 | "마지막 측정 2시간 전" — 숫자 신선도. 갱신 실패가 지속되면 이 시각이 낡는 게 보임 |
| 원고 | 연결 원고 제목. 행에서 [원고 연결]로 연결·변경 (등록 시가 아니라 — 등록 마찰 최소화) |
| 동작 | 행별 [새로고침] · [추적 중단] |

- **전체 새로고침**: 누르기 전 비용 표시("12건 갱신 — API 호출 12회"), 클라이언트가 행별 순차 호출(진행 표시 3/12…)
- **볼 수 없음**: 행 유지 + "볼 수 없음(삭제·비공개 등) · {확인 시각}" 배지 + 마지막 측정값 유지. 아는 사실(그 시점 조회 불가)까지만 말하는 표기
- **일시 오류**: 토스트 "지표를 가져오지 못했어요. 잠시 후 다시 시도해 주세요" — 행에 영구 딱지 없음(오류는 시도의 사실이지 게시물의 상태가 아님. 자동화 단계에선 지켜보는 사람이 없으므로 그때 행에 기록)
- **추적 중단** = 행 삭제(스냅샷 연쇄) + 실행취소 토스트(기존 패턴)
- 빈 목록: 페이지 용도 한 문단 안내
- 기본 정렬 최신 등록순. UX 원칙 체크리스트(AGENTS.md) 준수 — 라벨은 이득 언어, 비용 액션 opt-in

## API — 로직은 lib, 라우트는 얇게 (기존 관례)

| 동작 | 라우트 | 비고 |
|---|---|---|
| 목록 | `GET /api/tracking` | 명부+최신 스냅샷+원고 제목 한 번에 |
| 등록 | `POST /api/tracking` | 서버 재검증(parseTweetLink) → 수집 → 명부+첫 스냅샷 **한 트랜잭션**. 유니크 충돌 = "이미 추적 중" 응답(동시 등록 경합의 최후 방어) |
| 새로고침 | `POST /api/tracking/[id]/refresh` | ok→스냅샷 추가 / unavailable→unavailable_at / error→저장 없이 오류 응답 |
| 원고 연결 | `PATCH /api/tracking/[id]` | 연결·해제·변경 |
| 추적 중단 | `DELETE /api/tracking/[id]` | cascade |

- 인증: 기존 `requireMember`
- 일괄 새로고침 서버 엔드포인트 없음 — Vercel 함수 시간 제한 회피 + 진행 가시성. 자동화 단계 cron은 별도 구조라 이 결정에 안 묶임
- DB 풀: 순차 호출이라 동시 커넥션 부담 없음(과거 고갈 사고 재발 방지 관점 확인됨)

## 새 파일

- `migrations/027_tracked_post.sql`
- `src/lib/postMetrics.ts`(+test) — 수집 규격 + getxapi 구현
- `src/lib/trackingStore.ts`(+test) — 명부·기록장 읽기/쓰기
- `src/app/tracking/page.tsx` + 등록·테이블 컴포넌트
- `src/components/Sidebar.tsx` 항목 추가

## 테스트 (lib 단위·실 DB — 리포 관례)

- `trackingStore.test.ts`: 등록 트랜잭션 / tweet_id 중복 차단 / 최신 스냅샷 조회 / unavailable_at 기록 / cascade 삭제 / 원고 연결·해제
- `postMetrics.test.ts`: RawTweet→지표 6종 매핑, **unavailable vs error 분기 격리**(가짜 fetch 주입 — 404 응답 / 네트워크 실패 / 5xx 소진을 각각 검증)
- 링크 파싱은 기존 `tweetLink.test.ts` 커버
- 화면: 로컬 build+start(-p 3001, 127.0.0.1) 후 사용자 QA. 린트 기준선 24 유지

## 구현 시 확인 항목 (열린 검증)

1. **getxapi 실계약 스모크**: 실제 삭제된 트윗 ID로 `getTweetDetail` 호출해 404/400→null 경로 확인. 정상 응답인데 data가 빈 경계 케이스가 관찰되면 unavailable이 아니라 error로 떨어뜨리도록 조정 (smoke-expansion.ts 관례)
2. 게시 시각·본문 필드가 RawTweet 어디에 오는지 실응답으로 확인(mapRawTweet가 쓰는 필드 재사용 예상)

## 이 스펙이 다루지 않는 것

- 자동 발견·폴링·알림 (발전 1·3단계 — 리서치 문서에 설계 참고자료 있음: 체크포인트 5m/15m/1h/6h/24h, 갱신 컷오프, 폴링 상태 컬럼)
- 시계열 그래프 (2단계 — 데이터는 v1부터 쌓임)
- 스레드 원고의 트윗별 추적 — v1은 대표(첫) 트윗 링크 등록으로 커버(X 지표가 첫 트윗에 집중). 필요해지면 같은 원고에 여러 행 연결로 해결 가능
- 다른 플랫폼 지원
