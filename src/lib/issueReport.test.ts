import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIssueHandler, sanitizeLocation, locationOf, locationLine, locationHref, hasUnseenReply, inTab,
  issueScreenshotError, issueScreenshotPath, isIssueScreenshotPath, slackIssueText, fabPosition, screenNameFor,
  FAB_GAP, FAB_SIZE,
} from './issueReport.ts';

const UUID = '0b9c2b2e-1d1a-4c7e-9a43-2f1f6e4b8c01';

test('처리 담당자는 koo와 태정님 둘뿐 — 대소문자·공백 무시, 빈 값은 아님', () => {
  assert.equal(isIssueHandler('gugeon.park@clinicbridge.co.kr'), true);
  assert.equal(isIssueHandler(' TaeJeong.Jeon@clinicbridge.co.kr '), true);
  assert.equal(isIssueHandler('someone@clinicbridge.co.kr'), false);
  assert.equal(isIssueHandler(null), false);
  assert.equal(isIssueHandler(''), false);
});

test('위치 다듬기 — 화면·주소가 없으면 거절, 길이는 자르고 작업 id는 uuid만', () => {
  assert.equal(sanitizeLocation(null), null);
  assert.equal(sanitizeLocation({ screen: '캠페인' }), null);
  assert.equal(sanitizeLocation({ screen: '캠페인', path: 'https://evil.example' }), null);
  const l = sanitizeLocation({ screen: '  캠페인 ', title: 'x'.repeat(300), panel: '', path: '/campaigns/flow?id=1', taskId: 'nope', viewport: '1440×900' });
  assert.ok(l);
  assert.equal(l.screen, '캠페인');
  assert.equal(l.title?.length, 200);
  assert.equal(l.panel, null);
  assert.equal(l.dialog, null);
  assert.equal(l.taskId, null);
  assert.equal(sanitizeLocation({ screen: 'a', path: '/', taskId: UUID })?.taskId, UUID);
  assert.equal(locationOf('broken').screen, '알 수 없음');
});

test('보낸 곳 한 줄과 [이 화면 열기] 주소 — 작업 패널이면 ?task=를 더한다', () => {
  const l = { screen: '캠페인', title: '10월 4주차 가은치유한의원', panel: '인용RT · @miyuxxx48', dialog: null, path: '/campaigns/flow?id=c1', taskId: UUID, viewport: null };
  assert.equal(locationLine(l), '캠페인 › 10월 4주차 가은치유한의원 › 인용RT · @miyuxxx48');
  assert.equal(locationHref(l), `/campaigns/flow?id=c1&task=${UUID}`);
  assert.equal(locationLine({ ...l, title: '캠페인', panel: null }), '캠페인');
  // 패널 위에 뜬 가운데 창은 끝에 붙는다 — 링크는 패널까지만 연다(상세에 따로 적는다)
  assert.equal(locationLine({ ...l, dialog: '기존 방문 작업에 예약 추가' }), '캠페인 › 10월 4주차 가은치유한의원 › 인용RT · @miyuxxx48 › 기존 방문 작업에 예약 추가');
  assert.equal(locationHref({ ...l, dialog: '기존 방문 작업에 예약 추가' }), `/campaigns/flow?id=c1&task=${UUID}`);
  assert.equal(locationHref({ ...l, path: '/settlement', taskId: null }), '/settlement');
  assert.equal(locationHref({ ...l, path: '/campaigns/flow' }), `/campaigns/flow?task=${UUID}`);
});

test('안 본 답 — 답이 달린 뒤 상세를 열지 않았을 때만', () => {
  assert.equal(hasUnseenReply({ reply: null, repliedAt: null, replySeenAt: null }), false);
  assert.equal(hasUnseenReply({ reply: '고쳤어요', repliedAt: '2026-10-22T05:00:00Z', replySeenAt: null }), true);
  assert.equal(hasUnseenReply({ reply: '고쳤어요', repliedAt: '2026-10-22T05:00:00Z', replySeenAt: '2026-10-22T06:00:00Z' }), false);
  // 답을 고치면 다시 새 답
  assert.equal(hasUnseenReply({ reply: '다시 고쳤어요', repliedAt: '2026-10-22T07:00:00Z', replySeenAt: '2026-10-22T06:00:00Z' }), true);
});

test('탭 — 할 일 = 접수 + 확인 중, 내가 보낸 것 = 상태 무관', () => {
  assert.equal(inTab({ status: 'open', reporterId: 'a' }, 'todo', 'b'), true);
  assert.equal(inTab({ status: 'checking', reporterId: 'a' }, 'todo', 'b'), true);
  assert.equal(inTab({ status: 'resolved', reporterId: 'a' }, 'todo', 'b'), false);
  assert.equal(inTab({ status: 'resolved', reporterId: 'a' }, 'resolved', 'b'), true);
  assert.equal(inTab({ status: 'resolved', reporterId: 'a' }, 'mine', 'a'), true);
  assert.equal(inTab({ status: 'open', reporterId: 'a' }, 'mine', 'b'), false);
});

test('스크린샷 — 형식·용량, 경로 모양', () => {
  assert.equal(issueScreenshotError({ type: 'image/png', size: 1000 }), null);
  assert.match(issueScreenshotError({ type: 'image/gif', size: 1000 }) ?? '', /형식/);
  assert.match(issueScreenshotError({ type: 'image/png', size: 11 * 1024 * 1024 }) ?? '', /10MB/);
  const p = issueScreenshotPath('image/webp', UUID, new Date('2026-10-22T03:00:00Z'));
  assert.equal(p, `issue/2026-10/${UUID}.webp`);
  assert.equal(isIssueScreenshotPath(p), true);
  assert.equal(isIssueScreenshotPath(`task/${UUID}/${UUID}.png`), false);
  assert.equal(isIssueScreenshotPath('https://evil.example/x.png'), false);
  assert.equal(isIssueScreenshotPath(p + '\n'), false);
});

test('슬랙 한 줄 — 80자에서 자르고 슬랙 문법 글자는 이스케이프', () => {
  const t = slackIssueText({
    reporterName: '박구건', body: '표가 <안> 바뀌어요 & ' + '가'.repeat(100),
    location: { screen: '캠페인', title: null, panel: '작업 @a', dialog: null, path: '/', taskId: null, viewport: null },
    hasScreenshot: true, url: 'https://x.test/issues?id=1',
  });
  assert.match(t, /\*박구건\*님이 이슈를 보냈어요/);
  assert.match(t, /&lt;안&gt; 바뀌어요 &amp;/);
  assert.match(t, /…\n캠페인 › 작업 @a, 스크린샷 1장 {3}<https:\/\/x\.test\/issues\?id=1\|이슈 열기 ↗>$/);
});

test('버튼 자리 — 오른쪽 패널은 왼쪽으로 비키고, 하단 줄은 위로, 너무 넓은 패널이면 구석 그대로', () => {
  assert.deepEqual(fabPosition({ viewportWidth: 1440, rightPanelWidth: 0, bottomBarHeight: 0 }), { right: FAB_GAP, bottom: FAB_GAP });
  assert.deepEqual(fabPosition({ viewportWidth: 1440, rightPanelWidth: 560, bottomBarHeight: 0 }), { right: 560 + FAB_GAP, bottom: FAB_GAP });
  assert.deepEqual(fabPosition({ viewportWidth: 1440, rightPanelWidth: 0, bottomBarHeight: 53 }), { right: FAB_GAP, bottom: 65 });
  assert.deepEqual(fabPosition({ viewportWidth: 600, rightPanelWidth: 560, bottomBarHeight: 0 }), { right: FAB_GAP, bottom: FAB_GAP });
  assert.ok(560 + FAB_GAP + FAB_SIZE + FAB_GAP <= 1440);
});

test('화면 이름 — 긴 접두어 먼저, 모르는 주소는 첫 마디', () => {
  assert.equal(screenNameFor('/'), '첫 화면');
  assert.equal(screenNameFor('/campaigns/flow'), '캠페인');
  assert.equal(screenNameFor('/campaigns'), '캠페인 (이전)');
  assert.equal(screenNameFor('/influencers/performance'), '인플루언서 성과');
  assert.equal(screenNameFor('/w/abc/library'), '보관함');
  assert.equal(screenNameFor('/w/abc'), '덱');
  assert.equal(screenNameFor('/status'), 'status');
});
