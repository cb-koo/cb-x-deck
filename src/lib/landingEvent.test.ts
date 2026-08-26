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
