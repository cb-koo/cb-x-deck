import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWatchlistAccount } from './watchlistAccount.ts';

// 호출 횟수를 세는 스텁 — "유료 API를 부르지 않는다"는 규칙은 반환값이 아니라
// 호출 여부로만 검증되므로, 이 카운터가 이 파일에서 가장 중요한 단정이다.
function stubLookup(result: { id: string; userName: string } | Error) {
  const calls: string[] = [];
  const lookup = async (handle: string) => {
    calls.push(handle);
    if (result instanceof Error) throw result;
    return result;
  };
  return { lookup, calls };
}

test('형식이 틀린 입력은 400이고 유료 조회를 부르지 않는다', async () => {
  const { lookup, calls } = stubLookup({ id: '1', userName: 'x' });
  const r = await resolveWatchlistAccount('https://x.com/i/status/1790123456789', lookup);
  assert.deepEqual(r, { ok: false, status: 400, error: '계정을 알 수 없는 주소예요 — x.com/계정명 형태의 링크나 @핸들을 넣어주세요' });
  assert.deepEqual(calls, []);
});

test('빈 입력도 400이고 조회를 부르지 않는다', async () => {
  const { lookup, calls } = stubLookup({ id: '1', userName: 'x' });
  const r = await resolveWatchlistAccount('   ', lookup);
  assert.deepEqual(r, { ok: false, status: 400, error: '계정 핸들이나 프로필 링크를 넣어주세요' });
  assert.deepEqual(calls, []);
});

test('정상 입력은 정규화한 핸들로 1회 조회하고 X의 정본 표기를 돌려준다', async () => {
  const { lookup, calls } = stubLookup({ id: '44196397', userName: 'hadakan__' });
  const r = await resolveWatchlistAccount('https://x.com/HadaKan__?s=21', lookup);
  assert.deepEqual(r, { ok: true, handle: 'hadakan__', userId: '44196397' });
  assert.deepEqual(calls, ['HadaKan__']); // 조회는 사용자 표기로, 저장은 정본 표기로
});

test('조회 결과에 id가 없으면 404', async () => {
  const { lookup } = stubLookup({ id: '', userName: 'nope' });
  const r = await resolveWatchlistAccount('@nope', lookup);
  assert.deepEqual(r, { ok: false, status: 404, error: '계정을 찾을 수 없음: @nope' });
});

test('조회가 실패하면 502에 원인을 붙인다', async () => {
  const { lookup } = stubLookup(new Error('rate limited'));
  const r = await resolveWatchlistAccount('@hadakan__', lookup);
  assert.deepEqual(r, { ok: false, status: 502, error: '계정 확인 실패: rate limited' });
});

// 아래 세 개가 PATCH 경로의 핵심 — 지금까지 테스트가 없던 규칙이다.
test('이미 저장된 계정과 대소문자만 다르면 조회하지 않고 저장된 값을 그대로 쓴다', async () => {
  const { lookup, calls } = stubLookup({ id: 'WRONG', userName: 'WRONG' });
  const r = await resolveWatchlistAccount('HadaKan__', lookup, { handle: 'hadakan__', userId: '44196397' });
  assert.deepEqual(r, { ok: true, handle: 'hadakan__', userId: '44196397' });
  assert.deepEqual(calls, []);
});

test('링크 표기만 다른 경우도 같은 계정으로 보고 조회하지 않는다', async () => {
  const { lookup, calls } = stubLookup({ id: 'WRONG', userName: 'WRONG' });
  const r = await resolveWatchlistAccount('https://x.com/hadakan__/status/1790123456789', lookup,
    { handle: 'hadakan__', userId: '44196397' });
  assert.deepEqual(r, { ok: true, handle: 'hadakan__', userId: '44196397' });
  assert.deepEqual(calls, []);
});

// userId를 반드시 저장된 값으로 돌려줘야 하는 이유: config는 통째로 교체되고
// 트윗 조회는 userId로 키를 잡으므로, 클라이언트가 실어 보낸 값을 믿으면
// 제목은 @hadakan__인데 다른 계정 타임라인이 실리는 상태가 만들어진다.
test('건너뛰기 경로는 클라이언트가 보낸 userId를 믿지 않는다', async () => {
  const { lookup, calls } = stubLookup({ id: 'WRONG', userName: 'WRONG' });
  const r = await resolveWatchlistAccount('@hadakan__', lookup, { handle: 'hadakan__', userId: '44196397' });
  assert.equal(r.ok && r.userId, '44196397');
  assert.deepEqual(calls, []);
});

test('실제로 다른 계정이면 조회해서 새 값으로 바꾼다', async () => {
  const { lookup, calls } = stubLookup({ id: '999', userName: 'other' });
  const r = await resolveWatchlistAccount('@other', lookup, { handle: 'hadakan__', userId: '44196397' });
  assert.deepEqual(r, { ok: true, handle: 'other', userId: '999' });
  assert.deepEqual(calls, ['other']);
});

test('저장된 계정이 없으면(신규 생성) 항상 조회한다', async () => {
  const { lookup, calls } = stubLookup({ id: '1', userName: 'hadakan__' });
  await resolveWatchlistAccount('@hadakan__', lookup);
  await resolveWatchlistAccount('@hadakan__', lookup, null);
  assert.deepEqual(calls, ['hadakan__', 'hadakan__']);
});
