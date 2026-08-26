import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekColumns, weekBounds, isSingleWeek, prevWeek, nextWeek, clampWeek, weekLabel } from './campaignCalendar.ts';
import type { SortInput } from './campaignJudgment.ts';

const T = '2026-08-27'; // 목
const s = (o: Partial<SortInput> & { createdAt: string }): SortInput =>
  ({ status: 'draft', published: false, scheduledOn: null, influencerHandle: null, ...o });

test('1) weekColumns — 월~일 7열 + 예정일 없음, 다른 주 카드는 제외, 열 안은 생성순·미사용 맨 아래', () => {
  const rows = [
    s({ scheduledOn: '2026-08-26', createdAt: 'b' }),
    s({ scheduledOn: '2026-08-26', createdAt: 'a' }),
    s({ scheduledOn: '2026-08-26', status: 'unused', createdAt: '0' }),   // 같은 날이지만 맨 아래
    s({ scheduledOn: '2026-09-02', createdAt: 'c' }),                     // 다음 주 — 이 주엔 안 보인다
    s({ scheduledOn: null, createdAt: 'd' }),
    s({ scheduledOn: null, createdAt: 'e', status: 'unused' }),
  ];
  const cols = weekColumns(rows, '2026-08-24', T);
  assert.deepEqual(cols.days.map((d) => d.date), ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
  assert.deepEqual(cols.days[2].items.map((r) => r.createdAt), ['a', 'b', '0']);
  assert.equal(cols.days.flatMap((d) => d.items).length, 3);
  assert.deepEqual(cols.unscheduled.map((r) => r.createdAt), ['d', 'e']);
});

test('2) weekBounds — 기간의 주 ∪ 예정일의 주, 단일 주 판정', () => {
  assert.deepEqual(weekBounds('2026-08-24', '2026-08-30', []), { first: '2026-08-24', last: '2026-08-24' });
  assert.equal(isSingleWeek(weekBounds('2026-08-24', '2026-08-30', [null, '2026-08-28'])), true);
  assert.equal(isSingleWeek(weekBounds('2026-08-26', '2026-09-01', [])), false);            // 수~화 7일 — 두 주에 걸친다
  assert.deepEqual(weekBounds('2026-08-24', '2026-09-06', ['2026-09-09', '2026-08-20', null]),
    { first: '2026-08-17', last: '2026-09-07' });                                            // 기간 밖 예정일도 닿을 수 있어야 한다
});

test('3) prev/next — 경계에서 null, clamp는 가장 가까운 경계 주로', () => {
  const b = { first: '2026-08-24', last: '2026-09-07' };
  assert.equal(prevWeek('2026-08-24', b), null);
  assert.equal(nextWeek('2026-08-24', b), '2026-08-31');
  assert.equal(nextWeek('2026-09-07', b), null);
  assert.equal(prevWeek('2026-09-07', b), '2026-08-31');
  assert.equal(clampWeek('2026-08-10', b), '2026-08-24');
  assert.equal(clampWeek('2026-09-21', b), '2026-09-07');
  assert.equal(clampWeek('2026-08-31', b), '2026-08-31');
});

test('4) weekLabel — datetime.weekRangeLabel 연계(월 경계 포함)', () => {
  assert.equal(weekLabel('2026-08-24'), '8/24~30 주');
  assert.equal(weekLabel('2026-08-31'), '8/31~9/6 주');
});

// 달·해 경계에서도 주 산술이 어긋나지 않는지 — addDays(±7)만 쓰므로 31일 달·연말이 문제 되면 안 된다(브리핑 자기점검).
test('5) 달·해 경계 넘김', () => {
  const b = weekBounds('2026-12-21', '2027-01-10', []);
  assert.deepEqual(b, { first: '2026-12-21', last: '2027-01-04' });
  assert.equal(nextWeek('2026-12-28', b), '2027-01-04');
  assert.equal(weekLabel('2026-12-28'), '12/28~1/3 주');
  assert.equal(isSingleWeek(b), false);
});
