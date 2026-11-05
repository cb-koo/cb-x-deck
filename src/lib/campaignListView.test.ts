import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  campaignDot, isClosed, isEndedLongPending, isLongCampaign, staysInLongSection, campaignRowLabel, campaignSections, campaignsByClient,
  matchesCampaignQuery, matchedHandle, splitClientRows, weekKey, weekName,
} from './campaignListView.ts';

const TODAY = '2026-10-08'; // 목요일 — 10월 2주차(10/5~10/11)
const P = (posted: number, assigned: number, unassigned: number) => ({ planned: posted + assigned + unassigned, posted, assigned, unassigned });
const row = (name: string, clientName: string | null, startsOn: string, endsOn: string, clientId: string | null = clientName ? `id-${clientName}` : null,
  progress = P(0, 0, 0)) => ({ name, clientName, clientId, startsOn, endsOn, progress });

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
  // 이름이 {클라}_ 규칙을 안 따르면 클라이언트 이름을 붙이지 않고 캠페인 이름만(koo 10-08 — '미모드림 · 미모드림의원 10월 방…' 중복)
  assert.deepEqual(campaignRowLabel({ name: '미모드림의원 10월 방문협찬', clientName: '미모드림' }), { title: '미모드림의원 10월 방문협찬', suffix: null });
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

test('campaignRowLabel: 클라이언트로 묶으면 {클라}_ 뒤 부분만', () => {
  const g = { groupedByClient: true };
  assert.deepEqual(campaignRowLabel({ name: '미모드림_10월2주차', clientName: '미모드림' }, g), { title: '10월2주차', suffix: null });
  assert.deepEqual(campaignRowLabel({ name: '백수약국_10월 방문협찬', clientName: '백수약국' }, g), { title: '10월 방문협찬', suffix: null });
  // 딱 '{클라}_'뿐이면 빈 제목이 되지 않게 이름 전체
  assert.deepEqual(campaignRowLabel({ name: '미모드림_', clientName: '미모드림' }, g), { title: '미모드림_', suffix: null });
  assert.deepEqual(campaignRowLabel({ name: '미모드림_   ', clientName: '미모드림' }, g), { title: '미모드림_   ', suffix: null });
  // 앞뒤 공백은 자른다
  assert.deepEqual(campaignRowLabel({ name: '미모드림_  10월2주차  ', clientName: '미모드림' }, g), { title: '10월2주차', suffix: null });
  assert.deepEqual(campaignRowLabel({ name: '미모드림_10월2주차', clientName: '  미모드림 ' }, g), { title: '10월2주차', suffix: null });
  // 접두어가 없으면 이름 전체
  assert.deepEqual(campaignRowLabel({ name: '특별 프로모션', clientName: '미모드림' }, g), { title: '특별 프로모션', suffix: null });
  // 클라이언트 없음
  assert.deepEqual(campaignRowLabel({ name: '10월2주차', clientName: null }, g), { title: '10월2주차', suffix: null });
});

test('campaignSections: 이번 주 안에 끝난 장기는 이번 주 묶음에 남는다', () => {
  const endedEarly = row('백수약국_장기', '백수약국', '2026-09-20', '2026-10-06'); // 장기, 화요일에 종료
  const s = campaignSections([endedEarly, W2a], TODAY);
  assert.deepEqual(s.long, []);
  assert.deepEqual(s.upcoming[0].rows.map((r) => r.name), ['미모드림_10월2주차', '백수약국_장기']);
  assert.equal(s.past.length, 0);
});

test('campaignSections: 지난 주차 3개 이상은 최근 주가 위', () => {
  const w3 = row('a_9월3주차', 'a', '2026-09-14', '2026-09-20');
  const w2 = row('a_9월2주차', 'a', '2026-09-07', '2026-09-13');
  const s = campaignSections([w2, W94, W1a, w3], TODAY);
  assert.deepEqual(s.past.map((g) => g.label), ['지난 주 · 10월1주차', '9월4주차', '9월3주차', '9월2주차']);
});

test('splitClientRows: 진행 중·예정 먼저(장기가 맨 위), 지난은 받은 순서 그대로', () => {
  const wk = row('A_10월2주차', 'A', '2026-10-06', '2026-10-10');
  const nx = row('A_10월3주차', 'A', '2026-10-13', '2026-10-17');
  const lg = row('A_10월 방문협찬', 'A', '2026-10-01', '2026-10-31');
  const todayEnd = row('A_당일 끝', 'A', '2026-10-05', '2026-10-08');
  const p1 = row('A_10월1주차', 'A', '2026-09-29', '2026-10-03');
  const p2 = row('A_9월4주차', 'A', '2026-09-22', '2026-09-26');
  const { current, past } = splitClientRows([nx, wk, p1, lg, todayEnd, p2], TODAY);
  assert.deepEqual(current.map((r) => r.name), ['A_10월 방문협찬', 'A_10월3주차', 'A_10월2주차', 'A_당일 끝']);
  assert.deepEqual(past.map((r) => r.name), ['A_10월1주차', 'A_9월4주차']);
});

test('splitClientRows: 전부 지난 묶음이면 current가 비어 있다', () => {
  const p1 = row('B_10월1주차', 'B', '2026-09-29', '2026-10-03');
  const { current, past } = splitClientRows([p1], TODAY);
  assert.deepEqual(current, []);
  assert.deepEqual(past, [p1]);
});

// ISSUE-004(koo 11-02): 끝난 장기라도 게시 안 된 작업이 남으면 처리할 때까지 장기 칸에 남는다
const NOV2 = '2026-11-02'; // 월요일 — 11월1주차(11/2~11/8), 10/31은 지난 주(10월5주차)
const OCT_VISIT = (name: string, progress: ReturnType<typeof P>) => row(name, name.split('_')[0], '2026-10-01', '2026-10-31', undefined, progress);

test('isEndedLongPending·staysInLongSection', () => {
  const pending = OCT_VISIT('백수약국_10월 방문협찬', P(0, 3, 1));
  const done = OCT_VISIT('미모드림_10월 방문협찬', P(2, 0, 0));
  const empty = OCT_VISIT('A_10월 방문협찬', P(0, 0, 0));
  assert.equal(isEndedLongPending(pending, NOV2), true);
  assert.equal(isEndedLongPending(done, NOV2), false);
  assert.equal(isEndedLongPending(empty, NOV2), false);
  assert.equal(isEndedLongPending(pending, '2026-10-31'), false); // 종료일 당일은 아직 진행 중
  assert.equal(staysInLongSection(pending, '2026-10-31'), true);
  assert.equal(staysInLongSection(pending, NOV2), true);
  assert.equal(staysInLongSection(done, NOV2), false);
  // 짧은 캠페인은 남은 작업이 있어도 장기가 아니다
  const shortPending = row('A_10월4주차', 'A', '2026-10-20', '2026-10-26', undefined, P(0, 2, 0));
  assert.equal(isEndedLongPending(shortPending, NOV2), false);
});

test('campaignSections: 남은 작업 있는 끝난 장기는 장기 칸 아래쪽, 다 처리하면 끝난 주로 내려간다', () => {
  const pending = OCT_VISIT('백수약국_10월 방문협찬', P(0, 4, 0));
  const pending2 = row('B_9월 장기', 'B', '2026-09-01', '2026-10-20', undefined, P(1, 1, 0));
  const live = row('C_11월 방문협찬', 'C', '2026-11-01', '2026-11-30', undefined, P(0, 1, 0));
  const done = OCT_VISIT('미모드림_10월 방문협찬', P(2, 0, 0));
  const wk = row('D_10월5주차', 'D', '2026-10-26', '2026-11-01', undefined, P(1, 0, 0));
  const s = campaignSections([pending, done, wk, live, pending2], NOV2);
  assert.deepEqual(s.long.map((r) => r.name), ['C_11월 방문협찬', 'B_9월 장기', '백수약국_10월 방문협찬']);
  assert.deepEqual(s.upcoming[0].rows, []);
  assert.deepEqual(s.past.map((g) => [g.label, g.rows.map((r) => r.name)]), [['지난 주 · 10월5주차', ['미모드림_10월 방문협찬', 'D_10월5주차']]]);
});

test('splitClientRows·campaignsByClient: 남은 작업 있는 끝난 장기는 진행 중 칸, 묶음도 펼침', () => {
  const pending = row('A_10월 방문협찬', 'A', '2026-10-01', '2026-10-31', 'c1', P(0, 1, 0));
  const done = row('A_9월 방문협찬', 'A', '2026-09-01', '2026-09-30', 'c1', P(1, 0, 0));
  const wkPast = row('A_10월4주차', 'A', '2026-10-20', '2026-10-26', 'c1', P(0, 1, 0));
  const { current, past } = splitClientRows([wkPast, pending, done], NOV2);
  assert.deepEqual(current.map((r) => r.name), ['A_10월 방문협찬']);
  assert.deepEqual(past.map((r) => r.name), ['A_10월4주차', 'A_9월 방문협찬']);
  assert.equal(campaignsByClient([pending, done], NOV2)[0].open, true);
  assert.equal(campaignsByClient([done], NOV2)[0].open, false);
});

// 마감(085, koo 11-02): 남은 작업과 상관없이 지난 캠페인으로, 점은 회색, 다시 열면 원래대로
const closedAt = (kstDate: string) => `${kstDate}T03:00:00.000Z`; // 서울 12:00
test('isClosed·campaignDot: 마감하면 회색 점, 남은 작업 수를 말한다', () => {
  const c = { startsOn: '2026-10-01', endsOn: '2026-10-31', progress: P(0, 3, 1) };
  assert.equal(isClosed({ closedAt: undefined }), false);
  assert.equal(isClosed({ ...c, closedAt: null }), false);
  assert.deepEqual(campaignDot({ ...c, closedAt: closedAt('2026-11-02') }, NOV2), { dot: 'grey', reason: '마감했어요. 게시 안 된 작업 4건' });
  assert.deepEqual(campaignDot({ ...c, progress: P(2, 0, 0), closedAt: closedAt('2026-11-02') }, NOV2), { dot: 'grey', reason: '마감했어요' });
  assert.equal(campaignDot({ ...c, closedAt: null }, NOV2).dot, 'red');
});

test('campaignSections: 마감한 장기는 남은 작업이 있어도 끝난 날의 주로, 기간 중 마감이면 마감한 날의 주로', () => {
  const pendingClosed = { ...OCT_VISIT('백수약국_10월 방문협찬', P(0, 4, 0)), closedAt: closedAt('2026-11-02') };
  const pendingOpen = OCT_VISIT('벤자민클리닉_10월 방문협찬', P(0, 4, 0));
  const earlyClosed = { ...row('C_11월 방문협찬', 'C', '2026-11-01', '2026-11-30', undefined, P(0, 1, 0)), closedAt: closedAt('2026-11-02') };
  const s = campaignSections([pendingClosed, pendingOpen, earlyClosed], NOV2);
  assert.deepEqual(s.long.map((r) => r.name), ['벤자민클리닉_10월 방문협찬']);
  assert.deepEqual(s.past.map((g) => [g.label, g.rows.map((r) => r.name)]), [['지난 주 · 10월5주차', ['백수약국_10월 방문협찬']]]);
  assert.deepEqual(s.upcoming[0].rows.map((r) => r.name), ['C_11월 방문협찬']); // 11/2(이번 주)에 마감
  // 다시 열면(closedAt null) 장기 칸으로 돌아온다
  const reopened = campaignSections([{ ...pendingClosed, closedAt: null }], NOV2);
  assert.deepEqual(reopened.long.map((r) => r.name), ['백수약국_10월 방문협찬']);
});

test('campaignSections: 마감한 주차 캠페인은 시작한 주에 그대로(회색 점)', () => {
  const wk = { ...row('D_11월1주차', 'D', '2026-11-02', '2026-11-08', undefined, P(0, 2, 0)), closedAt: closedAt('2026-11-02') };
  const s = campaignSections([wk], NOV2);
  assert.deepEqual(s.upcoming[0].rows.map((r) => r.name), ['D_11월1주차']);
});

test('splitClientRows·campaignsByClient: 마감한 캠페인은 진행 중이어도 지난 쪽', () => {
  const live = { ...row('A_11월 방문협찬', 'A', '2026-11-01', '2026-11-30', 'c1', P(0, 1, 0)), closedAt: closedAt('2026-11-02') };
  const pending = { ...row('A_10월 방문협찬', 'A', '2026-10-01', '2026-10-31', 'c1', P(0, 1, 0)), closedAt: closedAt('2026-11-02') };
  const { current, past } = splitClientRows([live, pending], NOV2);
  assert.deepEqual(current, []);
  assert.deepEqual(past.map((r) => r.name), ['A_11월 방문협찬', 'A_10월 방문협찬']);
  assert.equal(campaignsByClient([live, pending], NOV2)[0].open, false);
});

// ISSUE-008 — 인플 핸들로도 찾고(@ 있든 없든), 핸들로 걸렸을 때만 그 핸들을 알려 준다
test('matchesCampaignQuery·matchedHandle: 인플 핸들로 찾기', () => {
  const c = { name: '백수약국_11월1주차', clientName: '백수약국', influencerHandles: ['Eveniffen', 'minchannell'] };
  assert.equal(matchesCampaignQuery(c, '@eveniffen'), true);
  assert.equal(matchesCampaignQuery(c, 'minchan'), true);
  assert.equal(matchesCampaignQuery(c, '@nobody'), false);
  assert.equal(matchesCampaignQuery(c, '@'), false);
  assert.equal(matchedHandle(c, '@evenif'), 'Eveniffen');
  assert.equal(matchedHandle(c, '백수'), null);                       // 이름으로 걸리면 핸들 표시 없음
  assert.equal(matchesCampaignQuery({ name: 'x', clientName: null }, 'mina'), false);   // 핸들 목록이 없는 옛 값도 안전
});
