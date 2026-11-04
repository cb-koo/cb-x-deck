import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createClient } from './clientStore.ts';
import { createCampaign, createCampaignsBulk, BulkCampaignError } from './campaignStore.ts';
import { defaultPreset, presetRange, parseBulkCreate, hasSamePeriod, bulkSuggestion, BULK_EMPTY_MESSAGE } from './campaignBulk.ts';

// ISSUE-006 여러 클라이언트 캠페인 한 번에 만들기
const sql = getSql();
const P = 'tcbk' + process.pid;
after(async () => {
  await sql`delete from campaign where client_name like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql.end();
});

test('기본 기간 — 월요일이면 이번 주, 그 외엔 다음 주(월~일)', () => {
  assert.equal(defaultPreset('2026-11-02'), 'this');   // 월
  assert.equal(defaultPreset('2026-11-04'), 'next');   // 수
  assert.equal(defaultPreset('2026-11-08'), 'next');   // 일
  assert.deepEqual(presetRange('2026-11-04', 'this'), { startsOn: '2026-11-02', endsOn: '2026-11-08' });
  assert.deepEqual(presetRange('2026-11-04', 'next'), { startsOn: '2026-11-09', endsOn: '2026-11-15' });
  assert.deepEqual(presetRange('2026-11-08', 'this'), { startsOn: '2026-11-02', endsOn: '2026-11-08' });   // 일요일은 그 주의 끝
});

test('제안 — 한 곳 만들기와 같은 이름·영문 코드 규칙', () => {
  assert.deepEqual(bulkSuggestion({ name: '블리비의원', nameEn: 'velyb' }, '2026-11-09'), { name: '블리비의원_11월2주차', nameEn: 'velyb-20261109' });
  assert.deepEqual(bulkSuggestion({ name: '강남타임의원', nameEn: '' }, '2026-11-09'), { name: '강남타임의원_11월2주차', nameEn: '20261109' });
});

test('parseBulkCreate — 빈 선택·잘못된 기간은 거절, 중복 id는 하나로', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  assert.deepEqual(parseBulkCreate({ clientIds: [], startsOn: '2026-11-09', endsOn: '2026-11-15' }), { ok: false, message: BULK_EMPTY_MESSAGE });
  assert.equal(parseBulkCreate({ clientIds: [id], startsOn: '2026-11-15', endsOn: '2026-11-09' }).ok, false);
  assert.equal(parseBulkCreate({ clientIds: ['x'], startsOn: '2026-11-09', endsOn: '2026-11-15' }).ok, false);
  const ok = parseBulkCreate({ clientIds: [id, id], startsOn: '2026-11-09', endsOn: '2026-11-15' });
  assert.ok(ok.ok && ok.value.clientIds.length === 1);
});

test('hasSamePeriod — 같은 클라이언트에 시작·종료가 같은 캠페인만', () => {
  const ex = [{ clientId: 'a', startsOn: '2026-11-09', endsOn: '2026-11-15' }, { clientId: 'b', startsOn: '2026-11-01', endsOn: '2026-11-30' }];
  assert.equal(hasSamePeriod(ex, 'a', '2026-11-09', '2026-11-15'), true);
  assert.equal(hasSamePeriod(ex, 'b', '2026-11-09', '2026-11-15'), false);   // 겹치는 장기 캠페인은 막지 않는다
});

test('createCampaignsBulk — 고른 곳마다 하나씩, 이미 같은 기간이 있으면 하나도 안 만든다', async () => {
  const a = await createClient(sql, P + '가');
  const b = await createClient(sql, P + '나');
  const rows = await createCampaignsBulk(sql, { clientIds: [a.id, b.id], startsOn: '2026-11-09', endsOn: '2026-11-15', createdBy: null });
  assert.deepEqual(rows.map((r) => r.name), [`${P}가_11월2주차`, `${P}나_11월2주차`]);
  assert.ok(rows.every((r) => r.startsOn === '2026-11-09' && r.endsOn === '2026-11-15' && r.nameEn === '20261109'));
  // 한 곳이라도 같은 기간이 있으면 전부 거절(트랜잭션) — 새 클라이언트 c도 만들어지지 않는다
  const c = await createClient(sql, P + '다');
  await assert.rejects(createCampaignsBulk(sql, { clientIds: [c.id, a.id], startsOn: '2026-11-09', endsOn: '2026-11-15', createdBy: null }),
    (e: unknown) => e instanceof BulkCampaignError && e.message.includes(`${P}가`));
  const [{ n }] = await sql<Array<{ n: number }>>`select count(*)::int n from campaign where client_id = ${c.id}`;
  assert.equal(n, 0);
  // 다른 기간이면 괜찮다
  await createCampaign(sql, { clientId: c.id, clientName: c.name, name: 'x', nameEn: 'x', startsOn: '2026-11-01', endsOn: '2026-11-30', kind: null, note: '', createdBy: null });
  const more = await createCampaignsBulk(sql, { clientIds: [c.id], startsOn: '2026-11-16', endsOn: '2026-11-22', createdBy: null });
  assert.equal(more.length, 1);
});
