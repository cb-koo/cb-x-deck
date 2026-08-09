import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setNavGuard, interceptNav } from './navGuard.ts';

test('navGuard: 가드가 없으면 통과(false)', () => {
  assert.equal(interceptNav('/w/abc'), false);
});

test('navGuard: 가드가 true면 차단 + href 전달, cleanup 후 통과', () => {
  const seen: string[] = [];
  const cleanup = setNavGuard((href) => { seen.push(href); return true; });
  assert.equal(interceptNav('/w/abc'), true);
  assert.deepEqual(seen, ['/w/abc']);
  cleanup();
  assert.equal(interceptNav('/w/abc'), false);
});

test('navGuard: 가드가 false면 통과 — 이동은 호출측이 계속 진행', () => {
  const cleanup = setNavGuard(() => false);
  assert.equal(interceptNav('/generate'), false);
  cleanup();
});

test('navGuard: 낡은 cleanup이 새 가드를 지우지 않는다', () => {
  const oldCleanup = setNavGuard(() => true);
  const newCleanup = setNavGuard(() => true);
  oldCleanup(); // 이미 교체된 가드의 cleanup은 no-op
  assert.equal(interceptNav('/x'), true);
  newCleanup();
  assert.equal(interceptNav('/x'), false);
});
