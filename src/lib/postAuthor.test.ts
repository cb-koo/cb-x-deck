import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgePostAuthor, authorVerdictMessage, firstAssignMismatchMessage } from './postAuthor.ts';

// ── judgePostAuthor — 판정 순서: 미배정 → 조회 실패 → 고유번호 비교 → 핸들 비교(대소문자 무시) ──

test('unassigned: 배정 핸들이 없으면 작성자 조회 성공 여부와 무관하게 unassigned', () => {
  const v = judgePostAuthor({ author: { handle: 'a', userId: '1' }, assigned: { handle: null, xUserId: null } });
  assert.deepEqual(v, { kind: 'unassigned' });
});

test('unverified: 작성자 조회 실패(author null)면 배정이 있어도 unverified', () => {
  const v = judgePostAuthor({ author: null, assigned: { handle: 'a', xUserId: null } });
  assert.deepEqual(v, { kind: 'unverified' });
});

test('ok: 고유번호가 같으면 핸들이 달라도 ok — coco 사례(핸들 변경)', () => {
  const v = judgePostAuthor({
    author: { handle: 'coco__ns_5', userId: '111' },
    assigned: { handle: 'coco_______5', xUserId: '111' },
  });
  assert.deepEqual(v, { kind: 'ok' });
});

test('mismatch: 고유번호가 다르면 핸들이 같아도 mismatch', () => {
  const v = judgePostAuthor({
    author: { handle: 'same', userId: '111' },
    assigned: { handle: 'same', xUserId: '222' },
  });
  assert.deepEqual(v, { kind: 'mismatch', authorHandle: 'same', assignedHandle: 'same' });
});

test('ok: 고유번호가 없으면 핸들을 대소문자 무시로 비교', () => {
  const v = judgePostAuthor({
    author: { handle: 'SomeOne', userId: null },
    assigned: { handle: 'someone', xUserId: null },
  });
  assert.deepEqual(v, { kind: 'ok' });
});

test('mismatch: 고유번호 없고 핸들도 다르면 mismatch', () => {
  const v = judgePostAuthor({
    author: { handle: 'alice', userId: null },
    assigned: { handle: 'bob', xUserId: null },
  });
  assert.deepEqual(v, { kind: 'mismatch', authorHandle: 'alice', assignedHandle: 'bob' });
});

test('ok: 한쪽만 고유번호가 있으면(둘 다는 아님) 핸들 비교로 폴백', () => {
  const v1 = judgePostAuthor({
    author: { handle: 'alice', userId: '111' },
    assigned: { handle: 'alice', xUserId: null }, // 명부에 고유번호 미저장
  });
  assert.deepEqual(v1, { kind: 'ok' });

  const v2 = judgePostAuthor({
    author: { handle: 'alice', userId: null },
    assigned: { handle: 'alice', xUserId: '111' },
  });
  assert.deepEqual(v2, { kind: 'ok' });
});

test('unverified: 작성자 핸들도 고유번호도 없으면 확인 불가', () => {
  const v = judgePostAuthor({
    author: { handle: null, userId: null },
    assigned: { handle: 'alice', xUserId: null },
  });
  assert.deepEqual(v, { kind: 'unverified' });
});

test('unverified: 작성자 핸들이 없고 둘 다 고유번호가 있는 조합도 아니면 확인 불가(고유번호 한쪽만)', () => {
  const v = judgePostAuthor({
    author: { handle: null, userId: '111' },
    assigned: { handle: 'alice', xUserId: null }, // 명부에 고유번호 없음 → 아이디 비교 불가 → 핸들 비교 폴백 → 작성자 핸들 없음
  });
  assert.deepEqual(v, { kind: 'unverified' });
});

test('핸들 비교는 앞의 @를 무시한다', () => {
  const v = judgePostAuthor({
    author: { handle: '@alice', userId: null },
    assigned: { handle: 'alice', xUserId: null },
  });
  assert.deepEqual(v, { kind: 'ok' });
});

// ── authorVerdictMessage — 문구(spec §4)와 code ──

test('mismatch 문구·code', () => {
  const m = authorVerdictMessage({ kind: 'mismatch', authorHandle: 'writer', assignedHandle: 'assignee' });
  assert.equal(m.error, '이 게시물은 @writer의 글이에요. 이 작업의 인플은 @assignee이에요 — 링크를 확인해 주세요');
  assert.equal(m.code, 'author-mismatch');
});

test('mismatch 문구는 핸들에 이미 @가 있어도 @를 두 번 붙이지 않는다', () => {
  const m = authorVerdictMessage({ kind: 'mismatch', authorHandle: '@writer', assignedHandle: '@assignee' });
  assert.equal(m.error, '이 게시물은 @writer의 글이에요. 이 작업의 인플은 @assignee이에요 — 링크를 확인해 주세요');
});

test('unverified 문구·code', () => {
  const m = authorVerdictMessage({ kind: 'unverified' });
  assert.equal(m.error, '게시물 작성자를 확인하지 못했어요 — 링크가 맞는지 보고 잠시 후 다시 시도해 주세요');
  assert.equal(m.code, 'author-unverified');
});

test('unassigned 문구·code', () => {
  const m = authorVerdictMessage({ kind: 'unassigned' });
  assert.equal(m.error, '인플을 먼저 배정해 주세요 — 누구의 게시물인지 확인할 수 없어요');
  assert.equal(m.code, 'task-unassigned');
});

// ── firstAssignMismatchMessage — §4 ⑤ 문구(최초 배정 거절) ──

test('firstAssignMismatchMessage 문구', () => {
  assert.equal(
    firstAssignMismatchMessage('writer'),
    '이 작업에 붙은 게시물은 @writer의 글이에요 — 그 인플로 배정해 주세요',
  );
});

test('firstAssignMismatchMessage도 @ 중복을 막는다', () => {
  assert.equal(
    firstAssignMismatchMessage('@writer'),
    '이 작업에 붙은 게시물은 @writer의 글이에요 — 그 인플로 배정해 주세요',
  );
});
