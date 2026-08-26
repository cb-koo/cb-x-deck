import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags, textsChanged, idSetChanged, newDraftsSince, filterDrafts, statusCounts, variantLabel, siblingCount } from './draftUi.ts';
import type { DraftContent } from './draftTypes.ts';
import type { DraftStatus } from './draftStatus.ts';

test('hookBoundary: 첫 빈 줄에서 분리, 없으면 null', () => {
  const b = hookBoundary('正直迷ってた。\n\nでも良かった。');
  assert.equal(b!.hook, '正直迷ってた。');
  assert.equal(b!.rest, 'でも良かった。');
  assert.equal(hookBoundary('한 단락뿐'), null);
  assert.equal(hookBoundary(''), null);
  assert.equal(hookBoundary('끝에만 빈 줄\n\n'), null);
});

test('draftCopyText: 단문=본문 그대로, 스레드=--- 구분', () => {
  assert.equal(draftCopyText({ posts: [{ text: 'A', media: [] }] }), 'A');
  assert.equal(
    draftCopyText({ posts: [{ text: '1番', media: [] }, { text: '2番', media: [] }] }),
    '1番\n\n---\n\n2番');
});

test('draftTimeLabel: 방금/분/시간 구간', () => {
  const now = Date.now();
  assert.equal(draftTimeLabel(new Date(now - 30_000).toISOString()), '방금');
  assert.equal(draftTimeLabel(new Date(now - 5 * 60_000).toISOString()), '5분');
  assert.equal(draftTimeLabel(new Date(now - 3 * 3600_000).toISOString()), '3시간');
});

// 24시간이 넘으면 상대 표기를 버리고 달력 날짜로 떨어지는데, 여기가 예전엔 브라우저 로컬 시간대였다.
// UTC로는 7/6 23:29지만 한국에서는 7/7 08:29 — 한국 기준으로 찍혀야 한다.
test('draftTimeLabel: 24시간이 넘으면 한국 날짜로 떨어진다', () => {
  // 미래 시각을 쓰면 경과 초가 음수라 '방금'으로 떨어져 이 분기를 못 탄다 — 반드시 과거 시각으로 둔다.
  // 연말 걸침 같은 달력 경계는 kstMonthDayKo 쪽(datetime.test.ts)이 이미 고정하고 있다.
  assert.equal(draftTimeLabel('2026-07-06T23:29:44.000Z'), '7월 7일');
});

test('collectDraftFlags: post별 표식 + dismissed 판정 + 중복 제거', () => {
  const content: DraftContent = {
    posts: [{ text: '効果がある。効果がある。', media: [] }, { text: 'B클리닉より', media: [] }],
  };
  const flags = collectDraftFlags(content, ['B클리닉'], ['yakkiho:効果がある']);
  const p0 = flags.filter((f) => f.postIndex === 0);
  assert.equal(p0.length, 1);                       // 같은 post 안 중복 제거
  assert.equal(p0[0].dismissed, true);              // dismissed 반영
  const p1 = flags.filter((f) => f.postIndex === 1);
  assert.ok(p1.some((f) => f.flag.kind === 'banned' && !f.dismissed));
});

test('textsChanged — 본문 배열이 하나라도 다르면 dirty', () => {
  assert.equal(textsChanged(['a', 'b'], ['a', 'b']), false);
  assert.equal(textsChanged(['a', 'b'], ['a', 'c']), true);
  assert.equal(textsChanged(['a'], ['a', '']), true);   // 길이 차이도 dirty
  assert.equal(textsChanged([], []), false);            // 빈 배열끼리는 안 변함
});

test('idSetChanged — 순서 무관 집합 비교', () => {
  assert.equal(idSetChanged(['1', '2'], ['2', '1']), false); // 순서만 다름 = 안 변함
  assert.equal(idSetChanged(['1'], ['1', '2']), true);
  assert.equal(idSetChanged(['1', '3'], ['1', '2']), true);
  assert.equal(idSetChanged([], []), false);
});

test('newDraftsSince — 모르는 id이면서 기준 시각 이후인 것만', () => {
  const cur = [{ id: 'a', createdAt: '2026-08-06T10:00:00Z' }];
  const fetched = [
    { id: 'b', createdAt: '2026-08-06T10:05:00Z' },  // 새 것 — 포함
    { id: 'a', createdAt: '2026-08-06T10:00:00Z' },  // 이미 있음 — 제외
    { id: 'c', createdAt: '2026-08-06T09:00:00Z' },  // 기준 이전(예: 삭제 대기 중인 옛 초안) — 제외
    { id: 'd', createdAt: '2026-08-06T10:01:00Z' },  // 기준 시각과 정확히 같음 — 포함(>=)
  ];
  const since = Date.parse('2026-08-06T10:01:00Z');
  assert.deepEqual(newDraftsSince(cur, fetched, since).map((d) => d.id), ['b', 'd']);
});

test('filterDrafts — 상태·클라이언트·캠페인 AND 조합', () => {
  const drafts = [
    { status: 'review' as DraftStatus, clientId: 'c1', campaignId: 'k1' },
    { status: 'review' as DraftStatus, clientId: 'c2', campaignId: null },
    { status: 'draft' as DraftStatus, clientId: null, campaignId: 'k1' },
  ];
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '', campaignId: '' }).length, 3);
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: '', campaignId: '' }).length, 2);
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: 'c1', campaignId: '' }).length, 1);
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: 'none', campaignId: '' }).length, 1); // 클라이언트 없음
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '', campaignId: 'k1' }).length, 2);
  assert.equal(filterDrafts(drafts, { status: 'all', clientId: '', campaignId: 'none' }).length, 1);  // 캠페인 없음
  assert.equal(filterDrafts(drafts, { status: 'review', clientId: 'c1', campaignId: 'none' }).length, 0);
});

test('statusCounts — 상태별 건수', () => {
  const counts = statusCounts([
    { status: 'draft' }, { status: 'draft' }, { status: 'delivered' },
  ]);
  assert.equal(counts.draft, 2);
  assert.equal(counts.delivered, 1);
  assert.equal(counts.review, 0);
});

test('variantLabel — 0부터 A·B·C…', () => {
  assert.equal(variantLabel(0), 'A');
  assert.equal(variantLabel(1), 'B');
  assert.equal(variantLabel(4), 'E');
});

test('siblingCount — 같은 batch만 센다 (삭제되면 정직하게 줄어듦)', () => {
  const drafts = [
    { batchId: 'b1' }, { batchId: 'b1' }, { batchId: 'b2' }, { batchId: null },
  ];
  assert.equal(siblingCount(drafts, 'b1'), 2);
  assert.equal(siblingCount(drafts, 'b2'), 1);
});
