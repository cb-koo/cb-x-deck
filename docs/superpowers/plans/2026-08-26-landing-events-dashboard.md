# 랜딩 이벤트 수집 + 성과 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 브릿지 랜딩페이지 이벤트(arrival/view/tap)를 `POST /api/landing-events`로 받아 저장하고, `/performance` 페이지에서 콘텐츠(원고)별 조회→클릭→도착→탭 퍼널 순위표와 스레드 읽기 흐름을 보여 다음 캠페인의 인플루언서·콘텐츠 선택에 쓴다.

**Architecture:** 이벤트는 append-only `landing_event`에 멱등 저장(시크릿 헤더 게이트, 사람 판정은 읽기 시점 SQL). 읽기는 `tracking_link`(콘텐츠 1=링크 1)를 기준으로 `draft`·`tracked_post`+최신 스냅샷(조회)·최신 `link_click_snapshot`(클릭)·`landing_event` 집계(도착·탭)를 조인해 `ContentRow`를 만들고, 비율·배지·Wilson 정렬·결정 문장은 순수 함수(`performanceJudgment`)가 서버·클라 공통으로 계산한다. 게시물 역할(main/thread/link)은 저장하지 않고 읽기 시점에 `postRole`로 판정하며, 사람이 고친 값만 `tracked_post.role`에 남는다.

**Tech Stack:** Next.js 16(App Router, route handlers), React 19, postgres.js(`sql` 태그, 실 Supabase 트랜잭션 풀러), node:test + tsx, Tailwind 4(리포 토큰 `text-ui`·`text-caption`·`x-*`).

**Spec:** `docs/superpowers/specs/2026-08-25-landing-events-design.md` — 모든 태스크의 요구사항은 이 스펙을 따른다. 시안: https://claude.ai/code/artifact/857b2f4d-b4d2-451e-a3d2-fee0ecf462a0

## Global Constraints

- 마이그레이션 번호 **034·035**(033은 캠페인 관리 브랜치 사용 중). 헤더 주석에 스펙 경로.
- 로직은 `src/lib`, 라우트는 얇게. 라우트 하네스 없음 — 라우트 검증은 스토어 테스트 + `build+start+curl`.
- 테스트: `node:test` + tsx, 실 DB, 테스트 데이터는 프로세스 고유 접두(`P`)로 만들고 `after`에서 자가 정리, `--test-concurrency=1`. 단일 파일 실행: `node --import tsx --env-file-if-exists=.env --test src/lib/<file>.test.ts`.
- `.env`는 gitignore — 없으면 `cp ../tracking-link-generator/.env .env`(같은 Vercel 프로젝트의 형제 워크트리). `.vercel/`은 복사하지 않는다.
- 이 API는 브릿지 서버가 부른다 → `requireMember` 아님, `LANDING_EVENTS_SECRET` Bearer 비교(`crypto.timingSafeEqual`). env 미설정이면 전부 401.
- 시간대: 날짜 경계는 전부 Asia/Seoul(`src/lib/datetime.ts`의 `kstDaysAgoStart`·`kstDate`). `new Date().toISOString().slice(0,10)` 금지.
- 외부 호출 0, cron 없음. `usageStore` 기록 없음.
- 화면 문구는 이득 언어(AGENTS.md UX 원칙). 내부 용어(Wilson·utm) 화면 노출 금지 — `utm_content` 코드는 툴팁 데이터로만.
- 표 규격: 부모 행 48px 한 줄, 본문 15px(`text-content`), 보조 13px(`text-ui`), 11px(`text-caption`)은 단위 캡션만.
- 표본 배지 상수 `SAMPLE_EARLY = 20`, `SAMPLE_REF = 50`. 탭률 표기 `15% (61/412)`.
- 린트 기준선 24(`npm run lint` 경고 수가 24를 넘으면 새로 만든 위반).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File Structure

새 파일(책임 하나씩):

| 파일 | 책임 |
|---|---|
| `migrations/034_landing_event.sql` | 이벤트 원장 테이블·인덱스 |
| `migrations/035_tracked_post_role.sql` | `tracked_post.role` |
| `src/lib/landingEvent.ts` (+test) | 브릿지 계약 타입 + 본문 파서(순수) |
| `src/lib/landingEventStore.ts` (+test) | insert(멱등) · utm_content별 방문 집계 · 미연결 집계 |
| `src/lib/postRole.ts` (+test) | 게시물 역할 판정(순수) |
| `src/lib/performanceJudgment.ts` (+test) | 비율·배지·Wilson·정렬·결정 문장·인플 묶기(순수) |
| `src/lib/performanceStore.ts` (+test) | 캠페인 목록 · `ContentRow` 조립 |
| `src/app/api/landing-events/route.ts` | POST 수집 |
| `src/app/api/performance/route.ts` | GET 읽기 |
| `src/app/performance/page.tsx` | 페이지 상태(필터·묶기·정렬·펼침) |
| `src/components/PerformanceCards.tsx` | 결정 카드 4 |
| `src/components/PerformanceTable.tsx` | 순위표 + 펼침 + 미연결 |

수정:

| 파일 | 변경 |
|---|---|
| `src/proxy.ts` | `/api/landing-events` 조기 통과 |
| `src/lib/trackingStore.ts` | `role`·`derivedRole` 읽기, `setRole` |
| `src/app/api/tracking/[id]/route.ts` | PATCH `role` |
| `src/components/TrackingTable.tsx` · `src/app/tracking/page.tsx` | 역할 select + 핸들러 |
| `src/components/XIcons.tsx` · `src/components/Sidebar.tsx` | `TrendIcon` + "성과" 항목 |
| `README.md` | `LANDING_EVENTS_SECRET` |

---

### Task 1: 마이그레이션 034·035 + 로컬 환경

**Files:**
- Create: `migrations/034_landing_event.sql`
- Create: `migrations/035_tracked_post_role.sql`

**Interfaces:**
- Produces: 테이블 `landing_event`(컬럼은 스펙 §데이터 모델 그대로), 컬럼 `tracked_post.role text check in ('main','thread','link')`.

- [ ] **Step 1: .env 준비(없을 때만)**

Run: `test -f .env || cp ../tracking-link-generator/.env .env; grep -c PGHOST .env`
Expected: `1`

- [ ] **Step 2: 034 작성**

```sql
-- 034: 브릿지 랜딩 이벤트 — append-only 원장. 봇·사람 필터는 저장하지 않고 읽기 시점에 판정한다.
-- 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md
-- 033은 캠페인 관리 브랜치(cb-koo/campaign-management)가 쓰고 있어 건너뜀 — 번호 공백은 적용 스크립트에 무해(026 선례).
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

- [ ] **Step 3: 035 작성**

```sql
-- 035: 게시물의 역할 — 한 원고에 게시물이 여럿일 때(스레드·링크 댓글) 어느 것이 '콘텐츠 조회'인지.
-- null = 자동 판정(읽기 시점, src/lib/postRole.ts). 값이 있으면 사람이 고친 것 — 자동 판정이 덮지 않는다.
-- 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §역할 판정
alter table tracked_post add column if not exists role text check (role in ('main','thread','link'));
```

- [ ] **Step 4: 적용**

Run: `npm run migrate 2>&1 | tail -4`
Expected: `== applying migrations/034_landing_event.sql` … `== applying migrations/035_tracked_post_role.sql` … `== done` (기존 파일은 전부 `if not exists`라 재적용 무해)

- [ ] **Step 5: 확인**

Run: `set -a; source .env; set +a; psql -c "\d landing_event" | head -5; psql -c "select column_name from information_schema.columns where table_name='tracked_post' and column_name='role'"`
Expected: `landing_event` 정의 출력 + `role` 1행

- [ ] **Step 6: Commit**

```bash
git add migrations/034_landing_event.sql migrations/035_tracked_post_role.sql
git commit -m "feat(landing-events): 마이그레이션 034 landing_event·035 tracked_post.role

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 계약 타입 + 본문 파서 `landingEvent.ts`

**Files:**
- Create: `src/lib/landingEvent.ts`
- Test: `src/lib/landingEvent.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LandingKind = 'arrival' | 'view' | 'tap';
  export interface LandingEventInput {
    eventId: string; visitId: string; kind: LandingKind;
    clinic: string; hostname: string; path: string;
    utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null;
    refererHost: string | null; ua: string; isBotUa: boolean; secFetchOk: boolean;
    ipHash: string | null; country: string | null;
    occurredAt: string; // ISO
  }
  export const MAX_EVENTS = 100;
  export type ParseResult =
    | { ok: true; events: LandingEventInput[] }
    | { ok: false; index: number | null; field: string; error: string };
  export function parseLandingEvents(body: unknown): ParseResult;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/landingEvent.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLandingEvents, MAX_EVENTS } from './landingEvent.ts';

const ev = (over: Record<string, unknown> = {}) => ({
  event_id: 'e1', visit_id: 'v1', kind: 'view', clinic: 'mimodream',
  hostname: 'x-line-link-bridge.vercel.app', path: '/mimodream',
  utm_source: 'x', utm_content: 'hana_kim-0824',
  ua: 'Mozilla/5.0', is_bot_ua: false, sec_fetch_ok: false,
  ts: '2026-08-26T01:02:03.000Z', ...over,
});

test('정상 본문 → camelCase 이벤트, 선택 필드는 null', () => {
  const r = parseLandingEvents({ events: [ev()] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].eventId, 'e1');
  assert.equal(r.events[0].utmContent, 'hana_kim-0824');
  assert.equal(r.events[0].utmMedium, null);
  assert.equal(r.events[0].refererHost, null);
  assert.equal(r.events[0].occurredAt, '2026-08-26T01:02:03.000Z');
});

test('필수 누락·타입 오류는 index·field로 짚어 준다', () => {
  const r1 = parseLandingEvents({ events: [ev(), ev({ visit_id: undefined })] });
  assert.deepEqual(r1.ok ? null : { index: r1.index, field: r1.field }, { index: 1, field: 'visit_id' });
  const r2 = parseLandingEvents({ events: [ev({ kind: 'click' })] });
  assert.deepEqual(r2.ok ? null : { index: r2.index, field: r2.field }, { index: 0, field: 'kind' });
  const r3 = parseLandingEvents({ events: [ev({ is_bot_ua: 'no' })] });
  assert.equal(r3.ok ? '' : r3.field, 'is_bot_ua');
  const r4 = parseLandingEvents({ events: [ev({ ts: 'yesterday' })] });
  assert.equal(r4.ok ? '' : r4.field, 'ts');
});

test('events가 배열이 아니거나 비었거나 100건 초과면 거부(index null)', () => {
  const r1 = parseLandingEvents({});
  assert.deepEqual(r1.ok ? null : { index: r1.index, field: r1.field }, { index: null, field: 'events' });
  const r2 = parseLandingEvents({ events: [] });
  assert.equal(r2.ok, false);
  const r3 = parseLandingEvents({ events: Array.from({ length: MAX_EVENTS + 1 }, () => ev()) });
  assert.equal(r3.ok, false);
});

test('알 수 없는 필드는 무시하고, 2,000자 초과 문자열은 거부', () => {
  const r1 = parseLandingEvents({ events: [ev({ future_field: 1 })] });
  assert.equal(r1.ok, true);
  const r2 = parseLandingEvents({ events: [ev({ ua: 'x'.repeat(2001) })] });
  assert.equal(r2.ok ? '' : r2.field, 'ua');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/landingEvent.test.ts`
Expected: FAIL — `Cannot find module './landingEvent.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/landingEvent.ts
// 브릿지(x-line-link-bridge) ↔ cb-x-deck 계약. 필드명은 브릿지 lib/deck.ts와 맞춰져 있다 — 바꾸면 브릿지에 알릴 것.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §수집 API
export type LandingKind = 'arrival' | 'view' | 'tap';
const KINDS: readonly LandingKind[] = ['arrival', 'view', 'tap'];

export interface LandingEventInput {
  eventId: string; visitId: string; kind: LandingKind;
  clinic: string; hostname: string; path: string;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null;
  refererHost: string | null; ua: string; isBotUa: boolean; secFetchOk: boolean;
  ipHash: string | null; country: string | null;
  occurredAt: string; // ISO — 브릿지 시각(ts)
}

export const MAX_EVENTS = 100;   // 브릿지는 1건씩 보내지만 배치 여지를 남긴다. 그 이상은 잘못된 호출
const MAX_STR = 2000;            // 필드 하나가 이 길이를 넘으면 계약 밖의 값이다

export type ParseResult =
  | { ok: true; events: LandingEventInput[] }
  | { ok: false; index: number | null; field: string; error: string };

type Fail = { field: string; reason: string };
const fail = (field: string, reason: string): Fail => ({ field, reason });

function str(o: Record<string, unknown>, k: string, required: boolean): string | null | Fail {
  const v = o[k];
  if (v === undefined || v === null) return required ? fail(k, '필수 값이 없어요') : null;
  if (typeof v !== 'string') return fail(k, '문자열이어야 해요');
  if (required && v.length === 0) return fail(k, '빈 문자열이에요');
  if (v.length > MAX_STR) return fail(k, `${MAX_STR}자를 넘어요`);
  return v;
}
function bool(o: Record<string, unknown>, k: string): boolean | Fail {
  return typeof o[k] === 'boolean' ? (o[k] as boolean) : fail(k, 'true/false여야 해요');
}
const isFail = (v: unknown): v is Fail => typeof v === 'object' && v !== null && 'reason' in (v as Fail);

function parseOne(raw: unknown): LandingEventInput | Fail {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('event', '객체여야 해요');
  const o = raw as Record<string, unknown>;
  const req = ['event_id', 'visit_id', 'clinic', 'hostname', 'path', 'ua'] as const;
  const got: Record<string, string> = {};
  for (const k of req) { const v = str(o, k, true); if (isFail(v)) return v; got[k] = v as string; }
  const kind = o.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as LandingKind)) return fail('kind', 'arrival·view·tap 중 하나여야 해요');
  const opt: Record<string, string | null> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referer_host', 'ip_hash', 'country']) {
    const v = str(o, k, false); if (isFail(v)) return v; opt[k] = v;
  }
  const isBotUa = bool(o, 'is_bot_ua'); if (isFail(isBotUa)) return isBotUa;
  const secFetchOk = bool(o, 'sec_fetch_ok'); if (isFail(secFetchOk)) return secFetchOk;
  const ts = str(o, 'ts', true); if (isFail(ts)) return ts;
  const ms = Date.parse(ts as string);
  if (Number.isNaN(ms)) return fail('ts', 'ISO 8601 시각이어야 해요');
  return {
    eventId: got.event_id, visitId: got.visit_id, kind: kind as LandingKind,
    clinic: got.clinic, hostname: got.hostname, path: got.path,
    utmSource: opt.utm_source, utmMedium: opt.utm_medium, utmCampaign: opt.utm_campaign,
    utmContent: opt.utm_content, utmTerm: opt.utm_term, refererHost: opt.referer_host,
    ua: got.ua, isBotUa, secFetchOk, ipHash: opt.ip_hash, country: opt.country,
    occurredAt: new Date(ms).toISOString(),
  };
}

// 본문 전체 → 이벤트 배열. 첫 오류에서 멈추고 어느 건(index)의 어느 필드(field)인지 알려준다 —
// 브릿지 쪽에서 계약 어긋남을 바로 짚을 수 있게(400 응답 본문이 이 값을 그대로 싣는다).
export function parseLandingEvents(body: unknown): ParseResult {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, index: null, field: 'events', error: 'events는 1건 이상의 배열이어야 해요' };
  }
  if (events.length > MAX_EVENTS) {
    return { ok: false, index: null, field: 'events', error: `한 번에 ${MAX_EVENTS}건까지만 받아요` };
  }
  const out: LandingEventInput[] = [];
  for (let i = 0; i < events.length; i++) {
    const r = parseOne(events[i]);
    if (isFail(r)) return { ok: false, index: i, field: r.field, error: `events[${i}].${r.field}: ${r.reason}` };
    out.push(r);
  }
  return { ok: true, events: out };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/landingEvent.test.ts`
Expected: `# pass 4`

- [ ] **Step 5: Commit**

```bash
git add src/lib/landingEvent.ts src/lib/landingEvent.test.ts
git commit -m "feat(landing-events): 브릿지 이벤트 계약 타입 + 본문 파서(index·field로 오류 위치)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 스토어 — 멱등 insert · utm_content별 방문 집계 · 미연결 집계

**Files:**
- Create: `src/lib/landingEventStore.ts`
- Test: `src/lib/landingEventStore.test.ts`

**Interfaces:**
- Consumes: `LandingEventInput` (Task 2), `kstDaysAgoStart` (`src/lib/datetime.ts`).
- Produces:
  ```ts
  export type Range = 'all' | '7d' | '30d';
  export function rangeStart(range: Range, now?: () => number): Date | null;   // all → null
  export async function insertLandingEvents(sql, events: LandingEventInput[]): Promise<{ accepted: number; duplicates: number }>;
  export interface ContentStats { utmContent: string; visits: number; arrivals: number; taps: number }
  export async function statsByUtmContent(sql, utmContents: string[], since: Date | null): Promise<Map<string, ContentStats>>;
  export interface UnlinkedStats { total: number; byContent: Array<{ utmContent: string | null; arrivals: number; taps: number }> }
  export async function unlinkedStats(sql, knownUtmContents: string[], campaign: string | null, since: Date | null): Promise<UnlinkedStats>;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/landingEventStore.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import type { LandingEventInput } from './landingEvent.ts';
import { insertLandingEvents, statsByUtmContent, unlinkedStats, rangeStart } from './landingEventStore.ts';

const sql = getSql();
const P = 'tlev' + process.pid.toString(36) + Date.now().toString(36);
const C1 = `${P}-c1`, C2 = `${P}-c2`, CAMP = `${P}-camp`;
let n = 0;
const ev = (over: Partial<LandingEventInput>): LandingEventInput => ({
  eventId: `${P}-e${++n}`, visitId: `${P}-v`, kind: 'view', clinic: 'mind',
  hostname: 'bridge.test', path: '/mind', utmSource: 'x', utmMedium: null, utmCampaign: CAMP,
  utmContent: C1, utmTerm: null, refererHost: null, ua: 'ua', isBotUa: false, secFetchOk: false,
  ipHash: null, country: 'JP', occurredAt: '2026-08-20T03:00:00.000Z', ...over,
});

after(async () => {
  await sql`delete from landing_event where event_id like ${P + '%'}`;
  await sql.end();
});

test('1) 멱등 insert — 같은 event_id는 duplicates로 세고 202감', async () => {
  const a = ev({ eventId: `${P}-dup` });
  const r1 = await insertLandingEvents(sql, [a, ev({})]);
  assert.deepEqual(r1, { accepted: 2, duplicates: 0 });
  const r2 = await insertLandingEvents(sql, [a]);
  assert.deepEqual(r2, { accepted: 0, duplicates: 1 });
});

test('2) 사람 판정은 방문 단위 — arrival만은 제외, view/tap이 있으면 도착, 봇 UA는 전부 제외', async () => {
  await insertLandingEvents(sql, [
    ev({ visitId: `${P}-A`, kind: 'arrival', utmContent: C2 }),                       // 프리페치: 제외
    ev({ visitId: `${P}-B`, kind: 'arrival', utmContent: C2 }), ev({ visitId: `${P}-B`, kind: 'view', utmContent: C2 }), // 도착
    ev({ visitId: `${P}-C`, kind: 'tap', utmContent: C2 }),                            // view 없이 tap: 도착+탭
    ev({ visitId: `${P}-D`, kind: 'view', utmContent: C2, isBotUa: true }), ev({ visitId: `${P}-D`, kind: 'tap', utmContent: C2, isBotUa: true }), // 봇: 제외
    ev({ visitId: `${P}-B`, kind: 'view', utmContent: C2 }),                           // 같은 방문 중복 핑: 여전히 1
  ]);
  const m = await statsByUtmContent(sql, [C2], null);
  assert.deepEqual(m.get(C2), { utmContent: C2, visits: 4, arrivals: 2, taps: 1 });
  assert.equal(m.has(`${P}-none`), false); // 이벤트 없는 키는 항목 없음(호출부가 0으로 채운다)
});

test('3) 기간은 서울 경계 — since 이전 이벤트는 빠진다', async () => {
  const old = '2026-08-01T00:00:00.000Z';
  await insertLandingEvents(sql, [ev({ visitId: `${P}-old`, occurredAt: old, utmContent: C1 })]);
  const all = await statsByUtmContent(sql, [C1], null);
  const recent = await statsByUtmContent(sql, [C1], new Date('2026-08-10T15:00:00.000Z')); // = 8/11 00:00 KST
  assert.equal((all.get(C1)?.arrivals ?? 0) - (recent.get(C1)?.arrivals ?? 0), 1);
  assert.equal(rangeStart('all'), null);
  assert.ok(rangeStart('7d') instanceof Date);
});

test('4) 미연결 — 아는 utm_content가 아닌 것과 null만, 캠페인은 같거나 null', async () => {
  await insertLandingEvents(sql, [
    ev({ visitId: `${P}-u1`, utmContent: `${P}-unknown` }),
    ev({ visitId: `${P}-u2`, utmContent: null }),
    ev({ visitId: `${P}-u3`, utmContent: null, utmCampaign: null }),
    ev({ visitId: `${P}-u4`, utmContent: null, utmCampaign: `${P}-other` }), // 다른 캠페인: 빠짐
    ev({ visitId: `${P}-u5`, utmContent: `${P}-unknown`, kind: 'tap' }),
  ]);
  const u = await unlinkedStats(sql, [C1, C2], CAMP, null);
  assert.equal(u.total, 4);
  const unknown = u.byContent.find((b) => b.utmContent === `${P}-unknown`);
  assert.deepEqual(unknown, { utmContent: `${P}-unknown`, arrivals: 2, taps: 1 });
  assert.equal(u.byContent.find((b) => b.utmContent === null)?.arrivals, 2);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/landingEventStore.test.ts`
Expected: FAIL — `Cannot find module './landingEventStore.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/landingEventStore.ts
// 랜딩 이벤트 원장 읽기/쓰기. 사람·봇 판정은 저장하지 않고 여기서 읽기 시점 SQL로 한다 —
// 규칙이 바뀌어도 과거 데이터가 새 규칙으로 다시 읽힌다(스펙 §집계 규칙).
import type postgres from 'postgres';
import type { LandingEventInput } from './landingEvent.ts';
import { kstDaysAgoStart } from './datetime.ts';

export type Range = 'all' | '7d' | '30d';

// 기간 시작 순간(서울 00:00). all은 경계 없음. 시계 주입은 datetime.ts 관례(테스트용).
export function rangeStart(range: Range, now: () => number = Date.now): Date | null {
  if (range === '7d') return kstDaysAgoStart(6, now);   // 오늘 포함 7일
  if (range === '30d') return kstDaysAgoStart(29, now);
  return null;
}

// 멱등 insert — event_id unique에 걸린 건은 조용히 넘기고 개수만 알려준다(브릿지 재시도가 중복을 만들지 않게).
export async function insertLandingEvents(
  sql: postgres.Sql, events: LandingEventInput[],
): Promise<{ accepted: number; duplicates: number }> {
  if (events.length === 0) return { accepted: 0, duplicates: 0 };
  const rows = events.map((e) => ({
    event_id: e.eventId, visit_id: e.visitId, kind: e.kind, clinic: e.clinic, hostname: e.hostname, path: e.path,
    utm_source: e.utmSource, utm_medium: e.utmMedium, utm_campaign: e.utmCampaign, utm_content: e.utmContent, utm_term: e.utmTerm,
    referer_host: e.refererHost, ua: e.ua, is_bot_ua: e.isBotUa, sec_fetch_ok: e.secFetchOk,
    ip_hash: e.ipHash, country: e.country, occurred_at: e.occurredAt,
  }));
  const ins = await sql<Array<{ id: string }>>`
    insert into landing_event ${sql(rows)}
    on conflict (event_id) do nothing
    returning id`;
  return { accepted: ins.length, duplicates: events.length - ins.length };
}

export interface ContentStats {
  utmContent: string;
  visits: number;    // distinct visit_id 전체(봇·프리페치 포함)
  arrivals: number;  // 사람 도착 = not bot and (view or tap)
  taps: number;      // not bot and tap
}

// 방문(visit_id) 단위로 먼저 접고 콘텐츠별로 센다. since가 null이면 기간 경계 없음.
export async function statsByUtmContent(
  sql: postgres.Sql, utmContents: string[], since: Date | null,
): Promise<Map<string, ContentStats>> {
  if (utmContents.length === 0) return new Map();
  const rows = await sql<Array<{ utm_content: string; visits: number; arrivals: number; taps: number }>>`
    with v as (
      select utm_content, visit_id,
             bool_or(not is_bot_ua and kind in ('view','tap')) as human,
             bool_or(not is_bot_ua and kind = 'tap') as tapped
        from landing_event
       where utm_content = any(${utmContents}::text[])
         ${since ? sql`and occurred_at >= ${since}` : sql``}
       group by utm_content, visit_id)
    select utm_content,
           count(*)::int as visits,
           count(*) filter (where human)::int as arrivals,
           count(*) filter (where tapped)::int as taps
      from v group by utm_content`;
  return new Map(rows.map((r) => [r.utm_content, {
    utmContent: r.utm_content, visits: r.visits, arrivals: r.arrivals, taps: r.taps,
  }]));
}

export interface UnlinkedStats {
  total: number;   // 사람 도착 합
  byContent: Array<{ utmContent: string | null; arrivals: number; taps: number }>; // 도착 많은 순
}

// 어느 링크에도 안 맞는 유입 — 버리지 않고 따로 센다(아는 만큼만 말한다).
// 캠페인 필터는 이벤트 자신의 utm_campaign으로(선택 캠페인과 같거나 null). campaign이 null이면 캠페인 조건 없음.
export async function unlinkedStats(
  sql: postgres.Sql, knownUtmContents: string[], campaign: string | null, since: Date | null,
): Promise<UnlinkedStats> {
  const rows = await sql<Array<{ utm_content: string | null; arrivals: number; taps: number }>>`
    with v as (
      select utm_content, visit_id,
             bool_or(not is_bot_ua and kind in ('view','tap')) as human,
             bool_or(not is_bot_ua and kind = 'tap') as tapped
        from landing_event
       where (utm_content is null or not (utm_content = any(${knownUtmContents}::text[])))
         ${campaign ? sql`and (utm_campaign = ${campaign} or utm_campaign is null)` : sql``}
         ${since ? sql`and occurred_at >= ${since}` : sql``}
       group by utm_content, visit_id)
    select utm_content,
           count(*) filter (where human)::int as arrivals,
           count(*) filter (where tapped)::int as taps
      from v group by utm_content
     having count(*) filter (where human) > 0
     order by arrivals desc, utm_content nulls last`;
  return {
    total: rows.reduce((s, r) => s + r.arrivals, 0),
    byContent: rows.map((r) => ({ utmContent: r.utm_content, arrivals: r.arrivals, taps: r.taps })),
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/landingEventStore.test.ts`
Expected: `# pass 4`

- [ ] **Step 5: Commit**

```bash
git add src/lib/landingEventStore.ts src/lib/landingEventStore.test.ts
git commit -m "feat(landing-events): 이벤트 스토어 — 멱등 insert·방문 단위 사람 판정·utm_content별 집계·미연결 집계

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/landing-events` + 프록시 조기 통과 + README

**Files:**
- Create: `src/app/api/landing-events/route.ts`
- Modify: `src/proxy.ts` (getUser 호출 앞)
- Modify: `README.md:12-14`

**Interfaces:**
- Consumes: `parseLandingEvents` (Task 2), `insertLandingEvents` (Task 3).
- Produces: 엔드포인트 `POST /api/landing-events` — `202 {accepted, duplicates}` / `401` / `400 {error, index, field}`.

- [ ] **Step 1: 라우트**

```ts
// src/app/api/landing-events/route.ts
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSql } from '@/lib/db';
import { parseLandingEvents } from '@/lib/landingEvent';
import { insertLandingEvents } from '@/lib/landingEventStore';

// 브릿지 서버 → 우리. 사람이 아니라 서버가 부르므로 세션 게이트(requireMember)가 아니라 공유 시크릿이다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §수집 API
function authorized(req: Request): boolean {
  const secret = process.env.LANDING_EVENTS_SECRET;
  if (!secret) return false; // env가 비어 있으면 '열린 API'가 아니라 '닫힌 API'다
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse(null, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = parseLandingEvents(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, index: parsed.index, field: parsed.field }, { status: 400 });
  }
  // 저장 실패는 그대로 500 — 브릿지가 재시도하고, event_id 멱등이 중복을 막는다
  const result = await insertLandingEvents(getSql(), parsed.events);
  return NextResponse.json(result, { status: 202 });
}
```

- [ ] **Step 2: 프록시 — 브릿지 요청은 Supabase 인증 왕복 없이 통과**

`src/proxy.ts`의 `export async function proxy(request: NextRequest) {` 바로 아래, `let response = NextResponse.next({ request });` 앞에 추가:

```ts
  // 브릿지 서버의 이벤트 push — 세션 쿠키가 없어 갱신할 것도 없고, 인가는 라우트가 시크릿으로 한다.
  // 아래 getUser()는 요청마다 인증 서버 왕복이라 이벤트 1건마다 붙일 이유가 없다(스펙 §수집 API).
  if (request.nextUrl.pathname === '/api/landing-events') return NextResponse.next({ request });
```

- [ ] **Step 3: README env 줄**

`README.md` 14행 `GETXAPI_KEY`, … 줄 끝에 이어 추가:

```
`LANDING_EVENTS_SECRET`(브릿지 랜딩 이벤트 수집 — 브릿지 프로젝트와 같은 값, 없으면 수집 API가 전부 401).
```

- [ ] **Step 4: 로컬 .env에 임시 시크릿 + 빌드·기동·curl**

Run:
```bash
grep -q LANDING_EVENTS_SECRET .env || echo 'LANDING_EVENTS_SECRET=local-dev-secret' >> .env
npm run build 2>&1 | tail -3 && (PORT=3001 npm run start -- -p 3001 > /dev/null 2>&1 &) && sleep 4
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/api/landing-events -H 'content-type: application/json' -d '{"events":[]}'
curl -s -w '\n%{http_code}\n' -X POST http://127.0.0.1:3001/api/landing-events -H 'authorization: Bearer local-dev-secret' -H 'content-type: application/json' -d '{"events":[{"event_id":"test-curl-1","visit_id":"test-v","kind":"view","clinic":"mind","hostname":"b","path":"/mind","ua":"ua","is_bot_ua":false,"sec_fetch_ok":false,"ts":"2026-08-26T00:00:00Z","utm_content":"test-curl"}]}'
curl -s -w '\n%{http_code}\n' -X POST http://127.0.0.1:3001/api/landing-events -H 'authorization: Bearer local-dev-secret' -H 'content-type: application/json' -d '{"events":[{"event_id":"test-curl-2","kind":"nope"}]}'
```
Expected: `401` / `{"accepted":1,"duplicates":0}` `202`(두 번째 실행 시 `accepted:0,duplicates:1`) / `{"error":"events[0].visit_id: 필수 값이 없어요","index":0,"field":"visit_id"}` `400`

- [ ] **Step 5: 정리(테스트 행·서버)**

Run: `set -a; source .env; set +a; psql -c "delete from landing_event where event_id like 'test-curl%'"; pkill -f 'next start' || true`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/landing-events/route.ts src/proxy.ts README.md
git commit -m "feat(landing-events): POST /api/landing-events — Bearer 시크릿·202/400/401·프록시 조기 통과

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 게시물 역할 판정 `postRole.ts`

**Files:**
- Create: `src/lib/postRole.ts`
- Test: `src/lib/postRole.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PostRole = 'main' | 'thread' | 'link';
  export const POST_ROLES: readonly PostRole[];
  export interface RolePostInput { tweetId: string; postedAt: string | null; role: PostRole | null; rawUrls: unknown; isReply: boolean | null }
  export function normalizeUrl(u: string): string;                       // 스킴·후행 슬래시·호스트 대소문자 무시
  export function urlsOf(rawUrls: unknown): string[];                    // entities.urls 배열 → expanded_url ?? url
  export function assignRoles<T extends RolePostInput>(posts: T[], shortUrls: string[]): Array<T & { role: PostRole }>; // main → thread(게시순) → link
  ```
  `rawUrls`는 `post_metric_snapshot.raw #> '{entities,urls}'`(jsonb 배열)이다 — raw 전체가 아니라 이 조각만 SELECT한다.

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/postRole.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignRoles, normalizeUrl, urlsOf } from './postRole.ts';

const SHORT = 'https://cb.link/tavemo';
const p = (tweetId: string, postedAt: string | null, over: Partial<{ role: 'main'|'thread'|'link'|null; rawUrls: unknown; isReply: boolean | null }> = {}) =>
  ({ tweetId, postedAt, role: null, rawUrls: [], isReply: null, ...over });

test('normalizeUrl: 스킴·후행 슬래시·호스트 대소문자를 무시한다', () => {
  assert.equal(normalizeUrl('HTTPS://CB.link/tavemo/'), normalizeUrl('http://cb.link/tavemo'));
  assert.notEqual(normalizeUrl('https://cb.link/tavemo-2'), normalizeUrl(SHORT));
});

test('urlsOf: entities.urls 배열에서 expanded_url(없으면 url)만 뽑고 기형은 버린다', () => {
  assert.deepEqual(urlsOf([{ expanded_url: 'https://a/x' }, { url: 'https://t.co/b' }, 'junk', null]), ['https://a/x', 'https://t.co/b']);
  assert.deepEqual(urlsOf(null), []);
});

test('링크가 든 게시물은 위치와 무관하게 link, 나머지는 가장 이른 것이 main', () => {
  const posts = [
    p('3', '2026-08-24T01:10:00Z', { rawUrls: [{ expanded_url: SHORT }] }),
    p('1', '2026-08-24T01:00:00Z'),
    p('2', '2026-08-24T01:05:00Z', { isReply: true }),
  ];
  const r = assignRoles(posts, [SHORT]);
  assert.deepEqual(r.map((x) => [x.tweetId, x.role]), [['1', 'main'], ['2', 'thread'], ['3', 'link']]);
});

test('저장된 role은 자동 판정을 덮는다', () => {
  const r = assignRoles([p('1', '2026-08-24T01:00:00Z', { role: 'thread' }), p('2', '2026-08-24T01:05:00Z')], []);
  assert.deepEqual(r.map((x) => [x.tweetId, x.role]), [['2', 'main'], ['1', 'thread']]);
});

test('isReply=false인 게시물이 있으면 시각보다 우선해 main', () => {
  const r = assignRoles([p('a', '2026-08-24T00:00:00Z', { isReply: true }), p('b', '2026-08-24T00:01:00Z', { isReply: false })], []);
  assert.equal(r[0].tweetId, 'b'); assert.equal(r[0].role, 'main');
});

test('링크가 없는 원고(shortUrls 빈 배열)는 main/thread만 나온다 · 빈 입력은 빈 출력', () => {
  const r = assignRoles([p('1', '2026-08-24T00:00:00Z', { rawUrls: [{ expanded_url: SHORT }] })], []);
  assert.equal(r[0].role, 'main');
  assert.deepEqual(assignRoles([], [SHORT]), []);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/postRole.test.ts`
Expected: FAIL — `Cannot find module './postRole.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/postRole.ts
// 한 원고에 게시물이 여럿일 때(스레드·링크 댓글) 어느 게시물이 무엇인지 매긴다 — 순수 함수.
// 저장하지 않고 읽기 시점에 판정한다: 등록 순서(링크보다 게시물이 먼저 등록된 경우)에 좌우되지 않고,
// 링크가 나중에 생겨도 다음 읽기에서 바로 맞는다. 사람이 고친 값(role)만 영구다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §역할 판정
export type PostRole = 'main' | 'thread' | 'link';
export const POST_ROLES: readonly PostRole[] = ['main', 'thread', 'link'];

export interface RolePostInput {
  tweetId: string;
  postedAt: string | null;   // ISO
  role: PostRole | null;     // 저장값(사람이 고친 것). null = 자동
  rawUrls: unknown;          // post_metric_snapshot.raw #> '{entities,urls}' — getxapi 트윗의 URL 엔티티 배열
  isReply: boolean | null;   // raw.isReply
}

// 비교용 정규형: 스킴·후행 슬래시·호스트 대소문자 차이는 같은 링크다(X가 t.co를 풀어 준 expanded_url과 우리 short_url 비교).
export function normalizeUrl(u: string): string {
  const s = u.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const slash = s.indexOf('/');
  return slash === -1 ? s.toLowerCase() : s.slice(0, slash).toLowerCase() + s.slice(slash);
}

export function urlsOf(rawUrls: unknown): string[] {
  if (!Array.isArray(rawUrls)) return [];
  const out: string[] = [];
  for (const e of rawUrls) {
    if (typeof e !== 'object' || e === null) continue;
    const o = e as Record<string, unknown>;
    const v = typeof o.expanded_url === 'string' ? o.expanded_url : typeof o.url === 'string' ? o.url : null;
    if (v) out.push(v);
  }
  return out;
}

function containsShortUrl(rawUrls: unknown, shortNorm: Set<string>): boolean {
  if (shortNorm.size === 0) return false;
  return urlsOf(rawUrls).some((u) => shortNorm.has(normalizeUrl(u)));
}

const ts = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY); // 시각 없음은 맨 뒤

// 출력 순서 = 화면의 스레드 읽기 흐름 순서: main → thread(게시 순) → link.
export function assignRoles<T extends RolePostInput>(posts: T[], shortUrls: string[]): Array<T & { role: PostRole }> {
  if (posts.length === 0) return [];
  const shortNorm = new Set(shortUrls.map(normalizeUrl));
  const fixed = new Map<string, PostRole>();
  for (const p of posts) if (p.role) fixed.set(p.tweetId, p.role);

  // 1) 저장값 우선, 2) 링크 포함 → link
  const auto = posts.filter((p) => !fixed.has(p.tweetId));
  const links = auto.filter((p) => containsShortUrl(p.rawUrls, shortNorm));
  const rest = auto.filter((p) => !links.includes(p));

  // 3) main = isReply=false가 있으면 그중 가장 이른 것, 없으면 가장 이른 것
  const sorted = [...rest].sort((a, b) => ts(a.postedAt) - ts(b.postedAt));
  const main = sorted.find((p) => p.isReply === false) ?? sorted[0];

  const roleOf = (p: T): PostRole => fixed.get(p.tweetId) ?? (links.includes(p) ? 'link' : p === main ? 'main' : 'thread');
  const roled = posts.map((p) => ({ ...p, role: roleOf(p) }));
  const order: Record<PostRole, number> = { main: 0, thread: 1, link: 2 };
  return roled.sort((a, b) => order[a.role] - order[b.role] || ts(a.postedAt) - ts(b.postedAt));
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/postRole.test.ts`
Expected: `# pass 6`

- [ ] **Step 5: Commit**

```bash
git add src/lib/postRole.ts src/lib/postRole.test.ts
git commit -m "feat(landing-events): 게시물 역할 판정 postRole — 링크 URL 매칭·가장 이른 것 main·저장값 우선

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 파생값 `performanceJudgment.ts` — 비율·배지·Wilson·정렬·결정 문장·인플 묶기

**Files:**
- Create: `src/lib/performanceJudgment.ts`
- Test: `src/lib/performanceJudgment.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SAMPLE_EARLY = 20; export const SAMPLE_REF = 50;
  export type SampleState = 'early' | 'ref' | 'ok';
  export function sampleState(arrivals: number): SampleState;
  export const SAMPLE_LABEL: Record<SampleState, string | null>;  // early '아직 판단 이르어요' · ref '참고용' · ok null
  export function wilsonLower(successes: number, n: number, z?: number): number;  // n=0 → -1
  export function rate(num: number | null, den: number | null): number | null;    // den 0/null → null
  export function formatPct(r: number | null, digits?: number): string;          // null → '—'
  export interface PerfRow { key: string; title: string; influencerHandle: string; contentCount: number;
                             views: number | null; clicks: number | null; arrivals: number; taps: number; postedAt: string | null }
  export function groupByInfluencer<T extends PerfRow>(rows: T[]): PerfRow[];
  export function topShare(rows: ReadonlyArray<{ title: string; taps: number }>, n?: number): { share: number | null; titles: string[] };
  export type PerfSortKey = 'taps' | 'arrivals' | 'clicks' | 'views' | 'clickRate' | 'tapRate' | 'contribution' | 'postedAt';
  export function sortRows<T extends PerfRow>(rows: T[], key: PerfSortKey, dir: 'asc' | 'desc'): T[];
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/performanceJudgment.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleState, wilsonLower, rate, formatPct, groupByInfluencer, topShare, sortRows, SAMPLE_EARLY, SAMPLE_REF,
} from './performanceJudgment.ts';

const row = (key: string, taps: number, arrivals: number, over: Partial<{ views: number | null; clicks: number | null; influencerHandle: string; postedAt: string | null }> = {}) => ({
  key, title: key, influencerHandle: 'h', contentCount: 1, views: 1000, clicks: 100, arrivals, taps, postedAt: '2026-08-24T00:00:00Z', ...over,
});

test('표본 상태: 19 early · 20 ref · 49 ref · 50 ok', () => {
  assert.equal(sampleState(SAMPLE_EARLY - 1), 'early');
  assert.equal(sampleState(SAMPLE_EARLY), 'ref');
  assert.equal(sampleState(SAMPLE_REF - 1), 'ref');
  assert.equal(sampleState(SAMPLE_REF), 'ok');
});

test('Wilson 하한: 2/2가 8/80보다 아래, n=0은 -1', () => {
  assert.ok(wilsonLower(2, 2) < wilsonLower(8, 80));
  assert.ok(wilsonLower(61, 412) > wilsonLower(8, 80));
  assert.equal(wilsonLower(0, 0), -1);
  assert.ok(wilsonLower(0, 10) >= 0);
});

test('rate·formatPct: 분모 0/null은 null → "—", 정수%·소수 1자리', () => {
  assert.equal(rate(61, 412)!.toFixed(4), '0.1481');
  assert.equal(rate(5, 0), null); assert.equal(rate(null, 10), null);
  assert.equal(formatPct(0.1481), '15%');
  assert.equal(formatPct(0.058, 1), '5.8%');
  assert.equal(formatPct(null), '—');
});

test('정렬: 기본 탭 desc, 탭률은 Wilson 하한, 값 없는 행은 방향 무관 맨 뒤', () => {
  const rows = [row('a', 2, 2), row('b', 8, 80), row('c', 0, 0), row('d', 61, 412, { views: null, clicks: null })];
  assert.deepEqual(sortRows(rows, 'taps', 'desc').map((r) => r.key), ['d', 'b', 'a', 'c']);
  assert.deepEqual(sortRows(rows, 'tapRate', 'desc').map((r) => r.key), ['d', 'b', 'a', 'c']); // a(100%)가 b(10%) 아래
  assert.deepEqual(sortRows(rows, 'clickRate', 'desc').map((r) => r.key).at(-1), 'd');       // 조회 없음은 맨 뒤
  assert.deepEqual(sortRows(rows, 'clickRate', 'asc').map((r) => r.key).at(-1), 'd');
});

test('결정 문장: 상위 3개 기여 합, 탭 0이면 share null', () => {
  const rows = [row('a', 61, 400), row('b', 22, 200), row('c', 19, 200), row('d', 17, 100), row('e', 24, 100)];
  const t = topShare(rows);
  assert.deepEqual(t.titles, ['a', 'e', 'b']);
  assert.equal(Math.round(t.share! * 100), 75); // (61+24+22)/143
  assert.deepEqual(topShare([row('z', 0, 10)]), { share: null, titles: [] });
});

test('인플루언서 묶기: 합산·콘텐츠 수, 조회는 null 섞이면 있는 것만 합', () => {
  const rows = [
    row('a', 61, 412, { influencerHandle: 'hana_kim', views: 12400, clicks: 720 }),
    row('b', 19, 280, { influencerHandle: 'Hana_Kim', views: 38000, clicks: 510 }),
    row('c', 17, 96, { influencerHandle: 'yuki_jp', views: null, clicks: 190 }),
  ];
  const g = groupByInfluencer(rows);
  const hana = g.find((r) => r.influencerHandle === 'hana_kim')!;
  assert.deepEqual([hana.contentCount, hana.views, hana.clicks, hana.arrivals, hana.taps], [2, 50400, 1230, 692, 80]);
  assert.equal(g.find((r) => r.influencerHandle === 'yuki_jp')!.views, null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test src/lib/performanceJudgment.test.ts`
Expected: FAIL — `Cannot find module './performanceJudgment.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/performanceJudgment.ts
// 성과 화면의 파생값 — 서버 요약과 클라 표시가 같은 함수를 쓴다(라벨-값 일치, influencerJudgment 선례).
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §읽기 모델
export const SAMPLE_EARLY = 20; // 도착이 이보다 적으면 탭률을 판단에 쓰지 말 것(흐리게 + 배지)
export const SAMPLE_REF = 50;   // 이보다 적으면 참고용
export type SampleState = 'early' | 'ref' | 'ok';
export function sampleState(arrivals: number): SampleState {
  return arrivals < SAMPLE_EARLY ? 'early' : arrivals < SAMPLE_REF ? 'ref' : 'ok';
}
export const SAMPLE_LABEL: Record<SampleState, string | null> = { early: '아직 판단 이르어요', ref: '참고용', ok: null };

// Wilson score 95% 신뢰구간 하한 — 단순 비율로 정렬하면 "2건 중 2건(100%)"이 "80건 중 8건" 위로 올라간다(Evan Miller).
// 화면에 보이는 값은 단순 비율 그대로 두고, 정렬 키로만 쓴다.
export function wilsonLower(successes: number, n: number, z = 1.96): number {
  if (n <= 0) return -1;
  const p = successes / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - spread) / denom;
}

export function rate(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den <= 0) return null;
  return num / den;
}
export function formatPct(r: number | null, digits = 0): string {
  return r === null ? '—' : `${(r * 100).toFixed(digits)}%`;
}

export interface PerfRow {
  key: string; title: string; influencerHandle: string; contentCount: number;
  views: number | null; clicks: number | null; arrivals: number; taps: number;
  postedAt: string | null;
}

// 같은 사람의 콘텐츠를 합친다 — 핸들은 소문자로 묶고(대소문자 표기 차이는 같은 사람), 표시는 첫 행의 표기.
// 조회는 콘텐츠당 1값(main)씩이라 그대로 더하면 된다; 값 없는 콘텐츠는 빼고 더하되 전부 없으면 null.
export function groupByInfluencer<T extends PerfRow>(rows: T[]): PerfRow[] {
  const map = new Map<string, PerfRow>();
  for (const r of rows) {
    const k = r.influencerHandle.toLowerCase();
    const g = map.get(k);
    if (!g) {
      map.set(k, { key: k, title: `@${r.influencerHandle}`, influencerHandle: r.influencerHandle, contentCount: 1,
                   views: r.views, clicks: r.clicks, arrivals: r.arrivals, taps: r.taps, postedAt: r.postedAt });
      continue;
    }
    g.contentCount += 1;
    g.views = r.views === null ? g.views : (g.views ?? 0) + r.views;
    g.clicks = r.clicks === null ? g.clicks : (g.clicks ?? 0) + r.clicks;
    g.arrivals += r.arrivals; g.taps += r.taps;
    if (r.postedAt && (!g.postedAt || r.postedAt < g.postedAt)) g.postedAt = r.postedAt;
  }
  return [...map.values()];
}

// 결정 카드: 탭 상위 n개가 전체 탭의 몇 %인가. 탭이 0이면 아직 말할 게 없다(share null).
export function topShare(rows: ReadonlyArray<{ title: string; taps: number }>, n = 3): { share: number | null; titles: string[] } {
  const total = rows.reduce((s, r) => s + r.taps, 0);
  if (total === 0) return { share: null, titles: [] };
  const top = [...rows].sort((a, b) => b.taps - a.taps).slice(0, n).filter((r) => r.taps > 0);
  return { share: top.reduce((s, r) => s + r.taps, 0) / total, titles: top.map((r) => r.title) };
}

export type PerfSortKey = 'taps' | 'arrivals' | 'clicks' | 'views' | 'clickRate' | 'tapRate' | 'contribution' | 'postedAt';

// 값이 없는 행(null)은 방향과 무관하게 맨 뒤 — '모름'이 0이나 최댓값처럼 끼면 순서가 거짓말이 된다(tracking 관례).
export function sortRows<T extends PerfRow>(rows: T[], key: PerfSortKey, dir: 'asc' | 'desc'): T[] {
  const val = (r: T): number | null => {
    switch (key) {
      case 'taps': case 'contribution': return r.taps;   // 기여 = 탭/Σ탭 — 순서는 탭과 같다
      case 'arrivals': return r.arrivals;
      case 'clicks': return r.clicks;
      case 'views': return r.views;
      case 'clickRate': return rate(r.clicks, r.views);
      case 'tapRate': return r.arrivals > 0 ? wilsonLower(r.taps, r.arrivals) : null;
      case 'postedAt': return r.postedAt ? Date.parse(r.postedAt) : null;
    }
  };
  return [...rows].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = va - vb;
    return dir === 'desc' ? -cmp : cmp;
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test src/lib/performanceJudgment.test.ts`
Expected: `# pass 6`

- [ ] **Step 5: Commit**

```bash
git add src/lib/performanceJudgment.ts src/lib/performanceJudgment.test.ts
git commit -m "feat(landing-events): 성과 파생값 — 표본 배지·Wilson 하한 정렬·비율 표기·결정 문장·인플 묶기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `trackingStore` — role·derivedRole 읽기, `setRole`, PATCH `role`

**Files:**
- Modify: `src/lib/trackingStore.ts` (`TrackedPostRow`, `Row`, `SELECT`, `toRow`, 목록·단건 함수)
- Modify: `src/app/api/tracking/[id]/route.ts` (PATCH)
- Test: `src/lib/trackingStore.test.ts` (테스트 추가)

**Interfaces:**
- Consumes: `assignRoles`, `PostRole`, `POST_ROLES` (Task 5); `insertLink` (`src/lib/linkStore.ts`, 기존).
- Produces:
  - `TrackedPostRow`에 `role: PostRole | null`(저장값), `derivedRole: PostRole | null`(판정값 — 원고 없으면 null) 추가. `listTrackedPosts`·`findTrackedPostById`·`findByTweetId`가 채운다.
  - `export async function setRole(sql, trackedPostId: string, role: PostRole | null): Promise<boolean>`
  - `PATCH /api/tracking/[id]` 본문 `{ role: 'main'|'thread'|'link'|null }` — `draftId` 요청과 배타적.

- [ ] **Step 1: 실패하는 테스트(기존 파일 끝에 추가)**

```ts
// src/lib/trackingStore.test.ts 끝에 추가 — import에 setRole, insertLink 추가:
//   import { insertLink } from './linkStore.ts';
//   trackingStore import 목록에 setRole 추가
test('7) 역할 — 원고의 링크 URL이 든 게시물은 link, 가장 이른 것 main, 저장값이 우선', async () => {
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'role', format: 'thread',
    referenceMode: 'off', refs: [], content: { posts: [{ text: '1/', media: [] }, { text: '2/', media: [] }] },
    model: null, memberId: null,
  });
  const link = await insertLink(sql, {
    code: P + 'rl', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=x',
    shortUrl: `https://cb.link/${P}rl`, shortioLinkId: 'lnk_' + P, utmCampaign: P + 'camp',
    influencerHandle: 'hana_kim', utmContent: `hana_kim-${P}`, draftId: d.id, clientId: null, clientName: null, createdBy: null,
  });
  const main = await addTrackedPost(sql, {
    tweetId: P + '71', authorHandle: 'hana_kim', text: '1/', postedAt: '2026-08-24T01:00:00.000Z',
    createdBy: null, metrics: M, raw: { isReply: false, entities: { urls: [] } },
  });
  const reply = await addTrackedPost(sql, {
    tweetId: P + '72', authorHandle: 'hana_kim', text: '링크', postedAt: '2026-08-24T01:10:00.000Z',
    createdBy: null, metrics: M, raw: { isReply: true, entities: { urls: [{ expanded_url: link.shortUrl }] } },
  });
  await setDraftLink(sql, main.row.id, d.id);
  await setDraftLink(sql, reply.row.id, d.id);

  const list = await listTrackedPosts(sql);
  assert.equal(list.find((r) => r.id === main.row.id)!.derivedRole, 'main');
  assert.equal(list.find((r) => r.id === reply.row.id)!.derivedRole, 'link');
  assert.equal(list.find((r) => r.id === reply.row.id)!.role, null);

  assert.equal(await setRole(sql, reply.row.id, 'thread'), true);
  const one = await findTrackedPostById(sql, reply.row.id);
  assert.equal(one!.role, 'thread');
  assert.equal(one!.derivedRole, 'thread'); // 저장값이 판정을 덮는다
  await setRole(sql, reply.row.id, null);
  assert.equal((await findTrackedPostById(sql, reply.row.id))!.derivedRole, 'link');

  await sql`delete from tracking_link where id = ${link.id}`;
});
```

`after` 정리에 `await sql\`delete from tracking_link where utm_campaign like ${P + '%'}\`;`를 tracked_post 삭제 앞에 추가.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trackingStore.test.ts`
Expected: FAIL — `setRole` export 없음

- [ ] **Step 3: 스토어 구현**

`src/lib/trackingStore.ts` 변경:

```ts
// import 추가
import { assignRoles, type PostRole } from './postRole.ts';

// TrackedPostRow에 추가
  role: PostRole | null;              // 사람이 고친 역할. null = 자동
  derivedRole: PostRole | null;       // 화면이 보여줄 역할(role ?? 판정). 원고 미연결이면 null — 판정 근거가 없다

// Row에 추가
  role: PostRole | null; is_reply: boolean | null; raw_urls: unknown;

// SELECT의 select 목록에 추가(s.captured_at 뒤):
         tp.role, (s.raw->>'isReply')::boolean as is_reply, s.raw #> '{entities,urls}' as raw_urls

// toRow: 반환 객체에 추가
    role: r.role, derivedRole: null,   // derivedRole은 attachDerivedRoles가 채운다(원고 단위 판정이라 행 하나로는 못 정한다)
```

`toRow` 아래에 추가:

```ts
// 원고 단위 역할 판정 — 같은 원고의 게시물 전부와 그 원고 링크들의 short_url이 필요하다.
// 주어진 행만이 아니라 그 원고의 모든 게시물을 다시 읽는다(단건 조회여도 형제가 판정을 바꾼다).
async function attachDerivedRoles(sql: postgres.Sql, rows: Array<TrackedPostRow & { _isReply: boolean | null; _rawUrls: unknown }>): Promise<TrackedPostRow[]> {
  const draftIds = [...new Set(rows.map((r) => r.draftId).filter((v): v is string => v !== null))];
  if (draftIds.length === 0) return rows.map(({ _isReply: _a, _rawUrls: _b, ...r }) => r);
  const siblings = await sql<Array<{ id: string; tweet_id: string; draft_id: string; posted_at: Date | null; role: PostRole | null; is_reply: boolean | null; raw_urls: unknown }>>`
    select tp.id, tp.tweet_id, tp.draft_id, tp.posted_at, tp.role,
           (s.raw->>'isReply')::boolean as is_reply, s.raw #> '{entities,urls}' as raw_urls
      from tracked_post tp
      left join lateral (select raw from post_metric_snapshot where tracked_post_id = tp.id order by captured_at desc limit 1) s on true
     where tp.draft_id = any(${draftIds}::uuid[])`;
  const links = await sql<Array<{ draft_id: string; short_url: string }>>`
    select draft_id, short_url from tracking_link where draft_id = any(${draftIds}::uuid[])`;
  const derived = new Map<string, PostRole>();
  for (const draftId of draftIds) {
    const posts = siblings.filter((s) => s.draft_id === draftId).map((s) => ({
      id: s.id, tweetId: s.tweet_id, postedAt: s.posted_at ? new Date(s.posted_at).toISOString() : null,
      role: s.role, rawUrls: s.raw_urls, isReply: s.is_reply,
    }));
    const shortUrls = links.filter((l) => l.draft_id === draftId).map((l) => l.short_url);
    for (const p of assignRoles(posts, shortUrls)) derived.set(p.id, p.role);
  }
  return rows.map(({ _isReply: _a, _rawUrls: _b, ...r }) => ({ ...r, derivedRole: r.draftId ? derived.get(r.id) ?? null : null }));
}
```

`toRow`가 `_isReply: r.is_reply, _rawUrls: r.raw_urls`도 함께 돌려주도록 반환 타입을 `TrackedPostRow & { _isReply: boolean | null; _rawUrls: unknown }`로 바꾸고, 세 조회 함수를 바꾼다:

```ts
export async function listTrackedPosts(sql: postgres.Sql): Promise<TrackedPostRow[]> {
  const rows = await sql<Row[]>`${SELECT(sql)} order by tp.created_at desc`;
  return attachDerivedRoles(sql, rows.map(toRow));
}
export async function findByTweetId(sql: postgres.Sql, tweetId: string): Promise<TrackedPostRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where tp.tweet_id = ${tweetId}`;
  return rows.length ? (await attachDerivedRoles(sql, [toRow(rows[0])]))[0] : null;
}
export async function findTrackedPostById(sql: postgres.Sql, id: string): Promise<TrackedPostRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where tp.id = ${id}`;
  return rows.length ? (await attachDerivedRoles(sql, [toRow(rows[0])]))[0] : null;
}

// 역할 수동 지정. null = 자동 판정으로 되돌리기.
export async function setRole(sql: postgres.Sql, trackedPostId: string, role: PostRole | null): Promise<boolean> {
  const rows = await sql`update tracked_post set role = ${role} where id = ${trackedPostId} returning id`;
  return rows.length > 0;
}
```

`addTrackedPost`·`appendSnapshot` 등 나머지는 그대로(그 안에서 `findByTweetId`/`findTrackedPostById`를 부르므로 자동으로 derivedRole이 붙는다).

- [ ] **Step 4: PATCH 라우트**

`src/app/api/tracking/[id]/route.ts`의 PATCH에서 `const body = ...` 직후, `const draftId = body.draftId;` 앞에 추가:

```ts
  // 역할 변경 — draftId 요청과 배타적. 'role' 키가 있으면 이 갈래다(null = 자동으로 되돌리기).
  if ('role' in body) {
    const role = (body as { role?: unknown }).role;
    if (role !== null && !POST_ROLES.includes(role as PostRole)) {
      return NextResponse.json({ error: '잘못된 요청이에요' }, { status: 400 });
    }
    const sql = getSql();
    if (!(await setRole(sql, id, role as PostRole | null))) return notFound();
    return NextResponse.json({ row: await findTrackedPostById(sql, id) });
  }
```

body 타입을 `{ draftId?: unknown; role?: unknown }`로, import에 `setRole`(trackingStore)과 `POST_ROLES, type PostRole`(`@/lib/postRole`) 추가.

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trackingStore.test.ts`
Expected: `# pass 7`(기존 6 + 새 1)

- [ ] **Step 6: 타입·린트**

Run: `npx tsc --noEmit -p . 2>&1 | head -5; npm run lint 2>&1 | tail -2`
Expected: tsc 출력 없음, 린트 경고 ≤ 24

- [ ] **Step 7: Commit**

```bash
git add src/lib/trackingStore.ts src/lib/trackingStore.test.ts src/app/api/tracking/[id]/route.ts
git commit -m "feat(tracking): 게시물 역할 — role 저장값·derivedRole 판정값 목록에 실어 보내고 PATCH role 추가

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `performanceStore.ts` — 캠페인 목록 · `ContentRow` 조립

**Files:**
- Create: `src/lib/performanceStore.ts`
- Test: `src/lib/performanceStore.test.ts`

**Interfaces:**
- Consumes: `statsByUtmContent`, `unlinkedStats`, `rangeStart`, `Range` (Task 3); `assignRoles`, `PostRole` (Task 5); `insertLink`(linkStore), `insertDraft`(draftStore), `addTrackedPost`·`setDraftLink`(trackingStore) — 테스트용.
- Produces:
  ```ts
  export interface CampaignOption { code: string; clientName: string | null; latestAt: string }
  export async function listCampaigns(sql): Promise<CampaignOption[]>;
  export interface ContentPost { tweetId: string; authorHandle: string | null; role: PostRole; views: number | null; postedAt: string | null }
  export interface ContentRow {
    linkId: string; utmContent: string; utmCampaign: string;
    draftId: string | null; title: string; format: 'single' | 'thread' | null; threadTotal: number | null;
    influencerHandle: string; postedAt: string | null;
    views: number | null; clicks: number | null; arrivals: number; taps: number; visits: number;
    posts: ContentPost[]; capturedAt: string | null; sharedUtmContent: boolean;
  }
  export async function listContentRows(sql, campaign: string, since: Date | null): Promise<ContentRow[]>;
  export interface PerformanceData {
    campaigns: CampaignOption[]; selected: string | null; range: Range;
    rows: ContentRow[]; unlinked: UnlinkedStats; excluded: number; snapshotAt: string | null;
  }
  export async function loadPerformance(sql, campaign: string | null, range: Range, now?: () => number): Promise<PerformanceData>;
  ```

- [ ] **Step 1: 실패하는 테스트**

```ts
// src/lib/performanceStore.test.ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import { insertLink, appendClickSnapshot } from './linkStore.ts';
import { addTrackedPost, setDraftLink } from './trackingStore.ts';
import { insertLandingEvents } from './landingEventStore.ts';
import type { LandingEventInput } from './landingEvent.ts';
import { listCampaigns, listContentRows, loadPerformance } from './performanceStore.ts';

const sql = getSql();
const P = 'tperf' + process.pid.toString(36) + Date.now().toString(36);
const CAMP = `${P}-camp`;
const M = { views: 100, likes: 1, retweets: 0, replies: 0, bookmarks: 0, quotes: 0 };
let n = 0;
const ev = (visit: string, kind: 'arrival' | 'view' | 'tap', utmContent: string | null, over: Partial<LandingEventInput> = {}): LandingEventInput => ({
  eventId: `${P}-e${++n}`, visitId: `${P}-${visit}`, kind, clinic: 'mind', hostname: 'b', path: '/mind',
  utmSource: 'x', utmMedium: null, utmCampaign: CAMP, utmContent, utmTerm: null, refererHost: null,
  ua: 'ua', isBotUa: false, secFetchOk: false, ipHash: null, country: null, occurredAt: '2026-08-25T03:00:00.000Z', ...over,
});

after(async () => {
  await sql`delete from landing_event where event_id like ${P + '%'}`;
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`;
  await sql`delete from tracked_post where tweet_id like ${P + '%'}`;
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql.end();
});

test('콘텐츠 행 — 링크+원고+게시물(main·link)+클릭 스냅샷+이벤트가 한 행으로 모인다', async () => {
  const d = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [], direction: P + 'd1', format: 'thread', referenceMode: 'off', refs: [],
    content: { posts: [{ text: '1/', media: [] }, { text: '2/', media: [] }, { text: '3/', media: [] }] }, model: null, memberId: null,
  });
  await updateDraft(sql, d.id, { title: '리프팅 다운타임 후기' });
  const link = await insertLink(sql, {
    code: P + 'a', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/?utm_content=x', shortUrl: `https://cb.link/${P}a`,
    shortioLinkId: 'l' + P, utmCampaign: CAMP, influencerHandle: 'hana_kim', utmContent: `hana_kim-${P}`, draftId: d.id,
    clientId: null, clientName: null, createdBy: null,
  });
  await appendClickSnapshot(sql, link.id, { totalClicks: 720, humanClicks: 700 }, null);
  const main = await addTrackedPost(sql, { tweetId: P + 'm', authorHandle: 'hana_kim', text: '1/', postedAt: '2026-08-24T01:00:00.000Z',
    createdBy: null, metrics: { ...M, views: 12400 }, raw: { isReply: false, entities: { urls: [] } } });
  const lnk = await addTrackedPost(sql, { tweetId: P + 'l', authorHandle: 'hana_kim', text: '링크', postedAt: '2026-08-24T01:10:00.000Z',
    createdBy: null, metrics: { ...M, views: 3100 }, raw: { isReply: true, entities: { urls: [{ expanded_url: link.shortUrl }] } } });
  await setDraftLink(sql, main.row.id, d.id); await setDraftLink(sql, lnk.row.id, d.id);
  await insertLandingEvents(sql, [
    ev('v1', 'arrival', `hana_kim-${P}`), ev('v1', 'view', `hana_kim-${P}`), ev('v1', 'tap', `hana_kim-${P}`),
    ev('v2', 'view', `hana_kim-${P}`), ev('v3', 'arrival', `hana_kim-${P}`),
  ]);

  const rows = await listContentRows(sql, CAMP, null);
  const r = rows.find((x) => x.linkId === link.id)!;
  assert.equal(r.title, '리프팅 다운타임 후기');
  assert.equal(r.format, 'thread'); assert.equal(r.threadTotal, 3);
  assert.equal(r.views, 12400); assert.equal(r.clicks, 720);
  assert.deepEqual([r.arrivals, r.taps, r.visits], [2, 1, 3]);
  assert.deepEqual(r.posts.map((p) => [p.role, p.views]), [['main', 12400], ['link', 3100]]);
  assert.equal(r.postedAt, '2026-08-24T01:00:00.000Z');
  assert.equal(r.sharedUtmContent, false);
});

test('원고 없는 링크 — 제목은 utm_content, 조회 null, 게시물 없음 · 옛 링크는 code로 매칭', async () => {
  const bare = await insertLink(sql, {
    code: P + 'b', landingUrl: 'https://c.example.com/', longUrl: 'https://c.example.com/', shortUrl: `https://cb.link/${P}b`,
    shortioLinkId: 'l2' + P, utmCampaign: CAMP, influencerHandle: 'yuki_jp', utmContent: `yuki_jp-${P}`, draftId: null,
    clientId: null, clientName: null, createdBy: null,
  });
  await sql`update tracking_link set utm_content = null where id = ${bare.id}`; // 031 이전 링크 흉내
  await insertLandingEvents(sql, [ev('v9', 'view', P + 'b')]);                    // utm_content = code
  const r = (await listContentRows(sql, CAMP, null)).find((x) => x.linkId === bare.id)!;
  assert.equal(r.title, P + 'b'); assert.equal(r.utmContent, P + 'b');
  assert.equal(r.views, null); assert.equal(r.clicks, null); assert.deepEqual(r.posts, []);
  assert.equal(r.arrivals, 1);
});

test('loadPerformance — 캠페인 목록·기본 선택·제외 방문·미연결·없는 캠페인은 최근으로 대체', async () => {
  await insertLandingEvents(sql, [ev('u1', 'view', null)]);
  const camps = await listCampaigns(sql);
  assert.ok(camps.some((c) => c.code === CAMP));
  const data = await loadPerformance(sql, CAMP, 'all');
  assert.equal(data.selected, CAMP);
  assert.equal(data.excluded, 1);        // v3(arrival만) 1건
  assert.equal(data.unlinked.total, 1);  // u1(utm_content null)
  const fallback = await loadPerformance(sql, `${P}-nope`, 'all');
  assert.equal(fallback.selected, camps[0].code);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/performanceStore.test.ts`
Expected: FAIL — `Cannot find module './performanceStore.ts'`

- [ ] **Step 3: 구현**

```ts
// src/lib/performanceStore.ts
// 성과 화면의 읽기 모델 — 콘텐츠(=링크) 한 행에 원고·게시물(역할)·클릭·랜딩 도착/탭을 모은다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §읽기 모델
import type postgres from 'postgres';
import { assignRoles, type PostRole } from './postRole.ts';
import { rangeStart, statsByUtmContent, unlinkedStats, type Range, type UnlinkedStats } from './landingEventStore.ts';

export interface CampaignOption { code: string; clientName: string | null; latestAt: string }

// 캠페인 = tracking_link.utm_campaign(캠페인 관리의 name_en과 같은 값). 최근 링크가 만들어진 순.
export async function listCampaigns(sql: postgres.Sql): Promise<CampaignOption[]> {
  const rows = await sql<Array<{ utm_campaign: string; client_name: string | null; latest_at: Date }>>`
    select utm_campaign,
           (array_agg(client_name order by created_at desc) filter (where client_name is not null))[1] as client_name,
           max(created_at) as latest_at
      from tracking_link group by utm_campaign order by latest_at desc`;
  return rows.map((r) => ({ code: r.utm_campaign, clientName: r.client_name, latestAt: new Date(r.latest_at).toISOString() }));
}

export interface ContentPost { tweetId: string; authorHandle: string | null; role: PostRole; views: number | null; postedAt: string | null }

export interface ContentRow {
  linkId: string; utmContent: string; utmCampaign: string;
  draftId: string | null; title: string;              // draft.title → ko_title → utm_content
  format: 'single' | 'thread' | null; threadTotal: number | null;
  influencerHandle: string; postedAt: string | null;  // main 게시물의 게시 시각
  views: number | null;                                // main 최신 조회. null = 게시물 연결 전
  clicks: number | null;                               // 최신 link_click_snapshot.total_clicks. null = 측정 전
  arrivals: number; taps: number; visits: number;      // 사람 도착·탭·전체 방문(기간 적용)
  posts: ContentPost[];                                // 스레드 읽기 흐름(main → thread → link)
  capturedAt: string | null;                           // 조회·클릭 스냅샷 중 가장 이른 시각
  sharedUtmContent: boolean;                           // 같은 utm_content를 쓰는 링크가 둘 이상
}

type LinkRow = {
  id: string; utm_key: string; utm_campaign: string; draft_id: string | null; influencer_handle: string; short_url: string;
  title: string | null; ko_title: string | null; format: 'single' | 'thread' | null; posts_total: number | null;
  total_clicks: number | null; click_captured_at: Date | null;
};
type PostRow = {
  id: string; tweet_id: string; author_handle: string | null; draft_id: string; posted_at: Date | null; role: PostRole | null;
  views: string | number | null; captured_at: Date | null; is_reply: boolean | null; raw_urls: unknown;
};

export async function listContentRows(sql: postgres.Sql, campaign: string, since: Date | null): Promise<ContentRow[]> {
  const links = await sql<LinkRow[]>`
    select l.id, coalesce(l.utm_content, l.code) as utm_key, l.utm_campaign, l.draft_id, l.influencer_handle, l.short_url,
           d.title, d.ko_title, d.format,
           jsonb_array_length(coalesce(d.edited, d.content)->'posts') as posts_total,
           s.total_clicks, s.captured_at as click_captured_at
      from tracking_link l
      left join draft d on d.id = l.draft_id
      left join lateral (select total_clicks, captured_at from link_click_snapshot where tracking_link_id = l.id order by captured_at desc limit 1) s on true
     where l.utm_campaign = ${campaign}
     order by l.created_at desc`;
  if (links.length === 0) return [];

  const draftIds = [...new Set(links.map((l) => l.draft_id).filter((v): v is string => v !== null))];
  const posts = draftIds.length === 0 ? [] : await sql<PostRow[]>`
    select tp.id, tp.tweet_id, tp.author_handle, tp.draft_id, tp.posted_at, tp.role,
           s.views, s.captured_at, (s.raw->>'isReply')::boolean as is_reply, s.raw #> '{entities,urls}' as raw_urls
      from tracked_post tp
      left join lateral (select views, captured_at, raw from post_metric_snapshot where tracked_post_id = tp.id order by captured_at desc limit 1) s on true
     where tp.draft_id = any(${draftIds}::uuid[])`;
  // 역할 판정에는 그 원고의 링크 전부(다른 캠페인 포함)가 필요하다
  const allLinks = draftIds.length === 0 ? [] : await sql<Array<{ draft_id: string; short_url: string }>>`
    select draft_id, short_url from tracking_link where draft_id = any(${draftIds}::uuid[])`;

  const stats = await statsByUtmContent(sql, links.map((l) => l.utm_key), since);
  const keyCount = new Map<string, number>();
  for (const l of links) keyCount.set(l.utm_key, (keyCount.get(l.utm_key) ?? 0) + 1);

  return links.map((l) => {
    const mine = posts.filter((p) => p.draft_id === l.draft_id).map((p) => ({
      id: p.id, tweetId: p.tweet_id, authorHandle: p.author_handle,
      postedAt: p.posted_at ? new Date(p.posted_at).toISOString() : null,
      role: p.role, rawUrls: p.raw_urls, isReply: p.is_reply,
      views: p.views === null ? null : Number(p.views), // bigint는 문자열로 온다(trackingStore 관례)
      capturedAt: p.captured_at ? new Date(p.captured_at).toISOString() : null,
    }));
    const roled = l.draft_id ? assignRoles(mine, allLinks.filter((x) => x.draft_id === l.draft_id).map((x) => x.short_url)) : [];
    const main = roled.find((p) => p.role === 'main') ?? null;
    const st = stats.get(l.utm_key);
    const captured = [l.click_captured_at ? new Date(l.click_captured_at).toISOString() : null, main?.capturedAt ?? null]
      .filter((v): v is string => v !== null).sort();
    return {
      linkId: l.id, utmContent: l.utm_key, utmCampaign: l.utm_campaign,
      draftId: l.draft_id, title: l.title ?? l.ko_title ?? l.utm_key,
      format: l.format, threadTotal: l.format === 'thread' ? l.posts_total : null,
      influencerHandle: l.influencer_handle, postedAt: main?.postedAt ?? null,
      views: main?.views ?? null, clicks: l.total_clicks,
      arrivals: st?.arrivals ?? 0, taps: st?.taps ?? 0, visits: st?.visits ?? 0,
      posts: roled.map((p) => ({ tweetId: p.tweetId, authorHandle: p.authorHandle, role: p.role, views: p.views, postedAt: p.postedAt })),
      capturedAt: captured[0] ?? null,
      sharedUtmContent: (keyCount.get(l.utm_key) ?? 0) > 1,
    };
  });
}

export interface PerformanceData {
  campaigns: CampaignOption[]; selected: string | null; range: Range;
  rows: ContentRow[]; unlinked: UnlinkedStats;
  excluded: number;            // 프리페치·봇으로 보이는 방문(utm_content 단위 중복 없이)
  snapshotAt: string | null;   // 행들의 capturedAt 중 가장 이른 것 — "마지막 새로고침 기준" 표기
}

// 없는 캠페인을 요청하면 최근 캠페인으로 대체하고 selected로 알려준다(캠페인 관리의 ?id= 관례).
export async function loadPerformance(
  sql: postgres.Sql, campaign: string | null, range: Range, now: () => number = Date.now,
): Promise<PerformanceData> {
  const campaigns = await listCampaigns(sql);
  const selected = campaigns.find((c) => c.code === campaign)?.code ?? campaigns[0]?.code ?? null;
  const since = rangeStart(range, now);
  if (selected === null) {
    return { campaigns, selected: null, range, rows: [], unlinked: { total: 0, byContent: [] }, excluded: 0, snapshotAt: null };
  }
  const rows = await listContentRows(sql, selected, since);
  const keys = [...new Set(rows.map((r) => r.utmContent))];
  const byKey = new Map(rows.map((r) => [r.utmContent, r]));
  const excluded = keys.reduce((s, k) => { const r = byKey.get(k)!; return s + (r.visits - r.arrivals); }, 0);
  const unlinked = await unlinkedStats(sql, keys, selected, since);
  const snapshotAt = rows.map((r) => r.capturedAt).filter((v): v is string => v !== null).sort()[0] ?? null;
  return { campaigns, selected, range, rows, unlinked, excluded, snapshotAt };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/performanceStore.test.ts`
Expected: `# pass 3`

- [ ] **Step 5: Commit**

```bash
git add src/lib/performanceStore.ts src/lib/performanceStore.test.ts
git commit -m "feat(landing-events): performanceStore — 캠페인 목록·ContentRow 조립(원고·역할·클릭·도착/탭)·미연결·제외

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `GET /api/performance`

**Files:**
- Create: `src/app/api/performance/route.ts`

**Interfaces:**
- Consumes: `loadPerformance`, `Range` (Task 8/3); `requireAllowedUser`.
- Produces: `GET /api/performance?campaign=<code>&range=all|7d|30d` → `PerformanceData` JSON.

- [ ] **Step 1: 라우트**

```ts
// src/app/api/performance/route.ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { loadPerformance } from '@/lib/performanceStore';
import type { Range } from '@/lib/landingEventStore';

const RANGES: readonly Range[] = ['all', '7d', '30d'];

// 읽기 전용 — 외부 호출 없이 DB만 읽는다. 게이트는 목록 GET 관례(requireAllowedUser).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const q = new URL(req.url).searchParams;
  const campaign = q.get('campaign');
  const rangeParam = q.get('range');
  const range: Range = RANGES.includes(rangeParam as Range) ? (rangeParam as Range) : 'all';
  return NextResponse.json(await loadPerformance(getSql(), campaign, range));
}
```

- [ ] **Step 2: 타입 확인**

Run: `npx tsc --noEmit -p . 2>&1 | head -3`
Expected: 출력 없음

- [ ] **Step 3: Commit**

```bash
git add src/app/api/performance/route.ts
git commit -m "feat(landing-events): GET /api/performance — 캠페인·기간으로 성과 데이터 읽기

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `/performance` 페이지 — 카드·순위표·펼침·미연결 + 사이드바

**Files:**
- Create: `src/components/PerformanceCards.tsx`
- Create: `src/components/PerformanceTable.tsx`
- Create: `src/app/performance/page.tsx`
- Modify: `src/components/XIcons.tsx` (끝에 `TrendIcon`)
- Modify: `src/components/Sidebar.tsx:11,57-61`

**Interfaces:**
- Consumes: `PerformanceData`·`ContentRow` (Task 8); `performanceJudgment` 전부 (Task 6); `apiFetch`·`Button`·`formatFull`·`kstDateTime`·`kstDate`·`tweetPermalink`.
- Produces: 페이지 `/performance`(URL 상태 `?campaign=&range=`), 사이드바 항목 "성과".

- [ ] **Step 1: 아이콘 + 사이드바**

`src/components/XIcons.tsx` 끝에:

```tsx
// 성과(추이) — Material trending_up 형태, 다른 아이콘과 같은 24 viewBox·fill
export const TrendIcon = ({ className }: { className?: string }) => (
  <Icon className={className} d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" />
);
```

`src/components/Sidebar.tsx` 11행 import에 `TrendIcon` 추가, `globalNav`의 트래킹 항목 뒤에:

```ts
    // 성과는 트래킹 다음 — 등록·갱신(작업)한 것이 어떤 결과를 냈는지(회고)로 읽힌다. B단계(퍼널 통합)의 자리.
    { href: '/performance', label: '성과', Ic: TrendIcon },
```

- [ ] **Step 2: 카드**

```tsx
// src/components/PerformanceCards.tsx
'use client';
import { formatFull } from '@/lib/format';
import { formatPct, rate } from '@/lib/performanceJudgment';

// 결정 카드 4 — 숫자만 던지지 않고 판단 한 줄을 붙인다(UX 원칙 3). 넷째는 결정 문장 카드.
export function PerformanceCards({ taps, arrivals, clicks, views, top3 }: {
  taps: number; arrivals: number; clicks: number | null; views: number | null;
  top3: { share: number | null; titles: string[] };
}) {
  const tapRate = rate(taps, arrivals);
  const arrivalRate = rate(arrivals, clicks);
  const clickRate = rate(clicks, views);
  const card = 'flex flex-col gap-1.5 rounded-xl border border-x-border px-5 py-4';
  return (
    <div className="grid grid-cols-4 gap-4">
      <div className={card}>
        <span className="text-[26px] font-extrabold tabular-nums">{formatFull(taps)}</span>
        <span className="text-ui font-semibold text-x-secondary">LINE 탭</span>
        <span className="text-[12px] text-x-muted">{tapRate === null ? '아직 도착이 없어요' : `도착 100명 중 ${Math.round(tapRate * 100)}명이 눌렀어요`}</span>
      </div>
      <div className={card}>
        <span className="text-[26px] font-extrabold tabular-nums">{formatFull(arrivals)}</span>
        <span className="text-ui font-semibold text-x-secondary">랜딩 도착(사람)</span>
        <span className="text-[12px] text-x-muted">{arrivalRate === null ? '링크 클릭은 새로고침 후 보여요' : `링크 클릭 ${formatFull(clicks)} 중 ${formatPct(arrivalRate)}가 페이지까지 왔어요`}</span>
      </div>
      <div className={card}>
        <span className="text-[26px] font-extrabold tabular-nums">{views === null ? '—' : formatFull(views)}</span>
        <span className="text-ui font-semibold text-x-secondary">콘텐츠 조회</span>
        <span className="text-[12px] text-x-muted">본문 트윗 기준{clickRate !== null && ` · 클릭률 ${formatPct(clickRate, 1)}`}</span>
        <span className="text-caption text-x-muted">마지막 새로고침 기준</span>
      </div>
      <div className={`${card} border-l-[3px] border-l-x-blue bg-[#f3f9fd]`}>
        <span className="text-[26px] font-extrabold tabular-nums text-x-blue-text">{top3.share === null ? '—' : formatPct(top3.share)}</span>
        <span className="text-ui font-semibold text-x-secondary">
          {top3.share === null ? '아직 탭이 없어요' : `탭 상위 ${top3.titles.length}개 콘텐츠가 전체 탭에서 차지하는 비율`}
        </span>
        <span className="text-[12px] text-x-muted">{top3.titles.join(' · ') || '탭이 들어오면 상위 콘텐츠가 여기 보여요'}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 표**

```tsx
// src/components/PerformanceTable.tsx
'use client';
import { Fragment } from 'react';
import { formatFull } from '@/lib/format';
import { kstDate } from '@/lib/datetime';
import { tweetPermalink } from '@/lib/tweetLink';
import type { ContentRow, ContentPost } from '@/lib/performanceStore';
import {
  formatPct, rate, sampleState, SAMPLE_LABEL, type PerfRow, type PerfSortKey,
} from '@/lib/performanceJudgment';

export type Grouping = 'content' | 'influencer';

// 표 한 행의 표시 모델 — 콘텐츠 행은 ContentRow를 그대로, 인플루언서 묶기는 groupByInfluencer 결과(PerfRow)를 쓴다.
export type TableRow = PerfRow & Partial<Pick<ContentRow, 'draftId' | 'utmContent' | 'format' | 'threadTotal' | 'posts' | 'sharedUtmContent'>>;

interface Col { key: PerfSortKey | 'title' | 'influencer' | 'open' | 'count'; label: string; width: number; numeric?: boolean; sort?: PerfSortKey }

const CONTENT_COLS: Col[] = [
  { key: 'title', label: '콘텐츠', width: 240 },
  { key: 'influencer', label: '인플루언서', width: 150 },
  { key: 'postedAt', label: '게시', width: 70, sort: 'postedAt' },
  { key: 'views', label: '조회', width: 90, numeric: true, sort: 'views' },
  { key: 'clicks', label: '클릭', width: 80, numeric: true, sort: 'clicks' },
  { key: 'arrivals', label: '도착', width: 80, numeric: true, sort: 'arrivals' },
  { key: 'taps', label: '탭', width: 70, numeric: true, sort: 'taps' },
  { key: 'clickRate', label: '클릭률', width: 80, numeric: true, sort: 'clickRate' },
  { key: 'tapRate', label: '탭률', width: 200, numeric: true, sort: 'tapRate' },
  { key: 'contribution', label: '탭 기여', width: 80, numeric: true, sort: 'contribution' },
  { key: 'open', label: '열기', width: 120 },
];
const INFLUENCER_COLS: Col[] = [
  { key: 'influencer', label: '인플루언서', width: 200 },
  { key: 'count', label: '콘텐츠', width: 80, numeric: true },
  ...CONTENT_COLS.filter((c) => ['views', 'clicks', 'arrivals', 'taps', 'clickRate', 'tapRate', 'contribution'].includes(c.key)),
];

export function PerformanceTable({ rows, grouping, totalTaps, sort, dir, onSort, expandedKey, onToggleExpand }: {
  rows: TableRow[];                 // 이미 정렬된 배열 — 여기서 순서를 바꾸지 않는다(DraftTable·LinkTable 관례)
  grouping: Grouping;
  totalTaps: number;                // 탭 기여 분모(utm_content 단위 중복 없이 페이지가 계산)
  sort: PerfSortKey; dir: 'asc' | 'desc'; onSort: (k: PerfSortKey) => void;
  expandedKey: string | null; onToggleExpand: (key: string) => void;
}) {
  const cols = grouping === 'content' ? CONTENT_COLS : INFLUENCER_COLS;
  const expandable = grouping === 'content';
  const total = cols.reduce((s, c) => s + c.width, 0) + (expandable ? 32 : 0);
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-x-border">
      <table className="table-fixed border-collapse text-content" style={{ width: `max(${total}px, 100%)` }}>
        <colgroup>
          {expandable && <col style={{ width: 32 }} />}
          {cols.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          <col />
        </colgroup>
        <thead className="text-ui text-x-secondary">
          {/* 퍼널 4열 위 그룹 헤더 — 조회→클릭→도착→탭이 한 흐름이라는 것을 한 번만 말한다 */}
          <tr>
            {expandable && <th rowSpan={2} aria-hidden="true" />}
            {cols.map((c) => c.key === 'views'
              ? <th key="funnel" colSpan={4} className="border-b border-x-border pb-1 pt-2 text-center text-[12px] font-medium text-x-muted">퍼널 · 조회 → 클릭 → 도착 → 탭</th>
              : ['clicks', 'arrivals', 'taps'].includes(c.key) ? null
              : <th key={c.key} rowSpan={2} scope="col" onClick={c.sort ? () => onSort(c.sort!) : undefined}
                    className={`whitespace-nowrap px-4 py-2.5 font-bold ${c.numeric ? 'text-right' : 'text-left'} ${c.sort ? 'cursor-pointer hover:text-x-text' : ''} border-b border-x-border-strong`}>
                  {c.label}{c.sort && sort === c.sort && <span aria-hidden className="ml-0.5 text-[10px]">{dir === 'desc' ? '▾' : '▴'}</span>}
                </th>)}
            <th rowSpan={2} aria-hidden="true" />
          </tr>
          <tr>
            {cols.filter((c) => ['views', 'clicks', 'arrivals', 'taps'].includes(c.key)).map((c) => (
              <th key={c.key} scope="col" onClick={() => onSort(c.sort!)}
                  className="cursor-pointer whitespace-nowrap border-b border-x-border-strong px-4 py-2 text-right font-bold hover:text-x-text">
                {c.label}{sort === c.sort && <span aria-hidden className="ml-0.5 text-[10px]">{dir === 'desc' ? '▾' : '▴'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = expandedKey === r.key;
            const clickRate = rate(r.clicks, r.views);
            const tapRate = rate(r.taps, r.arrivals);
            const state = sampleState(r.arrivals);
            const badge = SAMPLE_LABEL[state];
            const contribution = totalTaps > 0 ? r.taps / totalTaps : null;
            const main = r.posts?.find((p) => p.role === 'main') ?? null;
            return (
              <Fragment key={r.key}>
                <tr className="h-12 border-b border-x-border hover:bg-x-hover">
                  {expandable && (
                    <td className="pl-2">
                      <button onClick={() => onToggleExpand(r.key)} aria-expanded={open}
                              title="자세히 — 스레드 읽기 흐름(트윗별 조회)" aria-label={open ? '접기' : '자세히 보기'}
                              className="rounded p-1.5 text-[11px] leading-none text-x-muted hover:bg-x-surface hover:text-x-secondary">
                        {open ? '▼' : '▶'}
                      </button>
                    </td>
                  )}
                  {grouping === 'content' && (
                    <td className="truncate px-4" title={`utm_content: ${r.utmContent} · ${r.format === 'thread' ? `스레드 ${r.threadTotal ?? '?'}개` : '단일 게시물'}${r.sharedUtmContent ? ' · 같은 utm_content를 쓰는 링크가 둘 이상 — 방문이 양쪽에 같이 보여요' : ''}`}>
                      {r.title}
                    </td>
                  )}
                  <td className="truncate px-4">
                    {/* 재기용 판단은 프로필에서 — 단가·계정 분석·참여 이력이 거기 있다 */}
                    <a href={`/influencers?i=${encodeURIComponent(r.influencerHandle)}`} className="inline-flex items-center gap-2 hover:underline">
                      <span aria-hidden className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full bg-x-surface text-[10px] font-bold text-x-secondary">{r.influencerHandle[0]?.toUpperCase()}</span>
                      @{r.influencerHandle}
                    </a>
                  </td>
                  {grouping === 'influencer' && <td className="px-4 text-right tabular-nums">{r.contentCount}</td>}
                  {grouping === 'content' && <td className="px-4 tabular-nums text-x-secondary">{r.postedAt ? kstDate(r.postedAt).slice(5).replace('-', '/').replace(/^0/, '') : '—'}</td>}
                  <td className="px-4 text-right tabular-nums">
                    {r.views !== null ? formatFull(r.views)
                      : grouping === 'content' && r.draftId
                        ? <a href="/tracking" className="text-ui text-x-blue-text hover:underline" title="게시물을 트래킹에 등록하면 조회가 채워져요">게시물 연결 전</a>
                        : <span className="text-x-muted">—</span>}
                  </td>
                  <td className="px-4 text-right tabular-nums">{r.clicks !== null ? formatFull(r.clicks) : <span className="text-ui text-x-muted">측정 전</span>}</td>
                  <td className="px-4 text-right tabular-nums">{formatFull(r.arrivals)}</td>
                  <td className="px-4 text-right tabular-nums font-semibold">{formatFull(r.taps)}</td>
                  <td className="px-4 text-right tabular-nums" title="클릭 ÷ 본문 조회">{formatPct(clickRate, 1)}</td>
                  {/* 분모 병기 — 퍼센트 단독은 표본 크기를 감춘다. 표본이 적으면 값 자체를 흐리게(문구만 있으면 곧 무시된다) */}
                  <td className="whitespace-nowrap px-4 text-right tabular-nums">
                    <span className={state === 'early' ? 'opacity-40' : 'font-semibold'}>{formatPct(tapRate)}</span>
                    {tapRate !== null && <span className="ml-1 text-ui text-x-muted">({r.taps}/{r.arrivals})</span>}
                    {badge && (
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[12px] ${state === 'ref' ? 'bg-amber-50 text-amber-800' : 'bg-x-surface text-x-muted'}`}>{badge}</span>
                    )}
                  </td>
                  <td className="px-4 text-right tabular-nums">{formatPct(contribution)}</td>
                  {grouping === 'content' && (
                    <td className="whitespace-nowrap px-4 text-ui">
                      {r.draftId && <a href={`/generate?draft=${r.draftId}`} className="text-x-blue-text hover:underline">원고</a>}
                      {r.draftId && main && <span className="mx-1 text-x-muted">·</span>}
                      {main && <a href={tweetPermalink(main.authorHandle, main.tweetId)} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">X 게시물</a>}
                    </td>
                  )}
                  <td aria-hidden="true" />
                </tr>
                {open && expandable && <ThreadFlow row={r} colCount={cols.length + 2} />}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 펼침 = 스레드 읽기 흐름. 부모 열을 공유하는 자식 행 — 조회 칸에 트윗별 조회(1/ 대비 %), 링크 줄만 클릭 칸.
// 헤더도 그래프도 없다: 부모 헤더가 위에 있고, 숫자가 세로로 이어 읽힌다(LinkTable 펼침 문법).
function ThreadFlow({ row, colCount }: { row: TableRow; colCount: number }) {
  const posts = row.posts ?? [];
  const main = posts.find((p) => p.role === 'main') ?? null;
  const edge = 'shadow-[inset_2px_0_0_rgba(21,115,173,0.4)]';
  const cell = 'h-9 bg-x-surface text-ui tabular-nums';
  const label = (p: ContentPost, i: number) =>
    p.role === 'link' ? '🔗 링크 댓글' : p.role === 'main' ? '1/ 본문' : `${i + 1}/`;
  if (posts.length === 0) {
    return (
      <tr><td className={edge} /><td colSpan={colCount - 1} className={`${cell} border-b border-x-border-strong px-4 text-x-muted`}>
        등록된 게시물이 없어요 — 트래킹에서 게시물을 등록하면 여기 채워져요
      </td></tr>
    );
  }
  return (
    <>
      <tr>
        <td className={edge} />
        <td colSpan={colCount - 1} className="h-8 bg-x-surface px-4 text-ui text-x-muted">
          스레드 읽기 흐름 · {posts.length}개 등록{row.threadTotal ? ` / 스레드 ${row.threadTotal}개` : ''} · %는 1/ 본문 조회 대비
        </td>
      </tr>
      {posts.map((p, i) => {
        const pct = p.role !== 'main' && main?.views && p.views !== null ? formatPct(p.views / main.views) : '';
        const last = i === posts.length - 1;
        const b = last ? 'border-b border-x-border-strong' : '';
        return (
          <tr key={p.tweetId}>
            <td className={`${edge} ${cell} ${b}`} />
            <td className={`${cell} ${b} pl-10 text-x-secondary`}>{label(p, i)}</td>
            <td className={`${cell} ${b}`} /><td className={`${cell} ${b}`} />
            <td className={`${cell} ${b} px-4 text-right`}>
              <span className="inline-flex w-full justify-end gap-1.5"><span className="w-11 text-left text-[12px] text-x-muted">{pct}</span><span>{p.views === null ? '—' : formatFull(p.views)}</span></span>
            </td>
            <td className={`${cell} ${b} px-4 text-right`}>{p.role === 'link' && row.clicks !== null ? formatFull(row.clicks) : ''}</td>
            {Array.from({ length: colCount - 6 }, (_, k) => <td key={k} className={`${cell} ${b}`} />)}
          </tr>
        );
      })}
      <tr><td className={edge} /><td colSpan={colCount - 1} className="h-8 bg-x-surface px-4 text-[12px] text-x-muted">조회·클릭은 마지막 새로고침 시점 값이에요.</td></tr>
    </>
  );
}
```

- [ ] **Step 4: 페이지**

```tsx
// src/app/performance/page.tsx
'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { formatFull } from '@/lib/format';
import { kstDateTime, kstDate, kstToday, kstDaysAgo } from '@/lib/datetime';
import type { PerformanceData, ContentRow } from '@/lib/performanceStore';
import type { Range } from '@/lib/landingEventStore';
import { groupByInfluencer, sortRows, topShare, type PerfSortKey } from '@/lib/performanceJudgment';
import { PerformanceCards } from '@/components/PerformanceCards';
import { PerformanceTable, type Grouping, type TableRow } from '@/components/PerformanceTable';

export default function PerformancePage() {
  // useSearchParams는 Suspense 경계 필수(tracking·clients 선례)
  return <Suspense><PerformanceView /></Suspense>;
}

const RANGES: Array<[Range, string]> = [['all', '캠페인 전체'], ['7d', '최근 7일'], ['30d', '최근 30일']];

function PerformanceView() {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams();
  const campaign = sp.get('campaign');
  const range: Range = (['all', '7d', '30d'] as Range[]).includes(sp.get('range') as Range) ? (sp.get('range') as Range) : 'all';
  const setParams = useCallback((next: { campaign?: string | null; range?: Range }) => {
    const p = new URLSearchParams(sp.toString());
    if (next.campaign !== undefined) { if (next.campaign) p.set('campaign', next.campaign); else p.delete('campaign'); }
    if (next.range !== undefined) { if (next.range === 'all') p.delete('range'); else p.set('range', next.range); }
    const q = p.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  const [data, setData] = useState<PerformanceData | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [grouping, setGrouping] = useState<Grouping>('content');
  const [sort, setSort] = useState<PerfSortKey>('taps');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // setState는 전부 await 뒤 — 동기 setState를 앞에 두면 set-state-in-effect에 걸린다(tracking 관례)
  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams(); if (campaign) q.set('campaign', campaign); q.set('range', range);
      const r = await apiFetch(`/api/performance?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as PerformanceData);
      setLoadErr(false);
    } catch {
      setLoadErr(true); // 실패를 빈 상태로 위장하지 않는다
    }
  }, [campaign, range]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 필터가 바뀔 때 다시 읽는다, setState는 전부 비동기 콜백
  useEffect(() => { load(); }, [load]);

  const onSort = useCallback((k: PerfSortKey) => {
    setSort((cur) => { if (cur === k) { setDir((d) => (d === 'desc' ? 'asc' : 'desc')); return cur; } setDir('desc'); return k; });
  }, []);

  // 탭 기여 분모·제외 방문은 utm_content 단위(같은 값을 쓰는 링크가 둘이면 한 번만)
  const uniqueRows = useMemo(() => {
    const seen = new Set<string>(); const out: ContentRow[] = [];
    for (const r of data?.rows ?? []) { if (seen.has(r.utmContent)) continue; seen.add(r.utmContent); out.push(r); }
    return out;
  }, [data]);
  const totalTaps = uniqueRows.reduce((s, r) => s + r.taps, 0);
  const totalArrivals = uniqueRows.reduce((s, r) => s + r.arrivals, 0);
  const totalClicks = uniqueRows.some((r) => r.clicks !== null) ? uniqueRows.reduce((s, r) => s + (r.clicks ?? 0), 0) : null;
  const totalViews = uniqueRows.some((r) => r.views !== null) ? uniqueRows.reduce((s, r) => s + (r.views ?? 0), 0) : null;

  const tableRows: TableRow[] = useMemo(() => {
    const base: TableRow[] = (data?.rows ?? []).map((r) => ({
      key: r.linkId, title: r.title, influencerHandle: r.influencerHandle, contentCount: 1,
      views: r.views, clicks: r.clicks, arrivals: r.arrivals, taps: r.taps, postedAt: r.postedAt,
      draftId: r.draftId, utmContent: r.utmContent, format: r.format, threadTotal: r.threadTotal, posts: r.posts, sharedUtmContent: r.sharedUtmContent,
    }));
    return sortRows(grouping === 'content' ? base : groupByInfluencer(base), sort, dir);
  }, [data, grouping, sort, dir]);

  const top3 = topShare(uniqueRows);
  const selected = data?.campaigns.find((c) => c.code === data.selected) ?? null;
  const periodLabel = range === 'all'
    ? `${selected ? kstDate(selected.latestAt).slice(5).replace('-', '/') : ''} ~ ${kstToday().slice(5).replace('-', '/')} · 서울 기준`
    : `${kstDaysAgo(range === '7d' ? 6 : 29).slice(5).replace('-', '/')} ~ ${kstToday().slice(5).replace('-', '/')} · 서울 기준`;

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <h1 className="mb-1 text-[20px] font-bold">성과</h1>
      <p className="mb-4 text-caption text-x-muted">인플루언서·콘텐츠별로 랜딩 방문과 LINE 탭을 모아 봐요. 브릿지 페이지에서 바로 들어오는 기록이라 새로고침이 필요 없어요.</p>

      {data === null && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
      {loadErr && (
        <div className="py-8 text-center">
          <p className="mb-2 text-ui text-x-secondary">성과를 불러오지 못했습니다</p>
          <Button onClick={() => void load()}>다시 시도</Button>
        </div>
      )}
      {data && !loadErr && data.campaigns.length === 0 && (
        <p className="py-8 text-center text-ui text-x-secondary">
          트래킹 링크를 만들면 그 링크로 들어온 랜딩 방문과 LINE 탭이 여기 모여요. <a href="/tracking?view=links" className="text-x-blue-text hover:underline">링크 만들기 →</a>
        </p>
      )}
      {data && !loadErr && data.campaigns.length > 0 && (<>
        {/* 필터 바 — 캠페인 select + 기간 세그먼트(library 보기 방식 세그먼트 규격) */}
        <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-x-border px-4 py-3">
          <select value={data.selected ?? ''} onChange={(e) => setParams({ campaign: e.target.value })} aria-label="캠페인"
                  className="rounded-lg border border-x-border-strong bg-white px-3 py-1.5 text-ui font-semibold">
            {data.campaigns.map((c) => <option key={c.code} value={c.code}>{c.code}{c.clientName ? ` · ${c.clientName}` : ''}</option>)}
          </select>
          <div role="group" aria-label="기간" className="flex h-7 w-fit overflow-hidden rounded-lg border border-x-border-strong">
            {RANGES.map(([v, label], i) => (
              <button key={v} onClick={() => setParams({ range: v })} aria-pressed={range === v}
                      className={`h-full px-3 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${range === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-ui text-x-muted">{periodLabel}</span>
        </div>

        <PerformanceCards taps={totalTaps} arrivals={totalArrivals} clicks={totalClicks} views={totalViews} top3={top3} />

        <div className="mb-2 mt-8 flex flex-wrap items-center gap-4">
          <span className="text-ui font-bold text-x-secondary">묶어 보기</span>
          <div role="group" aria-label="묶어 보기" className="flex h-7 w-fit overflow-hidden rounded-lg border border-x-border-strong">
            {([['content', '콘텐츠'], ['influencer', '인플루언서']] as const).map(([v, label], i) => (
              <button key={v} onClick={() => { setGrouping(v); setExpandedKey(null); }} aria-pressed={grouping === v}
                      className={`h-full px-3 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${grouping === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="text-ui text-x-muted">{grouping === 'content' ? '콘텐츠 = 원고 하나 = 고유 링크 하나예요' : '같은 사람의 콘텐츠를 합쳐 보여요'}</span>
          <span className="ml-auto text-[12px] text-x-muted">정렬: {sort === 'tapRate' ? '탭률 — 방문이 적은 건 뒤로 보내요' : '헤더를 눌러 바꿀 수 있어요'}</span>
        </div>
        {/* 투명 표기(Fathom식): 무엇을 세지 않았는지, 조회·클릭이 어느 시점 값인지 한 줄 */}
        <p className="mb-2 text-ui text-x-muted">
          {data.rows.length > 0 && totalArrivals === 0 && '아직 들어온 방문이 없어요 — 브릿지가 연결되면 바로 채워져요 · '}
          프리페치·봇으로 보이는 방문 {formatFull(data.excluded)}건은 세지 않았어요
          {data.snapshotAt && ` · 조회·클릭은 마지막 새로고침(${kstDateTime(data.snapshotAt)}) 기준이라 기간과 무관해요`}
        </p>

        <PerformanceTable rows={tableRows} grouping={grouping} totalTaps={totalTaps} sort={sort} dir={dir} onSort={onSort}
                          expandedKey={expandedKey} onToggleExpand={(k) => setExpandedKey((cur) => (cur === k ? null : k))} />

        {/* 미연결 유입 — 버리지 않고 접힌 줄로(아는 만큼만 말한다) */}
        {data.unlinked.total > 0 && (
          <details className="mt-3 text-ui text-x-muted">
            <summary className="cursor-pointer">
              링크와 연결되지 않은 랜딩 방문 {formatFull(data.unlinked.total)}건 — utm_content 없음 {formatFull(data.unlinked.byContent.find((b) => b.utmContent === null)?.arrivals ?? 0)} · 모르는 값 {formatFull(data.unlinked.byContent.filter((b) => b.utmContent !== null).reduce((s, b) => s + b.arrivals, 0))}
            </summary>
            <table className="mt-2 text-ui"><tbody>
              {data.unlinked.byContent.slice(0, 5).map((b) => (
                <tr key={b.utmContent ?? '(없음)'}><td className="pr-6 py-1">{b.utmContent ?? '(utm_content 없음)'}</td><td className="pr-6 text-right tabular-nums">도착 {formatFull(b.arrivals)}</td><td className="text-right tabular-nums">탭 {formatFull(b.taps)}</td></tr>
              ))}
              {data.unlinked.byContent.length > 5 && <tr><td colSpan={3} className="py-1 text-x-muted">그 외 {data.unlinked.byContent.length - 5}종</td></tr>}
            </tbody></table>
          </details>
        )}
      </>)}
    </main>
  );
}
```

- [ ] **Step 5: 타입·린트·빌드**

Run: `npx tsc --noEmit -p . 2>&1 | head -10; npm run lint 2>&1 | tail -2; npm run build 2>&1 | tail -3`
Expected: tsc 출력 없음(있으면 해당 줄 고친다), 린트 경고 ≤ 24, 빌드 성공(`/performance` 라우트 포함)

- [ ] **Step 6: 화면 확인(로컬)**

Run: `(npm run start -- -p 3001 > /dev/null 2>&1 &) && sleep 4 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/performance`
Expected: `307`(로그인 리다이렉트 — 프록시가 페이지를 게이팅함). 실제 화면은 koo가 브라우저(127.0.0.1:3001, 구글 로그인)로 확인. 확인 후 `pkill -f 'next start'`.

- [ ] **Step 7: Commit**

```bash
git add src/components/XIcons.tsx src/components/Sidebar.tsx src/components/PerformanceCards.tsx src/components/PerformanceTable.tsx src/app/performance/page.tsx
git commit -m "feat(performance): /performance 페이지 — 결정 카드·콘텐츠/인플루언서 순위표·스레드 읽기 흐름 펼침·미연결 방문

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: 게시물 표 역할 select

**Files:**
- Modify: `src/components/TrackingTable.tsx` (`DraftCell`, props)
- Modify: `src/app/tracking/page.tsx` (`setRole` 핸들러, prop 전달)

**Interfaces:**
- Consumes: `TrackedPostRow.role`·`derivedRole` (Task 7), `PATCH /api/tracking/[id] {role}` (Task 7), `POST_ROLES`·`PostRole` (Task 5).
- Produces: `TrackingTable` prop `onSetRole: (row: TrackedPostRow, role: PostRole | null) => void`.

- [ ] **Step 1: TrackingTable — prop + DraftCell 아래 역할 select**

props 타입에 `onSetRole: (row: TrackedPostRow, role: PostRole | null) => void;` 추가, 구조 분해에 `onSetRole` 추가, `DraftCell` 호출에 `onSetRole={onSetRole}` 전달. import에 `import { POST_ROLES, type PostRole } from '@/lib/postRole';`.

`DraftCell`의 `if (row.draftId)` 갈래를 다음으로 교체:

```tsx
  if (row.draftId) {
    const label = row.draftLabel ?? '제목 없는 원고';
    const shown = row.role ?? row.derivedRole;
    return (
      <div className="min-w-0">
        <button onClick={() => onOpenPicker(row.id)} title={`${label} — 원고 연결 바꾸기·해제`}
                className="block max-w-full truncate text-x-blue-text hover:underline">
          {label}
        </button>
        {/* 역할 — 성과 화면의 '조회'가 어느 게시물인지 정한다. 자동 판정(role null)은 흐리게, 사람이 고치면 진하게.
            선택지 4개라 네이티브 select로 충분하다(원고 고르기와 달리 목록이 길지 않다). */}
        <select value={row.role ?? ''} onChange={(e) => onSetRole(row, (e.target.value || null) as PostRole | null)}
                aria-label="게시물 역할"
                title={row.role ? '사람이 정한 역할이에요 — 자동으로 되돌릴 수 있어요' : `자동으로 판정했어요(${ROLE_LABEL[shown ?? 'main']}) — 눌러서 바꿀 수 있어요`}
                className={`mt-0.5 max-w-full rounded border border-transparent bg-transparent text-caption hover:border-x-border-strong ${row.role ? 'text-x-secondary' : 'text-x-muted'}`}>
          <option value="">{shown ? `자동 · ${ROLE_LABEL[shown]}` : '자동'}</option>
          {POST_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </div>
    );
  }
```

`DraftCell` 시그니처에 `onSetRole: (row: TrackedPostRow, role: PostRole | null) => void;` 추가. 파일 상단(`COLS` 근처)에:

```ts
const ROLE_LABEL: Record<PostRole, string> = { main: '본문', thread: '이어지는 본문', link: '링크 댓글' };
```

- [ ] **Step 2: 페이지 핸들러**

`src/app/tracking/page.tsx`의 `linkDraft` 아래에 추가하고 `<TrackingTable … onSetRole={(row, role) => void setRole(row, role)} />` 전달:

```ts
  // 역할 변경 — 성과 화면이 '조회'로 쓸 게시물을 사람이 바로잡는다. null = 자동으로 되돌리기.
  const setRole = useCallback(async (row: TrackedPostRow, role: PostRole | null) => {
    try {
      const res = await apiFetch(`/api/tracking/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
      });
      const data = (await res.json().catch(() => ({}))) as { row?: TrackedPostRow; error?: string };
      if (!res.ok || !data.row) { show(data.error ?? '역할을 바꾸지 못했어요 — 잠시 후 다시 시도해 주세요'); return; }
      const next = data.row;
      setRows((cur) => cur.map((r) => (r.id === next.id ? next : r)));
    } catch {
      show('역할을 바꾸지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    }
  }, [show]);
```

import에 `import type { PostRole } from '@/lib/postRole';` 추가.

- [ ] **Step 3: 타입·린트**

Run: `npx tsc --noEmit -p . 2>&1 | head -5; npm run lint 2>&1 | tail -2`
Expected: 출력 없음, 경고 ≤ 24

- [ ] **Step 4: Commit**

```bash
git add src/components/TrackingTable.tsx src/app/tracking/page.tsx
git commit -m "feat(tracking): 게시물 역할 select — 자동 판정 표시·본문/이어지는 본문/링크 댓글 수동 지정

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: 전체 검증 + 배포 준비

**Files:**
- (변경 없음) — 검증과 체크리스트

- [ ] **Step 1: 전체 테스트**

Run: `npm test 2>&1 | tail -6`
Expected: `# fail 0` (약 4분, 실 DB)

- [ ] **Step 2: 린트 기준선·빌드**

Run: `npm run lint 2>&1 | grep -c "warning" ; npm run build 2>&1 | tail -2`
Expected: 경고 수 ≤ 24, 빌드 성공

- [ ] **Step 3: 로컬 화면 QA(koo) — 확인 항목**

`npm run start -- -p 3001` 후 `http://127.0.0.1:3001/performance`:
1. 사이드바 "성과" 진입, 캠페인 select에 기존 캠페인(`utm_campaign`)이 뜨고 기본 = 최근
2. 이벤트가 없어 도착·탭 0, 각주 "아직 들어온 방문이 없어요 · 프리페치·봇 0건"
3. 게시물 연결된 콘텐츠는 조회 숫자, 아닌 것은 "게시물 연결 전" 링크
4. `묶어 보기 → 인플루언서` 전환 시 합산·콘텐츠 수
5. 헤더 클릭 정렬, 탭률 정렬 시 캡션 변경
6. 펼침 ▶ → 스레드 읽기 흐름(등록 게시물이 여럿인 원고에서 확인)
7. `/tracking` 게시물 표의 원고 열에 역할 select — 자동값 흐림, 바꾸면 진하게, "자동"으로 되돌리기
8. 로컬에서 curl로 이벤트 1건 넣고(Task 4의 curl, `utm_content`를 실제 링크 값으로) 도착·탭이 1 오르는지

- [ ] **Step 4: 배포 체크리스트(스펙 §배포)**

1. `.vercel/project.json`이 cb-x-deck인지 확인 (`cat .vercel/project.json` — 없으면 `vercel link`)
2. Vercel 프로덕션 env `LANDING_EVENTS_SECRET` 추가(브릿지 프로젝트와 같은 값)
3. 프로덕션 DB에 034·035 적용 완료 확인(Task 1에서 적용한 .env가 프로덕션 풀러라면 이미 적용됨)
4. main 머지 → 배포 → 브릿지 세션에 "계약 변경 없음, 엔드포인트 준비됨" 전달 → 브릿지 `lib/deck.ts` 구현·배포
5. 브릿지에서 생성기 링크의 `utm_content`로 접근·탭 → `/performance` 그 행의 도착·탭 +1 확인, curl(봇 UA)로 접근 → "세지 않았어요" 수만 증가 확인
6. 클리닉 클라이언트 `landing_url`을 브릿지 URL로 설정

- [ ] **Step 5: 메모리·문서 갱신**

`~/.claude/projects/-Users-koo-clinicbridge-cb-x-deck/memory/cb-x-deck-landing-events-dashboard.md`의 상태를 "구현 완료·QA/머지 대기"로 갱신(스펙·계획 경로 유지).

---

## Self-Review (작성자 체크)

**Spec coverage**
- §데이터 모델 034·035 → Task 1 ✓ · §수집 API(계약·401·400 index/field·202 accepted/duplicates·100건·timingSafeEqual·프록시 조기 통과) → Task 2·3·4 ✓ · §집계 규칙(방문 단위·서울 경계·coalesce(code)·미연결 캠페인 조건) → Task 3·8 ✓ · §역할 판정(저장값 우선·URL 매칭·isReply 우선·읽기 시점·derivedRole 목록 제공·스레드 수 edited 우선) → Task 5·7·8 ✓ · §읽기 모델(ContentRow·비율·배지·Wilson·결정 문장·인플 묶기 클라이언트·utm_content 중복 가드·snapshotAt) → Task 6·8·10 ✓ · §화면(필터·카드 4·묶어 보기·12열·펼침 스레드·미연결·상태 4종·인플 프로필 링크·원고/X 게시물 열기·각주) → Task 10 ✓ · §게시물 표 역할 → Task 11 ✓ · §API 표 → Task 4·7·9 ✓ · §테스트 5파일 → Task 2·3·5·6·7·8 ✓ · §배포 체크리스트 → Task 12 ✓
- 스펙의 "제외한 방문" 정의(distinct 방문 − 사람 도착)는 `ContentStats.visits - arrivals`로 Task 8 `loadPerformance`가 계산 ✓

**Placeholder scan** — TBD/TODO 없음. 모든 코드 단계에 코드 있음.

**Type consistency**
- `LandingEventInput` 필드명(camelCase)은 Task 2 정의 → Task 3 insert 매핑 → Task 8 테스트 헬퍼 일치 ✓
- `Range`·`rangeStart`·`statsByUtmContent`·`unlinkedStats`·`UnlinkedStats`는 Task 3 정의 → Task 8·9·10 import 일치 ✓
- `assignRoles<T extends RolePostInput>`의 입력 `{tweetId, postedAt, role, rawUrls, isReply}` — Task 7·8이 그 필드로 매핑 ✓ (`id`·`views`·`capturedAt`·`authorHandle`는 T의 추가 필드로 통과)
- `PerfRow`·`PerfSortKey`·`sortRows`·`groupByInfluencer`·`topShare`·`sampleState`·`SAMPLE_LABEL`·`formatPct`·`rate` — Task 6 정의 → Task 10 사용 일치 ✓
- `TrackedPostRow.role`·`derivedRole`·`setRole` — Task 7 정의 → Task 11 사용 일치 ✓
- `PerformanceData`·`ContentRow`·`ContentPost` — Task 8 정의 → Task 9·10 일치 ✓
