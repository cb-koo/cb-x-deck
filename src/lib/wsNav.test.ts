import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapWorkspacePath } from './wsNav.ts';

test('swapWorkspacePath: 워크스페이스 안에서는 화면·쿼리를 유지한다', () => {
  assert.equal(swapWorkspacePath('/w/A', '', 'B'), '/w/B');
  assert.equal(swapWorkspacePath('/w/A', '?view=table', 'B'), '/w/B?view=table');
  assert.equal(swapWorkspacePath('/w/A/library', '', 'B'), '/w/B/library');
  assert.equal(swapWorkspacePath('/w/A/research', '?q=%EA%B2%80%EC%83%89', 'B'), '/w/B/research?q=%EA%B2%80%EC%83%89');
  assert.equal(swapWorkspacePath('/w/A/briefing', '', 'B'), '/w/B/briefing');
});

test('swapWorkspacePath: 워크스페이스 밖 경로는 새 워크스페이스의 덱으로', () => {
  assert.equal(swapWorkspacePath('/generate', '', 'B'), '/w/B');
  assert.equal(swapWorkspacePath('/workspaces', '', 'B'), '/w/B');
  assert.equal(swapWorkspacePath('/usage', '?period=7d', 'B'), '/w/B'); // 전역 화면 쿼리는 승계하지 않는다
});
