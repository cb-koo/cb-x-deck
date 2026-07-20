import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedEmail } from './auth.ts';

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
