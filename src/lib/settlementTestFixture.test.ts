import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTestFixtureHandle, exportIncludesTestFixtures, TEST_FIXTURE_HANDLE_RE, TEST_FIXTURE_HANDLE_PG } from './settlementTestFixture.ts';

test('isTestFixtureHandle — 테스트 접두어+pid+_ 만 픽스처, 실제 핸들은 아님', () => {
  assert.equal(isTestFixtureHandle('tstl12345_pay'), true);
  assert.equal(isTestFixtureHandle('tstpf987_hasproof'), true);
  assert.equal(isTestFixtureHandle('tcmp4321_stl'), true);
  for (const real of ['tstl', 'tstlover', 'tsutaya_jp', 'aik_ooooo', 'b___zooly', '_____noay', '2024_0406', 'tcmp_real', 'tstl_abc']) assert.equal(isTestFixtureHandle(real), false, real);
});
test('픽스처 접두어 목록이 실제로 요청을 만드는 테스트 파일의 P 정의와 맞는다', () => {
  const files = ['src/lib/settlementStore.test.ts', 'src/lib/campaignStore.test.ts', 'src/app/api/external/settlement/requests/[id]/proof/route.test.ts'];
  for (const f of files) {
    const m = readFileSync(f, 'utf8').match(/^const P = '([a-z]+)' \+ process\.pid/m);
    assert.ok(m, `${f}: P 정의를 찾지 못함`);
    assert.equal(isTestFixtureHandle(`${m[1]}123_x`), true, `${f}: 접두어 '${m[1]}'가 TEST_FIXTURE_HANDLE_RE에 없음`);
  }
  // JS 정규식과 postgres 정규식이 같은 접두어 집합을 말한다
  assert.deepEqual(TEST_FIXTURE_HANDLE_RE.source.match(/\(([a-z|]+)\)/)![1].split('|'), TEST_FIXTURE_HANDLE_PG.match(/\(([a-z|]+)\)/)![1].split('|'));
});
test('exportIncludesTestFixtures — 테스트 프로세스 안에서는 true, 서버(env 없음)에서는 false', () => {
  assert.equal(exportIncludesTestFixtures(), true);   // node --test가 NODE_TEST_CONTEXT를 심는다
  const prev = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
  try { assert.equal(exportIncludesTestFixtures(), false); } finally { process.env.NODE_TEST_CONTEXT = prev; }
});
