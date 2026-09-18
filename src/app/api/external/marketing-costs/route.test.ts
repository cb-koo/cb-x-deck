import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from '@/lib/db';
import { createClient } from '@/lib/clientStore';
import { createCampaign } from '@/lib/campaignStore';
import { createTasks, updateTask } from '@/lib/campaignTaskStore';
import { createInfluencer, updatePaymentMethods } from '@/lib/influencerStore';
import { SETTLEMENT_DEFAULTS, type SettlementSettings } from '@/lib/settlementSettings';
import { getSettlementSettings, saveSettlementSettings, listCandidates, createRequests, cancelRequest } from '@/lib/settlementStore';
import type { PriceType } from '@/lib/influencerPricing';
import { kstToday } from '@/lib/datetime';
import { GET } from './route.ts';

// 라우트 테스트 하네스가 이 저장소에 없어 핸들러를 직접 import해 Request를 만들어 부른다(proof/route.test.ts와 같은 방식).
const sql = getSql();
const P = 'tstmc' + process.pid;
const H = (s: string) => `${P}_${s}`;
const CLINIC = `${P}jp`;           // clinic_code는 unique — 실제 슬러그(mimodreamjp 등)와 겹치지 않게 프로세스 고유값
const TODAY = kstToday();
// 조회는 지급요청일(created_at=오늘)이 아니라 귀속일(게시일) 기준이다(변경요청 2026-09-18). 픽스처의 귀속일:
//  · quoteRt → task_posted_on 2026-08-27,  · rt → campaign_starts_on 2026-08-31(캠페인 startsOn). 둘을 감싸는 창으로 조회한다.
const ATTR_FROM = '2026-08-27';   // quoteRt 귀속일
const ATTR_TO = '2026-08-31';     // rt 귀속일
const UA = `${P}-test`;            // 이 프로세스 호출만 external_api_log에서 지우기 위한 표식(스테이징은 그쪽 QA 로그가 섞여 있다 — path로 지우면 안 된다)

const TEST_KEY = P + '_key';
process.env.MARKETING_EXPORT_API_KEY = TEST_KEY;   // 이 프로세스 안에서만 유효 — 운영 시크릿은 건드리지 않는다

// 프로덕션 현재 설정에서는 기본 분류 3개가 숨김일 수 있어 createRequests가 전부 튕긴다 — 시작할 때 기본 설정을 깔고 after()가 되돌린다(settlementStore.test.ts와 같은 이유).
let savedBefore: SettlementSettings | null = null;
before(async () => {
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  savedBefore = await getSettlementSettings(sql);
  await saveSettlementSettings(sql, { ...SETTLEMENT_DEFAULTS, marker: P } as SettlementSettings & { marker: string }, null);
});
after(async () => {
  if (savedBefore) await saveSettlementSettings(sql, savedBefore, null);
  await sql`delete from settlement_setting_version where settings->>'marker' = ${P}`;
  await sql`delete from payment_request where influencer_handle like ${P + '%'}`;
  await sql`delete from external_api_log where user_agent = ${UA}`;
  await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${P + '%'})`;
  await sql`delete from campaign where name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${P + '%'})`;
  await sql`delete from influencer where handle like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

let memberId = '';
async function member() {
  if (!memberId) {
    const [m] = await sql<Array<{ id: string }>>`insert into member (name, color) values (${P + '멤버'}, '#000') returning id`;
    memberId = m.id;
  }
  return { id: memberId, name: P + '멤버' };
}
async function influencer(handle: string) {
  const { row } = await createInfluencer(sql, { handle: H(handle), createdBy: null });
  await updatePaymentMethods(sql, row.id, { kind: 'add', input: { type: 'paypal', holder: 'KEIKO', currency: 'JPY', email: `${H(handle)}@x.com`, fee: { mode: 'grossUp', percent: 5 } }, makeDefault: true }, null);
  return row;
}
const campBase = (clientId: string, clientName: string, suffix: string) => ({
  clientId, clientName, name: P + suffix, nameEn: `${P.toLowerCase()}-${suffix}`, startsOn: '2026-08-31', endsOn: '2026-09-06',
  kind: 'content' as const, note: '', createdBy: null,
});
// 유형별 요청 하나 만들기 — rt는 대상 트윗 + 증빙, 그 외는 게시 URL이 필요하다(createRequests 게이트).
async function makeRequest(campaignId: string, type: PriceType, handle: string) {
  await influencer(handle);   // 명부 등록 + 결제 수단이 있어야 후보에 금액·수단이 붙어 createRequests가 통과한다
  const tin = { targetTaskId: null, targetTweetUrl: type === 'rt' ? 'https://x.com/target/status/1' : null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
  const [t] = await createTasks(sql, campaignId, { ...tin, type, items: [{ handle: H(handle), cost: { amount: 30000, currency: 'KRW' } }] });
  if (type === 'rt') {
    await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', proof: { url: `task/${t.id}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png`, by: null, byName: '박구건', at: '2026-08-27T01:00:00.000Z' } });
  } else {
    await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: 'https://x.com/a/status/1' });
  }
  const m = await member();
  const cand = (await listCandidates(sql, SETTLEMENT_DEFAULTS, m.id, TODAY)).find((x) => x.taskId === t.id)!;
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const [created] = await createRequests(sql, [{ taskId: cand.taskId, category: fee.sendAs, deadlineOn: cand.deadlineDefault, referenceUrl: cand.referenceDefault, expected: { amountGross: cand.money!.amountGross, payoutCurrency: cand.money!.payoutCurrency, paymentMethodId: cand.method!.id } }], m, TODAY);
  return created;
}

// 기본은 유효한 키 + 표식 UA. 키를 바꾸려면 extra로 덮고, 키를 아예 빼려면 아래 401 테스트처럼 직접 만든다.
function req(qs: string, extra: Record<string, string> = {}): Request {
  return new Request(`https://x.example/api/external/marketing-costs${qs}`, { headers: { 'user-agent': UA, 'x-api-key': TEST_KEY, ...extra } });
}

// 픽스처를 한 번만 만들고 여러 테스트가 공유한다.
let quoteRtReq = '';
before(async () => {
  const m = await member();
  const clientA = await createClient(sql, P + '클라A');
  await sql`update client set clinic_code = ${CLINIC} where id = ${clientA.id}`;
  const campA = await createCampaign(sql, campBase(clientA.id, clientA.name, 'A'));
  const q = await makeRequest(campA.id, 'quoteRt', 'contentA');
  await makeRequest(campA.id, 'rt', 'viralA');
  quoteRtReq = q.id;
  // 취소 건 — 그쪽은 매번 새로 당겨가므로 집계에서 빠져야 한다
  const cancelled = await makeRequest(campA.id, 'quoteRt', 'cancelledA');
  await cancelRequest(sql, cancelled.id, '테스트 취소', m);
  // clinic_code가 없는 클라이언트 — 집계에서 빠져야 한다
  const clientB = await createClient(sql, P + '클라B');
  const campB = await createCampaign(sql, campBase(clientB.id, clientB.name, 'B'));
  await makeRequest(campB.id, 'quoteRt', 'noClinicB');
});

// 이 프로세스에서 만든 것만 남기고 판단하기 위한 필터 — 같은 스테이징에 다른 데이터가 있을 수 있다
type Row = { id: string; clinicId: string; category: string; amountKrw: number; currency: string; timestamp: string; originalAmount: number; splitCount: number };
const mine = (data: Row[]) => data.filter((d) => d.clinicId === CLINIC);

test('키 없음/틀림 → 401, 본문 없음, no-store', async () => {
  const bare = new Request(`https://x.example/api/external/marketing-costs?from=${TODAY}&to=${TODAY}`, { headers: { 'user-agent': UA } });
  const noKey = await GET(bare);
  assert.equal(noKey.status, 401);
  assert.equal(await noKey.text(), '');
  assert.equal(noKey.headers.get('cache-control'), 'no-store');
  const wrong = await GET(req(`?from=${TODAY}&to=${TODAY}`, { 'x-api-key': 'nope' }));
  assert.equal(wrong.status, 401);
});

test('from·to 누락/형식 오류 → 400', async () => {
  assert.equal((await GET(req(`?to=${TODAY}`))).status, 400);            // from 없음
  assert.equal((await GET(req(`?from=${TODAY}`))).status, 400);          // to 없음
  assert.equal((await GET(req(`?from=2026-13-40&to=${TODAY}`))).status, 400);   // 달력에 없는 날
  assert.equal((await GET(req(`?from=${TODAY}&to=2026/09/18`))).status, 400);   // 형식 오류
});

test('귀속일 범위 — 봉투 모양 + 유형별 카테고리 매핑 + amountKrw=gross_krw + timestamp=귀속일', async () => {
  const res = await GET(req(`?from=${ATTR_FROM}&to=${ATTR_TO}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(typeof body.total, 'number');
  assert.equal(body.page, 1);
  assert.equal(body.limit, 500);
  assert.ok(Array.isArray(body.data));
  const rows = mine(body.data as Row[]);
  assert.equal(rows.length, 2, '취소·clinic_code 없는 건은 빠지고 2건만');
  const byCat = new Map(rows.map((r) => [r.category, r]));
  assert.ok(byCat.has('x_content_quote_rt'), '인용RT → x_content_quote_rt');
  assert.ok(byCat.has('x_secondary_viral'), 'RT → x_secondary_viral');
  for (const r of rows) {
    assert.equal(r.clinicId, CLINIC);
    assert.equal(r.splitCount, 1);
    assert.ok(Number.isInteger(r.amountKrw) && r.amountKrw > 0);
    assert.match(r.timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);   // KST, 공백 구분
    assert.ok(r.id.startsWith('xdeck:'));
  }
  // timestamp는 귀속일 — quoteRt는 게시일(08-27), rt는 캠페인 시작일(08-31). 지급요청일(오늘)이 아니다.
  assert.equal(byCat.get('x_content_quote_rt')!.timestamp, '2026-08-27 00:00:00', 'quoteRt 귀속일=게시일');
  assert.equal(byCat.get('x_secondary_viral')!.timestamp, '2026-08-31 00:00:00', 'rt 귀속일=캠페인 시작일');
  // gross_krw 정수 = amountKrw
  const q = byCat.get('x_content_quote_rt')!;
  const [pr] = await sql<Array<{ gross_krw: string }>>`select gross_krw from payment_request where id = ${quoteRtReq}`;
  assert.equal(q.amountKrw, Math.round(Number(pr.gross_krw)));
  assert.equal(q.id, `xdeck:${quoteRtReq}`);
});

test('귀속일 필터·표시 일치 — 08-28~08-31이면 rt(08-31)만, quoteRt(08-27)는 빠진다', async () => {
  const res = await GET(req(`?from=2026-08-28&to=${ATTR_TO}`));
  assert.equal(res.status, 200);
  const rows = mine((await res.json()).data as Row[]);
  assert.equal(rows.length, 1, '창을 08-28로 좁히면 quoteRt(08-27)는 필터에서 빠진다 — 필터도 귀속일 기준');
  assert.equal(rows[0].category, 'x_secondary_viral');
  assert.equal(rows[0].timestamp, '2026-08-31 00:00:00');
});

test('데이터 없는 과거 범위 → 200 + data 빈 배열 + totalPages 1', async () => {
  const res = await GET(req('?from=2000-01-01&to=2000-01-02'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(mine(body.data as Row[]).length, 0);
  assert.ok(body.totalPages >= 1);
});

test('limit=1 — 페이지네이션: totalPages 올라가고 data는 1건', async () => {
  const res = await GET(req(`?from=${ATTR_FROM}&to=${ATTR_TO}&limit=1&page=1`));
  const body = await res.json();
  assert.equal(body.limit, 1);
  assert.ok(body.total >= 2);
  assert.ok(body.totalPages >= 2, '2건 이상을 1건씩 나누면 페이지가 2 이상');
  assert.equal((body.data as Row[]).length, 1);
});
