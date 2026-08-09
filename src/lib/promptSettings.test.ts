import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type postgres from 'postgres';
import { getSql } from './db.ts';
import { sanitizeOverrides, getPromptOverrides, savePromptOverrides, listPromptVersions } from './promptSettings.ts';
import { PROMPT_DEFAULTS } from './generatePrompt.ts';

const sql = getSql();

// 이 테이블은 최신 행 = 팀 전역 설정이라, 커밋되는 테스트 행은 그 순간 실제 생성에 반영된다.
// 트랜잭션 안에서 검증하고 강제 롤백해 프로덕션 오염 창을 0으로 만든다.
const ROLLBACK = Symbol('rollback');
async function inRollback(fn: (tx: postgres.Sql) => Promise<void>) {
  await sql.begin(async (tx) => { await fn(tx as unknown as postgres.Sql); throw ROLLBACK; })
    .catch((e) => { if (e !== ROLLBACK) throw e; });
}

test('sanitize: 형식 위반은 null, 기본값·빈 값은 버림', () => {
  assert.equal(sanitizeOverrides(undefined), null);
  assert.equal(sanitizeOverrides(null), null);
  assert.equal(sanitizeOverrides([]), null);
  assert.equal(sanitizeOverrides({ unknown: 'x' }), null);
  assert.equal(sanitizeOverrides({ hook: 123 }), null);
  assert.equal(sanitizeOverrides({ hook: 'a'.repeat(2001) }), null);
  assert.deepEqual(sanitizeOverrides({ hook: PROMPT_DEFAULTS.hook, system: '  ' }), {});
  assert.deepEqual(sanitizeOverrides({ hook: '커스텀 훅' }), { hook: '커스텀 훅' });
});

test('저장 → 최신 반영, 이력 최신순 (롤백 하네스 — 커밋 없음)', async () => {
  await inRollback(async (tx) => {
    await savePromptOverrides(tx, { hook: '롤백 훅1' }, null);
    // 같은 트랜잭션 안은 now()가 동일해 created_at이 같다 — 첫 행을 1초 뒤로 물려 순서를 확정
    await tx`update prompt_template_version set created_at = created_at - interval '1 second'
             where overrides->>'hook' = '롤백 훅1'`;
    await savePromptOverrides(tx, { hook: '롤백 훅2' }, null);
    const cur = await getPromptOverrides(tx);
    assert.equal(cur.hook, '롤백 훅2');
    const versions = await listPromptVersions(tx, 5);
    assert.equal(versions[0].overrides.hook, '롤백 훅2');
    const idx1 = versions.findIndex((v) => v.overrides.hook === '롤백 훅1');
    assert.ok(idx1 > 0, '훅1이 훅2보다 뒤(과거)에 있어야 함');
    assert.equal(versions[0].memberName, null);
    assert.ok(versions[0].createdAt.endsWith('Z'));
  });
});

test('롤백 후 커밋된 잔존물이 없다', async () => {
  const rows = await sql`select id from prompt_template_version where overrides->>'hook' like '롤백 훅%'`;
  assert.equal(rows.length, 0);
});

after(() => sql.end());
