import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientNameCore, findSimilarClients } from './similarClients.ts';

const EXISTING = [
  '마인드스킨클리닉', '미모드림', '닥터손유나클리닉', '더스퀘어치과', '백수약국', '가은치유한의원',
  '블리비의원', '서울SY피부과', '벤자민클리닉',
].map((name) => ({ name, nameEn: name === '벤자민클리닉' ? 'benjamin' : '' }));
const names = (input: string) => findSimilarClients(input, EXISTING).map((c) => c.name);

test('clientNameCore: 업종 꼬리말을 떼고 공백·기호를 무시한다', () => {
  assert.equal(clientNameCore('벤자민 피부과'), '벤자민');
  assert.equal(clientNameCore('명동벤자민피부과의원'), '명동벤자민');
  assert.equal(clientNameCore('서울SY피부과'), '서울sy');
  assert.equal(clientNameCore('클리닉'), '클리닉'); // 꼬리말만 있으면 원래 이름 그대로
});

test('벤자민피부과를 쓰면 벤자민클리닉이 걸린다 (11-02 실제 사례)', () => {
  assert.deepEqual(names('벤자민피부과'), ['벤자민클리닉']);
  assert.deepEqual(names('명동 벤자민피부과의원'), ['벤자민클리닉']);
  assert.deepEqual(names('Benjamin Clinic'), ['벤자민클리닉']); // 영문 이름으로도
});

test('같은 이름·꼬리말만 다른 이름', () => {
  assert.deepEqual(names('더스퀘어치과'), ['더스퀘어치과']);
  assert.deepEqual(names('더스퀘어 의원'), ['더스퀘어치과']);
  assert.deepEqual(names('가은치유'), ['가은치유한의원']);
});

test('관계없는 이름·너무 짧은 입력은 걸리지 않는다', () => {
  assert.deepEqual(names('리엔장피부과'), []);
  assert.deepEqual(names('벤'), []);
  assert.deepEqual(names('피부과'), []);
  assert.deepEqual(names(''), []);
});
