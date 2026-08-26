# 랜딩 이벤트 수집 + 성과 대시보드 설계 (2026-08-25, 갱신 08-26)

## 목적

X 게시글 → 트래킹 링크(short.io) → **브릿지 랜딩페이지**(`x-line-link-bridge.vercel.app/<clinic>`, 별도 리포) → LINE 친구추가 버튼 탭 → `/go/<clinic>` 302 → LINE. 브릿지가 보내는 이벤트(도착·조회·탭)를 cb-x-deck이 받아 저장하고, **어떤 콘텐츠(원고)가 랜딩 유입과 LINE 탭을 만들어내는지**를 한 화면에서 보여 다음 캠페인의 인플루언서·콘텐츠 선택에 쓴다.

당초 시작 프롬프트는 "`/tracking › 링크` 표에 도착·탭 열 추가"였으나, 브레인스토밍에서 실제 질문이 "숫자 두 개"가 아니라 "콘텐츠 순위·퍼널·스레드 안에서 어디서 새나"임이 드러나 **별도 성과 대시보드**로 전환했다(koo 결정 08-25). 리서치: `~/claude-outputs/20260825_인플·콘텐츠_성과_대시보드_리서치.md`(플랫폼 10종·UTM 리포트·일본 LINE 퍼널). 시안: https://claude.ai/code/artifact/857b2f4d-b4d2-451e-a3d2-fee0ecf462a0 (v3.3).

궁극적으로는 트윗 조회 → 클릭 → 도착 → 탭 통합 퍼널(B단계)이며, 이 스펙은 그 첫 단계로 **조회까지 포함**한다(조회 데이터는 이미 게시물 트래킹에 있다).

## 확정된 결정 (브레인스토밍 Q&A)

| 결정 | 내용 |
|---|---|
| 화면 | 링크 표 열 추가가 아니라 **별도 페이지 `/performance`**, 사이드바 "트래킹" 다음에 "성과"(koo A안 08-26) |
| 주인공 | **콘텐츠**(원고). 인플루언서는 `묶어 보기` 세그먼트로 같은 표를 다시 묶는 축 |
| 행 단위 | 콘텐츠 = 원고 = 고유 utm 링크 1개(1:1:1). koo 운영 방침: 콘텐츠마다 고유 utm 링크를 만든다 |
| 기본 정렬 | **탭 수** 내림차순(효율이 아니라 인입량이 질문). 탭률 정렬은 Wilson 하한(소표본 왜곡 방지) |
| 조회 | **본문(첫) 트윗 조회** 하나. 스레드 합산 금지(koo). 클릭률 분모도 본문 조회 |
| 역할 | `tracked_post.role` 3종 `main`·`thread`·`link` — 자동 판정 + 수동 변경 |
| 펼침 | **스레드 읽기 흐름만**(트윗별 조회, 1/ 대비 %). 날짜별 도착·탭은 v1 제외(koo 08-26 — 결정 정보가 아님) |
| 부모 행 | 11열 한 줄 표. 인라인 막대·"게시 후 n일"·링크 댓글 보조줄 없음(koo 08-26) |
| 표본 | 도착 <20 "아직 판단 이르어요"(탭률 흐리게) / 20~49 "참고용" / 50+ 정상 — 임계값은 실데이터로 조정 |
| 봇·프리페치 | 카드가 아니라 표 위 각주 한 줄 "N건은 세지 않았어요"(Fathom식 투명 표기) |
| 신선도 | 조회·클릭 = 마지막 새로고침 스냅샷(표기), 도착·탭 = 실시간. 추후 주기 갱신은 별도(koo) |
| 미연결 유입 | 버리지 않고 표 아래 접힌 줄로 노출(아는 만큼만 말한다) |
| cron | 없음 — 이벤트는 push, 표는 DB만 읽음(외부 호출 0) |

## v1 범위

- `POST /api/landing-events` 수집 API + `landing_event` 테이블(append-only, 멱등)
- `tracked_post.role` + 읽기 시점 자동 판정(`postRole`) + 게시물 표에서 수동 변경
- `/performance` 페이지: 필터(캠페인·기간) → 결정 카드 4 → 순위표(콘텐츠/인플루언서 묶어 보기, 정렬, 배지, 펼침=스레드 읽기 흐름) → 미연결 방문 접힌 줄
- 읽기 API `GET /api/performance`

## 데이터 흐름

```
브릿지(별도 리포)                    cb-x-deck
 arrival/view/tap ── POST /api/landing-events ──▶ landing_event (append-only)
                                                        │ utm_content
 tracking_link ───────────────────────────────────────┤ (1 링크 = 1 콘텐츠)
     │ draft_id                                          │
 draft ── tracked_post(role) ── post_metric_snapshot ───┤ 조회(main)·링크 댓글 조회(link)·스레드(thread)
     │                                                   │
 link_click_snapshot(최신) ─────────────────────────────┘ 클릭
                                   ▼
                     GET /api/performance → /performance
```

## 데이터 모델

### 마이그레이션 번호

main은 032까지. **033은 캠페인 관리 브랜치(`cb-koo/campaign-management`)가 이미 쓰고 있다** → 이 스펙은 **034·035**를 쓴다. 적용 스크립트는 파일명 순으로 전부 적용하므로 번호 공백은 무해하다(026 건너뜀 선례). 어느 쪽이 먼저 머지되든 rename이 필요 없다.

### `migrations/034_landing_event.sql`

```sql
-- 034: 브릿지 랜딩 이벤트 — append-only 원장. 필터(봇·사람)는 저장하지 않고 읽기 시점에 판정한다.
-- 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md
create table if not exists landing_event (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique,        -- 브릿지가 생성(uuid). 재시도 중복은 여기서 무시된다
  visit_id     text not null,               -- 방문 — arrival/view/tap을 한 사람으로 묶는 열쇠(브릿지 쿠키 1시간)
  kind         text not null check (kind in ('arrival','view','tap')),
  clinic       text not null,
  hostname     text not null,
  path         text not null,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  referer_host text,
  ua           text not null,
  is_bot_ua    boolean not null,            -- 브릿지의 isbot 판정. 전부 저장, 필터는 읽기 시점
  sec_fetch_ok boolean not null,
  ip_hash      text,                        -- sha256(일별 salt + ip) 앞 16자. 원본 IP 없음
  country      text,
  occurred_at  timestamptz not null,        -- 브릿지 시각(ts)
  received_at  timestamptz not null default now()
);
create index if not exists idx_landing_event_content_time on landing_event (utm_content, occurred_at desc);
create index if not exists idx_landing_event_visit on landing_event (visit_id);
create index if not exists idx_landing_event_campaign_time on landing_event (utm_campaign, occurred_at desc); -- 미연결 유입 조회
```

- `jsonb raw` 없음: 필드가 계약으로 고정돼 있다. 브릿지가 필드를 늘리면 컬럼 추가로 대응.
- 워크스페이스 컬럼 없음(tracking_link·tracked_post와 같은 전역 관례).
- 보존 정책 없음(v1). 행 ~300B, 월 수만 건 규모 — 수백만 행 트리거 전까지 솎지 않는다(콘텐츠 트래킹 스펙과 같은 판단).

### `migrations/035_tracked_post_role.sql`

```sql
-- 035: 게시물의 역할 — 한 원고에 게시물이 여럿일 때(스레드·링크 댓글) 어느 것이 '콘텐츠 조회'인지.
-- null = 자동 판정(읽기 시점, postRole.ts). 값이 있으면 사람이 고친 것 — 자동 판정이 덮지 않는다.
alter table tracked_post add column if not exists role text check (role in ('main','thread','link'));
```

## 수집 API — `POST /api/landing-events`

브릿지 ↔ cb-x-deck 계약(브릿지 세션과 합의된 것, 변경 시 브릿지 `lib/deck.ts`에 전달):

- 헤더 `authorization: Bearer ${LANDING_EVENTS_SECRET}` · `content-type: application/json`
- 본문 `{ "events": [LandingEvent, ...] }` — 1~100건. 100 초과는 400
- 응답 `202 {accepted: n, duplicates: m}` / `401`(시크릿 불일치·누락·env 미설정) / `400 {error, index, field}`(스키마 위반 — 어느 건의 어느 필드인지) / 5xx(저장 실패)
- 멱등: `event_id` unique → `on conflict do nothing`. 전부 중복이어도 202

```ts
type LandingEvent = {
  event_id: string; visit_id: string;
  kind: 'arrival' | 'view' | 'tap';
  clinic: string; hostname: string; path: string;
  utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string; utm_term?: string;
  referer_host?: string;
  ua: string; is_bot_ua: boolean; sec_fetch_ok: boolean;
  ip_hash?: string; country?: string;
  ts: string; // ISO 8601
};
```

- 이 API는 사람이 아니라 브릿지 서버가 호출한다 → `requireMember`가 아니라 시크릿 비교(`crypto.timingSafeEqual`, 길이 다르면 즉시 401). `LANDING_EVENTS_SECRET` 미설정이면 전부 401(열려 있는 상태를 만들지 않는다).
- 검증은 `src/lib/landingEvent.ts` 순수 함수 `parseLandingEvents(body) → {ok, events} | {ok:false, index, field, reason}`. 문자열 길이 상한(각 2,000자)·`ts` 파싱 가능·`kind` 3종. 알 수 없는 필드는 무시(브릿지가 앞서가도 깨지지 않게).
- 저장은 `landingEventStore.insertEvents(sql, events)` — 한 문장 multi-row insert, 반환 건수로 `accepted` 계산.
- 쓰기 전용. 읽기는 `/api/performance`.
- 사용량 기록(usageStore) 없음 — 외부 과금이 아니다.

## 집계 규칙 — 방문(visit_id) 단위, 읽기 시점 SQL

| 값 | 정의 |
|---|---|
| 사람 도착 | `distinct visit_id where not is_bot_ua and exists(kind in ('view','tap'))` — JS가 실행됐거나 탭했으면 사람. arrival만 있는 방문(X 프리페치·크롤러)은 제외 |
| 탭 | `distinct visit_id where kind='tap' and not is_bot_ua` |
| 제외한 방문 | `distinct visit_id` 전체 − 사람 도착 (프리페치·봇으로 보이는 방문) |
| 기간 | `occurred_at`을 **Asia/Seoul** 경계로 자른다(`kstDaysAgoStart`, 시간대 통일 결정 2026-08-08). `all`은 경계 없음 |
| 콘텐츠 매칭 | `landing_event.utm_content = tracking_link.utm_content` |
| 미연결 | `utm_content`가 null이거나 어느 `tracking_link`에도 없는 이벤트. 캠페인 필터는 이벤트의 `utm_campaign`으로 적용(선택 캠페인과 같거나 null) |

한 방문이 두 콘텐츠의 utm_content를 가질 수는 없다(쿠키 1시간, 링크 하나로 들어옴). 같은 방문이 arrival·view·tap을 여러 번 보내도 distinct로 1이다.

## 역할 판정 — `src/lib/postRole.ts` (순수 함수)

한 원고에 등록된 게시물들에 역할을 매긴다. 입력: 게시물 목록(`tweetId, postedAt, role(저장값), raw(최신 스냅샷)`)과 그 원고 링크들의 `short_url` 집합.

1. **저장된 role이 있으면 그대로**(사람이 고친 값).
2. 없으면 자동: `raw.entities.urls[].expanded_url`(또는 `url`)이 `short_url` 중 하나와 일치(스킴·후행 슬래시 무시) → **`link`**. 위치(스레드 안/별도 댓글) 무관.
3. 나머지 중 `postedAt`이 가장 이른 것 → **`main`**, 그 외 → **`thread`**. `isReply=false`인 게시물이 있으면 그것을 main으로 우선(시각이 같거나 없을 때의 보정).
4. 출력: 정렬된 목록(main → thread 게시 순 → link) + `main`·`link`·`threadCount`.

- 픽스처(`fixtures/user-tweets-response.json`)로 `entities.urls`·`isReply`·`inReplyToId`·`conversationId`·`createdAt` 존재 확인됨. `raw`는 `post_metric_snapshot.raw`(스냅샷마다 저장) — 최신 스냅샷의 것을 쓴다.
- 저장 시점: `POST /api/tracking`(등록)과 `refresh`에서 `role`이 null이면 자동 판정값을 **저장하지 않고** 그대로 둔다 — 읽기 시점 판정 하나로 통일해 등록 순서(링크보다 게시물이 먼저 등록된 경우)에 좌우되지 않게. 사람이 고칠 때만 값이 생긴다.
- 원고에 링크가 없으면 `link` 판정은 불가 → main/thread만.
- 스레드 개수: `draft.content.posts.length`(형식 `thread`일 때) — "스레드 4개 중 2개 등록" 표시에 쓴다.

## 읽기 모델 — `src/lib/performanceStore.ts` + `src/lib/performanceJudgment.ts`

### 행(콘텐츠) — `ContentRow`

기준 테이블은 `tracking_link`(콘텐츠 1 = 링크 1). 조인: `draft`(제목·형식·스레드 수), `tracked_post`+최신 `post_metric_snapshot`(원고의 게시물 전부 → 역할 판정), 최신 `link_click_snapshot`(클릭), `landing_event` 집계(도착·탭, 기간 적용).

```ts
interface ContentRow {
  linkId: string; utmContent: string; utmCampaign: string;
  draftId: string | null; title: string;            // draft.title → ko_title → utm_content
  format: 'single' | 'thread' | null; threadTotal: number | null; // 원고 기준
  influencerHandle: string;
  postedAt: string | null;                           // main 게시물 posted_at
  views: number | null;                              // main 최신 views. null = 게시물 연결 전
  clicks: number | null;                             // 최신 link_click_snapshot.total_clicks. null = 측정 전
  arrivals: number; taps: number;                    // 사람 기준, 기간 적용
  posts: Array<{ tweetId: string; role: 'main'|'thread'|'link'; views: number | null; authorHandle: string | null }>; // 펼침용, 정렬됨
  capturedAt: string | null;                         // 조회·클릭 스냅샷 중 가장 이른 시각(신선도 표기)
}
```

파생값(`performanceJudgment.ts`, 순수 — 서버 요약과 클라 표시가 같은 함수):

| 값 | 정의 |
|---|---|
| 클릭률 | `clicks / views` (둘 다 있을 때). 소수 1자리 % |
| 탭률 | `taps / arrivals` (arrivals>0). 정수 % + `(taps/arrivals)` 병기 |
| 탭 기여 | `taps / Σtaps(현재 필터)`. 정수 % |
| 표본 상태 | arrivals <20 → `early`("아직 판단 이르어요", 탭률 흐리게) / 20~49 → `ref`("참고용") / 50+ → `ok`. 상수 `SAMPLE_EARLY=20`, `SAMPLE_REF=50` |
| 탭률 정렬키 | Wilson 95% 하한 `wilsonLower(taps, arrivals)`; arrivals=0이면 −1(맨 뒤) |
| 결정 문장 | 탭 내림차순 상위 3개의 기여 합 → "탭 상위 3개 콘텐츠가 전체 탭의 n%" + 제목 3개. Σtaps=0이면 "아직 탭이 없어요" |
| 스레드 % | `post.views / main.views` (main.views>0) |

### 묶어 보기 — 인플루언서

같은 행 배열을 `influencerHandle`(소문자)로 묶어 합산: 조회 = Σmain views(콘텐츠당 1값), 클릭·도착·탭 = Σ. 비율·배지·정렬은 합산값으로 재계산. 콘텐츠 수 열 추가. 서버가 아니라 **클라이언트에서 묶는다**(행 수십 개 — 재요청 없이 즉시 전환).

### 요약

`summary = { taps, arrivals, excluded, views, clicks, clickRate, tapRate, top3: {share, titles} }` — 전부 현재 필터의 행에서 파생(카드 ↔ 표 불일치 방지). `excluded`는 별도 쿼리(제외한 방문 수).

### 미연결

`unlinked = { total, byContent: Array<{ utmContent: string | null; arrivals: number; taps: number }> }` — 상위 5개 + 나머지 합.

### 캠페인·기간

- 캠페인 목록 = `tracking_link.utm_campaign` distinct(최근 생성순) + 대표 `client_name`. 기본 선택 = 가장 최근 캠페인. 캠페인 관리(`campaign.name_en`)가 머지되면 라벨만 그쪽 이름으로 바꾼다(키는 같다).
- 기간 `all | 7d | 30d`. **도착·탭에만 적용**. 조회·클릭은 스냅샷이라 기간과 무관하게 최신값 — 화면 도움말에 명시.
- URL 상태 `?campaign=&range=`(링크 공유·새로고침 유지, tracking 탭 관례).

### 성능

행 수 = 캠페인의 링크 수(5~20). 쿼리 3~4개(행 기본 + 게시물/스냅샷 + 이벤트 집계 GROUP BY utm_content + 미연결·제외). 인덱스 `(utm_content, occurred_at desc)`로 이벤트 집계는 캠페인 크기에 비례. 캐시 없음.

## 화면 — `/performance`

시안 v3.3 기준. 사이드바 `globalNav`에 `{ href: '/performance', label: '성과' }`를 "트래킹" 다음에 추가. 페이지 폭 `max-w-[1280px]`.

**헤더** — h1 "성과", 한 줄 "인플루언서·콘텐츠별로 랜딩 방문과 LINE 탭을 모아 봐요. 브릿지 페이지에서 바로 들어오는 기록이라 새로고침이 필요 없어요."

**필터 바** — 캠페인 select(`{utm_campaign} · {client_name}`) · 기간 세그먼트 `[캠페인 전체 | 최근 7일 | 최근 30일]` · 우측 "{시작}~{끝} · 서울 기준"(전체면 첫 링크 생성일~오늘).

**결정 카드 4**(숫자 26px, 라벨 13px, 보조 12px):
1. LINE 탭 `143` — "도착 100명 중 11명이 눌렀어요"
2. 랜딩 도착(사람) `1,203` — "링크 클릭 2,220 중 54%가 페이지까지 왔어요"
3. 콘텐츠 조회 `180,000` — "본문 트윗 기준 · 클릭률 1.2%" + 11px "마지막 새로고침 기준"
4. **결정 카드**(왼쪽 3px 파란 테두리·연한 배경) — "탭 상위 3개 콘텐츠가 전체 탭의 71%" / 제목 3개

**표 위** — `묶어 보기: [콘텐츠 | 인플루언서]` + 도움말 "콘텐츠 = 원고 하나 = 고유 링크 하나예요" / "인플루언서로 묶으면 같은 사람의 콘텐츠를 합쳐 보여요". 각주 한 줄(13px muted): "프리페치·봇으로 보이는 방문 N건은 세지 않았어요 · 조회·클릭은 마지막 새로고침({시각}) 기준이라 기간과 무관해요".

**순위표** — 12열(펼침 32 + 11), 부모 행 48px 한 줄, 본문 15px·보조 13px·단위 캡션만 11px:

| 열 | 내용 |
|---|---|
| ▶ | 펼침(한 번에 하나, TrackingTable 관례). title "자세히 — 스레드 읽기 흐름(트윗별 조회)" |
| 콘텐츠 | 제목(말줄임). title 툴팁 "utm_content: {code} · 스레드 {n}개/단일 게시물" |
| 인플루언서 | 이니셜 아바타 + @핸들 |
| 게시 | main `posted_at` → `M/D`. 없으면 "—" |
| 조회 · 클릭 · 도착 · 탭 | 우측 정렬 tabular. 위에 얇은 그룹 헤더 "퍼널 · 조회 → 클릭 → 도착 → 탭". 조회 없음 = 링크 텍스트 **"게시물 연결 전"**(→ `/tracking`, 0으로 보이지 않게). 클릭 없음 = "측정 전" |
| 클릭률 | `5.8%`. title "클릭 ÷ 본문 조회" |
| 탭률 | `15% (61/412)` — 분모 병기(muted 13px). 배지 인라인. `early`면 값 흐리게 |
| 탭 기여 | `43%` |
| 열기 | "원고"(`/generate?draft={id}`, 원고 없으면 숨김) · "X 게시물"(`tweetPermalink(main)`, 없으면 숨김) |

- 정렬: 헤더 클릭. 기본 탭 desc. 탭률 헤더는 Wilson 하한으로 정렬(캡션 "정렬: 탭률 — 방문이 적은 건 뒤로 보내요"). 값 없는 행은 방향 무관 맨 뒤(tracking 관례).
- 인플루언서 묶기 시 열: `인플루언서 · 콘텐츠 n · 조회 · 클릭 · 도착 · 탭 · 클릭률 · 탭률 · 탭 기여`(게시·열기·펼침 없음).

**펼침(스레드 읽기 흐름)** — 부모 열을 공유하는 자식 행(배경 surface, 36px, 13px, 왼쪽 2px 파란 경계). 라벨 줄 "스레드 읽기 흐름 · {등록}개 등록{/스레드 n개} · 새로고침 {M/D} 기준 · %는 1/ 본문 조회 대비". 게시물마다 한 줄: 콘텐츠 칸 `1/ 본문` `2/` … `🔗 링크 댓글`, **조회 칸**에 views + 44px 고정 폭 `%`(main은 빈칸), **link 줄만 클릭 칸**에 clicks. 마지막 줄 하단 경계선 + 각주 "조회·클릭은 마지막 새로고침 시점 값이에요". 게시물 0개면 한 줄 "등록된 게시물이 없어요 — 트래킹에서 게시물을 등록하면 여기 채워져요".

**미연결** — 표 아래 `<details>` "▶ 링크와 연결되지 않은 랜딩 방문 N건 — utm_content 없음 a · 모르는 값 b". 펼치면 utm_content별 도착·탭 소표(상위 5 + 나머지).

**상태 4종** — 로딩 "불러오는 중…" / 오류 "성과를 불러오지 못했습니다 [다시 시도]"(빈 상태로 위장 안 함) / 빈 상태(캠페인 없음): "트래킹 링크를 만들면 그 링크로 들어온 랜딩 방문과 LINE 탭이 여기 모여요" + `/tracking?view=links` 링크 / 캠페인은 있는데 이벤트 0: 표는 그리되 도착·탭 0, 각주 "아직 들어온 방문이 없어요 — 브릿지가 연결되면 바로 채워져요".

UX 원칙 체크(AGENTS.md): 라벨은 이득 언어("아직 판단 이르어요", "게시물 연결 전"), 내부 용어(Wilson·utm) 화면 노출 없음(utm_content 코드는 툴팁 데이터로만), 결과에 판단 서술(결정 카드·표본 배지), 라벨-값 일치(배지·정렬은 같은 `performanceJudgment` 함수), 비용 액션 없음(외부 호출 0).

## 게시물 표(`/tracking › 게시물`) 변경 — 역할

원고가 연결된 행의 **원고 열** 제목 아래 13px 역할 칩(`본문` / `이어지는 본문` / `링크 댓글`, 자동 판정이면 흐리게·title "자동으로 판정했어요 — 눌러서 바꿀 수 있어요"). 클릭 → 3택 팝오버 → `PATCH /api/tracking/[id] {role}`. 자동 판정으로 되돌리기(null)도 팝오버에. 원고 미연결 행은 칩 없음(판정 근거가 없다).

역할은 저장하지 않고 읽기 시점에 판정하므로(§역할 판정) `GET /api/tracking` 목록이 `role`(저장값, null 가능)과 `derivedRole`(postRole 결과)을 함께 내려준다 — `trackingStore`가 원고별로 링크 `short_url` 집합과 최신 스냅샷 `raw`를 모아 `postRole`을 호출한다. 칩은 `role ?? derivedRole`을 표시하고, `role`이 null이면 "자동" 흐림 처리.

## API

| 동작 | 라우트 | 게이트 |
|---|---|---|
| 이벤트 수집 | `POST /api/landing-events` | Bearer `LANDING_EVENTS_SECRET` |
| 성과 읽기 | `GET /api/performance?campaign=&range=` → `{ campaigns, selected, summary, rows, unlinked }` | `requireAllowedUser` |
| 역할 변경 | `PATCH /api/tracking/[id]` (기존) `{ role: 'main'\|'thread'\|'link'\|null }` 추가 | `requireMember` |

로직은 lib, 라우트는 얇게. `campaign`이 목록에 없으면 최근 캠페인으로 대체하고 `selected`로 알려준다(캠페인 미존재 `?id=` → 첫 캠페인 선택, 캠페인 관리 관례).

## 오류·경계

- 시크릿 불일치·누락·env 미설정 → 401(본문 없음). 스키마 위반 → 400 `{error:'events[3].kind가 올바르지 않아요', index, field}`. 저장 실패 → 500(브릿지가 재시도, 멱등이라 안전).
- 링크는 있는데 원고 없음(트래킹 화면에서 독립 생성) → 제목 = utm_content, 조회 "게시물 연결 전"이 아니라 "—"(연결할 원고가 없어 등록 유도가 성립하지 않음), 열기에 "원고" 없음.
- 원고에 게시물이 있는데 링크 URL이 어느 게시물에도 없음(인플이 다른 링크를 씀) → `link` 없음, 스레드 읽기 흐름에 링크 줄 없음. 클릭은 그대로(short.io 기준).
- main 게시물의 스냅샷이 `unavailable`(삭제·비공개) → 마지막 views 유지 + 툴팁 "게시물을 볼 수 없어요(삭제·비공개) · {확인 시각}"(tracked_post.unavailable_at 관례).
- 같은 인플이 같은 콘텐츠 라벨로 링크 둘(`-2`) → 행 둘. 1:1:1 운영 방침의 예외지만 표는 정직하게 둘 다 보인다.
- 기간 7d/30d에서 도착 0인 콘텐츠도 행 유지(0은 사실).
- 탭 > 도착(뷰 핑 전에 탭한 방문은 tap만 있어도 사람 도착으로 세므로 이론상 불가). 만약 데이터 오류로 발생하면 탭률 100% 상한 없이 그대로 표시하고 툴팁 "기록이 어긋나 있어요".

## 테스트 (node:test + tsx, 실 Supabase, `test-` 접두 자가 정리, `--test-concurrency=1`)

- `landingEvent.test.ts`(순수): 정상 파싱 / 필수 누락·타입 오류의 index·field / 101건 거부 / 알 수 없는 필드 무시
- `landingEventStore.test.ts`(DB): 멱등 insert(중복 event_id → accepted 0) / 사람 판정(arrival만 → 제외, view만 → 도착, tap만 → 도착+탭, bot UA → 제외) / 서울 경계(UTC 15시 이벤트가 다음 날) / utm_content별 집계 / 미연결 집계
- `postRole.test.ts`(순수): expanded_url 매칭(스킴·슬래시 차이) → link / 가장 이른 것 main·나머지 thread / isReply=false 우선 / 저장 role 우선 / 링크 없는 원고
- `performanceJudgment.test.ts`(순수): Wilson 정렬(2/2가 8/80 아래) / 배지 임계 19·20·49·50 / 탭 기여·결정 문장 / 인플루언서 묶기 합산·재계산 / 0 분모
- `performanceStore.test.ts`(DB): 링크+원고+게시물 2개(main·link)+이벤트 → ContentRow 필드 / 원고 없는 링크 / 기간 필터가 도착·탭에만 / 캠페인 목록 순서
- 화면: `build + start -p 3001 + 127.0.0.1` 후 koo QA. 린트 기준선 24 유지.

## 배포 체크리스트

1. 마이그레이션 034·035 적용(`npm run migrate` — .env는 `vercel env pull`)
2. Vercel 프로덕션 env `LANDING_EVENTS_SECRET` 추가(브릿지 프로젝트와 같은 값)
3. 배포 후 브릿지 세션에 전달: 엔드포인트·필드명 변경 없음(계약 그대로), `lib/deck.ts` Sender 구현 → 브릿지 배포
4. 확인: 생성기로 만든 링크의 `utm_content`로 브릿지 접근·탭 → `/performance` 그 행의 도착·탭이 1씩 오르는지, 봇 UA(curl)로 접근 → "세지 않았어요" 수만 오르는지
5. 클리닉 클라이언트의 `landing_url`을 브릿지 URL로 설정
6. `.vercel/project.json`이 cb-x-deck인지 확인(워크트리 링크 함정 메모리)

## 새 파일 / 수정 파일

새 파일:
- `migrations/034_landing_event.sql`, `migrations/035_tracked_post_role.sql`
- `src/lib/landingEvent.ts`(+test) — 계약 타입·파서
- `src/lib/landingEventStore.ts`(+test) — insert·집계·미연결·제외
- `src/lib/postRole.ts`(+test) — 역할 판정
- `src/lib/performanceJudgment.ts`(+test) — 비율·배지·Wilson·결정 문장·인플 묶기
- `src/lib/performanceStore.ts`(+test) — ContentRow 조립·캠페인 목록
- `src/app/api/landing-events/route.ts`, `src/app/api/performance/route.ts`
- `src/app/performance/page.tsx`, `src/components/PerformanceCards.tsx`, `src/components/PerformanceTable.tsx`

수정:
- `src/components/Sidebar.tsx` — "성과" 항목
- `src/lib/trackingStore.ts` — `role` 읽기·쓰기(`setRole`), 목록에 role 포함
- `src/app/api/tracking/[id]/route.ts` — PATCH `role`
- `src/components/TrackingTable.tsx` — 역할 칩
- `README.md`/env 견본 — `LANDING_EVENTS_SECRET`

## 범위 밖 (백로그)

- 캠페인 전체 일별 도착·탭 추이(카드 아래 한 줄) · 콘텐츠별 날짜 표(조회·클릭 주기 갱신이 붙은 뒤)
- 조회·클릭 자동 주기 갱신(cron) — 게시물 트래킹 자동화와 같은 단계
- 콘텐츠 유형 태그(후기/비교/정보…)와 유형별 묶어 보기
- 스레드 전체 일괄 등록("이 트윗의 스레드 전부 등록" — getxapi 스레드 조회)
- LINE 친구추가 완료까지 잇기(LIFF 별도 프로젝트; `友だち追加経路`는 20건 미만 비공개)
- 제외한 방문 상세(국가·UA 분류 팝업), 이전 캠페인 대비 비교, 다음 캠페인 후보 저장
- 표현 컴플라이언스 배지(医療広告ガイドライン·ステマ規制) — 성과 좋은 표현을 그대로 복제 권장하지 않기 위한 장치

## 결정 기록

| 결정 | 근거 |
|---|---|
| 별도 페이지 | 리서치: 플랫폼 10종 전부 Reports/Analytics를 운영 화면과 분리. `/tracking` 두 탭은 등록·갱신 작업 표. B단계에서 퍼널 전체를 담을 자리 |
| 콘텐츠 주인공, 인플은 묶어 보기 | koo: "중요한 것은 어떤 콘텐츠가 LINE 인입을 만드느냐". 리서치는 인플/콘텐츠 별도 표가 관행이나 표 하나+묶기 축이 밀도가 낮고 같은 답을 준다 |
| 탭 수 기본 정렬 | 인입"량"이 질문. 탭률 1위가 탭 6건이면 근거가 못 됨 |
| Wilson 하한 정렬, 분모 병기, 표본 배지 | Evan Miller·MeasuringU·NN/g(리서치 §B-2). 시각 상태를 실제로 바꿔야 무시되지 않는다 |
| 본문 조회 단일, 합산 금지 | koo 08-26. 본문과 링크 댓글은 다른 것을 측정한다 |
| 역할은 읽기 시점 판정 + 수동 값만 저장 | 등록 순서에 좌우되지 않고, 사람이 고친 값만 영구 |
| 펼침 = 스레드 흐름만 | 날짜별은 콘텐츠 A/B 결정을 바꾸지 않고 8줄을 차지(koo 08-26) |
| 034·035 번호 | 033은 캠페인 관리 브랜치 사용 중. 번호 공백은 적용 스크립트에 무해 |
| 기간은 도착·탭에만 | 조회·클릭은 스냅샷이라 기간 필터가 성립하지 않음 — 숨기는 대신 도움말로 명시(아는 만큼만 말한다) |
