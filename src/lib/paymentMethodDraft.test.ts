// src/lib/paymentMethodDraft.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { methodDraftOf, methodInputOf, parseMethodDraft, newMethodIdOf } from './paymentMethodDraft.ts';

test('1) 새 수단 기본값 — 유형은 목록 첫 번째, 통화는 엔화, 수수료는 인플 부담', () => {
  const d = methodDraftOf(null);
  assert.equal(d.type, 'paypal'); assert.equal(d.currency, 'JPY'); assert.equal(d.feeMode, 'none'); assert.equal(d.makeDefault, false);
});

test('2) 폼 값 → 검증 — 서버와 같은 parsePaymentMethodInput을 지난다(문구도 같다)', () => {
  const ok = parseMethodDraft({ ...methodDraftOf(null), holder: 'Sakura', email: 's@x.com' });
  assert.ok(typeof ok !== 'string' && ok.type === 'paypal' && ok.email === 's@x.com');
  assert.equal(parseMethodDraft({ ...methodDraftOf(null), holder: '' }), '수취인명을 입력해 주세요');
  // 고정액 칸을 비우면 0원이 아니라 '안 적음' — 검증에서 걸린다
  assert.equal(typeof parseMethodDraft({ ...methodDraftOf(null), holder: 'S', email: 's@x.com', feeMode: 'fixed', feeAmount: '' }), 'string');
  assert.deepEqual((methodInputOf({ ...methodDraftOf(null), feeMode: 'grossUp', feePercent: '3' }) as { fee: unknown }).fee, { mode: 'grossUp', percent: 3 });
});

test('3) 등록 뒤 새 수단 id — 응답 배열을 등록 전 id와 비교해 찾는다', () => {
  assert.equal(newMethodIdOf(['a'], [{ id: 'a' }, { id: 'b' }]), 'b');
  assert.equal(newMethodIdOf([], [{ id: 'a' }]), 'a');
  assert.equal(newMethodIdOf(['a'], [{ id: 'a' }]), null);
});
