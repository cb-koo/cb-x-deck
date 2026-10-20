import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPost, parsePost, weekStartOf, kstYmd, kstMidnight, addWeeks, relativeDay, weekTitle,
  firstRecordedWeek, targetForWeek, campaignWeekLabel, weekCell, missedStreak, buildChannelsView, buildChannelDetail, followerSummary,
  type ChannelInput, type ChannelPost,
} from './ownedChannels.ts';

// 기준 시각: 2026-10-21(화) 10:00 한국 = 01:00Z. 이번 주 = 10/19(월)~10/25(일)
const NOW = Date.parse('2026-10-21T01:00:00Z');
const kst = (ymdHm: string) => new Date(Date.parse(ymdHm.replace(' ', 'T') + ':00Z') - 9 * 3_600_000).toISOString();

const post = (at: string, kind: ChannelPost['kind'] = 'original', o: Partial<ChannelPost> = {}): ChannelPost =>
  ({ postId: `${at}-${kind}`, kind, text: '글', postedAt: kst(at), deletedAt: null, ...o });

const channel = (o: Partial<ChannelInput> = {}): ChannelInput => ({
  channelId: 'c1', clientId: 'k1', clientName: '연세바른한의원', handle: 'yonsei',
  currentTarget: 1, registeredAt: kst('2026-10-01 12:00'), accountCreatedAt: null,
  weekTargets: [], posts: [], snapshots: [], lastCollectedAt: kst('2026-10-21 07:00'), lastError: null, ...o,
});

test('글 종류 — RT가 먼저, 스레드 이어 쓰기는 답글, 인용, 그 밖은 새 글', () => {
  assert.equal(classifyPost({ retweeted_tweet: {}, quoted_tweet: {} }), 'retweet');
  assert.equal(classifyPost({ inReplyToId: '123' }), 'reply');
  assert.equal(classifyPost({ isReply: true }), 'reply');
  assert.equal(classifyPost({ quoted_tweet: {} }), 'quote');
  assert.equal(classifyPost({ inReplyToId: null }), 'original');
  const p = parsePost({ id: '9', createdAt: 'Mon Oct 19 12:01:23 +0000 2026', text: 'hi', isPinned: true });
  assert.deepEqual(p, { postId: '9', kind: 'original', text: 'hi', postedAt: '2026-10-19T12:01:23.000Z', pinned: true });
  assert.equal(parsePost({ id: '9' }), null);
  assert.equal(parsePost({ id: '8', createdAt: '2026-10-19T00:00:00Z', text: 'Q&amp;A &lt;3 &quot;hi&quot;' })?.text, 'Q&A <3 "hi"');
});

test('주 경계 — 한국 일요일 23:59는 그 주, 월요일 00:00은 다음 주', () => {
  assert.equal(weekStartOf(kst('2026-10-25 23:59')), '2026-10-19');
  assert.equal(weekStartOf(kst('2026-10-26 00:00')), '2026-10-26');
  // UTC로는 일요일 15:00 = 한국 월요일 00:00
  assert.equal(weekStartOf('2026-10-25T15:00:00Z'), '2026-10-26');
  assert.equal(kstYmd('2026-10-20T15:30:00Z'), '2026-10-21');
  assert.equal(kstMidnight('2026-10-19').toISOString(), '2026-10-18T15:00:00.000Z');
  assert.equal(addWeeks('2026-10-19', -1), '2026-10-12');
});

test('날짜 표기 — 9/26(25일 전)·어제·오늘, 주 제목', () => {
  assert.equal(relativeDay(kst('2026-09-26 15:00'), NOW), '9/26(25일 전)');
  assert.equal(relativeDay(kst('2026-10-20 23:30'), NOW), '10/20(어제)');
  assert.equal(relativeDay(kst('2026-10-21 00:10'), NOW), '10/21(오늘)');
  assert.equal(weekTitle('2026-10-19'), '10/19(월) ~ 25(일)');
  assert.equal(weekTitle('2026-09-28'), '9/28(월) ~ 10/4(일)');
});

test('기록 시작 — 등록 8주 전 월요일, 계정 개설이 더 늦으면 개설 주', () => {
  assert.equal(firstRecordedWeek(channel()), '2026-08-03');
  assert.equal(firstRecordedWeek(channel({ accountCreatedAt: kst('2026-09-30 10:00') })), '2026-09-28');
  const c = channel({ accountCreatedAt: kst('2026-09-30 10:00') });
  assert.equal(weekCell(c, '2026-09-21', false).count, null);
  assert.equal(weekCell(c, '2026-09-21', false).met, null);
  assert.equal(weekCell(c, '2026-09-28', false).count, 0);
});

test('그 주의 약속 — 저장된 값, 없으면 가까운 앞 주, 그것도 없으면 뒤 주, 그다음 지금 약속', () => {
  const c = channel({ currentTarget: 3, weekTargets: [{ weekStart: '2026-09-28', target: 1 }, { weekStart: '2026-10-12', target: 2 }] });
  assert.equal(targetForWeek(c, '2026-10-12'), 2);
  assert.equal(targetForWeek(c, '2026-10-05'), 1);
  assert.equal(targetForWeek(c, '2026-09-14'), 1);
  assert.equal(targetForWeek(channel({ currentTarget: 3 }), '2026-09-14'), 3);
  // 이번 주는 지금 약속
  assert.equal(weekCell(c, '2026-10-19', true).target, 3);
  assert.equal(weekCell(c, '2026-10-12', false).target, 2);
});

test('센 글 — 새 글·인용만, 지운 글도 센다(지워짐 수는 따로)', () => {
  const c = channel({ posts: [
    post('2026-10-13 09:00'), post('2026-10-14 09:00', 'quote', { deletedAt: kst('2026-10-16 07:00') }),
    post('2026-10-15 09:00', 'retweet'), post('2026-10-15 10:00', 'reply'),
  ] });
  const cell = weekCell(c, '2026-10-12', false);
  assert.equal(cell.count, 2);
  assert.equal(cell.deleted, 1);
  assert.equal(cell.met, true);
});

test('연속 못 채움 — 지난주부터 거꾸로, 기록 시작 전에서 멈춤', () => {
  const cells = (ms: Array<boolean | null>) => ms.map((met, i) => ({ weekStart: String(i), state: 'judged' as const, count: 0, target: 1, met, deleted: 0 }));
  assert.equal(missedStreak(cells([true, false, false, false])), 3);
  assert.equal(missedStreak(cells([false, true, false])), 1);
  assert.equal(missedStreak(cells([null, null, false, false])), 2);
  assert.equal(missedStreak(cells([false, true])), 0);
});

test('이번 주 — 못 채운 곳 문구·색·정렬, 채운 곳은 따로', () => {
  const threeMissed = channel({ channelId: 'a', clientName: '더스퀘어', posts: [post('2026-09-26 10:00')] });
  const lastMissed = channel({ channelId: 'b', clientName: '백수약국', posts: [post('2026-09-30 10:00'), post('2026-10-06 10:00')] });
  const plain = channel({ channelId: 'c', clientName: '가은치유한의원', posts: [post('2026-10-16 10:00')] });
  const partial = channel({ channelId: 'd', clientName: '마인드클리닉', currentTarget: 2,
    weekTargets: [{ weekStart: '2026-10-12', target: 2 }], posts: [post('2026-10-13 10:00'), post('2026-10-14 10:00'), post('2026-10-20 10:00')] });
  const done = channel({ channelId: 'e', clientName: '브릿지피부과', posts: [post('2026-10-15 10:00'), post('2026-10-21 08:00')] });
  const v = buildChannelsView([done, plain, partial, lastMissed, threeMissed], NOW);

  assert.equal(v.thisWeek.title, '10/19(월) ~ 25(일)');
  assert.equal(v.thisWeek.daysLeftLabel, '5일 남음');
  assert.equal(v.thisWeek.checkedLabel, '오늘 07:00에 확인했어요');
  assert.equal(v.thisWeek.total, 5);
  assert.equal(v.thisWeek.doneCount, 1);
  assert.deepEqual(v.thisWeek.pending.map((r) => r.clientName), ['더스퀘어', '백수약국', '가은치유한의원', '마인드클리닉']);
  const [a, b, c, d] = v.thisWeek.pending;
  assert.equal(a.situation, '3주째 못 채우는 중 — 이번 주 꼭 챙겨요');
  assert.equal(a.tone, 'warn');
  assert.equal(a.lastPost, '9/26(25일 전)');
  assert.equal(b.situation, '지난주 못 채움 — 2주 연속이 될 수 있어요');
  assert.equal(c.situation, '아직');
  assert.equal(c.tone, 'plain');
  assert.equal(d.situation, '1번 더');
  assert.equal(d.count, 1);
  assert.equal(v.thisWeek.done[0].situation, '✓ 채웠어요');
  assert.equal(v.thisWeek.done[0].tone, 'ok');
});

test('이번 주 — 계정 확인 실패는 0으로 세지 않고 맨 위, 오늘 수집 실패는 기준 날짜', () => {
  const bad = channel({ channelId: 'x', clientName: '하나', lastError: 'notFound', posts: [post('2026-10-20 10:00')] });
  const stale = channel({ channelId: 'y', clientName: '둘', lastCollectedAt: kst('2026-10-20 07:00'), lastError: 'fetchFailed' });
  const v = buildChannelsView([stale, bad], NOW);
  assert.equal(v.thisWeek.pending[0].clientName, '하나');
  assert.equal(v.thisWeek.pending[0].count, null);
  assert.equal(v.thisWeek.pending[0].done, false);
  assert.match(v.thisWeek.pending[0].situation, /계정을 확인하지 못했어요/);
  assert.equal(v.thisWeek.pending[1].staleNote, '10/20 기준');
  assert.equal(v.thisWeek.checkedLabel, '어제 07:00에 확인했어요');
});

test('일요일은 오늘까지, 점검 대상이 없으면 확인 시각 없음', () => {
  const sunday = Date.parse('2026-10-25T05:00:00Z');
  assert.equal(buildChannelsView([], sunday).thisWeek.daysLeftLabel, '오늘까지');
  assert.equal(buildChannelsView([], sunday).thisWeek.checkedLabel, null);
  assert.equal(buildChannelsView([channel({ lastCollectedAt: null })], NOW).thisWeek.checkedLabel, '아직 확인 전이에요');
});

test('흐름 — 8주 칸, 요약 문구, 지난주 못 채운 곳이 위', () => {
  const every = channel({ channelId: 'a', clientName: '가', posts: Array.from({ length: 8 }, (_, i) => post(`${addWeeks('2026-08-24', i)} 10:00`)) });
  const recent = channel({ channelId: 'b', clientName: '나', accountCreatedAt: kst('2026-09-30 10:00'),
    posts: ['2026-10-01', '2026-10-06', '2026-10-13'].map((d) => post(`${d} 10:00`)) });
  const streak = channel({ channelId: 'c', clientName: '다', posts: ['2026-08-24', '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((d) => post(`${d} 10:00`)) });
  const mixed = channel({ channelId: 'd', clientName: '라', posts: ['2026-08-24', '2026-09-01', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'].map((d) => post(`${d} 10:00`)) });
  const v = buildChannelsView([every, recent, mixed, streak], NOW);
  assert.deepEqual(v.history.weeks, ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  const by = Object.fromEntries(v.history.rows.map((r) => [r.clientName, r]));
  assert.equal(by['가'].summary, '8주 모두 채움');
  assert.equal(by['나'].summary, '시작 후 3주 모두 채움');
  assert.equal(by['나'].cells[0].count, null);
  assert.equal(by['다'].summary, '3주 연속 못 채움');
  assert.equal(by['다'].bad, true);
  assert.equal(by['라'].summary, '8주 중 7주 채움');
  assert.equal(v.history.rows[0].clientName, '다');
});

test('지난 주 판정은 그 주 약속으로 — 지금 약속을 올려도 지난 주가 바뀌지 않는다', () => {
  const c = channel({ currentTarget: 3, weekTargets: [{ weekStart: '2026-10-12', target: 1 }], posts: [post('2026-10-13 10:00')] });
  const v = buildChannelsView([c], NOW);
  const last = v.history.rows[0].cells[7];
  assert.equal(last.target, 1);
  assert.equal(last.met, true);
  assert.equal(v.thisWeek.pending[0].target, 3);
});

test('자세히 — 이번 주부터 최근 순, 지운 글 표시, 팔로워 해석', () => {
  const c = channel({
    posts: [post('2026-10-18 10:00', 'original', { deletedAt: kst('2026-10-20 07:00') }), post('2026-10-15 10:00', 'retweet')],
    snapshots: [{ capturedOn: '2026-08-25', followers: 5518 }, { capturedOn: '2026-10-14', followers: 5900 }, { capturedOn: '2026-10-21', followers: 5930 }],
  });
  const d = buildChannelDetail(c, NOW);
  assert.equal(d.weeks[0].isCurrent, true);
  assert.equal(d.weeks[0].met, null);
  assert.equal(d.weeks[1].weekStart, '2026-10-12');
  assert.equal(d.weeks[1].count, 1);
  assert.equal(d.weeks[1].met, true);
  assert.equal(d.weeks[1].posts[0].deletedNote, '10/20에 지워진 것을 확인했어요');
  assert.equal(d.weeks[1].posts[1].counted, false);
  assert.equal(d.followers.values.length, 9);
  assert.equal(d.followers.summary, '8주 동안 +412명(5,518 → 5,930), 주 평균 +52명이에요');
  assert.equal(followerSummary([100, null]), '팔로워 추이는 2주 뒤부터 보여요');
  assert.equal(followerSummary([100, 90]), '1주 동안 −10명(100 → 90), 주 평균 −10명으로 줄고 있어요');
});

test('약속을 쉰 주는 판정하지 않는다 — 약속 없음 줄 뒤의 빈 주도 약속 없음(리뷰 10-20)', () => {
  // 9/28주에 주 1회, 10/5주에 '약속 없음'으로 바꿈, 10/19주(이번 주)에 다시 주 1회
  const c = channel({ currentTarget: 1, weekTargets: [
    { weekStart: '2026-09-28', target: 1 }, { weekStart: '2026-10-05', target: null }, { weekStart: '2026-10-19', target: 1 },
  ], posts: [post('2026-09-29 10:00')] });
  assert.equal(targetForWeek(c, '2026-10-12'), null);
  const cell = weekCell(c, '2026-10-12', false);
  assert.equal(cell.met, null);
  assert.equal(cell.count, 0);
  const v = buildChannelsView([c], NOW);
  // 지난주(10/12)는 약속 없음 → 연속 못 채움이 아니다
  assert.equal(v.thisWeek.pending[0].situation, '아직');
  assert.equal(v.history.rows[0].cells[7].met, null);
});

test('수집이 끊긴 주는 그 앞 약속이 이어진다(약속을 바꾼 게 아니므로)', () => {
  const c = channel({ currentTarget: 2, weekTargets: [{ weekStart: '2026-09-28', target: 2 }] });
  assert.equal(targetForWeek(c, '2026-10-12'), 2);
});

test('약속 시작일 — 그 전 주는 판정하지 않고 글 수만, 시작 주부터 판정(더스퀘어 10월부터, koo 10-20)', () => {
  const c = channel({ promiseStartedOn: '2026-10-01', posts: [post('2026-09-15 10:00'), post('2026-09-16 10:00'), post('2026-10-06 10:00')] });
  const sep = weekCell(c, '2026-09-14', false);
  assert.deepEqual([sep.state, sep.count, sep.met, sep.target], ['beforeStart', 2, null, null]);
  const startWeek = weekCell(c, '2026-09-28', false);   // 10/1이 든 주(9/28~10/4)
  assert.deepEqual([startWeek.state, startWeek.met], ['judged', false]);
  const v = buildChannelsView([c], NOW);
  // 지난주(10/12) 못 채움, 10/5주 채움, 9/28주 못 채움 → 연속 1, 요약은 시작 후 3주만 센다
  assert.equal(v.history.rows[0].summary, '3주 중 1주 채움');
  assert.equal(v.thisWeek.pending[0].situation, '지난주 못 채움 — 2주 연속이 될 수 있어요');
  // 시작일이 미래면 이번 주도 판정 전
  const future = buildChannelsView([channel({ promiseStartedOn: '2026-10-27' })], NOW);
  assert.equal(future.thisWeek.pending[0].situation, '10/27부터 약속이 시작돼요');
});

test('주 머리 문구 · 표의 게시 시각', () => {
  const c = channel({ promiseStartedOn: '2026-10-05', posts: [
    post('2026-09-30 10:00'), post('2026-10-13 14:05'), post('2026-10-20 09:00'),
  ] });
  const d = buildChannelDetail(c, NOW);
  assert.equal(d.weeks[0].verdict, '1 / 1회 채움');            // 이번 주
  assert.equal(d.weeks[1].verdict, '1 / 1회 채움');
  assert.equal(d.weeks[2].verdict, '0 / 1회 못 채움');
  assert.equal(d.weeks[3].verdict, '약속 시작 전(글 1개)');
  assert.equal(d.weeks[1].posts[0].day, '10/13(화) 14:05');
  const cur = buildChannelDetail(channel({ currentTarget: 2, posts: [post('2026-10-20 09:00')] }), NOW);
  assert.equal(cur.weeks[0].verdict, '1 / 2회 진행 중');
});

test('캠페인 주차 — 월~일 주를 달 경계에서 잘라 그 달 1일이 든 주부터 1주차(캠페인 운영 규칙)', () => {
  assert.equal(campaignWeekLabel('2026-09-01'), '9월 1주차');   // 9/1(화)~6
  assert.equal(campaignWeekLabel('2026-09-06'), '9월 1주차');
  assert.equal(campaignWeekLabel('2026-09-07'), '9월 2주차');
  assert.equal(campaignWeekLabel('2026-09-30'), '9월 5주차');   // 9/28~30
  assert.equal(campaignWeekLabel('2026-10-01'), '10월 1주차');  // 10/1(목)~4
  assert.equal(campaignWeekLabel('2026-10-05'), '10월 2주차');
  assert.equal(campaignWeekLabel('2026-10-19'), '10월 4주차');
  assert.equal(campaignWeekLabel('2026-06-01'), '6월 1주차');   // 1일이 월요일
  assert.equal(campaignWeekLabel('2026-06-07'), '6월 1주차');
  assert.equal(campaignWeekLabel('2026-06-08'), '6월 2주차');
});

test('자세히 — 글은 주차로 묶지 않은 한 목록(최근 순)에 주차 열', () => {
  // 한국 시간 10/1 00:30 글은 10월 1주차(UTC로는 9/30)
  const c = channel({ posts: [post('2026-09-30 23:00'), post('2026-10-01 00:30'), post('2026-10-20 09:00', 'retweet')] });
  const d = buildChannelDetail(c, NOW);
  assert.deepEqual(d.posts.map((p) => p.weekLabel), ['10월 4주차', '10월 1주차', '9월 5주차']);
});
