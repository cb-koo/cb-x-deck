import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignWeekOf, campaignWeeksInMonth, campaignWeeksBack, campaignWeekName, nextCampaignWeek } from './campaignWeek.ts';

const nm = (d: string) => { const w = campaignWeekOf(d); return `${campaignWeekName(w)} ${w.start}~${w.end} ${w.days}일`; };

test('운영 캠페인과 같은 주차(10-10 운영 DB 확인)', () => {
  assert.equal(nm('2026-09-01'), '9월1주차 2026-09-01~2026-09-06 6일');   // 1일이 화요일
  assert.equal(nm('2026-09-07'), '9월2주차 2026-09-07~2026-09-13 7일');
  assert.equal(nm('2026-09-21'), '9월4주차 2026-09-21~2026-09-27 7일');
  assert.equal(nm('2026-09-29'), '9월5주차 2026-09-28~2026-09-30 3일');   // 달 끝에서 잘림
  assert.equal(nm('2026-10-01'), '10월1주차 2026-10-01~2026-10-04 4일');  // 다음 달 1일부터 새로
  assert.equal(nm('2026-10-05'), '10월2주차 2026-10-05~2026-10-11 7일');
});

test('경계: 월말 월요일(하루짜리), 1일이 월요일, 연도 넘김', () => {
  assert.equal(nm('2026-08-31'), '8월6주차 2026-08-31~2026-08-31 1일');
  assert.equal(nm('2026-06-01'), '6월1주차 2026-06-01~2026-06-07 7일');   // 6/1 월요일
  assert.equal(nm('2026-12-31'), '12월5주차 2026-12-28~2026-12-31 4일');
  assert.equal(nm('2027-01-01'), '1월1주차 2027-01-01~2027-01-03 3일');
  assert.equal(nextCampaignWeek(campaignWeekOf('2026-12-30')).start, '2027-01-01');
});

test('한 달 = 그 달 주차들의 합', () => {
  const ws = campaignWeeksInMonth(2026, 9);
  assert.deepEqual(ws.map((w) => w.n), [1, 2, 3, 4, 5]);
  assert.equal(ws.reduce((s, w) => s + w.days, 0), 30);
  assert.equal(campaignWeeksInMonth(2026, 8).reduce((s, w) => s + w.days, 0), 31);
  assert.deepEqual(campaignWeeksBack(campaignWeekOf('2026-10-01'), 3).map(campaignWeekName), ['9월4주차', '9월5주차', '10월1주차']);
});
