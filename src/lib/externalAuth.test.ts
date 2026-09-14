// src/lib/externalAuth.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bearerMatches } from './externalAuth.ts';

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
