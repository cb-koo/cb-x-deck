import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuidLike } from './uuid.ts';

test('isUuidLike: UUID 형식 판별', () => {
  assert.equal(isUuidLike('123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(isUuidLike('123E4567-E89B-12D3-A456-426614174000'), true); // 대소문자 무관
  assert.equal(isUuidLike('abc'), false);
  assert.equal(isUuidLike(''), false);
  assert.equal(isUuidLike('123e4567-e89b-12d3-a456-42661417400g'), false); // g는 hex 아님
});
