// 확장 API(API 1)의 순수 판정 — Bearer 형식·claims 정책, 작업 분류·정렬·cursor, 상대 확인, 입력 검증. DB·네트워크 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerToken, checkClaims, isExpiredJwt } from './extensionClaims.ts';
import {
  classifyTask, compareClassified, decodeCursor, encodeCursor, pageOf, seoulIso, toTaskDto, type TaskFacts,
} from './extensionTasks.ts';
import { findPeopleByXUserIds, judgeIdentity, loadTaskFacts } from './extensionReadStore.ts';
import { parseBadgePerson, parseObservedPerson } from './extensionInput.ts';
import type postgres from 'postgres';
import { allowedExtensionOrigins, isSchemaNotReady } from './extensionApi.ts';
import type { InfluencerRow } from './influencerStore.ts';

const SUPABASE = 'https://abc.supabase.co';
const claims = (over: Record<string, unknown> = {}) => ({
  iss: `${SUPABASE}/auth/v1`, aud: 'authenticated', sub: '11111111-1111-1111-1111-111111111111',
  email: 'staff@clinicbridge.co.kr', app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { name: '담당' },
  ...over,
});
const jwt = (payload: Record<string, unknown>) =>
  `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.c2ln`;

test('Bearer: 정확한 스킴과 JWT 모양만 받는다', () => {
  assert.equal(bearerToken('Bearer a.b.c'), 'a.b.c');
  assert.equal(bearerToken(null), null);
  assert.equal(bearerToken('bearer a.b.c'), null);
  assert.equal(bearerToken('Bearer a.b'), null);
  assert.equal(bearerToken('Bearer a.b.c extra'), null);
  assert.equal(bearerToken('Basic dXNlcg=='), null);
});

test('만료 판정: exp가 지금 이하이면 만료, 형식 오류는 서명 검증에 맡긴다', () => {
  assert.equal(isExpiredJwt(jwt({ exp: 100 }), 100), true);
  assert.equal(isExpiredJwt(jwt({ exp: 101 }), 100), false);
  assert.equal(isExpiredJwt('x.%%%.y', 100), false);
});

test('claims: 회사 Google 계정은 통과하고 identity를 돌려준다', () => {
  const r = checkClaims(claims(), `${SUPABASE}/`);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual([r.user.id, r.user.email], ['11111111-1111-1111-1111-111111111111', 'staff@clinicbridge.co.kr']);
  assert.equal(checkClaims(claims({ aud: ['authenticated', 'x'] }), SUPABASE).ok, true);
});

test('claims: 다른 issuer·audience·subject 없음은 AUTH_REQUIRED', () => {
  for (const over of [{ iss: 'https://other.supabase.co/auth/v1' }, { aud: 'anon' }, { sub: '' }, { sub: undefined }]) {
    assert.deepEqual(checkClaims(claims(over), SUPABASE), { ok: false, code: 'AUTH_REQUIRED' });
  }
});

test('claims: 외부 도메인·비구글 provider는 ACCOUNT_NOT_ALLOWED', () => {
  assert.deepEqual(checkClaims(claims({ email: 'x@gmail.com' }), SUPABASE), { ok: false, code: 'ACCOUNT_NOT_ALLOWED' });
  assert.deepEqual(checkClaims(claims({ app_metadata: { provider: 'email', providers: ['email'] } }), SUPABASE),
    { ok: false, code: 'ACCOUNT_NOT_ALLOWED' });
});

const TODAY = '2026-10-04';
const task = (over: Partial<TaskFacts> = {}): TaskFacts => ({
  id: '00000000-0000-0000-0000-000000000001', campaignId: 'c1', campaignName: '10월 방문', type: 'visit',
  influencerHandle: 'hana', draftStatus: null, postedAt: null, postUrl: null, removedAt: null, cancelledAt: null,
  scheduledOn: null, visitOn: null, cost: { amount: 0, currency: 'KRW' }, noCost: false, hasConsent: false, version: 3,
  visitCompletedAt: null, settlement: null, endKind: null, reservation: null, requestCount: 0,
  ...over,
});
const reservation = (visitAt: string, confirmed = true) => ({ confirmed, visitAt, deadlineMode: 'default' as const });

test('분류: 예약 없는 방문 작업은 진행중·unregistered', () => {
  const c = classifyTask(task(), TODAY);
  assert.deepEqual([c.bucket, c.visitPhase], ['active', 'unregistered']);
});

test('분류: 확정 방문은 방문일까지 D-day, 다음 날부터 visited·기한 D-day', () => {
  const r = task({ reservation: reservation('2026-10-08T16:00'), scheduledOn: '2026-10-22' });
  const before = classifyTask(r, TODAY);
  assert.deepEqual([before.visitPhase, before.dDay, before.nextDate], ['confirmed', 4, '2026-10-08']);
  const after = classifyTask(r, '2026-10-09');
  assert.deepEqual([after.visitPhase, after.dDay, after.nextDate], ['visited', 13, '2026-10-22']);
});

test('분류: 종료 종류·작업 취소는 ended, 지급 완료·무상 게시는 completed', () => {
  assert.equal(classifyTask(task({ endKind: 'visit_no_show' }), TODAY).bucket, 'ended');
  assert.equal(classifyTask(task({ endKind: 'change_limit' }), TODAY).visitPhase, 'cancelled');
  assert.equal(classifyTask(task({ cancelledAt: '2026-10-01' }), TODAY).bucket, 'ended');
  assert.equal(classifyTask(task({ postedAt: '2026-10-01', noCost: true }), TODAY).bucket, 'completed');
  assert.equal(classifyTask(task({ postedAt: '2026-10-01', settlement: { status: 'requested', externalStatus: 'paid' } }), TODAY).bucket, 'completed');
  // 금액 0은 무상이 아니다 — 게시 확인만으로 완료되지 않는다
  assert.equal(classifyTask(task({ postedAt: '2026-10-01' }), TODAY).bucket, 'active');
});

test('분류: 콘텐츠 작업은 flowStage 기준, 게시 후에는 D-day 없음', () => {
  const post = task({ type: 'post', scheduledOn: '2026-10-10' });
  assert.deepEqual([classifyTask(post, TODAY).bucket, classifyTask(post, TODAY).visitPhase, classifyTask(post, TODAY).dDay], ['active', null, 6]);
  assert.equal(classifyTask({ ...post, postedAt: '2026-10-03' }, TODAY).dDay, null);
  assert.equal(classifyTask({ ...post, cancelledAt: '2026-10-03' }, TODAY).bucket, 'ended');
  assert.equal(classifyTask({ ...post, postedAt: '2026-10-03', noCost: true }, TODAY).bucket, 'completed');
});

test('정렬: 가까운 일정 순, 날짜 없음은 뒤, 같은 날은 id 순', () => {
  const rows = [
    { id: 'b', c: classifyTask(task({ type: 'post', scheduledOn: '2026-10-09' }), TODAY) },
    { id: 'z', c: classifyTask(task({ type: 'post' }), TODAY) },
    { id: 'a', c: classifyTask(task({ type: 'post', scheduledOn: '2026-10-09' }), TODAY) },
    { id: 'c', c: classifyTask(task({ type: 'post', scheduledOn: '2026-10-05' }), TODAY) },
  ].sort(compareClassified);
  assert.deepEqual(rows.map((r) => r.id), ['c', 'a', 'b', 'z']);
});

test('DTO: wire 종류·0과 null·noCost 구분·offset 시각·허용 행동', () => {
  const t = task({ type: 'visit', reservation: reservation('2026-10-04T16:00'), scheduledOn: '2026-10-18' });
  const dto = toTaskDto(t, classifyTask(t, TODAY), 'p1', TODAY, 'https://deck.example');
  assert.equal(dto.visitAt, '2026-10-04T16:00:00+09:00');
  assert.deepEqual([dto.amount, dto.noCost, dto.uploadDeadline], [0, false, '2026-10-18']);
  assert.ok(dto.allowedActions.includes('complete_visit'));   // 방문 당일
  assert.equal(dto.webUrl, `https://deck.example/campaigns/flow?id=c1&task=${t.id}`);
  const quote = toTaskDto(task({ type: 'quoteRt', cost: null }), classifyTask(task({ type: 'quoteRt' }), TODAY), 'p1', TODAY, 'https://deck.example');
  assert.deepEqual([quote.kind, quote.amount, quote.currency, quote.allowedActions], ['quote_rt', null, null, []]);
  assert.equal(seoulIso(''), null);
});

test('cursor·페이지: total은 전체, 마지막 페이지는 nextCursor 없음, 위조 cursor 거부', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  const p1 = pageOf(items, 0, 20);
  assert.deepEqual([p1.items.length, p1.total], [20, 45]);
  const p3 = pageOf(items, decodeCursor(pageOf(items, decodeCursor(p1.nextCursor)!, 20).nextCursor)!, 20);
  assert.deepEqual([p3.items, p3.nextCursor], [[40, 41, 42, 43, 44], null]);
  assert.equal(decodeCursor(null), 0);
  assert.equal(decodeCursor(encodeCursor(20)), 20);
  assert.equal(decodeCursor('bm9wZQ'), null);
});

test('DTO: 방문·업로드 D-day는 독립적으로 당일·미래·지난 날짜를 표시한다', () => {
  for (const [today, expected] of [['2026-10-04', [4, 14]], ['2026-10-08', [0, 10]], ['2026-10-19', [-11, -1]]] as const) {
    const t = task({ reservation: reservation('2026-10-08T16:00'), scheduledOn: '2026-10-18' });
    const dto = toTaskDto(t, classifyTask(t, today), 'p1', today, 'https://deck.example');
    assert.deepEqual([dto.visitDday, dto.uploadDday], expected);
  }
  const t = task();
  const dto = toTaskDto(t, classifyTask(t, TODAY), 'p1', TODAY, 'https://deck.example');
  assert.deepEqual([dto.visitDday, dto.uploadDday], [null, null]);
});

test('DTO: 일반 협찬은 방문 D-day 없이 게시 예정일·대상·해당 협찬 링크를 전달한다', () => {
  for (const type of ['post', 'rt', 'quoteRt'] as const) {
    const target = { label: '@hana · 10월 캠페인', url: 'https://x.com/hana/status/123' };
    const t = task({ type, scheduledOn: '2026-10-18', target });
    const dto = toTaskDto(t, classifyTask(t, TODAY), 'p1', TODAY, 'https://deck.example');
    assert.deepEqual([dto.visitDday, dto.uploadDday, dto.scheduledOn, dto.target], [null, null, '2026-10-18', target]);
    const url = new URL(dto.webUrl);
    assert.equal(url.searchParams.get('id'), t.campaignId);
    assert.equal(url.searchParams.get('task'), t.id);
  }
});

test('배지 입력: 핸들 없이 큰 숫자 ID를 보존하고 모호한 입력을 거부한다', () => {
  assert.deepEqual(parseBadgePerson({ observedXUserId: '9007199254740993' }), { observedXUserId: '9007199254740993' });
  assert.deepEqual(parseBadgePerson({ handle: '@hana', observedXUserId: '42' }), { handle: 'hana', observedXUserId: '42' });
  for (const bad of [{}, { observedXUserId: 42 }, { observedXUserId: '' }, { observedXUserId: '1'.repeat(26) }, { observedXUserId: '42', extra: true }]) {
    assert.throws(() => parseBadgePerson(bad));
  }
});

// SQL 응답만 대체한다. DB 연결이나 운영 데이터 변경 없이 조회 결과 변환을 검증한다.
function fakeSql(results: unknown[][]): postgres.Sql {
  return ((parts: unknown) => Array.isArray(parts) && 'raw' in parts ? Promise.resolve(results.shift() ?? []) : parts) as unknown as postgres.Sql;
}

test('숫자 ID 조회: 유일한 상대만 연결하고 중복 저장된 ID는 제외한다', async () => {
  const sql = fakeSql([[
    { id: 'p1', handle: 'hana', x_user_id: '9007199254740993' },
    { id: 'p2', handle: 'yui', x_user_id: '42' },
    { id: 'p3', handle: 'momo', x_user_id: '42' },
  ]]);
  const found = await findPeopleByXUserIds(sql, ['9007199254740993', '42']);
  assert.deepEqual([...found.values()], [{ id: 'p1', handle: 'hana', xUserId: '9007199254740993' }]);
  assert.equal((await findPeopleByXUserIds(fakeSql([]), [])).size, 0);
});

test('작업 조회: 내부 협찬 대상·외부 게시물 대상·미등록 대상을 구분한다', async () => {
  const rows = [
    { id: 't1', target_task_id: 'other', target_handle: 'hana', target_campaign_name: '10월', target_post_url: 'https://x.com/hana/status/123' },
    { id: 't2', target_tweet_url: 'https://x.com/yui/status/456' },
    { id: 't3' },
    { id: 't4', target_task_id: 'unposted', target_handle: 'momo', target_campaign_name: '11월', target_post_url: null },
  ];
  const facts = await loadTaskFacts(fakeSql([rows]), ['hana']);
  assert.deepEqual(facts.map((t) => t.target), [
    { label: '@hana · 10월', url: 'https://x.com/hana/status/123' },
    { label: 'https://x.com/yui/status/456', url: 'https://x.com/yui/status/456' },
    null,
    { label: '@momo · 11월', url: null },
  ]);
});

const influencer = (xUserId: string | null) => ({ id: 'p1', handle: 'Hana', xUserId, displayName: '하나' }) as InfluencerRow;

test('상대 확인: 미등록·일치·숫자 ID 불일치만 mismatch', () => {
  assert.deepEqual(judgeIdentity(null, 'hana'), { status: 'unregistered', handle: 'hana' });
  assert.equal(judgeIdentity(influencer('42'), 'hana', '42').status, 'matched');
  assert.equal(judgeIdentity(influencer(null), 'hana', '42').status, 'matched');   // 저장 ID 없음 → 자동 보강 없이 일치로
  assert.equal(judgeIdentity(influencer('42'), 'hana').status, 'matched');
  assert.equal(judgeIdentity(influencer('42'), 'hana', '43').status, 'identity_mismatch');
  const m = judgeIdentity(influencer('9007199254740993'), 'hana', '9007199254740993');
  assert.ok(m.status === 'matched' && m.person.xUserId === '9007199254740993' && m.person.noteVersion === null);
});

test('입력: @ 제거, 숫자 ID는 문자열, 모르는 키·형식 오류 거부', () => {
  assert.deepEqual(parseObservedPerson({ handle: '@hana_1' }), { handle: 'hana_1' });
  assert.deepEqual(parseObservedPerson({ handle: 'hana', observedXUserId: '9007199254740993' }), { handle: 'hana', observedXUserId: '9007199254740993' });
  for (const bad of [null, [], { handle: 'a-b' }, { handle: 'x'.repeat(16) }, { handle: 'a', observedXUserId: 42 }, { handle: 'a', actorId: 'm' }]) {
    assert.throws(() => parseObservedPerson(bad));
  }
});

test('공통: 개발 확장 origin 기본 허용, 064 미적용 오류 식별', () => {
  assert.deepEqual(allowedExtensionOrigins({ EXTENSION_ORIGINS: ' chrome-extension://prod ,' }),
    ['chrome-extension://naopbhcnpgofjmhaagpijcjcbijacacb', 'chrome-extension://prod']);
  assert.equal(isSchemaNotReady({ code: '42P01' }), true);
  assert.equal(isSchemaNotReady({ code: '23505' }), false);
});
