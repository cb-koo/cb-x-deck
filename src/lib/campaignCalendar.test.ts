import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekBounds, weekRows, calendarGrid, dateAnchorLabel } from './campaignCalendar.ts';
import type { TaskSortInput } from './campaignJudgment.ts';

const T = '2026-08-27'; // 목
// 달력의 카드는 작업(campaign_task)이다 — 게시 예정일 칸과(방문협찬이면) 방문일 칸에 각각 선다.
const t = (o: Partial<TaskSortInput> & { createdAt: string }): TaskSortInput =>
  ({ type: 'post', draftStatus: null, postedAt: null, removedAt: null, scheduledOn: null, visitOn: null, influencerHandle: null, ...o });

test('1) weekBounds — 기간의 주 ∪ 예정일의 주', () => {
  assert.deepEqual(weekBounds('2026-08-24', '2026-08-30', []), { first: '2026-08-24', last: '2026-08-24' });
  assert.deepEqual(weekBounds('2026-08-26', '2026-09-01', []), { first: '2026-08-24', last: '2026-08-31' });   // 수~화 — 두 주에 걸친다
  assert.deepEqual(weekBounds('2026-08-24', '2026-09-06', ['2026-09-09', '2026-08-20', null]),
    { first: '2026-08-17', last: '2026-09-07' });                                            // 기간 밖 예정일도 닿을 수 있어야 한다
});

test('2) weekRows — 주 행이 월~일 7일로 쌓인다(달·해 경계 포함)', () => {
  const one = weekRows('2026-08-24', '2026-08-30', []);
  assert.equal(one.length, 1);
  assert.deepEqual(one[0], ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']);
  // 2주 캠페인 + 기간 밖 예정일 → 예정일이 있는 주까지 행이 생긴다(그 카드가 격자 어딘가에 있어야 손이 닿는다)
  const rows = weekRows('2026-08-31', '2026-09-13', ['2026-09-16']);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r[0]), ['2026-08-31', '2026-09-07', '2026-09-14']);
  // 해 경계 — addDays(+7)만 쓰므로 연말에도 어긋나지 않는다
  const ny = weekRows('2026-12-21', '2027-01-10', []);
  assert.deepEqual(ny.map((r) => r[0]), ['2026-12-21', '2026-12-28', '2027-01-04']);
  assert.deepEqual(ny[1].at(-1), '2027-01-03');
});

test('3) calendarGrid — 게시 예정일 칸에 카드, 칸 안은 만든 순·미사용 맨 아래, 게시일 미정은 따로', () => {
  const rows = [
    t({ scheduledOn: '2026-08-26', createdAt: 'b' }),
    t({ scheduledOn: '2026-08-26', createdAt: 'a' }),
    t({ scheduledOn: '2026-08-26', draftStatus: 'unused', createdAt: '0' }),   // 같은 날이지만 맨 아래
    t({ scheduledOn: '2026-09-02', createdAt: 'c' }),                          // 다음 주 행에 들어간다(넘김 없이 보인다)
    t({ scheduledOn: null, createdAt: 'd' }),
    t({ scheduledOn: null, createdAt: 'e', draftStatus: 'unused' }),
  ];
  const weeks = weekRows('2026-08-24', '2026-09-06', rows.map((r) => r.scheduledOn));
  const grid = calendarGrid(rows, weeks, T);
  assert.equal(grid.weeks.length, 2);
  assert.deepEqual(grid.weeks[0][2].items.map((i) => [i.task.createdAt, i.kind]),
    [['a', 'post'], ['b', 'post'], ['0', 'post']]);                            // 8/26 수
  assert.deepEqual(grid.weeks[1][2].items.map((i) => [i.task.createdAt, i.kind]), [['c', 'post']]);   // 9/2 수 — 두 번째 주 행
  assert.equal(grid.weeks.flat().flatMap((c) => c.items).length, 4);           // 예정일 있는 4건만 칸에 담긴다
  assert.deepEqual(grid.unscheduled.map((r) => r.createdAt), ['d', 'e']);
});

test('3-2) calendarGrid — 방문협찬은 방문일 칸에도 선다(게시일이 없으면 미정에도 든다)', () => {
  const rows = [
    t({ type: 'visit', visitOn: '2026-09-10', scheduledOn: null, createdAt: 'v1' }),          // 방문일만 — 게시일은 미정
    t({ type: 'visit', visitOn: '2026-09-08', scheduledOn: '2026-09-10', createdAt: 'v2' }),  // 방문 카드 + 게시 카드 둘
    t({ type: 'post', visitOn: '2026-09-08', scheduledOn: null, createdAt: 'p' }),            // 방문협찬이 아니면 방문일은 무시
  ];
  const weeks = weekRows('2026-09-07', '2026-09-13', rows.flatMap((r) => [r.scheduledOn, r.visitOn]));
  const grid = calendarGrid(rows, weeks, T);
  assert.equal(grid.weeks.length, 1);
  // 9/8 화 — v2의 방문 카드 하나뿐(p의 visitOn은 유형이 방문협찬이 아니라 안 선다)
  assert.deepEqual(grid.weeks[0][1].items.map((i) => [i.task.createdAt, i.kind]), [['v2', 'visit']]);
  // 9/10 목 — v2의 게시 카드 + v1의 방문 카드
  assert.deepEqual(grid.weeks[0][3].items.map((i) => [i.task.createdAt, i.kind]), [['v2', 'post'], ['v1', 'visit']]);
  // 게시 예정일이 없는 작업은 방문일이 있어도 '게시일 미정'에 든다
  assert.deepEqual(grid.unscheduled.map((r) => r.createdAt), ['p', 'v1']);   // 둘 다 게시일 미정이라 만든 순
});

test('4) dateAnchorLabel — 첫 칸과 달이 바뀌는 칸만 달을 붙인다', () => {
  assert.equal(dateAnchorLabel('2026-08-31', null), '8/31');       // 격자 첫 칸
  assert.equal(dateAnchorLabel('2026-09-01', '2026-08-31'), '9/1'); // 달 경계
  assert.equal(dateAnchorLabel('2026-09-02', '2026-09-01'), '2');   // 같은 달이면 일 숫자만
  assert.equal(dateAnchorLabel('2027-01-01', '2026-12-31'), '1/1'); // 해가 바뀌어도 같은 규칙
});
