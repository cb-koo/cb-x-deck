import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTab, mergeQuery, tabQuery, TAB_KEYS, TAB_LABEL, DEFAULT_TAB } from './profileTabs.ts';

const params = (q: string) => Object.fromEntries(new URLSearchParams(q));

test('parseTab: 유효 키는 그대로, 그 외는 account', () => {
  assert.equal(parseTab('deal'), 'deal');
  assert.equal(parseTab('content'), 'content');
  assert.equal(parseTab('account'), 'account');
  assert.equal(parseTab('nope'), 'account');
  assert.equal(parseTab(null), 'account');
  assert.equal(parseTab(undefined), 'account');
});

test('상수', () => {
  assert.deepEqual([...TAB_KEYS], ['account', 'content', 'deal']);
  assert.equal(TAB_LABEL.content, '협업 콘텐츠');
  assert.equal(DEFAULT_TAB, 'account');
});

test('mergeQuery: 다른 파라미터를 보존하며 set/delete', () => {
  assert.deepEqual(params(mergeQuery('i=abc', { tab: 'deal' })), { i: 'abc', tab: 'deal' });
  assert.deepEqual(params(mergeQuery('i=abc&tab=deal', { tab: null })), { i: 'abc' });
  assert.deepEqual(params(mergeQuery('tab=deal', { i: 'xyz' })), { tab: 'deal', i: 'xyz' });
  assert.equal(mergeQuery('tab=deal', { tab: null }), '');           // 비면 빈 문자열(호출자가 pathname만 쓴다)
});

test('tabQuery: 기본 탭은 URL에서 지운다', () => {
  assert.deepEqual(params(tabQuery('i=abc&tab=deal', 'account')), { i: 'abc' });
  assert.deepEqual(params(tabQuery('i=abc', 'content')), { i: 'abc', tab: 'content' });
});
