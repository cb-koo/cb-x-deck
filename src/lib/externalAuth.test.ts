// src/lib/externalAuth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerMatches, apiKeyMatches } from './externalAuth.ts';

test('bearerMatches — 시크릿이 비어 있으면 어떤 헤더도 통과 못 한다(닫힌 API)', () => {
  assert.equal(bearerMatches('Bearer abc', undefined), false);
  assert.equal(bearerMatches('Bearer abc', ''), false);
});
test('bearerMatches — 정확히 일치만 통과', () => {
  assert.equal(bearerMatches('Bearer s3cret', 's3cret'), true);
  assert.equal(bearerMatches('Bearer s3cre', 's3cret'), false);    // 길이 다름
  assert.equal(bearerMatches('Bearer S3cret', 's3cret'), false);   // 대소문자
  assert.equal(bearerMatches('s3cret', 's3cret'), false);          // Bearer 접두어 없음
  assert.equal(bearerMatches(null, 's3cret'), false);
});

test('apiKeyMatches — 시크릿이 비어 있으면 어떤 헤더도 통과 못 한다(닫힌 API)', () => {
  assert.equal(apiKeyMatches('abc', undefined), false);
  assert.equal(apiKeyMatches('abc', ''), false);
  assert.equal(apiKeyMatches(null, undefined), false);
});
test('apiKeyMatches — Bearer 접두어 없이 키 값 그대로, 정확히 일치만 통과', () => {
  assert.equal(apiKeyMatches('s3cret', 's3cret'), true);
  assert.equal(apiKeyMatches('s3cre', 's3cret'), false);           // 길이 다름
  assert.equal(apiKeyMatches('S3cret', 's3cret'), false);          // 대소문자
  assert.equal(apiKeyMatches('Bearer s3cret', 's3cret'), false);   // 접두어를 붙이면 안 된다
  assert.equal(apiKeyMatches(null, 's3cret'), false);
});
