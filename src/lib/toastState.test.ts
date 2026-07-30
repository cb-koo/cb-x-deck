import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialToastState, toastReducer, visibleToast, type ToastSpec } from './toastState.ts';

const UNDO: ToastSpec = { message: '팀 보관함에서 뺐어요', actionLabel: '실행취소', dismissible: false };
const COPIED: ToastSpec = { message: '링크를 복사했어요', dismissible: true };

test('일시 토스트가 지속 토스트를 가린다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  assert.equal(visibleToast(s), UNDO);
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  assert.equal(visibleToast(s), COPIED);
});

test('일시 토스트가 만료되면 지속 토스트가 다시 드러난다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'expireTransient' });
  assert.equal(visibleToast(s), UNDO, '실행취소 기회가 복사 토스트에 먹혀서는 안 된다');
});

test('일시 토스트 만료 시 지속 토스트가 없으면 아무것도 안 보인다', () => {
  let s = toastReducer(initialToastState, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'expireTransient' });
  assert.equal(visibleToast(s), null);
});

test('hidePersistent는 일시 토스트를 건드리지 않는다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'hidePersistent' });
  assert.equal(visibleToast(s), COPIED);
  s = toastReducer(s, { type: 'expireTransient' });
  assert.equal(visibleToast(s), null, '지속 토스트가 내려간 뒤엔 되살아나지 않는다');
});

test('dismissVisible은 표시 중인 슬롯만 비운다', () => {
  let s = toastReducer(initialToastState, { type: 'showPersistent', toast: UNDO });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  s = toastReducer(s, { type: 'dismissVisible' });
  assert.equal(visibleToast(s), UNDO, '일시 토스트를 닫아도 지속 토스트는 남는다');
  s = toastReducer(s, { type: 'dismissVisible' });
  assert.equal(visibleToast(s), null);
});

test('일시 토스트끼리는 마지막 것이 이긴다', () => {
  const ERR: ToastSpec = { message: '순서를 저장하지 못했어요', dismissible: true };
  let s = toastReducer(initialToastState, { type: 'showTransient', toast: ERR });
  s = toastReducer(s, { type: 'showTransient', toast: COPIED });
  assert.equal(visibleToast(s), COPIED);
});

test('seq는 전이마다 증가한다 — 같은 문구 반복 시 aria-live 재고지용', () => {
  const s0 = initialToastState;
  const s1 = toastReducer(s0, { type: 'showTransient', toast: COPIED });
  const s2 = toastReducer(s1, { type: 'showTransient', toast: COPIED });
  assert.ok(s1.seq > s0.seq);
  assert.ok(s2.seq > s1.seq, '같은 메시지를 다시 띄우면 key가 바뀌어야 스크린리더가 다시 읽는다');
});
