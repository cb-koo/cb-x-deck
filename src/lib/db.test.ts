import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql, getUsageSql } from './db.ts';

// 연결 자체는 lazy(첫 쿼리 전까지 소켓 없음)라 DB 없이도 인스턴스 동일성만 검증한다.
after(async () => {
  await getSql().end();
  await getUsageSql().end();
});

test('앱 풀과 사용량 풀은 서로 다른 인스턴스 — fire-and-forget insert가 앱 커넥션을 뺏지 않게', () => {
  assert.notStrictEqual(getSql(), getUsageSql());
});

test('getSql / getUsageSql: 각각 메모이즈되어 같은 인스턴스를 재사용', () => {
  assert.strictEqual(getSql(), getSql());
  assert.strictEqual(getUsageSql(), getUsageSql());
});
