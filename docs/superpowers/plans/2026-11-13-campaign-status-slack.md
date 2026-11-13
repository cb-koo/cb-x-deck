# 캠페인 현황 슬랙 자동 공유 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 월 18:00, 수목금 10:30(한국 시각, 공휴일 제외)에 이번 주 캠페인 진행 상태를 요약 글과 PNG 이미지로 슬랙 채널에 보낸다.

**Architecture:** 순수 함수(`campaignStatusSlack.ts`)가 기존 `Overview`에서 메시지 블록과 문구를 만들고, 공용 JSX(`StatusImage.tsx`)를 Next 내장 `ImageResponse`로 PNG로 그린다. `slackUpload.ts`가 봇 토큰으로 업로드와 전송을 하고, 라우트 `POST /api/campaigns/overview/slack`이 이를 묶는다. 예약은 기존 방식대로 `scripts/*-cron.sql`(pg_cron + pg_net)이 라우트를 부른다.

**Tech Stack:** Next.js(이 저장소 버전), TypeScript, `next/og` ImageResponse, Slack Web API(fetch), node:test + tsx, pg_cron/pg_net.

**Spec:** `docs/superpowers/specs/2026-11-13-campaign-status-slack-design.md`
**시안:** `docs/mockups/campaign-status-slack-20261113.html`(모양 기준), `.png`(실제 결과)

## Global Constraints

- 코드 쓰기 전에 `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/image-response.md`와 라우트 핸들러 안내를 읽는다(AGENTS.md).
- 마이그레이션 없음. 새 라이브러리 없음. 글꼴 파일 하나(OFL 등 재배포 가능 라이선스)만 추가 가능.
- 문구는 스펙 §4 그대로. 가운뎃점(·) 구분자 금지. 사람(담당자) 이름 금지. 이모지는 스펙에 적힌 것만(📊 ✅ ⏰ 🗓️ ⚪ 👉).
- 이미지 배치 800px, 출력 1600px 폭(시안의 모든 크기 ×2). 진행률순(`sortCards(cards, 'progress')`), 세팅 전 맨 뒤.
- 채널 허용 목록: `C0AD9E5HE1K`(운영), `C0CGWSFBDPV`(테스트). 그 밖은 거부.
- 인증: `Authorization: Bearer ${MEASURE_CRON_SECRET}`, 미설정이면 거부(fail-closed, `src/app/api/settlement/auto-send/route.ts`와 같은 계약).
- 환경 변수: `SLACK_BOT_TOKEN`(등록 완료), `SLACK_STATUS_CHANNEL`(새로, 운영 `C0AD9E5HE1K`).
- 테스트는 DB 없는 단위 테스트만 새로 쓴다(`node --import tsx --test <파일>`). 슬랙 실제 호출은 Task 5의 수동 확인에서만, 테스트 채널로만.
- `npm run build` 금지(마이그레이션을 먼저 돌린다). 빌드 확인은 `npx next build`. 린트 기준선 `npm run lint` 1110건 이하, 새·고친 파일 0건.
- 커밋은 경로를 명시해서. push는 koo 지시가 있을 때만.

## Review Focus

1. **공휴일인 회차**: 그 회차는 보내지 않고 `{ skipped: 'holiday', name }`을 돌려준다. → Task 1, Task 4 테스트.
2. **이미지 업로드 실패**: 이미지 블록 없이 글 메시지는 나간다. → Task 4 테스트(업로드 함수 주입).
3. **그 주 캠페인 0개(월요일 저녁 세팅 전)**: 이미지 없이 안내 문구 메시지. → Task 2 테스트.
4. **허용 목록 밖 채널, 시크릿 없음/틀림**: 401/400으로 거부, 슬랙 호출 없음. → Task 4 테스트.
5. **`slack_file` 처리 지연(`invalid_blocks`)**: 짧게 다시 시도, 끝내 실패하면 이미지 없이 글만. → Task 3 테스트.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/koreanHolidays.ts` (+test) | 2026, 2027 공휴일 목록, `holidayOn` |
| `src/lib/campaignStatusSlack.ts` (+test) | 네 칸 보조 문구(화면과 공유), 메시지 블록, 기준 시각 문구 |
| `src/app/campaigns/overview/OverviewTiles.tsx` (수정) | 보조 문구를 위 함수로 |
| `src/lib/slackUpload.ts` (+test) | 봇 토큰 업로드와 전송, `fetch` 주입 가능 |
| `src/lib/statusImage/StatusImage.tsx` | ImageResponse용 JSX(시안 그대로, ×2) |
| `src/lib/statusImage/render.ts` | 글꼴 읽기 + `renderStatusPng(overview, sentAt): Promise<ArrayBuffer>` |
| `public/fonts/` 글꼴 파일 + `next.config.ts` 수정 | 출력 파일 추적 |
| `src/lib/campaignStatusSend.ts` (+test) | 라우트 본체(의존성 주입): 인증 뒤 판단과 전송 |
| `src/app/api/campaigns/overview/slack/route.ts` | POST |
| `src/app/api/campaigns/overview/slack-image/route.ts` | GET 미리보기(로그인 필요) |
| `scripts/campaign-status-slack-cron.sql` | 예약 등록 |
| `src/content/updates.ts` (머지 직전) | 소식 |

---

### Task 1: 공휴일 목록

**Files:** Create `src/lib/koreanHolidays.ts`, `src/lib/koreanHolidays.test.ts`

**Interfaces:**
- Produces: `export function holidayOn(date: string): { name: string } | null | 'unknown-year'` — `'YYYY-MM-DD'`(한국 날짜). 목록에 없는 해면 `'unknown-year'`.

- [ ] **Step 1: 실패하는 테스트**

```ts
test('공휴일과 대체공휴일, 평일, 목록 없는 해', () => {
  assert.deepEqual(holidayOn('2026-12-25'), { name: '성탄절' });
  assert.deepEqual(holidayOn('2026-03-02'), { name: '대체공휴일(삼일절)' });
  assert.equal(holidayOn('2026-11-13'), null);
  assert.equal(holidayOn('2028-01-03'), 'unknown-year');
});
```

- [ ] **Step 2: 실패 확인** — `node --import tsx --test src/lib/koreanHolidays.test.ts` FAIL.
- [ ] **Step 3: 구현** — 2026년과 2027년 공휴일(대체공휴일, 확정된 임시공휴일 포함)을 **한국천문연구원 월력요항** 공식 발표로 확인해 넣는다(웹에서 원본 확인, 블로그 목록 금지). 파일 머리 주석에 출처 URL과 "다음 해 목록은 해가 바뀌기 전에 추가, 임시공휴일은 지정되면 추가"를 적는다. 2027년 월력요항이 아직 없으면 2027은 넣지 않고 보고한다.
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** `feat(status-slack): 한국 공휴일 목록`

---

### Task 2: 문구와 메시지 블록

**Files:** Create `src/lib/campaignStatusSlack.ts`, `src/lib/campaignStatusSlack.test.ts`; Modify `src/app/campaigns/overview/OverviewTiles.tsx`

**Interfaces:**
- Consumes: `Overview`, `OverviewTiles`, `sortCards`, `CARD_STATUS_LABEL`(`campaignOverview.ts`), `weekLabel`(`campaignListView.ts`), `formatDateKo`(`campaignJudgment.ts`), `kstDateTime`(`datetime.ts`).
- Produces:

```ts
export function tileDescriptions(t: OverviewTiles): { planned: string; overdue: string; remaining: string | null };
// planned: '캠페인 10개, 1개는 세팅 전' | '캠페인 10개'; overdue: '백수약국 3건, 벤자민클리닉 2건, 외 2곳' | '없음'; remaining: '예정일 미정 2건 포함' | null
export function sentAtLabel(sentAt: Date): string;        // '11/12 (수) 10:30 기준' (한국 시각)
export type SlackBlock = Record<string, unknown>;
export function buildStatusMessage(o: Overview, sentAt: Date, opts: { pageUrl: string; imageFileId: string | null }):
  { text: string; blocks: SlackBlock[] };
export const STATUS_SCHEDULE_NOTE = '월 18:00, 수목금 10:30에 보내요.';
```

규칙(스펙 §4):
- 블록: section(`📊 *{weekLabel(week.weekStart)} 캠페인 현황*\n{sentAtLabel(sentAt)}`, 예: `📊 *11월 2주차 캠페인 현황*\n11/12 (수) 10:30 기준`) → section(요약 줄) → section(`👉 <{pageUrl}|캠페인 현황 열기>  캠페인별 게시물과 성과는 여기서 봐요`) → `imageFileId`가 있으면 image(`slack_file: { id }`, alt_text `'{주} 캠페인 현황: 계획 N건 중 M건 게시'`) → context(`진행률이 높은 캠페인부터 보여줘요. 방문협찬(장기) 캠페인은 빠져 있어요. ` + STATUS_SCHEDULE_NOTE).
- 요약 줄: `✅ 게시 완료  *41 / 63건* (65%)` / `⏰ 예정일 지난 미게시  *5건*  {overdue 문구}` 또는 `✅ 예정일 지난 미게시 없음` / `🗓️ 남은 게시 예정  *17건*` + (있으면 `  예정일 미정 2건 포함`) / 세팅 전이 있으면 `⚪ 세팅 전  *1개*  {이름들, 3곳까지 + 외 N곳}`. 계획 0건이면 퍼센트 생략.
- 카드 0개: 블록은 제목 section → section `이번 주에 시작한 주차 캠페인이 아직 없어요.` → 링크 section. 이미지 없음.
- `text`(알림 미리보기): `📊 {주} 캠페인 현황: {계획}건 중 {게시}건 게시, 예정일 지난 미게시 {N}건`(0건이면 `, 예정일 지난 미게시 없음`).

- [ ] **Step 1: 실패하는 테스트** — `campaignOverview.test.ts`의 `task`/`camp`/`input` 도우미를 복사해 `buildOverview`로 입력을 만든다.

```ts
test('기본 메시지: 제목, 요약 네 줄, 링크, 이미지, 안내 순서', () => {
  const m = buildStatusMessage(o, new Date('2026-11-12T01:30:00Z'), { pageUrl: URL, imageFileId: 'F1' });
  assert.deepEqual(m.blocks.map((b) => b.type), ['section', 'section', 'section', 'image', 'context']);
  assert.match(JSON.stringify(m.blocks[0]), /11월 2주차 캠페인 현황\*\\n11\/12 \(수\) 10:30 기준/);
});
test('늦은 건 0건이면 "없음" 줄, 예정일 미정 0건이면 꼬리 없음, 세팅 전 없으면 줄 없음', () => { /* ... */ });
test('늦은 클라이언트 4곳 → 3곳 + 외 1곳, 세팅 전 4곳 → 3곳 + 외 1곳', () => { /* ... */ });
test('카드 0개 → 이미지 없는 세 블록, imageFileId null → image 블록 없음', () => { /* ... */ });
test('tileDescriptions는 화면 문구와 같다', () => { /* '캠페인 10개, 1개는 세팅 전', '없음', null */ });
test('문구에 가운뎃점이 없다', () => { assert.ok(!JSON.stringify(m).includes('·')); });
```

주석으로 적힌 테스트는 이름의 조건과 위 규칙의 기대 문구로 완성한다.

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `OverviewTiles.tsx`는 `tileDescriptions`를 쓰도록 바꾼다(화면 문구가 그대로인지 diff로 확인).
- [ ] **Step 4: 통과 확인** + `node --import tsx --test src/lib/campaignOverview.test.ts` 그대로 통과 + `npx tsc --noEmit` 0.
- [ ] **Step 5: 커밋** `feat(status-slack): 메시지 블록과 공용 칸 문구`

---

### Task 3: 슬랙 업로드와 전송

**Files:** Create `src/lib/slackUpload.ts`, `src/lib/slackUpload.test.ts`

**Interfaces:**
- Consumes: `SlackBlock`(Task 2, `campaignStatusSlack.ts`).
- Produces:

```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export async function uploadPrivateImage(token: string, png: ArrayBuffer, filename: string, title: string, f?: FetchLike): Promise<string>; // file id
export async function postBlocks(token: string, channel: string, msg: { text: string; blocks: SlackBlock[] }, f?: FetchLike,
  opts?: { retries?: number; delayMs?: number }): Promise<{ ts: string }>;
export class SlackApiError extends Error { constructor(public method: string, public code: string) }
```

- 업로드: `files.getUploadURLExternal`(GET, `filename`, `length`) → `upload_url`에 POST(바이트) → `files.completeUploadExternal`(JSON, `files: [{ id, title }]`, 채널 없음). 각 단계 `ok: false`면 `SlackApiError`.
- 전송: `chat.postMessage`(JSON, `channel`, `text`, `blocks`, `unfurl_links: false`). 응답 `invalid_blocks`면 `delayMs`(기본 1500) 간격으로 `retries`(기본 3)번 다시. 그 밖 오류는 즉시 `SlackApiError`.
- 토큰은 로그와 오류 메시지에 절대 넣지 않는다.

- [ ] **Step 1: 실패하는 테스트** — 가짜 `fetch`로 호출 순서와 본문을 검사.

```ts
test('업로드 세 단계 순서와 채널 없는 완료 호출', async () => { /* 호출 URL 3개 순서, complete 본문에 channel_id 없음, 반환 file id */ });
test('invalid_blocks는 다시 시도하고, 성공하면 ts를 준다', async () => { /* 2번 invalid_blocks 뒤 ok → ts, 호출 3번 */ });
test('다른 오류는 바로 SlackApiError, 메시지에 토큰 없음', async () => { /* not_in_channel → throws, err.message에 'xoxb' 없음 */ });
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과.**
- [ ] **Step 5: 커밋** `feat(status-slack): 봇 토큰 업로드와 전송`

---

### Task 4: 이미지 그리기와 보내기 라우트

**Files:** Create `src/lib/statusImage/StatusImage.tsx`, `src/lib/statusImage/render.ts`, 글꼴 파일(`public/fonts/…`), `src/lib/campaignStatusSend.ts`, `src/lib/campaignStatusSend.test.ts`, `src/app/api/campaigns/overview/slack/route.ts`, `src/app/api/campaigns/overview/slack-image/route.ts`; Modify `next.config.ts`(`outputFileTracingIncludes`에 두 라우트와 글꼴 파일)

**Interfaces:**
- Consumes: Task 1 `holidayOn`, Task 2 `buildStatusMessage`/`tileDescriptions`/`sentAtLabel`, Task 3 `uploadPrivateImage`/`postBlocks`, `getCampaignOverview(sql, null, today)`, `sortCards`.
- Produces:

```ts
// src/lib/statusImage/render.ts
export async function renderStatusPng(o: Overview, sentAt: Date): Promise<ArrayBuffer>;
// src/lib/campaignStatusSend.ts — 의존성을 받아 테스트 가능하게
export const ALLOWED_CHANNELS = ['C0AD9E5HE1K', 'C0CGWSFBDPV'] as const;
export type SendDeps = {
  now: () => Date; loadOverview: () => Promise<Overview>; renderPng: (o: Overview, at: Date) => Promise<ArrayBuffer>;
  upload: (png: ArrayBuffer) => Promise<string>; post: (channel: string, msg: { text: string; blocks: SlackBlock[] }) => Promise<{ ts: string }>;
  log: (msg: string) => void;
};
export type SendResult =
  | { skipped: 'holiday'; name: string }
  | { sent: true; channel: string; ts: string; withImage: boolean; holidayListMissing?: true };
export async function sendCampaignStatus(channel: string, deps: SendDeps): Promise<SendResult>;
```

- `sendCampaignStatus`: 한국 날짜로 `holidayOn` → 공휴일이면 skip. `'unknown-year'`면 보내고 `holidayListMissing: true`와 로그. 카드가 있으면 그리기+업로드를 시도하고, 실패하면 로그 후 `imageFileId: null`로 글만. `post` 실패는 그대로 던진다(재전송 없음).
- 라우트 POST: 시크릿 확인(없거나 다르면 401) → 본문 `{ channel? }`, 없으면 `SLACK_STATUS_CHANNEL` → `ALLOWED_CHANNELS`에 없으면 400 → `SLACK_BOT_TOKEN` 없으면 500 → `sendCampaignStatus` 결과 JSON. `maxDuration = 60`. 예외는 500과 `{ error }`(토큰 제외).
- 라우트 GET 미리보기: `requireAllowedUser()` 뒤 `?week=`로 `getCampaignOverview` → `renderStatusPng` → `image/png`.
- `StatusImage.tsx`: 시안 HTML의 구조와 값을 flex로 옮긴다(satori는 grid 미지원). 모든 px ×2. 캠페인 줄은 `sortCards(o.cards, 'progress')`. 네 칸 보조 글은 `tileDescriptions`. 기준 시각은 `sentAtLabel(sentAt)`. 글꼴 굵기 400과 700(또는 800) 두 개.

- [ ] **Step 1: 실패하는 테스트** (`campaignStatusSend.test.ts`, 가짜 deps)

```ts
test('공휴일이면 보내지 않는다', async () => { /* now = 2026-12-25T01:30Z → { skipped:'holiday', name:'성탄절' }, post 호출 0 */ });
test('이미지 실패해도 글은 보낸다', async () => { /* renderPng throws → post 1번, blocks에 image 없음, withImage false */ });
test('업로드 성공이면 image 블록에 그 파일 id', async () => { /* upload → 'F9', post된 blocks에 slack_file.id 'F9' */ });
test('목록 없는 해는 보내고 표시를 남긴다', async () => { /* now 2028-01-05 → sent, holidayListMissing true, log 1번 */ });
test('카드 0개면 그리지 않는다', async () => { /* renderPng 호출 0, withImage false */ });
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `sendCampaignStatus`, 그다음 이미지와 라우트. 라우트의 인증과 채널 검사는 작은 함수(`authorize(req): Response | null`, `pickChannel(body, env): string | Response`)로 빼서 같은 테스트 파일에서 검사한다(시크릿 없음 401, 틀림 401, 허용 밖 400).
- [ ] **Step 4: 확인** — 단위 테스트 통과, `npx tsc --noEmit` 0, `npm run lint` 기준선, `npx next build` 성공.
- [ ] **Step 5: 로컬 이미지 확인** — 연습용 DB로 PNG만 만들어 보는 일회용 스크립트(`node --import tsx --env-file=.env.staging`, 커밋하지 않음)로 `renderStatusPng` 결과를 파일로 저장하고, 시안 PNG와 나란히 비교한 결과(다른 점 목록)를 보고에 적는다. 슬랙으로는 보내지 않는다.
- [ ] **Step 6: 커밋** `feat(status-slack): 이미지 그리기와 보내기 라우트`

---

### Task 5: 예약 스크립트, 배포 전 확인, 소식

**Files:** Create `scripts/campaign-status-slack-cron.sql`; Modify `src/content/updates.ts`(머지 직전)

- [ ] **Step 1: 예약 스크립트** — `scripts/settlement-auto-send-cron.sql`과 같은 머리 주석 형식(무엇, 마이그레이션 아님, 운영에서만 실행, 실행법, 멈추는 법, 확인법). 항목 두 개:
  - `campaign-status-slack-mon`: `0 9 * * 1` (월 18:00 KST)
  - `campaign-status-slack-wtf`: `30 1 * * 3,4,5` (수목금 10:30 KST)
  - 둘 다 `net.http_post(url := :app_url || '/api/campaigns/overview/slack', headers := Authorization Bearer measure_cron_secret, body := '{}')`. 다시 돌려도 안전하게(이미 있으면 `cron.unschedule` 후 등록).
- [ ] **Step 2: 커밋** `feat(status-slack): 예약 등록 스크립트`
- [ ] **Step 3: koo와 함께(컨트롤러가 진행)** — `SLACK_STATUS_CHANNEL` 운영 등록 → main push(koo 지시) → 운영 라우트를 본문 `{ "channel": "C0CGWSFBDPV" }`로 한 번 불러 실제 숫자로 테스트 채널 확인 → koo 확인 → `psql`로 예약 등록(운영만) → `cron.job`에 두 항목 확인.
- [ ] **Step 4: 소식** — `src/content/updates.ts` 맨 위 `새 기능`: 제목 `캠페인 진행 상황이 슬랙으로 와요`, 요약은 언제(월 18:00, 수목금 10:30, 공휴일 제외) 어디로(#f-x-채널-통합관리) 무엇을(진행 상태 요약과 이미지, 진행률순, 방문협찬 제외), `link` 없음 또는 `/campaigns/overview`. `node --import tsx --test src/lib/updates.test.ts` 통과 후 커밋.
