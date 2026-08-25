# 트래킹 링크 생성기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인플루언서에게 전달할 랜딩페이지 링크에 UTM을 반자동으로 붙이고 short.io로 단축해, 클릭 수까지 앱 안에서 추적한다.

**Architecture:** 새 엔티티 `tracking_link` + append-only `link_click_snapshot`(게시물 트래킹과 대칭). short.io는 공식 SDK 없이 REST 2개 엔드포인트를 얇은 수제 클라이언트(getxapi.ts 패턴)로 호출. 화면은 /tracking 페이지에 `[게시물 | 링크]` 세그먼트를 추가하고, DraftCard에는 자급식(self-fetching) 섹션을 얹는다.

**Tech Stack:** Next.js 16(App Router) · postgres.js · node:test + tsx · Tailwind. **새 의존성 0.**

**스펙:** `docs/superpowers/specs/2026-08-24-tracking-link-design.md` (모든 결정의 근거)

## Global Constraints

- **이 리포의 Next.js는 훈련 데이터와 다르다** — 코드 작성 전 `node_modules/next/dist/docs/`의 해당 가이드 확인 (AGENTS.md)
- **UX 원칙 6개(AGENTS.md) 준수** — 라벨은 이득 언어, 행동 전 기대 설정, 비용 액션 opt-in 등
- 린트 기준선 **24개** 유지 (`npm run lint` 경고 수가 늘면 안 됨)
- 전체 테스트는 `npm test`(실 DB, 약 4분) — 개발 중엔 단일 파일: `node --import tsx --env-file-if-exists=.env --test src/lib/<파일>.test.ts`
- 커밋 메시지는 한국어, `feat(tracking-link):` / `fix:` / `docs:` 관례
- 인증: 읽기 라우트 `requireAllowedUser`, 쓰기 라우트 `requireMember` (`@/lib/authGuard`)
- env 신규 2개: `SHORTIO_API_KEY`, `SHORTIO_DOMAIN` — 미설정이어도 앱이 죽으면 안 됨(안내 문구로 대체)
- 서버 코드에서 API 키를 클라이언트 번들로 노출 금지

---

### Task 1: 마이그레이션 028 — tracking_link · link_click_snapshot · client.landing_url

**Files:**
- Create: `migrations/028_tracking_link.sql`
- Modify: `docs/superpowers/specs/2026-08-24-tracking-link-design.md` (unavailable_at 컬럼 추가 반영)

**Interfaces:**
- Produces: 테이블 `tracking_link`(code unique), `link_click_snapshot`, `client.landing_url` — Task 4·5가 사용

스펙 보정 1건: 스펙 §short.io 오류 규격은 "404 → 클릭 열에 '링크 없음' 표시하되 행·이력 유지"를 요구하는데 스펙의 스키마에는 그 상태를 지속시킬 컬럼이 없다. `tracked_post.unavailable_at` 관례를 그대로 가져와 `unavailable_at`을 추가한다(복귀 수용 포함).

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- 028: 트래킹 링크 — 랜딩페이지+UTM+단축 링크 명부 + 클릭 스냅샷(append-only).
-- 설계: docs/superpowers/specs/2026-08-24-tracking-link-design.md
create table if not exists tracking_link (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,  -- 6자 소문자 영숫자. 세 곳을 잇는 축:
                                          -- 단축 경로({도메인}/{code}) = utm_content 꼬리 = 이 행.
                                          -- GA에서 본 utm_content로 앱의 링크·원고 역추적 가능
  landing_url      text not null,         -- UTM 붙기 전 원본
  long_url         text not null,         -- UTM 붙은 최종 URL 스냅샷 — 조립 규칙이 바뀌어도 과거 링크 재현
  short_url        text not null,         -- https://{SHORTIO_DOMAIN}/{code}
  shortio_link_id  text not null,         -- short.io 링크 ID(idString) — 통계 조회 키
  utm_campaign     text not null,
  influencer_handle text not null,        -- 핸들 자연키 (draft.influencer_handle 관례)
  draft_id         uuid references draft(id) on delete set null,   -- 선택 연결(원고 삭제돼도 기록 유지)
  client_id        uuid references client(id) on delete set null,
  client_name      text,                  -- 스냅샷 관례(014 선례)
  unavailable_at   timestamptz,           -- short.io 쪽에서 링크가 지워진 것을 확인한 시각. null = 정상
                                          -- (tracked_post.unavailable_at 관례 — 아는 만큼만 말한다)
  created_by       uuid references member(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_tracking_link_draft on tracking_link (draft_id);

-- 클릭은 덮어쓰지 않고 측정마다 한 줄(post_metric_snapshot과 대칭) — short.io에 이력이 있어도
-- 데이터 확인을 위해 서비스를 옮겨다니는 전환 비용이 크고, 다른 데이터와의 관계를 보려면
-- 우리 DB에 있어야 한다(koo 확정, C안).
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

-- 클라이언트 기본 랜딩 URL — 링크 생성 폼 자동 채움용, 생성 시 덮어쓰기 가능
alter table client add column if not exists landing_url text not null default '';
```

- [ ] **Step 2: 로컬/프로덕션 DB에 적용**

`.env`가 프로덕션 DB를 가리키는 리포(마이그레이션 024·025·027 선례와 동일하게 단일 DB). 이 파일 하나만 적용한다:

```bash
set -a; source .env; set +a; psql -v ON_ERROR_STOP=1 -f migrations/028_tracking_link.sql
```

Expected: `CREATE TABLE` ×2, `CREATE INDEX` ×2, `ALTER TABLE` 출력, 오류 없음.

- [ ] **Step 3: 스펙 문서의 스키마 블록에 `unavailable_at` 컬럼 추가** (Step 1과 동일 정의·주석)

- [ ] **Step 4: Commit**

```bash
git add migrations/028_tracking_link.sql docs/superpowers/specs/2026-08-24-tracking-link-design.md
git commit -m "feat(tracking-link): 스키마 — tracking_link·클릭 스냅샷·클라 기본 랜딩 URL (unavailable_at 스펙 보정)"
```

---

### Task 2: `src/lib/trackingLink.ts` — 코드 생성·URL 검사·UTM 조립·캠페인 제안 (순수 함수)

**Files:**
- Create: `src/lib/trackingLink.ts`
- Test: `src/lib/trackingLink.test.ts`

**Interfaces:**
- Produces (Task 6·8·9·10이 사용):
  - `CODE_LEN = 6`
  - `generateLinkCode(): string` — 소문자 영숫자 6자
  - `type LandingUrlCheck = { ok: true; url: string } | { ok: false; reason: 'empty' | 'not-https' | 'invalid' }`
  - `checkLandingUrl(input: string): LandingUrlCheck`
  - `landingUrlMessage(reason: 'empty' | 'not-https' | 'invalid'): string`
  - `buildTrackedUrl(args: { landingUrl: string; campaign: string; handle: string; code: string }): string`
  - `suggestCampaign(clientName: string | null, now?: number): string`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/trackingLink.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_LEN, generateLinkCode, checkLandingUrl, landingUrlMessage,
  buildTrackedUrl, suggestCampaign,
} from './trackingLink.ts';

test('1) 코드 — 6자 소문자 영숫자, 연속 생성이 겹치지 않는다', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
  for (const c of codes) assert.match(c, new RegExp(`^[a-z0-9]{${CODE_LEN}}$`));
  assert.equal(codes.size, 200); // 21억 조합에서 200개 충돌 확률은 사실상 0 — 겹치면 생성기가 고장난 것
});

test('2) 랜딩 URL 검사 — 빈 값·http·형식 오류를 구분한다', () => {
  assert.deepEqual(checkLandingUrl('  '), { ok: false, reason: 'empty' });
  assert.deepEqual(checkLandingUrl('http://example.com'), { ok: false, reason: 'not-https' });
  assert.deepEqual(checkLandingUrl('example.com/page'), { ok: false, reason: 'invalid' }); // 프로토콜 없음
  assert.deepEqual(checkLandingUrl('https://localhost'), { ok: false, reason: 'invalid' }); // 점 없는 호스트
  const ok = checkLandingUrl(' https://clinic.example.com/event?ref=a ');
  assert.equal(ok.ok, true);
  // 사유별 안내 문구가 비어 있지 않다 — 버튼 비활성의 이유를 항상 말한다(UX 원칙 2)
  for (const r of ['empty', 'not-https', 'invalid'] as const) assert.ok(landingUrlMessage(r).length > 0);
});

test('3) UTM 조립 — 표준형 4개 파라미터, 기존 쿼리 보존', () => {
  const u = new URL(buildTrackedUrl({
    landingUrl: 'https://clinic.example.com/event?ref=abc',
    campaign: '클리닉A-202608', handle: 'hana_kim', code: 'a3k9x2',
  }));
  assert.equal(u.searchParams.get('ref'), 'abc');            // 기존 쿼리 보존
  assert.equal(u.searchParams.get('utm_source'), 'x');
  assert.equal(u.searchParams.get('utm_medium'), 'influencer');
  assert.equal(u.searchParams.get('utm_campaign'), '클리닉A-202608'); // 한글 캠페인 왕복
  assert.equal(u.searchParams.get('utm_content'), 'hana_kim-a3k9x2');
});

test('4) UTM 조립 — 기존 utm_*는 교체, fragment는 유지', () => {
  const out = buildTrackedUrl({
    landingUrl: 'https://c.example.com/p?utm_source=old&UTM_Campaign=stale&keep=1#section',
    campaign: 'camp', handle: 'h', code: 'c0de00',
  });
  const u = new URL(out);
  assert.equal(u.searchParams.get('keep'), '1');
  assert.equal(u.searchParams.get('utm_source'), 'x');       // old가 아니라 교체됨
  assert.equal(u.searchParams.get('UTM_Campaign'), null);     // 대소문자 무관 제거
  assert.equal(u.searchParams.getAll('utm_campaign').length, 1);
  assert.equal(u.hash, '#section');                           // fragment 유지
});

test('5) 캠페인 제안 — 클라명 공백→하이픈 + KST YYYYMM, 클라 없으면 YYYYMM만', () => {
  // 2026-08-31 23:00 KST(= 14:00 UTC) — UTC로 계산하면 202608, KST 경계 검증은 아래에서
  const t = Date.parse('2026-08-31T14:00:00Z');
  assert.equal(suggestCampaign('연세 밝은 클리닉', t), '연세-밝은-클리닉-202608');
  assert.equal(suggestCampaign(null, t), '202608');
  assert.equal(suggestCampaign('  ', t), '202608');
  // KST 월 경계: 8/31 16:00 UTC = 9/1 01:00 KST → 202609
  assert.equal(suggestCampaign(null, Date.parse('2026-08-31T16:00:00Z')), '202609');
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trackingLink.test.ts`
Expected: FAIL — `Cannot find module './trackingLink.ts'`

- [ ] **Step 3: 구현** (`src/lib/trackingLink.ts`)

```ts
// 트래킹 링크의 순수 로직 — 코드 생성·랜딩 URL 검사·UTM 조립·캠페인 제안.
// 서버(라우트)와 브라우저(생성 모달 미리보기)가 같은 함수를 쓴다 — node 전용 API 금지(Web Crypto만).
// (스펙: docs/superpowers/specs/2026-08-24-tracking-link-design.md §UTM 조립 규칙)

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const CODE_LEN = 6;

// 6자 = 36^6 ≈ 21억 조합. 충돌은 DB unique + short.io 409가 잡고 호출부가 재생성한다.
export function generateLinkCode(): string {
  const buf = new Uint32Array(CODE_LEN);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (const n of buf) out += ALPHABET[n % ALPHABET.length];
  return out;
}

export type LandingUrlCheck =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'not-https' | 'invalid' };

// 잘못된 링크가 인플루언서에게 나가는 사고를 막는 관문 — 클라이언트(즉시 피드백)와
// 서버(저장 근거)가 같은 함수를 쓴다(parseTweetLink 재검증 관례).
export function checkLandingUrl(input: string): LandingUrlCheck {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'invalid' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (!u.hostname.includes('.')) return { ok: false, reason: 'invalid' }; // localhost 등 — 인플에게 줄 주소가 아니다
  return { ok: true, url: u.toString() };
}

export function landingUrlMessage(reason: 'empty' | 'not-https' | 'invalid'): string {
  if (reason === 'empty') return '랜딩페이지 주소를 입력해 주세요';
  if (reason === 'not-https') return '주소는 https:// 로 시작해야 해요';
  return '주소 형식이 올바르지 않아요 — 브라우저 주소창의 전체 주소를 붙여넣어 주세요';
}

// 표준형 UTM(스펙 확정): source=x · medium=influencer · campaign=입력값 · content={핸들}-{code}.
// 기존 utm_*는 대소문자 무관 제거 후 교체 — 이중 UTM은 랜딩 쪽 분석을 오염시킨다.
export function buildTrackedUrl(args: {
  landingUrl: string; campaign: string; handle: string; code: string;
}): string {
  const u = new URL(args.landingUrl);
  for (const k of [...u.searchParams.keys()]) {
    if (k.toLowerCase().startsWith('utm_')) u.searchParams.delete(k);
  }
  u.searchParams.set('utm_source', 'x');
  u.searchParams.set('utm_medium', 'influencer');
  u.searchParams.set('utm_campaign', args.campaign);
  u.searchParams.set('utm_content', `${args.handle}-${args.code}`);
  return u.toString();
}

// 제안값일 뿐 확정이 아니다 — 입력란에서 수정 가능(반자동의 '반').
// 한글 그대로 둔다(GA4 정상 표시), 공백만 하이픈으로. 월은 KST 기준(리포 시간대 관례).
export function suggestCampaign(clientName: string | null, now: number = Date.now()): string {
  const kst = new Date(now + 9 * 3600 * 1000);
  const ym = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  const name = (clientName ?? '').trim().replace(/\s+/g, '-');
  return name ? `${name}-${ym}` : ym;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/trackingLink.test.ts`
Expected: PASS 5건

- [ ] **Step 5: Commit**

```bash
git add src/lib/trackingLink.ts src/lib/trackingLink.test.ts
git commit -m "feat(tracking-link): 순수 로직 — 코드 생성·랜딩 URL 검사·UTM 조립·캠페인 제안"
```

---

### Task 3: `src/lib/shortio.ts` — short.io REST 클라이언트

**Files:**
- Create: `src/lib/shortio.ts`
- Test: `src/lib/shortio.test.ts`

**Interfaces:**
- Produces (Task 6·7이 사용):
  - `type CreateLinkResult = { kind: 'ok'; linkId: string; shortUrl: string } | { kind: 'conflict' } | { kind: 'error' }`
  - `type LinkStatsResult = { kind: 'ok'; totalClicks: number | null; humanClicks: number | null; raw: unknown } | { kind: 'unavailable' } | { kind: 'error' }`
  - `class ShortioClient` — `createLink(args: { originalUrl: string; path: string; title?: string })`, `getLinkStats(linkId: string)`
  - `isShortioConfigured(): boolean` / `makeShortioClient(): ShortioClient`(env 누락 시 throw)

설계 결정: getxapi.ts의 얇은 클라이언트 패턴(fetchImpl·sleep 주입, 백오프 재시도)을 따르되, 결과는 postMetrics의 3분기 규격(ok/unavailable·conflict/error)으로 돌려준다 — 라우트가 예외 처리 없이 분기만 하게. 재시도는 기본 2회(대화형 생성이라 길게 끌지 않는다). 사용량 기록 없음(정액 플랜 — 스펙).

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/shortio.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShortioClient } from './shortio.ts';

// 가짜 fetch — 호출 순서대로 응답을 소비한다(postMetrics.test 관례)
function fakeFetch(responses: Array<Response | Error>): { fn: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('가짜 fetch 응답 소진');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fn, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const make = (responses: Array<Response | Error>) => {
  const f = fakeFetch(responses);
  return { client: new ShortioClient({ apiKey: 'k', domain: 'cb.link', fetchImpl: f.fn, sleep: async () => {}, maxRetries: 2 }), calls: f.calls };
};

test('1) createLink 성공 — 도메인·경로·인증 헤더가 실리고 idString/shortURL을 돌려준다', async () => {
  const { client, calls } = make([json(200, { idString: 'lnk_1', shortURL: 'https://cb.link/a3k9x2' })]);
  const r = await client.createLink({ originalUrl: 'https://c.example.com/?utm_source=x', path: 'a3k9x2', title: 'hana · camp' });
  assert.deepEqual(r, { kind: 'ok', linkId: 'lnk_1', shortUrl: 'https://cb.link/a3k9x2' });
  assert.equal(calls[0].url, 'https://api.short.io/links');
  const headers = calls[0].init!.headers as Record<string, string>;
  assert.equal(headers.authorization, 'k');
  const body = JSON.parse(String(calls[0].init!.body));
  assert.deepEqual(body, { domain: 'cb.link', originalURL: 'https://c.example.com/?utm_source=x', path: 'a3k9x2', title: 'hana · camp' });
});

test('2) createLink 409 → conflict (경로 충돌 — 호출부가 코드 재생성)', async () => {
  const { client } = make([json(409, { error: 'Link already exists' })]);
  assert.deepEqual(await client.createLink({ originalUrl: 'https://a.b/', path: 'dup000' }), { kind: 'conflict' });
});

test('3) createLink — 5xx는 재시도 후 소진되면 error, 네트워크 예외도 error', async () => {
  const a = make([json(500, {}), json(500, {}), json(500, {})]); // maxRetries=2 → 3회 시도 후 포기
  assert.deepEqual(await a.client.createLink({ originalUrl: 'https://a.b/', path: 'x' }), { kind: 'error' });
  assert.equal(a.calls.length, 3);
  const b = make([new Error('ECONNRESET'), json(200, { idString: 'lnk_2', shortURL: 'https://cb.link/y' })]);
  assert.equal((await b.client.createLink({ originalUrl: 'https://a.b/', path: 'y' })).kind, 'ok'); // 재시도로 회복
});

test('4) createLink — 200인데 필수 필드가 없으면 error (성공 위장 금지)', async () => {
  const { client } = make([json(200, { ok: true })]);
  assert.deepEqual(await client.createLink({ originalUrl: 'https://a.b/', path: 'z' }), { kind: 'error' });
});

test('5) getLinkStats — 성공/404/5xx 3분기가 절대 섞이지 않는다', async () => {
  const a = make([json(200, { totalClicks: 128, humanClicks: 120 })]);
  const ok = await a.client.getLinkStats('lnk_1');
  assert.equal(ok.kind, 'ok');
  if (ok.kind === 'ok') {
    assert.equal(ok.totalClicks, 128);
    assert.equal(ok.humanClicks, 120);
    assert.deepEqual(ok.raw, { totalClicks: 128, humanClicks: 120 });
  }
  assert.equal(a.calls[0].url, 'https://api-v2.short.io/statistics/link/lnk_1?period=total');
  const b = make([json(404, {})]);
  assert.deepEqual(await b.client.getLinkStats('gone'), { kind: 'unavailable' });
  const c = make([json(500, {}), json(500, {}), json(500, {})]);
  assert.deepEqual(await c.client.getLinkStats('x'), { kind: 'error' });
});

test('6) getLinkStats — 클릭 필드가 숫자가 아니면 null (결손 허용, 오류 아님)', async () => {
  const { client } = make([json(200, { totalClicks: 'n/a' })]);
  const r = await client.getLinkStats('lnk_1');
  assert.equal(r.kind, 'ok');
  if (r.kind === 'ok') { assert.equal(r.totalClicks, null); assert.equal(r.humanClicks, null); }
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/shortio.test.ts`
Expected: FAIL — `Cannot find module './shortio.ts'`

- [ ] **Step 3: 구현** (`src/lib/shortio.ts`)

```ts
// short.io REST 클라이언트 — 링크 생성·클릭 통계 2개 엔드포인트만 쓴다.
// 공식 SDK(@short.io/client-node) 대신 직접 호출: 의존성 +763KB·zod 동반을 피하고
// getxapi.ts의 검증된 수제 클라이언트 패턴(fetchImpl 주입·백오프 재시도)을 따른다(스펙 §short.io 연동).
// 결과는 postMetrics 3분기 규격 — 라우트는 예외 없이 kind 분기만 한다.

const CREATE_BASE = 'https://api.short.io';
const STATS_BASE = 'https://api-v2.short.io';

export type CreateLinkResult =
  | { kind: 'ok'; linkId: string; shortUrl: string }
  | { kind: 'conflict' } // 409 — 같은 도메인에 같은 경로가 이미 있다. 호출부가 코드를 다시 뽑는다
  | { kind: 'error' };   // 통신 실패·5xx 소진·기형 응답 — 아무것도 저장하지 말 것

export type LinkStatsResult =
  | { kind: 'ok'; totalClicks: number | null; humanClicks: number | null; raw: unknown }
  | { kind: 'unavailable' } // 404 — short.io 쪽에서 링크가 지워짐(대시보드 수동 삭제 등)
  | { kind: 'error' };

export interface ShortioClientOptions {
  apiKey: string;
  domain: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export class ShortioClient {
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxRetries: number;

  constructor(private opts: ShortioClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = opts.maxRetries ?? 2; // 대화형 액션 뒤에 있어 getxapi(5회)보다 짧게 끊는다
  }

  async createLink(args: { originalUrl: string; path: string; title?: string }): Promise<CreateLinkResult> {
    const res = await this.request(`${CREATE_BASE}/links`, {
      method: 'POST',
      headers: { authorization: this.opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        domain: this.opts.domain, originalURL: args.originalUrl, path: args.path,
        ...(args.title ? { title: args.title } : {}),
      }),
    });
    if (!res) return { kind: 'error' };
    if (res.status === 409) return { kind: 'conflict' };
    if (!res.ok) {
      console.error(`shortio createLink ${res.status}:`, await res.text().catch(() => ''));
      return { kind: 'error' };
    }
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    // 실계약 확인(scripts/smoke-shortio.ts): 링크 ID는 idString(문자열) — 숫자 id는 폴백
    const linkId = typeof d?.idString === 'string' && d.idString ? d.idString
      : d?.id != null ? String(d.id) : null;
    const shortUrl = typeof d?.shortURL === 'string' && d.shortURL ? d.shortURL : null;
    if (!linkId || !shortUrl) return { kind: 'error' }; // 200인데 기형 — 성공으로 위장하지 않는다
    return { kind: 'ok', linkId, shortUrl };
  }

  async getLinkStats(linkId: string): Promise<LinkStatsResult> {
    const res = await this.request(
      `${STATS_BASE}/statistics/link/${encodeURIComponent(linkId)}?period=total`,
      { method: 'GET', headers: { authorization: this.opts.apiKey } },
    );
    if (!res) return { kind: 'error' };
    if (res.status === 404) return { kind: 'unavailable' };
    if (!res.ok) {
      console.error(`shortio getLinkStats ${res.status}:`, await res.text().catch(() => ''));
      return { kind: 'error' };
    }
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!d) return { kind: 'error' };
    return { kind: 'ok', totalClicks: num(d.totalClicks), humanClicks: num(d.humanClicks), raw: d };
  }

  // 공통 전송 — 네트워크 예외·429·5xx만 재시도, 그 외 상태 판정은 호출부 몫. 소진되면 null.
  private async request(url: string, init: RequestInit): Promise<Response | null> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, init);
      } catch (e) {
        if (attempt++ >= this.maxRetries) { console.error(`shortio ${url} 통신 실패:`, e); return null; }
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt++ >= this.maxRetries) return res; // 마지막 응답을 그대로 — 상태 로그는 호출부가 남긴다
        await this.sleep(Math.min(500 * 2 ** (attempt - 1), 4000));
        continue;
      }
      return res;
    }
  }
}

export function isShortioConfigured(): boolean {
  return Boolean(process.env.SHORTIO_API_KEY && process.env.SHORTIO_DOMAIN);
}

export function makeShortioClient(): ShortioClient {
  const apiKey = process.env.SHORTIO_API_KEY;
  const domain = process.env.SHORTIO_DOMAIN;
  if (!apiKey || !domain) throw new Error('SHORTIO_API_KEY / SHORTIO_DOMAIN not set');
  return new ShortioClient({ apiKey, domain });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/shortio.test.ts`
Expected: PASS 6건

- [ ] **Step 5: Commit**

```bash
git add src/lib/shortio.ts src/lib/shortio.test.ts
git commit -m "feat(tracking-link): short.io REST 클라이언트 — 생성·통계 2엔드포인트, 3분기 규격"
```

---

### Task 4: `src/lib/linkStore.ts` — 명부·클릭 기록 읽기/쓰기

**Files:**
- Create: `src/lib/linkStore.ts`
- Test: `src/lib/linkStore.test.ts`

**Interfaces:**
- Consumes: Task 1의 테이블
- Produces (Task 6·8·9·10이 사용):
  - `interface LinkClicks { totalClicks: number | null; humanClicks: number | null }`
  - `interface TrackingLinkRow { id; code; landingUrl; longUrl; shortUrl; shortioLinkId; utmCampaign; influencerHandle; draftId; draftLabel; clientId; clientName; unavailableAt; createdAt: string; clicks: LinkClicks | null; capturedAt: string | null }` (draftLabel = coalesce(title, ko_title), 나머지 nullable 문자열)
  - `interface LinkClickSnapshotRow { capturedAt: string; totalClicks: number | null; humanClicks: number | null }`
  - `listLinks(sql, opts?: { draftId?: string }): Promise<TrackingLinkRow[]>`
  - `findLinkById(sql, id): Promise<TrackingLinkRow | null>`
  - `insertLink(sql, args): Promise<TrackingLinkRow>` — args: `{ code; landingUrl; longUrl; shortUrl; shortioLinkId; utmCampaign; influencerHandle; draftId: string | null; clientId: string | null; clientName: string | null; createdBy: string | null }`
  - `appendClickSnapshot(sql, trackingLinkId, clicks: LinkClicks, raw: unknown): Promise<void>` — unavailable_at 복귀 수용 포함
  - `markLinkUnavailable(sql, trackingLinkId): Promise<void>` — 최초 확인 시각 보존(coalesce)
  - `deleteLink(sql, trackingLinkId): Promise<boolean>` — DB만, 스냅샷 cascade
  - `listClickSnapshots(sql, trackingLinkId, limit = 50): Promise<LinkClickSnapshotRow[]>`

- [ ] **Step 1: 실패하는 테스트 작성** (`src/lib/linkStore.test.ts` — trackingStore.test.ts 골격, 실 DB, 접두사 정리)

```ts
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { insertDraft, updateDraft } from './draftStore.ts';
import type { DraftContent } from './draftTypes.ts';
import {
  listLinks, findLinkById, insertLink, appendClickSnapshot,
  markLinkUnavailable, deleteLink, listClickSnapshots,
} from './linkStore.ts';

const sql = getSql();
const P = 'tlnk' + process.pid;
const base = (code: string) => ({
  code, landingUrl: 'https://c.example.com/', longUrl: `https://c.example.com/?utm_content=h-${code}`,
  shortUrl: `https://cb.link/${code}`, shortioLinkId: 'lnk_' + code, utmCampaign: P + '캠',
  influencerHandle: 'hana_kim', draftId: null as string | null, clientId: null, clientName: null, createdBy: null,
});

after(async () => {
  await sql`delete from tracking_link where utm_campaign like ${P + '%'}`; // 스냅샷은 cascade
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql.end();
});

test('1) 생성 → 목록 — 클릭 측정 전에는 clicks가 null', async () => {
  const row = await insertLink(sql, base(P.slice(0, 2) + '0001'));
  assert.equal(row.clicks, null);
  assert.equal(row.capturedAt, null);
  assert.equal(row.unavailableAt, null);
  const listed = (await listLinks(sql)).find((r) => r.id === row.id);
  assert.ok(listed);
  assert.equal(listed!.shortUrl, row.shortUrl);
});

test('2) code unique — 같은 코드 재삽입은 던진다(호출부 재생성의 근거)', async () => {
  await insertLink(sql, base(P.slice(0, 2) + '0002'));
  await assert.rejects(() => insertLink(sql, base(P.slice(0, 2) + '0002')));
});

test('3) 클릭 스냅샷 append — 최신값이 목록에 붙고 이력이 쌓인다·복귀 수용', async () => {
  const row = await insertLink(sql, base(P.slice(0, 2) + '0003'));
  await appendClickSnapshot(sql, row.id, { totalClicks: 10, humanClicks: 9 }, { totalClicks: 10 });
  await markLinkUnavailable(sql, row.id);
  const dead = await findLinkById(sql, row.id);
  assert.ok(dead!.unavailableAt);
  await markLinkUnavailable(sql, row.id); // 두 번째 호출이 시각을 덮어쓰지 않는다
  assert.equal((await findLinkById(sql, row.id))!.unavailableAt, dead!.unavailableAt);
  await appendClickSnapshot(sql, row.id, { totalClicks: 25, humanClicks: null }, null); // 복귀
  const back = await findLinkById(sql, row.id);
  assert.equal(back!.clicks!.totalClicks, 25);
  assert.equal(back!.clicks!.humanClicks, null);
  assert.equal(back!.unavailableAt, null);
  const history = await listClickSnapshots(sql, row.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].totalClicks, 25); // 최신이 먼저
});

test('4) draft 연결 — draftLabel(title 우선), draft 삭제 시 링크는 남고 연결만 풀린다', async () => {
  const content: DraftContent = { posts: [{ text: '링크 연결 테스트', media: [] }] };
  const draftId = await insertDraft(sql, {
    clientId: null, clientName: null, procedureNames: [],
    direction: P + '방향', format: 'single', referenceMode: 'off', refs: [],
    content, model: null, memberId: null,
  });
  await updateDraft(sql, draftId, { title: P + '제목' });
  const row = await insertLink(sql, { ...base(P.slice(0, 2) + '0004'), draftId });
  assert.equal((await findLinkById(sql, row.id))!.draftLabel, P + '제목');
  const byDraft = await listLinks(sql, { draftId });
  assert.equal(byDraft.length, 1);
  await sql`delete from draft where id = ${draftId}`;
  const after1 = await findLinkById(sql, row.id);
  assert.ok(after1); // on delete set null — 링크·클릭 기록은 남는다(스펙)
  assert.equal(after1!.draftId, null);
});

test('5) 삭제 — 행과 스냅샷만 지워진다(shortio_link_id 관련 동작 없음은 라우트 몫)', async () => {
  const row = await insertLink(sql, base(P.slice(0, 2) + '0005'));
  await appendClickSnapshot(sql, row.id, { totalClicks: 1, humanClicks: 1 }, null);
  assert.equal(await deleteLink(sql, row.id), true);
  assert.equal(await findLinkById(sql, row.id), null);
  const snaps = await sql`select id from link_click_snapshot where tracking_link_id = ${row.id}`;
  assert.equal(snaps.length, 0);
  assert.equal(await deleteLink(sql, row.id), false);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/linkStore.test.ts`
Expected: FAIL — `Cannot find module './linkStore.ts'`

- [ ] **Step 3: 구현** (`src/lib/linkStore.ts` — trackingStore.ts와 같은 구성: 공용 SELECT + lateral join)

```ts
import type postgres from 'postgres';

export interface LinkClicks { totalClicks: number | null; humanClicks: number | null }

export interface TrackingLinkRow {
  id: string; code: string;
  landingUrl: string; longUrl: string; shortUrl: string; shortioLinkId: string;
  utmCampaign: string; influencerHandle: string;
  draftId: string | null;
  draftLabel: string | null;      // coalesce(draft.title, draft.ko_title) — 목록 표시용(trackingStore 관례)
  clientId: string | null; clientName: string | null;
  unavailableAt: string | null;   // short.io 쪽 링크 소실 확인 시각(ISO). null = 정상
  createdAt: string;              // ISO
  clicks: LinkClicks | null;      // 최신 스냅샷 (없으면 null — 링크는 클릭 0에서 시작하므로 '측정 전'이 실재한다)
  capturedAt: string | null;      // 최신 스냅샷 시각(ISO)
}

type Row = {
  id: string; code: string; landing_url: string; long_url: string; short_url: string;
  shortio_link_id: string; utm_campaign: string; influencer_handle: string;
  draft_id: string | null; draft_title: string | null; draft_ko_title: string | null;
  client_id: string | null; client_name: string | null;
  unavailable_at: Date | null; created_at: Date;
  total_clicks: number | null; human_clicks: number | null; captured_at: Date | null;
};

// 목록·단건이 같은 정의를 쓴다(드리프트 방지) — lateral join으로 최신 스냅샷 1건만 붙인다(trackingStore 관례).
const SELECT = (sql: postgres.Sql) => sql`
  select l.id, l.code, l.landing_url, l.long_url, l.short_url, l.shortio_link_id,
         l.utm_campaign, l.influencer_handle, l.draft_id,
         d.title as draft_title, d.ko_title as draft_ko_title,
         l.client_id, l.client_name, l.unavailable_at, l.created_at,
         s.total_clicks, s.human_clicks, s.captured_at
    from tracking_link l
    left join draft d on d.id = l.draft_id
    left join lateral (
      select * from link_click_snapshot where tracking_link_id = l.id
      order by captured_at desc limit 1
    ) s on true`;

function toRow(r: Row): TrackingLinkRow {
  return {
    id: r.id, code: r.code,
    landingUrl: r.landing_url, longUrl: r.long_url, shortUrl: r.short_url,
    shortioLinkId: r.shortio_link_id, utmCampaign: r.utm_campaign,
    influencerHandle: r.influencer_handle,
    draftId: r.draft_id, draftLabel: r.draft_title ?? r.draft_ko_title ?? null,
    clientId: r.client_id, clientName: r.client_name,
    unavailableAt: r.unavailable_at ? new Date(r.unavailable_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    clicks: r.captured_at !== null ? { totalClicks: r.total_clicks, humanClicks: r.human_clicks } : null,
    capturedAt: r.captured_at ? new Date(r.captured_at).toISOString() : null,
  };
}

export async function listLinks(sql: postgres.Sql, opts?: { draftId?: string }): Promise<TrackingLinkRow[]> {
  const rows = opts?.draftId
    ? await sql<Row[]>`${SELECT(sql)} where l.draft_id = ${opts.draftId} order by l.created_at desc`
    : await sql<Row[]>`${SELECT(sql)} order by l.created_at desc`;
  return rows.map(toRow);
}

export async function findLinkById(sql: postgres.Sql, id: string): Promise<TrackingLinkRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where l.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

// 스냅샷 없이 명부만 만든다 — 링크 생성은 측정이 아니다(클릭은 0에서 시작, 스펙 §데이터 모델).
// code unique 충돌은 그대로 던진다: short.io 409를 먼저 통과했다면 사실상 도달 불가(스펙 §생성 흐름).
export async function insertLink(sql: postgres.Sql, args: {
  code: string; landingUrl: string; longUrl: string; shortUrl: string; shortioLinkId: string;
  utmCampaign: string; influencerHandle: string;
  draftId: string | null; clientId: string | null; clientName: string | null; createdBy: string | null;
}): Promise<TrackingLinkRow> {
  const ins = await sql<Array<{ id: string }>>`
    insert into tracking_link (code, landing_url, long_url, short_url, shortio_link_id,
                               utm_campaign, influencer_handle, draft_id, client_id, client_name, created_by)
    values (${args.code}, ${args.landingUrl}, ${args.longUrl}, ${args.shortUrl}, ${args.shortioLinkId},
            ${args.utmCampaign}, ${args.influencerHandle}, ${args.draftId}, ${args.clientId},
            ${args.clientName}, ${args.createdBy})
    returning id`;
  return (await findLinkById(sql, ins[0].id)) as TrackingLinkRow;
}

// 스냅샷 추가 + unavailable_at 복귀 수용(appendSnapshot 관례) — 다시 측정됐다는 것 자체가 복귀 증거다.
export async function appendClickSnapshot(
  sql: postgres.Sql, trackingLinkId: string, clicks: LinkClicks, raw: unknown,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into link_click_snapshot (tracking_link_id, total_clicks, human_clicks, raw)
      values (${trackingLinkId}, ${clicks.totalClicks}, ${clicks.humanClicks},
              ${raw ? tx.json(raw as never) : null})`;
    await tx`update tracking_link set unavailable_at = null where id = ${trackingLinkId}`;
  });
}

// 이미 기록돼 있으면 시각 유지(최초 확인 시각 보존) — markUnavailable 관례.
export async function markLinkUnavailable(sql: postgres.Sql, trackingLinkId: string): Promise<void> {
  await sql`update tracking_link set unavailable_at = coalesce(unavailable_at, now()) where id = ${trackingLinkId}`;
}

export async function deleteLink(sql: postgres.Sql, trackingLinkId: string): Promise<boolean> {
  const rows = await sql`delete from tracking_link where id = ${trackingLinkId} returning id`; // 스냅샷은 cascade
  return rows.length > 0;
}

export interface LinkClickSnapshotRow {
  capturedAt: string; totalClicks: number | null; humanClicks: number | null;
}

// limit: 이력이 길어져도 한 번에 다 그리지 않는다(listSnapshots 관례 — 인덱스가 정렬을 그대로 탄다).
export async function listClickSnapshots(
  sql: postgres.Sql, trackingLinkId: string, limit = 50,
): Promise<LinkClickSnapshotRow[]> {
  const rows = await sql<Array<{ captured_at: Date; total_clicks: number | null; human_clicks: number | null }>>`
    select captured_at, total_clicks, human_clicks
    from link_click_snapshot
    where tracking_link_id = ${trackingLinkId}
    order by captured_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    capturedAt: new Date(r.captured_at).toISOString(),
    totalClicks: r.total_clicks, humanClicks: r.human_clicks,
  }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/linkStore.test.ts`
Expected: PASS 5건

- [ ] **Step 5: Commit**

```bash
git add src/lib/linkStore.ts src/lib/linkStore.test.ts
git commit -m "feat(tracking-link): linkStore — 명부·클릭 스냅샷 읽기/쓰기 (lateral 최신값·복귀 수용)"
```

---

### Task 5: 클라이언트 기본 랜딩 URL — store · PATCH 라우트 · 관리 화면

**Files:**
- Modify: `src/lib/clientStore.ts` (ClientRow에 landingUrl, select 3곳, updateClient)
- Modify: `src/app/api/clients/[id]/route.ts` (PATCH 허용 필드 추가 + 검증)
- Modify: `src/app/clients/ClientDetail.tsx` (BasicInfoEditor에 입력란)
- Test: `src/lib/clientStore.test.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Consumes: Task 1의 `client.landing_url`, Task 2의 `checkLandingUrl`·`landingUrlMessage`
- Produces: `ClientRow.landingUrl: string` — GET /api/clients 응답에 자동 포함되어 Task 8(생성 모달)의 자동 채움 소스가 된다

- [ ] **Step 1: 실패하는 테스트 추가** — `src/lib/clientStore.test.ts`의 기존 테스트들 뒤에 추가 (기존 파일 스타일에 맞춰 정리 로직 재사용):

```ts
test('landing_url — 저장·조회 왕복, 기본값은 빈 문자열', async () => {
  const c = await createClient(sql, P + '랜딩');
  assert.equal(c.landingUrl, '');
  await updateClient(sql, c.id, { landingUrl: 'https://clinic.example.com/event' });
  const got = await getClientWithProcedures(sql, c.id);
  assert.equal(got!.client.landingUrl, 'https://clinic.example.com/event');
  // 다른 필드 patch가 landing_url을 지우지 않는다(coalesce)
  await updateClient(sql, c.id, { info: '정보' });
  assert.equal((await getClientWithProcedures(sql, c.id))!.client.landingUrl, 'https://clinic.example.com/event');
});
```

(주의: 기존 테스트 파일의 접두사 변수·정리(after) 방식을 열어 확인하고 동일하게 맞춘다. `createClient`/`updateClient`/`getClientWithProcedures` import가 이미 있는지 확인.)

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --env-file-if-exists=.env --test src/lib/clientStore.test.ts`
Expected: FAIL — `landingUrl` 프로퍼티 없음(타입 에러) 또는 undefined 비교 실패

- [ ] **Step 3: clientStore.ts 수정** — 4곳:

```ts
// 1) 인터페이스
export interface ClientRow { id: string; name: string; info: string; bannedPhrases: string[]; position: number; updatedAt: string; landingUrl: string }
// 2) CRow에 landing_url: string 추가, toClient에 landingUrl: r.landing_url 추가
// 3) createClient·listClients·getClientWithProcedures의 select/returning 컬럼 목록에 landing_url 추가 (3곳)
// 4) updateClient patch에 landingUrl 추가:
export async function updateClient(
  sql: postgres.Sql, id: string,
  patch: { name?: string; info?: string; bannedPhrases?: string[]; landingUrl?: string },
): Promise<void> {
  await sql`update client set
      name = coalesce(${patch.name ?? null}, name),
      info = coalesce(${patch.info ?? null}, info),
      banned_phrases = coalesce(${patch.bannedPhrases ? sql.json(patch.bannedPhrases) : null}, banned_phrases),
      landing_url = coalesce(${patch.landingUrl ?? null}, landing_url),
      updated_at = now()
    where id = ${id}`;
}
```

- [ ] **Step 4: 테스트 통과 확인** — Step 2와 같은 명령, Expected: PASS(기존 케이스 포함 전부)

- [ ] **Step 5: PATCH 라우트 검증 추가** — `src/app/api/clients/[id]/route.ts`의 PATCH에서 body 타입에 `landingUrl?: string`을 더하고, name 검증 블록 다음에:

```ts
import { checkLandingUrl, landingUrlMessage } from '@/lib/trackingLink';
// ...
if (body.landingUrl !== undefined) {
  body.landingUrl = body.landingUrl.trim();
  // 빈 값은 '기본 랜딩 없음'으로 허용 — 값이 있을 때만 형식을 지킨다(잘못된 기본값이 생성 폼에 흘러들지 않게)
  if (body.landingUrl !== '') {
    const check = checkLandingUrl(body.landingUrl);
    if (!check.ok) return NextResponse.json({ error: landingUrlMessage(check.reason) }, { status: 400 });
    body.landingUrl = check.url;
  }
}
```

- [ ] **Step 6: ClientDetail.tsx의 BasicInfoEditor에 입력란 추가** — `info`/`banned`와 같은 방식으로 `landingUrl` state·baseline·cur·isDirty·PATCH body에 편입하고, '클리닉·의사 정보' label 앞에:

```tsx
<label className="block">
  <span className="text-ui font-bold">기본 랜딩페이지 주소 <span className="font-normal text-x-muted">선택</span></span>
  <p className="text-caption text-x-muted">트래킹 링크를 만들 때 이 주소가 자동으로 채워져요. (만들 때 바꿀 수도 있어요)</p>
  <input type="url" value={landingUrl} onChange={(e) => { setLandingUrl(e.target.value); setSaved(false); }}
         placeholder="https://…" autoComplete="off" spellCheck={false}
         className="mt-1 w-full rounded-md border border-x-border-strong p-2 text-ui outline-none focus:border-x-blue" />
</label>
```

수정 지점: `useState`·`baseline`·`cur` ref·`useEffect`(cur 동기화)·`save`의 PATCH body·`isDirty` — 각각 `info`와 나란히 `landingUrl`을 추가한다. 저장 실패(400) 시 기존 `err` 표시가 그대로 서버 문구를 보여준다.

- [ ] **Step 7: 린트·수동 확인**

Run: `npm run lint` → 경고 24개 이하 유지.
(화면 확인은 Task 11의 build+start에서 일괄.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/clientStore.ts src/lib/clientStore.test.ts "src/app/api/clients/[id]/route.ts" src/app/clients/ClientDetail.tsx
git commit -m "feat(tracking-link): 클라이언트 기본 랜딩 URL — 저장·검증·관리 화면 입력란"
```

---

### Task 6: API 라우트 — /api/links (목록·생성·새로고침·이력·삭제)

**Files:**
- Create: `src/app/api/links/route.ts`
- Create: `src/app/api/links/[id]/route.ts`
- Create: `src/app/api/links/[id]/refresh/route.ts`
- Create: `src/app/api/links/[id]/snapshots/route.ts`

**Interfaces:**
- Consumes: Task 2 `generateLinkCode`·`checkLandingUrl`·`landingUrlMessage`·`buildTrackedUrl` / Task 3 `makeShortioClient`·`isShortioConfigured` / Task 4 linkStore 전체 / 기존 `parseXHandle`(`@/lib/xHandle`)·`isUuidLike`(`@/lib/uuid`)·`requireAllowedUser`/`requireMember`·`getSql`
- Produces (Task 8·9·10이 호출):
  - `GET /api/links[?draftId=]` → `{ configured: boolean; rows: TrackingLinkRow[] }`
  - `POST /api/links` body `{ landingUrl, influencerHandle, utmCampaign, draftId?, clientId? }` → `{ row: TrackingLinkRow }` | `{ error }`(400/502/503)
  - `POST /api/links/[id]/refresh` → `{ row }` | `{ error }`(404/502)
  - `GET /api/links/[id]/snapshots` → `LinkClickSnapshotRow[]`
  - `DELETE /api/links/[id]` → `{ ok: true }` (short.io 링크는 건드리지 않음)

라우트 테스트 하네스는 이 리포에 없다(검증 관례) — 로직은 Task 2~4 테스트가 덮고, 라우트는 lint+build+수동 QA로 확인한다.

- [ ] **Step 1: `src/app/api/links/route.ts` 작성**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { parseXHandle } from '@/lib/xHandle';
import { generateLinkCode, checkLandingUrl, landingUrlMessage, buildTrackedUrl } from '@/lib/trackingLink';
import { isShortioConfigured, makeShortioClient } from '@/lib/shortio';
import { insertLink, listLinks } from '@/lib/linkStore';

const NOT_CONFIGURED = 'short.io 연결이 아직 설정되지 않았어요 — 관리자에게 SHORTIO_API_KEY·SHORTIO_DOMAIN 설정을 요청해 주세요';
const CREATE_FAILED = '짧은 링크를 만들지 못했어요 — 잠시 후 다시 시도해 주세요';

// configured를 함께 내려보낸다 — 화면이 '만들기'를 거짓 어포던스로 두지 않기 위한 근거(스펙 §short.io 연동).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const draftId = new URL(req.url).searchParams.get('draftId');
  const rows = await listLinks(getSql(), draftId && isUuidLike(draftId) ? { draftId } : undefined);
  return NextResponse.json({ configured: isShortioConfigured(), rows });
}

// 생성은 원자적: short.io 생성이 성공한 뒤에만 DB에 저장 — 실패 시 반쪽 행이 없다(스펙 §생성 흐름).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  if (!isShortioConfigured()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as {
    landingUrl?: unknown; influencerHandle?: unknown; utmCampaign?: unknown;
    draftId?: unknown; clientId?: unknown;
  };

  // 서버 재검증 — 클라이언트 인라인 검증만 믿지 않는다(같은 함수, parseTweetLink 관례)
  const landing = checkLandingUrl(String(body.landingUrl ?? ''));
  if (!landing.ok) return NextResponse.json({ error: landingUrlMessage(landing.reason) }, { status: 400 });
  const handle = parseXHandle(String(body.influencerHandle ?? ''));
  if (!handle.ok) return NextResponse.json({ error: '인플루언서 핸들을 확인해 주세요 — @핸들 또는 프로필 링크' }, { status: 400 });
  const campaign = String(body.utmCampaign ?? '').trim();
  if (!campaign) return NextResponse.json({ error: '캠페인명을 입력해 주세요' }, { status: 400 });

  // 연결 대상은 존재할 때만 잇는다 — 죽은 id로 FK 오류(500)를 내느니 조용히 연결 없이 만든다
  let draftId: string | null = null;
  if (typeof body.draftId === 'string' && isUuidLike(body.draftId)) {
    const d = await sql<Array<{ id: string }>>`select id from draft where id = ${body.draftId}`;
    if (d.length) draftId = body.draftId;
  }
  let clientId: string | null = null;
  let clientName: string | null = null;
  if (typeof body.clientId === 'string' && isUuidLike(body.clientId)) {
    const c = await sql<Array<{ id: string; name: string }>>`select id, name from client where id = ${body.clientId}`;
    if (c.length) { clientId = c[0].id; clientName = c[0].name; } // 이름은 서버가 스냅샷(클라 삭제 대비)
  }

  const shortio = makeShortioClient();
  // 코드 충돌(short.io 409)이면 다시 뽑는다 — 21억 조합이라 3회면 충분(스펙 §데이터 모델)
  for (let i = 0; i < 3; i++) {
    const code = generateLinkCode();
    const longUrl = buildTrackedUrl({ landingUrl: landing.url, campaign, handle: handle.handle, code });
    const created = await shortio.createLink({
      originalUrl: longUrl, path: code,
      title: `${handle.handle} · ${campaign}`, // short.io 대시보드에서 사람이 알아보는 이름
    });
    if (created.kind === 'conflict') continue;
    if (created.kind === 'error') return NextResponse.json({ error: CREATE_FAILED }, { status: 502 });
    const row = await insertLink(sql, {
      code, landingUrl: landing.url, longUrl, shortUrl: created.shortUrl,
      shortioLinkId: created.linkId, utmCampaign: campaign, influencerHandle: handle.handle,
      draftId, clientId, clientName, createdBy: gate.member.id,
    });
    return NextResponse.json({ row });
  }
  return NextResponse.json({ error: CREATE_FAILED }, { status: 502 });
}
```

(`parseXHandle` 반환 형태는 `{ ok: true; handle: string } | { ok: false; reason }` — src/lib/xHandle.ts에서 확인 완료. 위 코드와 일치.)

- [ ] **Step 2: `src/app/api/links/[id]/route.ts` 작성**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { deleteLink } from '@/lib/linkStore';

// DB만 지운다 — short.io 링크는 살려둔다: 인플루언서가 이미 게시한 링크가 죽으면 사고다(스펙 §API, koo 확정).
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  await deleteLink(getSql(), id);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: `src/app/api/links/[id]/refresh/route.ts` 작성**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { isShortioConfigured, makeShortioClient } from '@/lib/shortio';
import { findLinkById, appendClickSnapshot, markLinkUnavailable } from '@/lib/linkStore';

const NOT_CONFIGURED = 'short.io 연결이 아직 설정되지 않았어요 — 관리자에게 SHORTIO_API_KEY·SHORTIO_DOMAIN 설정을 요청해 주세요';
const FETCH_FAILED = '클릭 수를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

// ok → 스냅샷 추가(복귀 수용 포함) / unavailable(404) → 시각 기록 / error → 아무것도 저장 안 함
// (tracking refresh와 동일 문법 — 틀린 기록보다 빈 기록)
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  if (!isShortioConfigured()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  const sql = getSql();
  const row = await findLinkById(sql, id);
  if (!row) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });

  const result = await makeShortioClient().getLinkStats(row.shortioLinkId);
  if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
  if (result.kind === 'unavailable') await markLinkUnavailable(sql, id);
  else await appendClickSnapshot(sql, id, { totalClicks: result.totalClicks, humanClicks: result.humanClicks }, result.raw);
  return NextResponse.json({ row: await findLinkById(sql, id) });
}
```

- [ ] **Step 4: `src/app/api/links/[id]/snapshots/route.ts` 작성**

```ts
import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { listClickSnapshots } from '@/lib/linkStore';

// 행을 펼칠 때만 부른다(목록 응답에 이력 전량을 싣지 않는다 — tracking snapshots 관례)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return NextResponse.json({ error: '링크를 찾을 수 없어요' }, { status: 404 });
  return NextResponse.json(await listClickSnapshots(getSql(), id));
}
```

- [ ] **Step 5: 린트·타입 확인**

Run: `npm run lint && npx tsc --noEmit`
Expected: 린트 경고 24개 이하, 타입 오류 0. (`npx tsc --noEmit`가 리포에서 통상 쓰이지 않으면 `npm run build`로 대체)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/links
git commit -m "feat(tracking-link): /api/links 라우트 — 목록·생성(원자)·클릭 새로고침·이력·삭제(short.io 보존)"
```

---

### Task 7: `scripts/smoke-shortio.ts` — 실계약 스모크 (열린 검증 1·2)

**Files:**
- Create: `scripts/smoke-shortio.ts`
- Modify: `package.json` (scripts에 `"smoke:shortio"` 추가)

**Interfaces:**
- Consumes: Task 3 `ShortioClient`

스펙의 열린 검증: ① 생성→통계 왕복으로 응답 필드명(idString/totalClicks/humanClicks) 확정 ② 경로 충돌 시 409 실확인. env가 없으면 안내만 하고 성공 종료(smoke 관례 확인 후 맞춤).

- [ ] **Step 1: 스크립트 작성**

```ts
// short.io 실계약 스모크 — 생성→중복 생성(409 확인)→통계 조회 1왕복.
// 만든 테스트 링크는 자동 삭제하지 않는다(삭제 API를 앱이 안 쓰므로) — 마지막에 지울 링크를 안내한다.
import { ShortioClient } from '../src/lib/shortio.ts';

const apiKey = process.env.SHORTIO_API_KEY;
const domain = process.env.SHORTIO_DOMAIN;
if (!apiKey || !domain) {
  console.log('SHORTIO_API_KEY / SHORTIO_DOMAIN 미설정 — .env에 넣고 다시 실행하세요');
  process.exit(0);
}
const client = new ShortioClient({ apiKey, domain });
const path = 'smoke-' + Date.now().toString(36);

const created = await client.createLink({
  originalUrl: 'https://example.com/?utm_source=x&utm_medium=influencer&utm_campaign=smoke&utm_content=smoke-' + path,
  path, title: 'smoke test — 지워도 됩니다',
});
console.log('createLink:', JSON.stringify(created, null, 2));
if (created.kind !== 'ok') process.exit(1);

const dup = await client.createLink({ originalUrl: 'https://example.com/', path });
console.log('중복 경로 생성(409 → conflict 기대):', dup.kind);

const stats = await client.getLinkStats(created.linkId);
console.log('getLinkStats:', JSON.stringify(stats, null, 2));

const missing = await client.getLinkStats('lnk_missing_0000');
console.log('없는 링크 통계(unavailable 기대):', missing.kind);

console.log(`\n확인 후 short.io 대시보드에서 테스트 링크(${domain}/${path})를 지워주세요.`);
```

- [ ] **Step 2: package.json scripts에 추가** — 기존 smoke 관례 그대로:

```json
"smoke:shortio": "node --import tsx --env-file-if-exists=.env scripts/smoke-shortio.ts"
```

- [ ] **Step 3: 실행 (SHORTIO_API_KEY·SHORTIO_DOMAIN이 .env에 있을 때)**

Run: `npm run smoke:shortio`
Expected: createLink `kind: 'ok'`(idString·shortURL 존재), 중복 `conflict`, 통계 `ok`(totalClicks 숫자 또는 null), 없는 링크 `unavailable`.
**응답 필드가 기대와 다르면**(예: 통계 필드명이 `clicks`거나 409 대신 400) `src/lib/shortio.ts`의 매핑·판정과 Task 3 테스트를 실응답 기준으로 고치고 이 스크립트를 재실행한다. env가 아직 없으면 이 Step은 보류하고 Task 11 전까지 완료한다(구현 진행에는 지장 없음 — 매핑은 폴백을 갖고 있다).

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-shortio.ts package.json
git commit -m "feat(tracking-link): short.io 실계약 스모크 — 필드명·409·404 확정용"
```

---

### Task 8: `LinkCreateModal` — 생성 모달 (양쪽 진입점 공유)

**Files:**
- Create: `src/components/LinkCreateModal.tsx`

**Interfaces:**
- Consumes: Task 2 순수 함수(미리보기·검증), `InfluencerField`(`@/components/InfluencerField`), `Button`(`@/components/ui`), `apiFetch`, `ClientRow`(landingUrl 포함), `InfluencerOption`(`@/lib/draftTypes`), `InfluencerRow`(`@/lib/influencerStore`), POST /api/links
- Produces (Task 9·10이 사용):
  - `LinkCreateModal({ open, onClose, onCreated, configured, prefill }: { open: boolean; onClose: () => void; onCreated: (row: TrackingLinkRow) => void; configured: boolean; prefill?: { draftId?: string; influencerHandle?: string; clientId?: string; clientName?: string } })`

동작 규칙:
- 열릴 때 `/api/clients`·`/api/influencers`를 병렬 조회(자동 채움·자동완성 소스). 실패해도 모달은 동작한다(자동 채움만 빠짐).
- 클라이언트 select 변경 시: 랜딩 URL 입력을 사용자가 아직 안 만졌으면(`landingTouched`) 그 클라의 `landingUrl`로, 캠페인을 안 만졌으면(`campaignTouched`) `suggestCampaign(name)`으로 채운다. prefill.clientId도 로드 후 같은 규칙 적용.
- 미리보기: 랜딩 URL이 유효하면 `buildTrackedUrl({ ..., code: 'xxxxxx' })`를 항상 표시 + 캡션 "xxxxxx 자리는 만들 때 정해지는 6자리 코드예요". 무엇이 만들어지는지 행동 전에 보여준다(UX 원칙 2).
- 만들기 버튼: `configured === false`면 버튼 대신 안내 문구(거짓 어포던스 금지). 검증 실패면 비활성 + 이유.
- 성공 화면: 단축 링크 크게 + [복사](navigator.clipboard, 성공 시 "복사됨 ✓" 2초) + "인플루언서에게 이 링크를 전달해 게시할 때 함께 올려달라고 요청하세요." + [닫기].
- Esc 닫기: `AddByLinkModal.tsx`의 관례(`e.isComposing` 가드, 오버레이 클릭 닫기, 내부 클릭 stopPropagation)를 그대로 따른다.

- [ ] **Step 1: 컴포넌트 작성** — 상태·구조 스케치(전체 골격, AddByLinkModal 참조해 마감):

```tsx
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { InfluencerField } from '@/components/InfluencerField';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow } from '@/lib/clientStore';
import type { InfluencerRow } from '@/lib/influencerStore';
import type { TrackingLinkRow } from '@/lib/linkStore';
import { checkLandingUrl, landingUrlMessage, buildTrackedUrl, suggestCampaign } from '@/lib/trackingLink';

// 트래킹 링크 생성 모달 — 원고 카드(자동 채움)와 트래킹 페이지(직접 입력) 양쪽이 공유한다(스펙 §화면).
export function LinkCreateModal({ open, onClose, onCreated, configured, prefill }: {
  open: boolean; onClose: () => void; onCreated: (row: TrackingLinkRow) => void;
  configured: boolean;
  prefill?: { draftId?: string; influencerHandle?: string; clientId?: string; clientName?: string };
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [influencers, setInfluencers] = useState<InfluencerOption[]>([]);
  const [clientId, setClientId] = useState(prefill?.clientId ?? '');
  const [landingUrl, setLandingUrl] = useState('');
  const [landingTouched, setLandingTouched] = useState(false);
  const [handle, setHandle] = useState(prefill?.influencerHandle ?? '');
  const [campaign, setCampaign] = useState(suggestCampaign(prefill?.clientName ?? null));
  const [campaignTouched, setCampaignTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<TrackingLinkRow | null>(null); // 성공 화면
  const [copied, setCopied] = useState(false);
  // ... open 시: 병렬 로드 + prefill.clientId의 landingUrl 반영(landingTouched=false일 때만)
  // ... Esc/오버레이 닫기: AddByLinkModal 관례
  const landing = checkLandingUrl(landingUrl);
  const canSubmit = configured && landing.ok && handle.trim() !== '' && campaign.trim() !== '' && !busy;
  const preview = landing.ok
    ? buildTrackedUrl({ landingUrl: landing.url, campaign: campaign.trim(), handle: handle.trim().replace(/^@/, ''), code: 'xxxxxx' })
    : null;

  const submit = useCallback(async () => {
    if (!canSubmit || !landing.ok) return;
    setBusy(true); setErr('');
    try {
      const r = await apiFetch('/api/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landingUrl: landing.url, influencerHandle: handle, utmCampaign: campaign.trim(),
          draftId: prefill?.draftId, clientId: clientId || undefined,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { row?: TrackingLinkRow; error?: string };
      if (!r.ok || !data.row) { setErr(data.error ?? '링크를 만들지 못했어요 — 잠시 후 다시 시도해 주세요'); return; }
      setDone(data.row);
      onCreated(data.row);
    } catch {
      setErr('링크를 만들지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally { setBusy(false); }
  }, [canSubmit, landing, handle, campaign, clientId, prefill?.draftId, onCreated]);
  // ... 렌더: 입력 폼(아래 순서) 또는 done 성공 화면
}
```

폼 순서(스펙 §생성 모달 — 사람이 정할 것부터): 클라이언트 select("없음" 포함, prefill 시 그 값) → 랜딩 URL(input type=url, 오류 시 `landingUrlMessage` 인라인) → `InfluencerField`(options=influencers, error=null) → 캠페인 input(도움말: "랜딩 쪽 분석 도구에서 이 캠페인 이름으로 모아 볼 수 있어요") → 미리보기(`<code>` break-all) → 하단 [취소] [짧은 링크 만들기]. `configured === false`면 폼 대신: "short.io 연결이 아직 설정되지 않았어요 — 관리자에게 요청해 주세요".

인플루언서 옵션 매핑: `/api/influencers` 응답(`InfluencerRow[]`)에서 `{ handle: r.handle, name: r.displayName ?? undefined }`.

- [ ] **Step 2: 린트 확인**

Run: `npm run lint`
Expected: 경고 24개 이하.

- [ ] **Step 3: Commit**

```bash
git add src/components/LinkCreateModal.tsx
git commit -m "feat(tracking-link): 생성 모달 — 자동 채움·검증 인라인·최종 URL 미리보기·성공 복사"
```

---

### Task 9: 링크 목록 화면 — `LinkTable` + `LinksView` + /tracking 세그먼트

**Files:**
- Create: `src/components/LinkTable.tsx`
- Create: `src/app/tracking/LinksView.tsx`
- Modify: `src/app/tracking/page.tsx` (세그먼트 + 탭 분기)

**Interfaces:**
- Consumes: Task 4 타입, Task 6 라우트, Task 8 모달, `relTimeFine`(`@/lib/relTime`), `Button`, `useToast`, `apiFetch`
- Produces: `/tracking?view=links` 화면

**LinkTable** (표시 전용 — 정렬 없음, 최신 생성순 고정. 열 = 스펙 §화면의 읽기 동선):

```tsx
'use client';
import { useState } from 'react';
import type { TrackingLinkRow, LinkClickSnapshotRow } from '@/lib/linkStore';
import { relTimeFine } from '@/lib/relTime';

export type LinkHistoryState = 'loading' | 'ready' | 'error';

export function LinkTable({ rows, refreshingIds, expandedId, onToggleExpand, history, historyState, onRefresh, onRemove }: {
  rows: TrackingLinkRow[];
  refreshingIds: ReadonlySet<string>;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  history: LinkClickSnapshotRow[];      // 펼친 행의 클릭 이력(뷰가 소유·조회 — TrackingTable 관례)
  historyState: LinkHistoryState;
  onRefresh: (row: TrackingLinkRow) => void;
  onRemove: (row: TrackingLinkRow) => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 열: 인플루언서 / 원고 / 캠페인 / 단축 링크(+복사 — 이 표의 제1 행동) / 클릭 / 측정 / 동작
  // 클릭 칸: clicks 없으면 '측정 전', unavailableAt 있으면 '링크 없음' 배지(+마지막 값 유지)
  // 행 펼침(▼) = 클릭 측정 이력 — TrackingTable의 펼침 문법(부모 열 정렬)을 따른다
  // 복사: navigator.clipboard.writeText(row.shortUrl) 성공 시 copiedId 2초 표시
  // ...
}
```

셀 구현 요점:
- 단축 링크: `<a href={row.shortUrl} target="_blank" rel="noreferrer">` 표기는 도메인 경로만(`row.shortUrl.replace(/^https?:\/\//, '')`) + [복사] 버튼.
- 클릭: `row.clicks === null ? '측정 전' : (row.clicks.totalClicks ?? '—')`, `unavailableAt` 있으면 `링크 없음 · {relTimeFine(unavailableAt, '확인')}` 배지(amber). 봇 제외값이 있으면 title 툴팁 "봇 제외 {humanClicks}".
- 측정: `capturedAt ? relTimeFine(capturedAt, '측정') : '—'`.
- 원고: `draftLabel ?? '—'`.
- 이력 펼침 행: `총 {totalClicks ?? '—'} · 봇 제외 {humanClicks ?? '—'} · {kstShort(capturedAt)}` 줄 나열(최신 위).

**LinksView** (`src/app/tracking/LinksView.tsx` — 상태 소유. tracking page의 검증된 조각을 단순화해 재사용):

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { useToast } from '@/lib/toastContext';
import { LinkTable, type LinkHistoryState } from '@/components/LinkTable';
import { LinkCreateModal } from '@/components/LinkCreateModal';
import type { TrackingLinkRow, LinkClickSnapshotRow } from '@/lib/linkStore';

const FETCH_FAILED = '클릭 수를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

export function LinksView() {
  const { show, hide } = useToast();
  const [rows, setRows] = useState<TrackingLinkRow[]>([]);
  const [configured, setConfigured] = useState(true); // 낙관 시작 — 응답이 정정한다
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<LinkClickSnapshotRow[]>([]);
  const [historyState, setHistoryState] = useState<LinkHistoryState>('loading');
  const [pendingRemove, setPendingRemove] = useState<ReadonlySet<string>>(new Set());
  const expandedRef = useRef<string | null>(null);
  const pendingRef = useRef<ReadonlySet<string>>(new Set());
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // load / refreshOne / toggleExpand / requestRemove(1건 단위 5초 실행취소) / cleanup —
  // tracking page.tsx의 같은 이름 콜백을 단순화(선택·일괄·플래시 없음)해 그대로 옮긴다.
  // requestRemove 토스트 문구: '링크를 목록에서 뺐어요 — 짧은 링크 자체는 계속 열려요'
  //   + actionLabel '실행취소', duration null, dismissible false (5초 뒤 DELETE 커밋)
  // ...
}
```

- 빈 목록 문구: "인플루언서에게 전달할 랜딩페이지 링크를 만들고 클릭을 추적하는 곳이에요. '링크 만들기'로 시작하세요."
- 상단 우측: `[+ 링크 만들기]` — `configured === false`면 클릭 시 모달이 안내 문구를 보여준다(버튼은 항상 진입 가능, 모달이 이유를 말한다).
- 생성 성공(`onCreated`): `setRows((cur) => [row, ...cur])` — 모달 성공 화면이 닫힌 뒤 목록 맨 위에 있다.

**tracking/page.tsx 수정** (최소 diff):

1. import 추가: `import { usePathname, useRouter, useSearchParams } from 'next/navigation';`, `import { LinksView } from './LinksView';`
2. 컴포넌트 앞부분에 (library/page.tsx 33~37행 관례):

```tsx
const router = useRouter();
const pathname = usePathname();
const searchParams = useSearchParams();
const tab = searchParams.get('view') === 'links' ? 'links' : 'posts';
function setTab(next: 'posts' | 'links') {
  const p = new URLSearchParams(searchParams);
  if (next === 'links') p.set('view', 'links'); else p.delete('view');
  router.replace(`${pathname}${p.size ? `?${p}` : ''}`, { scroll: false });
}
```

3. `<h1>트래킹</h1>` 줄의 `{visible.length}건` 표기는 `tab === 'posts'` 조건 추가. 설명 문단을 탭별로:

```tsx
<p className="mb-3 text-caption text-x-muted">
  {tab === 'posts'
    ? '게시된 게시물의 반응을 모아 보는 곳이에요. 지표는 새로고침을 누른 순간에만 다시 가져와요(자동 수집 없음).'
    : '인플루언서에게 전달할 랜딩페이지 링크를 만드는 곳이에요 — 어느 인플·어느 콘텐츠에서 온 방문인지 꼬리표가 붙고, 클릭 수를 여기서 추적해요.'}
</p>
```

4. 설명 아래 세그먼트(library 세그먼트 마크업 그대로 — 배타 모드 전환기 시각 문법):

```tsx
<div role="group" aria-label="추적 대상" className="mb-4 flex h-7 w-fit overflow-hidden rounded-lg border border-x-border-strong">
  {([['posts', '게시물'], ['links', '링크']] as const).map(([v, label], i) => (
    <button key={v} onClick={() => setTab(v)} aria-pressed={tab === v}
            title={v === 'posts' ? '게시된 게시물의 반응(조회·좋아요 등)을 추적해요' : '랜딩페이지 링크를 만들고 클릭을 추적해요'}
            className={`h-full px-3 text-[13px] ${i > 0 ? 'border-l border-x-border-strong' : ''} ${tab === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
      {label}
    </button>
  ))}
</div>
```

5. 기존 본문(등록 폼부터 BulkActionBar까지)을 `{tab === 'posts' && (<>...</>)}` 로 감싸고, `{tab === 'links' && <LinksView />}` 추가.
6. `useSearchParams`는 Suspense 경계가 필요할 수 있다 — `npm run build`가 경고하면 library의 처리 방식(해당 파일 확인)을 그대로 복제한다.

- [ ] **Step 1: LinkTable.tsx 작성** (위 규격 — TrackingTable.tsx의 표 마크업·펼침 행 구현을 참조해 마감)
- [ ] **Step 2: LinksView.tsx 작성** (위 규격 — tracking/page.tsx의 load/refreshOne/toggleExpand/requestRemove 단순화 이식)
- [ ] **Step 3: tracking/page.tsx 세그먼트 통합** (위 1~6)
- [ ] **Step 4: 린트·빌드**

Run: `npm run lint && npm run build`
Expected: 경고 24개 이하, 빌드 성공.

- [ ] **Step 5: Commit**

```bash
git add src/components/LinkTable.tsx src/app/tracking/LinksView.tsx src/app/tracking/page.tsx
git commit -m "feat(tracking-link): 링크 목록 화면 — /tracking [게시물|링크] 세그먼트·표·이력 펼침·실행취소 삭제"
```

---

### Task 10: DraftCard "트래킹 링크" 섹션

**Files:**
- Create: `src/components/TrackingLinkSection.tsx`
- Modify: `src/components/DraftCard.tsx` (회색 도구층에 섹션 1줄 추가)

**Interfaces:**
- Consumes: Task 6 GET/POST(모달 경유), Task 8 `LinkCreateModal`, `relTimeFine`
- Produces: DraftCard 내 접이식 섹션 — **DraftCard props 무변경**(카드=표팝업=칸반팝업 3표면에 자동 반영, 호스트 페이지 수정 0)

설계 결정: 자급식(자체 fetch) 컴포넌트로 만든다. DraftCard는 이미 apiFetch를 직접 쓰는 선례(번역)가 있고, 호스트 3곳에 props를 배선하면 이 기능이 표면마다 갈라질 위험이 크다(단일 표면 원칙). 목록에 카드가 수십 장 떠도 네트워크 폭주가 없도록 **펼칠 때 처음 조회**한다(레퍼런스 펼침 refsOpen과 같은 문법).

- [ ] **Step 1: TrackingLinkSection.tsx 작성**

```tsx
'use client';
import { useCallback, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { relTimeFine } from '@/lib/relTime';
import { LinkCreateModal } from '@/components/LinkCreateModal';
import type { TrackingLinkRow } from '@/lib/linkStore';

// 원고 카드의 트래킹 링크 섹션 — 이 원고로 만든 랜딩 링크 목록 + 만들기.
// 자급식: 호스트 3표면(카드·표팝업·칸반팝업)에 props를 배선하지 않는다(단일 표면 원칙).
// 카드가 목록에 수십 장 떠도 조용하도록, 펼칠 때 처음 조회한다(refsOpen 문법).
export function TrackingLinkSection({ draftId, influencerHandle, clientId, clientName }: {
  draftId: string;
  influencerHandle: string | null;
  clientId: string | null;
  clientName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [rows, setRows] = useState<TrackingLinkRow[]>([]);
  const [configured, setConfigured] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await apiFetch(`/api/links?draftId=${draftId}`);
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as { configured: boolean; rows: TrackingLinkRow[] };
      setRows(data.rows);
      setConfigured(data.configured);
      setState('ready');
    } catch {
      setState('error'); // 실패를 '링크 없음'으로 위장하지 않는다
    }
  }, [draftId]);

  const toggle = useCallback(() => {
    const opening = !open;
    setOpen(opening);
    if (opening && state === 'idle') void load();
  }, [open, state, load]);

  const copy = useCallback(async (row: TrackingLinkRow) => {
    try {
      await navigator.clipboard.writeText(row.shortUrl);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* 클립보드 거부 — 링크가 화면에 있으니 수동 복사 가능 */ }
  }, []);

  return (
    <div className="py-0.5 text-[13px]">
      <button onClick={toggle} className="text-left">
        🔗 트래킹 링크{rows.length > 0 ? ` ${rows.length}건` : ''} <span className="text-x-blue-text">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <div className="mt-1">
          {state === 'loading' && <p className="text-x-muted">불러오는 중…</p>}
          {state === 'error' && (
            <p className="text-x-secondary">링크 목록을 불러오지 못했어요 <button onClick={() => void load()} className="text-x-blue-text hover:underline">다시 시도</button></p>
          )}
          {state === 'ready' && rows.length === 0 && (
            <p className="text-x-muted">아직 만든 링크가 없어요 — 게시 요청에 함께 보낼 랜딩페이지 링크를 만들 수 있어요.</p>
          )}
          {state === 'ready' && rows.map((r) => (
            <p key={r.id} className="flex items-baseline gap-2 py-0.5">
              <a href={r.shortUrl} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">
                {r.shortUrl.replace(/^https?:\/\//, '')}
              </a>
              <button onClick={() => void copy(r)} className="text-x-blue-text hover:underline">
                {copiedId === r.id ? '복사됨 ✓' : '복사'}
              </button>
              <span className="ml-auto shrink-0 text-x-muted">
                {r.clicks === null ? '측정 전' : `클릭 ${r.clicks.totalClicks ?? '—'}`}
                {r.capturedAt ? ` · ${relTimeFine(r.capturedAt, '측정')}` : ''}
              </span>
            </p>
          ))}
          {state === 'ready' && (
            <button onClick={() => setCreateOpen(true)} className="mt-0.5 text-x-blue-text hover:underline">+ 링크 만들기</button>
          )}
        </div>
      )}
      {createOpen && (
        <LinkCreateModal open={createOpen} onClose={() => setCreateOpen(false)} configured={configured}
                         onCreated={(row) => setRows((cur) => [row, ...cur])}
                         prefill={{ draftId, influencerHandle: influencerHandle ?? undefined,
                                    clientId: clientId ?? undefined, clientName: clientName ?? undefined }} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: DraftCard.tsx에 섹션 배치** — 회색 도구층(`{/* 회색 = 도구층 ... */}` div) 안, 근거 풋터 flex 줄 **위**에:

```tsx
<TrackingLinkSection draftId={draft.id} influencerHandle={draft.influencerHandle}
                     clientId={draft.clientId} clientName={draft.clientName} />
```

import 추가: `import { TrackingLinkSection } from '@/components/TrackingLinkSection';`

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 경고 24개 이하.

- [ ] **Step 4: Commit**

```bash
git add src/components/TrackingLinkSection.tsx src/components/DraftCard.tsx
git commit -m "feat(tracking-link): 원고 카드 트래킹 링크 섹션 — 자급식 접이식(3표면 자동 반영)"
```

---

### Task 11: 최종 검증 · 배포 준비

**Files:**
- Modify: 없음(검증 위주) — 발견된 결함만 수정

- [ ] **Step 1: 전체 테스트**

Run: `npm test` (약 4분, 실 DB)
Expected: 신규 3파일 포함 전부 PASS. 실패 시 systematic-debugging으로 원인 규명 후 수정.

- [ ] **Step 2: 린트 기준선·빌드**

Run: `npm run lint && npm run build`
Expected: 경고 24개 이하(표 컨테이너 예외 2건 포함 기준선), 빌드 성공.

- [ ] **Step 3: short.io 스모크 완료 확인** — Task 7 Step 3이 보류됐다면 지금 실행(.env에 키 필요). 실응답과 매핑이 어긋나면 shortio.ts·테스트를 고치고 재커밋.

- [ ] **Step 4: 로컬 화면 QA 준비**

Run: `npm run build && npx next start -p 3001` 후 `http://127.0.0.1:3001` (next dev 금지 — 하이드레이션 조용히 실패 이력, localhost는 프록시에 잡힘)

koo QA 체크리스트(사용자에게 전달):
1. /tracking → [게시물|링크] 전환, URL `?view=links` 보존
2. 링크 만들기: 클라 선택 → 랜딩 자동 채움 → 캠페인 제안 → 미리보기 → 생성 → 복사
3. http:// 주소·빈 캠페인에서 버튼 비활성+이유 표시
4. 행 새로고침 → 클릭 수·측정 시각 갱신, 행 펼침 → 이력
5. 삭제 → 실행취소 토스트, "짧은 링크는 계속 열려요" 문구
6. 원고 카드(카드·표 팝업·칸반 팝업 3표면)에서 트래킹 링크 섹션 펼침·생성(인플·클라 자동 채움)
7. 클라이언트 관리에서 기본 랜딩 URL 저장 → 생성 모달 자동 채움 확인
8. 단축 링크 실제 접속 → 랜딩 도착 + 주소창 UTM 4개 확인

- [ ] **Step 5: 배포 전 체크(별도 승인 후 진행)**

- Vercel 프로덕션 env에 `SHORTIO_API_KEY`, `SHORTIO_DOMAIN` 추가 (`vercel env add`)
- `.vercel/project.json`이 cb-x-deck 프로젝트를 가리키는지 확인(엉뚱한 프로젝트 연결 사고 이력)
- 마이그레이션 028은 Task 1에서 이미 프로덕션 DB 적용됨을 재확인

- [ ] **Step 6: Commit (수정이 있었다면)**

```bash
git add -A && git commit -m "fix(tracking-link): 최종 검증 반영"
```

---

## 계획 자체 점검 기록

- 스펙 커버리지: 데이터 모델(T1·T4) / UTM 규칙(T2) / short.io 연동·SDK 불채택(T3·T7) / 생성 원자성·라우트 5종(T6) / 클라 기본 랜딩(T5) / 세그먼트·표·이력 펼침·실행취소 삭제(T9) / 생성 모달·미리보기(T8) / DraftCard 섹션(T10) / 테스트·열린 검증 3건(T2~4·T7·T11) — 전 항목 대응 태스크 존재.
- 스펙과 다른 점 1건(보정): `tracking_link.unavailable_at` 추가 — 스펙 §오류 규격의 "링크 없음 표시 유지"에 필요한 컬럼이 스펙 스키마에 빠져 있었음. T1에서 스펙 문서도 함께 수정.
- 타입 일관성: `TrackingLinkRow`·`LinkClicks`·`LinkClickSnapshotRow`·`CreateLinkResult`·`LinkStatsResult`·`LandingUrlCheck` 이름을 전 태스크에서 동일 사용 확인.
