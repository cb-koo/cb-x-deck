import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignDot, isLongCampaign, campaignRowLabel, campaignSections, campaignsByClient,
  matchesCampaignQuery, weekKey, weekName,
} from './campaignListView.ts';

const TODAY = '2026-10-08'; // 목요일 — 10월 2주차(10/5~10/11)
const P = (posted: number, assigned: number, unassigned: number) => ({ planned: posted + assigned + unassigned, posted, assigned, unassigned });
const row = (name: string, clientName: string | null, startsOn: string, endsOn: string, clientId: string | null = clientName ? `id-${clientName}` : null) =>
  ({ name, clientName, clientId, startsOn, endsOn });

test('weekKey·weekName: 월요일 키, 목요일 판정 주차 이름', () => {
  assert.equal(weekKey('2026-10-08'), '2026-10-05');
  assert.equal(weekKey('2026-10-11'), '2026-10-05');
  assert.equal(weekName('2026-10-08'), '10월2주차');
  assert.equal(weekName('2026-09-28'), '10월1주차'); // 월 9/28 → 목 10/1
  assert.equal(weekName('2026-10-04'), '10월1주차');
  assert.equal(weekName('2026-09-21'), '9월4주차');
});

test('isLongCampaign: 기간 7일 초과만 장기', () => {
  assert.equal(isLongCampaign({ startsOn: '2026-10-05', endsOn: '2026-10-11' }), false);
  assert.equal(isLongCampaign({ startsOn: '2026-10-05', endsOn: '2026-10-12' }), true);
  assert.equal(isLongCampaign({ startsOn: '2026-10-01', endsOn: '2026-10-31' }), true);
});

test('campaignDot: 표의 모든 행', () => {
  const base = { startsOn: '2026-10-05', endsOn: '2026-10-11' };
  assert.deepEqual(campaignDot({ startsOn: '2026-10-12', endsOn: '2026-10-18', progress: P(0, 0, 0) }, TODAY), { dot: 'grey', reason: '10/12에 시작해요' });
  assert.deepEqual(campaignDot({ startsOn: '2026-10-12', endsOn: '2026-10-18', progress: P(0, 1, 2) }, TODAY), { dot: 'grey', reason: '10/12에 시작해요' });
  assert.deepEqual(campaignDot({ ...base, progress: P(3, 0, 0) }, TODAY), { dot: 'green', reason: '모두 게시됐어요' });
  assert.deepEqual(campaignDot({ startsOn: '2026-09-28', endsOn: '2026-10-04', progress: P(3, 0, 0) }, TODAY), { dot: 'green', reason: '모두 게시됐어요' });
  assert.deepEqual(campaignDot({ startsOn: '2026-09-28', endsOn: '2026-10-04', progress: P(1, 1, 1) }, TODAY), { dot: 'red', reason: '기간이 끝났는데 게시 안 된 작업 2건' });
  assert.deepEqual(campaignDot({ ...base, progress: P(1, 2, 1) }, TODAY), { dot: 'yellow', reason: '미배정 1건 · 게시 대기 2건' });
  assert.deepEqual(campaignDot({ ...base, progress: P(1, 2, 0) }, TODAY), { dot: 'yellow', reason: '게시 대기 2건' });
  assert.deepEqual(campaignDot({ ...base, progress: P(0, 0, 0) }, TODAY), { dot: 'grey', reason: '작업이 없어요' });
  assert.deepEqual(campaignDot({ startsOn: '2026-09-28', endsOn: '2026-10-04', progress: P(0, 0, 0) }, TODAY), { dot: 'grey', reason: '작업이 없어요' });
  // 종료일 당일은 아직 끝난 게 아니다
  assert.equal(campaignDot({ startsOn: '2026-10-05', endsOn: '2026-10-08', progress: P(0, 1, 0) }, TODAY).dot, 'yellow');
});

test('campaignRowLabel', () => {
  assert.deepEqual(campaignRowLabel({ name: '미모드림_10월2주차', clientName: '미모드림' }), { title: '미모드림', suffix: null });
  assert.deepEqual(campaignRowLabel({ name: '더스퀘어치과_10월 도쿄상담회 플모', clientName: '더스퀘어치과' }), { title: '더스퀘어치과', suffix: '10월 도쿄상담회 플모' });
  assert.deepEqual(campaignRowLabel({ name: '백수약국_10월 방문협찬', clientName: '백수약국' }), { title: '백수약국', suffix: '10월 방문협찬' });
  assert.deepEqual(campaignRowLabel({ name: '10월2주차', clientName: null }), { title: '10월2주차', suffix: null });
});

const W2a = row('미모드림_10월2주차', '미모드림', '2026-10-05', '2026-10-11');
const W2b = row('가나다치과_10월2주차', '가나다치과', '2026-10-05', '2026-10-11');
const LONG = row('백수약국_10월 방문협찬', '백수약국', '2026-10-01', '2026-10-31');
const W1a = row('미모드림_10월1주차', '미모드림', '2026-09-28', '2026-09-30');
const W1b = row('가나다치과_10월1주차', '가나다치과', '2026-10-01', '2026-10-04');
const W94 = row('미모드림_9월4주차', '미모드림', '2026-09-21', '2026-09-27');

test('campaignSections: 장기·이번 주·다음 주(0개)·지난 주', () => {
  const s = campaignSections([W2a, W2b, LONG, W1a, W1b, W94], TODAY);
  assert.deepEqual(s.long, [LONG]);
  assert.deepEqual(s.upcoming.map((g) => [g.label, g.tone, g.rows.length]), [
    ['이번 주 · 10월2주차', 'current', 2],
    ['다음 주 · 10월3주차', 'upcoming', 0],
  ]);
  assert.deepEqual(s.upcoming[0].rows, [W2b, W2a]); // 클라이언트 가나다순
  assert.deepEqual(s.past.map((g) => [g.label, g.tone, g.rows.length]), [
    ['지난 주 · 10월1주차', 'past', 2],
    ['9월4주차', 'past', 1],
  ]);
  assert.deepEqual(s.past[0].rows, [W1b, W1a]);
});

test('campaignSections: 다음 주·그 뒤 주차, 같은 클라이언트는 시작일순', () => {
  const n1 = row('미모드림_10월3주차', '미모드림', '2026-10-12', '2026-10-18');
  const far = row('미모드림_10월4주차', '미모드림', '2026-10-19', '2026-10-25');
  const early = row('미모드림_a', '미모드림', '2026-10-06', '2026-10-08');
  const s = campaignSections([far, n1, W2a, early], TODAY);
  assert.deepEqual(s.upcoming.map((g) => g.label), ['이번 주 · 10월2주차', '다음 주 · 10월3주차', '10월4주차']);
  assert.deepEqual(s.upcoming[0].rows, [W2a, early]);
  assert.equal(s.upcoming[2].tone, 'upcoming');
});

test('campaignSections: 끝난 장기는 끝난 날의 주차로 지난 캠페인', () => {
  const ended = row('백수약국_9월 방문협찬', '백수약국', '2026-09-01', '2026-09-30'); // 9/30 = 10월1주차 주(9/28~)
  const s = campaignSections([ended, LONG], TODAY);
  assert.deepEqual(s.long, [LONG]);
  assert.deepEqual(s.past.map((g) => [g.label, g.rows]), [['지난 주 · 10월1주차', [ended]]]);
});

test('campaignSections: 비어도 이번 주·다음 주는 있다 / 장기 없으면 빈 배열', () => {
  const s = campaignSections([], TODAY);
  assert.deepEqual(s.long, []);
  assert.deepEqual(s.past, []);
  assert.deepEqual(s.upcoming.map((g) => g.rows.length), [0, 0]);
});

test('campaignSections: 장기는 시작일 오름차순', () => {
  const l2 = row('A_x', 'A', '2026-09-20', '2026-10-20');
  const s = campaignSections([LONG, l2], TODAY);
  assert.deepEqual(s.long, [l2, LONG]);
});

test('campaignsByClient: 최근 시작 클라이언트가 위, 진행 중·예정이면 펼침', () => {
  const a1 = row('가_1', '가나다치과', '2026-09-21', '2026-09-27', 'c1'); // 끝남
  const a2 = row('가_2', '가나다치과', '2026-09-28', '2026-10-04', 'c1'); // 끝남
  const b1 = row('미_1', '미모드림', '2026-10-05', '2026-10-11', 'c2'); // 진행
  const b0 = row('미_0', '미모드림', '2026-09-14', '2026-09-20', 'c2');
  const n = row('무_1', null, '2026-09-01', '2026-09-07', null);
  const g = campaignsByClient([a1, a2, b0, n, b1], TODAY);
  assert.deepEqual(g.map((x) => [x.label, x.open]), [['미모드림', true], ['가나다치과', false], ['클라이언트 없음', false]]);
  assert.deepEqual(g[0].rows, [b1, b0]);
  assert.deepEqual(g[1].rows, [a2, a1]);
});

test('matchesCampaignQuery: 대소문자·공백 무시, 이름·클라이언트', () => {
  assert.equal(matchesCampaignQuery({ name: 'The Square_10월', clientName: '더스퀘어' }, 'thesq'), true);
  assert.equal(matchesCampaignQuery({ name: 'x_10월2주차', clientName: '미모드림' }, ' 미모 '), true);
  assert.equal(matchesCampaignQuery({ name: 'x_10월2주차', clientName: null }, '10월 2주'), true);
  assert.equal(matchesCampaignQuery({ name: 'x', clientName: '가' }, 'zz'), false);
  assert.equal(matchesCampaignQuery({ name: 'x', clientName: null }, '   '), true);
});
