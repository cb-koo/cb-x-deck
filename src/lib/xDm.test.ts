import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xDmTarget } from './xDm.ts';

test('xDmTarget — 숫자 ID가 있으면 DM(compose?recipient_id), 없거나 이상하면 프로필', () => {
  assert.deepEqual(xDmTarget('mika', '783214'), { kind: 'dm', url: 'https://x.com/messages/compose?recipient_id=783214' });
  assert.deepEqual(xDmTarget('@mika', null), { kind: 'profile', url: 'https://x.com/mika' });
  assert.deepEqual(xDmTarget('mika', ''), { kind: 'profile', url: 'https://x.com/mika' });
  assert.deepEqual(xDmTarget('mika', '12a'), { kind: 'profile', url: 'https://x.com/mika' });   // 숫자가 아니면 주소를 만들지 않는다
});
