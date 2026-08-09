import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { sanitizeOverrides, getPromptOverrides, savePromptOverrides, listPromptVersions } from './promptSettings.ts';
import { PROMPT_DEFAULTS } from './generatePrompt.ts';

const sql = getSql();
const MARK = `test-pt-${process.pid}`;

after(async () => {
  // 공유 DB(로컬=프로덕션) — 테스트 행이 잠깐 "최신 템플릿"이 되므로 반드시 정리 (clientStore 테스트와 같은 관례)
  await sql`delete from prompt_template_version where overrides->>'hook' like ${MARK + '%'}`;
  await sql.end();
});

test('sanitize: 형식 위반은 null, 기본값·빈 값은 버림', () => {
  assert.equal(sanitizeOverrides(null), null);
  assert.equal(sanitizeOverrides([]), null);
  assert.equal(sanitizeOverrides({ unknown: 'x' }), null);
  assert.equal(sanitizeOverrides({ hook: 123 }), null);
  assert.equal(sanitizeOverrides({ hook: 'a'.repeat(2001) }), null);
  assert.deepEqual(sanitizeOverrides({ hook: PROMPT_DEFAULTS.hook, system: '  ' }), {});
  assert.deepEqual(sanitizeOverrides({ hook: '커스텀 훅' }), { hook: '커스텀 훅' });
});

test('저장 → 최신 반영, 이력은 최신순 + 멤버 없으면 null', async () => {
  await savePromptOverrides(sql, { hook: `${MARK} 훅1` }, null);
  await savePromptOverrides(sql, { hook: `${MARK} 훅2` }, null);
  const cur = await getPromptOverrides(sql);
  assert.equal(cur.hook, `${MARK} 훅2`);
  const versions = await listPromptVersions(sql, 5);
  assert.equal(versions[0].overrides.hook, `${MARK} 훅2`);
  assert.equal(versions[1].overrides.hook, `${MARK} 훅1`);
  assert.equal(versions[0].memberName, null);
  assert.ok(versions[0].createdAt.endsWith('Z'));
});
