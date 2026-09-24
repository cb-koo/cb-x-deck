import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRosterInput, rosterSuggestions, findRosterOption, ROSTER_FAILED_MESSAGE, ROSTER_LOADING_MESSAGE } from './rosterPick.ts';

const opts = [
  { id: '1', handle: 'Sakura_jp', name: '사쿠라' },
  { id: '2', handle: 'coco_x', name: 'ココ' },
  { id: '3', handle: 'mika' },
];

test('1) 판정 — 빈 칸·형식 오류·명부 안(명부 표기로)·명부 밖', () => {
  assert.deepEqual(resolveRosterInput('  ', opts, 'ok'), { kind: 'empty' });
  assert.equal(resolveRosterInput('bad handle!', opts, 'ok').kind, 'invalid');
  const r = resolveRosterInput('@sakura_JP', opts, 'ok');
  assert.ok(r.kind === 'roster' && r.handle === 'Sakura_jp');
  const p = resolveRosterInput('https://x.com/Mika', opts, 'ok');   // 프로필 링크 붙여넣기도 같은 판정
  assert.ok(p.kind === 'roster' && p.handle === 'mika');
  assert.deepEqual(resolveRosterInput('coco', opts, 'ok'), { kind: 'outside', handle: 'coco' });
});

test('2) 명부를 아직 못 읽었거나 실패했으면 배정 판정을 하지 않는다 — 형식 오류는 먼저 말한다', () => {
  assert.deepEqual(resolveRosterInput('mika', [], 'loading'), { kind: 'unavailable', message: ROSTER_LOADING_MESSAGE });
  assert.deepEqual(resolveRosterInput('mika', [], 'failed'), { kind: 'unavailable', message: ROSTER_FAILED_MESSAGE });
  assert.equal(resolveRosterInput('bad handle!', [], 'failed').kind, 'invalid');
});

test('3) 후보 — 핸들·이름 부분 일치, 정확히 같은 것 → 앞부분 일치 → 나머지 순, 빈 칸이면 없음, 개수 제한', () => {
  assert.deepEqual(rosterSuggestions(opts, 'co').map((o) => o.handle), ['coco_x']);
  assert.deepEqual(rosterSuggestions(opts, '사쿠').map((o) => o.handle), ['Sakura_jp']);
  assert.deepEqual(rosterSuggestions(opts, ''), []);
  const many = Array.from({ length: 10 }, (_, i) => ({ handle: `aa${i}` }));
  assert.equal(rosterSuggestions(many, 'aa').length, 6);
  assert.deepEqual(rosterSuggestions([{ handle: 'xmika' }, { handle: 'mikan' }, { handle: 'mika' }], 'mika').map((o) => o.handle), ['mika', 'mikan', 'xmika']);
  assert.equal(findRosterOption(opts, 'MIKA')?.id, '3');
});
