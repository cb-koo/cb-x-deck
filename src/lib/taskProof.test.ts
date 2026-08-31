import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskProofValidationError, taskProofFilename, MAX_TASK_PROOF_BYTES } from './taskProof.ts';

// node 환경에도 File이 있다(Node 20+). 크기는 내용 길이로 만든다.
const file = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });

test('검증 — 허용 형식만 통과, gif는 거절', () => {
  assert.equal(taskProofValidationError(file('a.png', 'image/png', 10)), null);
  assert.equal(taskProofValidationError(file('a.jpg', 'image/jpeg', 10)), null);
  assert.equal(taskProofValidationError(file('a.webp', 'image/webp', 10)), null);
  assert.equal(
    taskProofValidationError(file('a.gif', 'image/gif', 10)),
    '형식을 지원하지 않아요(jpg·png·webp만 올릴 수 있어요)',
  );
  assert.equal(
    taskProofValidationError(file('a.pdf', 'application/pdf', 10)),
    '형식을 지원하지 않아요(jpg·png·webp만 올릴 수 있어요)',
  );
});

test('검증 — 10MB 경계', () => {
  assert.equal(taskProofValidationError(file('a.png', 'image/png', MAX_TASK_PROOF_BYTES)), null);
  assert.equal(
    taskProofValidationError(file('a.png', 'image/png', MAX_TASK_PROOF_BYTES + 1)),
    '10MB를 넘어요 — 크기를 줄여서 다시 올려주세요',
  );
});

test('파일명 — 게시일·핸들·용도가 보이고, 게시일이 없으면 핸들만', () => {
  assert.equal(
    taskProofFilename({ postedAt: '2026-08-31', influencerHandle: 'someone', url: 'task/x/y.png' }),
    '20260831_someone_RT증빙.png',
  );
  assert.equal(
    taskProofFilename({ postedAt: null, influencerHandle: 'someone', url: 'task/x/y.jpg' }),
    'someone_RT증빙.jpg',
  );
  // 배정이 없으면 화면과 같은 말('미배정'), 파일명 금지문자는 밑줄
  assert.equal(
    taskProofFilename({ postedAt: '2026-08-31', influencerHandle: null, url: 'task/x/y.webp' }),
    '20260831_미배정_RT증빙.webp',
  );
  assert.equal(
    taskProofFilename({ postedAt: null, influencerHandle: 'a/b:c', url: 'task/x/y.png' }),
    'a_b_c_RT증빙.png',
  );
  // 확장자를 못 찾으면 png로 — 파일명이 확장자 없이 나가지 않게
  assert.equal(
    taskProofFilename({ postedAt: null, influencerHandle: 'someone', url: 'task/x/y' }),
    'someone_RT증빙.png',
  );
});
