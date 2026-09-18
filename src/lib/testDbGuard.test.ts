import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDbTarget } from './testDbGuard.ts';

// npm test는 연습용(스테이징) DB에서 돌아야 한다 — 운영 DB에 붙으면 테스트가 만든 데이터가 실제 화면에 섞인다
// (2026-08 가짜 팀원 15개가 보관함 필터에 노출, 2026-09-09 픽스처가 정산 프로덕트로 유출).
const PROD = 'postgres.xdwtehjlxsnntsuizxba';
const STAGING = 'postgres.zatrinmwpqarjhkarubj';

test('운영 DB를 가리키면 막는다', () => {
  const r = testDbTarget({ PGUSER: PROD });
  assert.equal(r.kind, 'blocked');
  assert.match(r.message, /운영/);
});

test('연습용 DB면 통과', () => {
  assert.equal(testDbTarget({ PGUSER: STAGING }).kind, 'ok');
});

test('접속 정보가 없으면 무엇을 해야 하는지 알려준다', () => {
  const r = testDbTarget({});
  assert.equal(r.kind, 'blocked');
  assert.match(r.message, /\.env\.staging/);
});

test('SUPABASE_URL에만 운영 ref가 있어도 막는다 — 두 값이 어긋난 설정 파일을 잡는다', () => {
  const r = testDbTarget({ PGUSER: STAGING, SUPABASE_URL: 'https://xdwtehjlxsnntsuizxba.supabase.co' });
  assert.equal(r.kind, 'blocked');
});

test('알고 하는 예외 — ALLOW_PROD_TESTS=on 이면 운영도 통과', () => {
  assert.equal(testDbTarget({ PGUSER: PROD, ALLOW_PROD_TESTS: 'on' }).kind, 'ok');
});
