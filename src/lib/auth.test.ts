import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedEmail, isAllowedUser } from './auth.ts';

test('회사 도메인만 허용', () => {
  assert.equal(isAllowedEmail('a@clinicbridge.co.kr'), true);
  assert.equal(isAllowedEmail('A.B@Clinicbridge.CO.KR'), true); // 대소문자 무시
  assert.equal(isAllowedEmail('a@gmail.com'), false);
  assert.equal(isAllowedEmail('a@sub.clinicbridge.co.kr'), false); // 서브도메인 불허
  assert.equal(isAllowedEmail('clinicbridge.co.kr'), false); // @ 없음
  assert.equal(isAllowedEmail(null), false);
  assert.equal(isAllowedEmail(undefined), false);
  assert.equal(isAllowedEmail(''), false);
});

test('isAllowedUser: 구글+회사도메인만 허용', () => {
  assert.equal(
    isAllowedUser({
      email: 'a@clinicbridge.co.kr',
      app_metadata: { provider: 'google', providers: ['google'] },
    }),
    true,
  );
  assert.equal(
    isAllowedUser({
      email: 'a@clinicbridge.co.kr',
      app_metadata: { provider: 'email', providers: ['email'] },
    }),
    false,
  );
  assert.equal(
    isAllowedUser({
      email: 'a@gmail.com',
      app_metadata: { provider: 'google', providers: ['google'] },
    }),
    false,
  );
  assert.equal(
    isAllowedUser({
      email: 'a@clinicbridge.co.kr',
      app_metadata: { providers: ['google'] },
    }),
    true,
  );
  assert.equal(isAllowedUser(null), false);
});
