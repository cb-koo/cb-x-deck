import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTaskProofPath, taskProofOf, TASK_PROOF_PATH_RE, proofUploadedLine } from './taskProofGuard.ts';

const TASK = '11111111-2222-3333-4444-555555555555';
const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OK = `task/${TASK}/${FILE}.png`;

test('경로 — 정상 형태만 통과', () => {
  assert.equal(isTaskProofPath(OK), true);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.jpg`), true);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.jpeg`), true);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.webp`), true);
});

test('경로 — 정상 UI가 만들 수 없는 값은 전부 거절', () => {
  // 추적 픽셀·IP 유출 방어: 임의 URL이 들어오면 워크스페이스 전원의 브라우저가 그 주소로 요청을 보낸다
  assert.equal(isTaskProofPath('https://evil.example/pixel.png'), false);
  assert.equal(isTaskProofPath(`draft/${TASK}/${FILE}.png`), false);      // 원고 버킷 경로
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.gif`), false);       // gif는 허용 형식 아님
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.svg`), false);
  assert.equal(isTaskProofPath(`task/${TASK}/../${FILE}.png`), false);
  assert.equal(isTaskProofPath(`task/${TASK}/${FILE}.png?x=1`), false);
  assert.equal(isTaskProofPath(`task/not-a-uuid/${FILE}.png`), false);
  assert.equal(isTaskProofPath(`TASK/${TASK}/${FILE}.PNG`), false);       // 대문자 경로·확장자 안 만든다
  assert.equal(isTaskProofPath(''), false);
  assert.equal(isTaskProofPath(null), false);
  assert.equal(isTaskProofPath(123), false);
});

test('정규식은 줄 전체를 고정한다 — 앞뒤에 뭘 붙여도 안 통과', () => {
  assert.equal(TASK_PROOF_PATH_RE.test(`x${OK}`), false);
  assert.equal(TASK_PROOF_PATH_RE.test(`${OK}\nhttps://evil.example`), false);
});

test('taskProofOf — jsonb 모양이 보증되지 않으므로 통과분만 돌려준다', () => {
  const good = { url: OK, by: TASK, byName: '박구건', at: '2026-08-31T01:00:00.000Z' };
  assert.deepEqual(taskProofOf(good), good);
  assert.equal(taskProofOf(null), null);
  assert.equal(taskProofOf(undefined), null);
  assert.equal(taskProofOf({ url: 'https://evil.example/a.png', by: null, byName: '', at: '' }), null);
  assert.equal(taskProofOf({ url: OK }), null);                       // 칸이 빠지면 거절
  assert.equal(taskProofOf({ ...good, byName: 42 }), null);
  assert.equal(taskProofOf('문자열'), null);
});

test('taskProofOf — by는 null을 허용한다(멤버가 지워진 경우)', () => {
  const p = { url: OK, by: null, byName: '박구건', at: '2026-08-31T01:00:00.000Z' };
  assert.deepEqual(taskProofOf(p), p);
});

test('proofUploadedLine — 세 화면이 같은 한 줄을 쓴다', () => {
  assert.equal(proofUploadedLine('박구건', '2026-08-31T10:00:00.000Z'), '박구건이 8/31 올림');
  // 이름이 비어 있으면 '누군가'로 대체한다
  assert.equal(proofUploadedLine('', '2026-08-31T10:00:00.000Z'), '누군가가 8/31 올림');
});

test('proofUploadedLine — 주격 조사가 받침에 따라 갈린다(화면에 틀린 말이 나가지 않게)', () => {
  const at = '2026-08-31T10:00:00.000Z';
  assert.match(proofUploadedLine('박구건', at), /^박구건이 /);   // 받침 있음
  assert.match(proofUploadedLine('김서아', at), /^김서아가 /);   // 받침 없음
  assert.match(proofUploadedLine('홍길동', at), /^홍길동이 /);
  assert.match(proofUploadedLine('이수미', at), /^이수미가 /);
  assert.match(proofUploadedLine('koo', at), /^koo가 /);         // 한글이 아니면 '가'
});

test('proofUploadedLine — 한국 오전 9시 이전(=UTC 전날 15~24시)에 올린 증빙이 전날로 안 밀린다(리뷰 수정 2)', () => {
  // 한국 8/30 23:59는 UTC로 8/30 14:59 — 아직 8/30
  assert.equal(proofUploadedLine('박구건', '2026-08-30T14:59:59.000Z'), '박구건이 8/30 올림');
  // 경계 정각: UTC 8/30 15:00 = 한국 8/31 00:00 — 여기서 한국 날짜가 넘어간다
  assert.equal(proofUploadedLine('박구건', '2026-08-30T15:00:00.000Z'), '박구건이 8/31 올림');
  // 한국 8/31 08:00(=UTC 8/30 23:00) — 문자열을 그냥 잘랐다면(.slice(0, 10)) UTC 날짜인 '8/30'으로
  // 전날로 보였을 값. kstMonthDay를 쓰면 올바르게 8/31로 나온다.
  assert.equal(proofUploadedLine('박구건', '2026-08-30T23:00:00.000Z'), '박구건이 8/31 올림');
});
