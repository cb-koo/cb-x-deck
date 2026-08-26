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
