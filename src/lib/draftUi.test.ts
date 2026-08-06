import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hookBoundary, draftCopyText, draftTimeLabel, collectDraftFlags, textsChanged, idSetChanged, newDraftsSince } from './draftUi.ts';
import type { DraftContent } from './draftTypes.ts';

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
  ];
  const since = Date.parse('2026-08-06T10:01:00Z');
  assert.deepEqual(newDraftsSince(cur, fetched, since).map((d) => d.id), ['b']);
});
