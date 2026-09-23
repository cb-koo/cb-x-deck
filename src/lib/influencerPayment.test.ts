import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePaymentMethodInput, applyPaymentOp, describeMethod, formatFee, getDefaultPaymentMethod,
  settlementBadge,
  PAYMENT_TYPE_LABEL, PAYMENT_FIELD_LABEL, PAYMENT_NOT_FOUND,
  type PaymentMethod, type PaymentMethodInput,
} from './influencerPayment.ts';

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `id-${idCounter}`;
}

const NOW = '2026-08-27T00:00:00.000Z';

function bankInput(overrides: Partial<PaymentMethodInput> = {}): PaymentMethodInput {
  return { type: 'bank', holder: '오오쿠보 나나', currency: 'JPY', bank: '미쓰비시UFJ', account: '0441321', ...overrides };
}

function paypalInput(overrides: Partial<PaymentMethodInput> = {}): PaymentMethodInput {
  return { type: 'paypal', holder: 'SAWADA KEIKO', currency: 'JPY', email: 'sawada@example.com', ...overrides };
}

function paypayInput(overrides: Partial<PaymentMethodInput> = {}): PaymentMethodInput {
  return { type: 'paypay', holder: 'A', currency: 'JPY', ...overrides };
}

// ---- parsePaymentMethodInput ----

test('parsePaymentMethodInput: 유형 누락/오류', () => {
  assert.equal(parsePaymentMethodInput({}), '결제 수단 유형을 선택해 주세요');
  assert.equal(parsePaymentMethodInput({ type: 'venmo' }), '결제 수단 유형을 선택해 주세요');
  assert.equal(parsePaymentMethodInput('x'), '입력을 확인해 주세요');
  assert.equal(parsePaymentMethodInput(null), '입력을 확인해 주세요');
});

test('parsePaymentMethodInput: 수취인명 필수 1~80자', () => {
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: '', currency: 'KRW', bank: '신한', account: '1' }), '수취인명을 입력해 주세요');
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: '   ', currency: 'KRW', bank: '신한', account: '1' }), '수취인명을 입력해 주세요');
  const tooLong = 'a'.repeat(81);
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: tooLong, currency: 'KRW', bank: '신한', account: '1' }), '수취인명을 입력해 주세요');
  const ok = parsePaymentMethodInput({ type: 'bank', holder: ' 홍길동 ', currency: 'KRW', bank: '신한', account: '1' });
  assert.equal((ok as PaymentMethodInput).holder, '홍길동'); // trim 확인
});

test('parsePaymentMethodInput: 통화 필수(paypal/bank), paypay는 무시하고 JPY 고정', () => {
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: 'h', currency: 'USD', bank: 'b', account: 'a' }), '통화를 선택해 주세요');
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: 'h', bank: 'b', account: 'a' }), '통화를 선택해 주세요');
  const paypay = parsePaymentMethodInput({ type: 'paypay', holder: '田中', currency: 'USD' });
  assert.equal((paypay as PaymentMethodInput).currency, 'JPY'); // 보낸 값 무시하고 JPY
});

test('parsePaymentMethodInput: paypal 이메일 형식 검증', () => {
  assert.equal(parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', email: 'not-an-email' }), '이메일 형식을 확인해 주세요');
  assert.equal(parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY' }), '이메일 또는 PayPal.me 아이디를 입력해 주세요');
  // 이메일 대신 PayPal.me 아이디만으로도 등록된다(노션 데이터에 실제 사례) — 접두어 paypal.me/·@는 벗긴다
  const byId = parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', paypalId: 'https://paypal.me/barbie_y' });
  assert.deepEqual(byId, { type: 'paypal', holder: 'h', currency: 'JPY', paypalId: 'barbie_y' });
  assert.equal(parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', paypalId: 'a b' }), 'PayPal.me 아이디는 영문·숫자·._- 3~50자예요');
  const both = parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co', paypalId: 'x_y' });
  assert.deepEqual(both, { type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co', paypalId: 'x_y' });
  const ok = parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co' });
  assert.equal((ok as PaymentMethodInput).email, 'a@b.co');
});

test('parsePaymentMethodInput: bank는 은행·계좌번호 필수, 지점 선택', () => {
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: 'h', currency: 'KRW', bank: '', account: '1' }), '은행과 계좌번호를 입력해 주세요');
  assert.equal(parsePaymentMethodInput({ type: 'bank', holder: 'h', currency: 'KRW', bank: '신한', account: '' }), '은행과 계좌번호를 입력해 주세요');
  const ok = parsePaymentMethodInput({ type: 'bank', holder: 'h', currency: 'KRW', bank: '신한', account: '110', branch: '역삼' });
  assert.deepEqual(ok, { type: 'bank', holder: 'h', currency: 'KRW', bank: '신한', account: '110', branch: '역삼' });
  const okNoBranch = parsePaymentMethodInput({ type: 'bank', holder: 'h', currency: 'KRW', bank: '신한', account: '110', branch: '' });
  assert.equal((okNoBranch as PaymentMethodInput).branch, undefined); // 빈 지점은 버림
});

test('parsePaymentMethodInput: paypay 식별 정보는 선택', () => {
  const ok = parsePaymentMethodInput({ type: 'paypay', holder: '田中', currency: 'JPY' });
  assert.equal((ok as PaymentMethodInput).identifier, undefined);
  const withId = parsePaymentMethodInput({ type: 'paypay', holder: '田中', currency: 'JPY', identifier: 'tanaka123' });
  assert.equal((withId as PaymentMethodInput).identifier, 'tanaka123');
});

test('parsePaymentMethodInput: 유형에 없는 필드는 버린다', () => {
  const paypalWithBank = parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co', bank: '신한', account: '1' });
  assert.deepEqual(paypalWithBank, { type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co' });
});

test('parsePaymentMethodInput: 알 수 없는 최상위 키는 무시(오류 아님)', () => {
  const ok = parsePaymentMethodInput({ type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co', unknownKey: 'x' });
  assert.deepEqual(ok, { type: 'paypal', holder: 'h', currency: 'JPY', email: 'a@b.co' });
});

test('parsePaymentMethodInput: 수수료 — 부재/grossUp/fixed/잘못된 값', () => {
  const noFee = parsePaymentMethodInput(bankInput());
  assert.equal((noFee as PaymentMethodInput).fee, undefined);

  const grossUp = parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'grossUp', percent: 5 } });
  assert.deepEqual((grossUp as PaymentMethodInput).fee, { mode: 'grossUp', percent: 5 });

  assert.equal(
    parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'grossUp', percent: 0 } }),
    '수수료 비율은 0보다 크고 100보다 작아야 해요',
  );
  assert.equal(
    parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'grossUp', percent: 100 } }),
    '수수료 비율은 0보다 크고 100보다 작아야 해요',
  );
  assert.equal(
    parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'grossUp', percent: NaN } }),
    '수수료 비율은 0보다 크고 100보다 작아야 해요',
  );

  const fixed = parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'fixed', amount: 165 } });
  assert.deepEqual((fixed as PaymentMethodInput).fee, { mode: 'fixed', amount: 165 });

  assert.equal(parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'fixed', amount: -1 } }), '금액은 0 이상 정수예요');
  assert.equal(parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'fixed', amount: 1.5 } }), '금액은 0 이상 정수예요');
  assert.equal(parsePaymentMethodInput({ ...bankInput(), fee: { mode: 'weird' } }), '수수료 처리 방식이 올바르지 않아요');
});

test('parsePaymentMethodInput: 메모 선택·trim·200자 이내', () => {
  const withMemo = parsePaymentMethodInput({ ...bankInput(), memo: '  월말 정산 희망  ' });
  assert.equal((withMemo as PaymentMethodInput).memo, '월말 정산 희망');
  const noMemo = parsePaymentMethodInput({ ...bankInput(), memo: '' });
  assert.equal((noMemo as PaymentMethodInput).memo, undefined);
  const tooLong = parsePaymentMethodInput({ ...bankInput(), memo: 'a'.repeat(201) });
  assert.equal(tooLong, '메모는 200자 이내로 적어 주세요');
});

// ---- applyPaymentOp: add ----

test('applyPaymentOp add: 첫 수단은 무조건 기본, 변경 1건', () => {
  const { list, changes } = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId);
  assert.equal(list.length, 1);
  assert.equal(list[0].isDefault, true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'added');
  assert.equal(changes[0].label, describeMethod(list[0]));
});

test('applyPaymentOp add: makeDefault로 기존 기본 해제 — 변경 2건(added, default_changed)', () => {
  const first = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list, changes } = applyPaymentOp(first, { kind: 'add', input: paypalInput(), makeDefault: true }, NOW, newId);
  assert.equal(list.length, 2);
  assert.equal(list.find((m) => m.type === 'bank')!.isDefault, false);
  assert.equal(list.find((m) => m.type === 'paypal')!.isDefault, true);
  assert.deepEqual(changes.map((c) => c.action), ['added', 'default_changed']);
});

test('applyPaymentOp add: makeDefault 없이 추가하면 기본은 그대로, 변경 1건', () => {
  const first = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list, changes } = applyPaymentOp(first, { kind: 'add', input: paypalInput() }, NOW, newId);
  assert.equal(list.find((m) => m.type === 'bank')!.isDefault, true);
  assert.equal(list.find((m) => m.type === 'paypal')!.isDefault, false);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'added');
});

test('applyPaymentOp add: 입력 리스트를 변형하지 않는다', () => {
  const first = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const snapshot = JSON.parse(JSON.stringify(first));
  applyPaymentOp(first, { kind: 'add', input: paypalInput(), makeDefault: true }, NOW, newId);
  assert.deepEqual(first, snapshot);
});

// ---- applyPaymentOp: update ----

test('applyPaymentOp update: 변경 없으면 changes 0건, 리스트도 동일 내용', () => {
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list: after, changes } = applyPaymentOp(list, { kind: 'update', id: list[0].id, input: bankInput() }, '2026-08-27T01:00:00.000Z', newId);
  assert.equal(changes.length, 0);
  assert.deepEqual(after, list); // updatedAt도 안 바뀜(실질 변경 없음)
});

test('applyPaymentOp update: 바뀐 필드만 기록, 라벨은 PAYMENT_FIELD_LABEL에 존재', () => {
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list: after, changes } = applyPaymentOp(
    list,
    { kind: 'update', id: list[0].id, input: bankInput({ account: '9999999', memo: '변경 메모' }) },
    '2026-08-27T01:00:00.000Z',
    newId,
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'updated');
  const fieldNames = changes[0].fields!.map((f) => f.field);
  assert.deepEqual(new Set(fieldNames), new Set(['account', 'memo']));
  for (const f of changes[0].fields!) {
    assert.ok(f.field in PAYMENT_FIELD_LABEL, `${f.field} should have a label`);
  }
  const accountField = changes[0].fields!.find((f) => f.field === 'account')!;
  assert.equal(accountField.from, '0441321');
  assert.equal(accountField.to, '9999999');
  assert.equal(after[0].updatedAt, '2026-08-27T01:00:00.000Z');
  assert.equal(after[0].isDefault, true); // isDefault는 update로 안 바뀜
});

test('applyPaymentOp update: 유형 변경 시 옛 필드는 드롭된다', () => {
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list: after, changes } = applyPaymentOp(
    list,
    { kind: 'update', id: list[0].id, input: paypalInput({ holder: bankInput().holder }) },
    '2026-08-27T01:00:00.000Z',
    newId,
  );
  const updated = after[0];
  assert.equal(updated.type, 'paypal');
  assert.equal(updated.bank, undefined);
  assert.equal(updated.account, undefined);
  assert.equal(updated.email, paypalInput().email);
  const typeField = changes[0].fields!.find((f) => f.field === 'type');
  assert.deepEqual(typeField, { field: 'type', from: PAYMENT_TYPE_LABEL.bank, to: PAYMENT_TYPE_LABEL.paypal });
});

test('applyPaymentOp update: qr만 바뀌어도 적용된다(DIFF_FIELDS 누락 시 no-op — 명부 자동 반영·057이 이 경로를 탄다)', () => {
  const list = applyPaymentOp([], { kind: 'add', input: paypayInput({ identifier: 'ident-1', qr: 'inf-1/old.png' }) }, NOW, newId).list;
  const { list: after, changes } = applyPaymentOp(
    list,
    { kind: 'update', id: list[0].id, input: paypayInput({ identifier: 'ident-1', qr: 'inf-1/new.png' }) },
    '2026-08-27T01:00:00.000Z',
    newId,
  );
  assert.equal(changes.length, 1, 'qr만 바뀌었어도 변경으로 기록돼야 한다');
  assert.equal(after[0].qr, 'inf-1/new.png', '리스트에도 새 qr이 반영돼야 한다');
  const qrField = changes[0].fields!.find((f) => f.field === 'qr');
  assert.deepEqual(qrField, { field: 'qr', from: 'inf-1/old.png', to: 'inf-1/new.png' });
  assert.ok('qr' in PAYMENT_FIELD_LABEL);
});

test('applyPaymentOp update: 존재하지 않는 id는 PAYMENT_NOT_FOUND를 던진다', () => {
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  assert.throws(
    () => applyPaymentOp(list, { kind: 'update', id: 'no-such-id', input: bankInput() }, NOW, newId),
    (err: unknown) => err instanceof Error && err.message === PAYMENT_NOT_FOUND,
  );
});

// ---- applyPaymentOp: remove ----

test('applyPaymentOp remove: 기본을 지우면 남은 것 중 첫 번째가 기본이 되고 default_changed가 뒤따른다', () => {
  const afterFirst = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const afterSecond = applyPaymentOp(afterFirst, { kind: 'add', input: paypalInput() }, NOW, newId).list;
  const defaultId = afterSecond.find((m) => m.isDefault)!.id;
  const { list, changes } = applyPaymentOp(afterSecond, { kind: 'remove', id: defaultId }, NOW, newId);
  assert.equal(list.length, 1);
  assert.equal(list[0].isDefault, true);
  assert.equal(list[0].type, 'paypal');
  assert.deepEqual(changes.map((c) => c.action), ['removed', 'default_changed']);
});

test('applyPaymentOp remove: 마지막 하나를 지우면 빈 배열, default_changed 없음', () => {
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list: after, changes } = applyPaymentOp(list, { kind: 'remove', id: list[0].id }, NOW, newId);
  assert.deepEqual(after, []);
  assert.deepEqual(changes.map((c) => c.action), ['removed']);
});

test('applyPaymentOp remove: 기본이 아닌 것을 지우면 default_changed 없음', () => {
  const afterFirst = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const afterSecond = applyPaymentOp(afterFirst, { kind: 'add', input: paypalInput() }, NOW, newId).list;
  const nonDefault = afterSecond.find((m) => !m.isDefault)!;
  const { list, changes } = applyPaymentOp(afterSecond, { kind: 'remove', id: nonDefault.id }, NOW, newId);
  assert.equal(list.length, 1);
  assert.deepEqual(changes.map((c) => c.action), ['removed']);
});

test('applyPaymentOp remove: 존재하지 않는 id는 PAYMENT_NOT_FOUND를 던진다', () => {
  assert.throws(
    () => applyPaymentOp([], { kind: 'remove', id: 'no-such-id' }, NOW, newId),
    (err: unknown) => err instanceof Error && err.message === PAYMENT_NOT_FOUND,
  );
});

// ---- applyPaymentOp: setDefault ----

test('applyPaymentOp setDefault: 이미 기본이면 changes 0건, 리스트 동일', () => {
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const { list: after, changes } = applyPaymentOp(list, { kind: 'setDefault', id: list[0].id }, NOW, newId);
  assert.equal(changes.length, 0);
  assert.deepEqual(after, list);
});

test('applyPaymentOp setDefault: 기본이 아니면 default_changed 1건, 이전 기본은 해제', () => {
  const afterFirst = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  const afterSecond = applyPaymentOp(afterFirst, { kind: 'add', input: paypalInput() }, NOW, newId).list;
  const nonDefault = afterSecond.find((m) => !m.isDefault)!;
  const { list, changes } = applyPaymentOp(afterSecond, { kind: 'setDefault', id: nonDefault.id }, NOW, newId);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'default_changed');
  assert.equal(list.filter((m) => m.isDefault).length, 1);
  assert.equal(list.find((m) => m.id === nonDefault.id)!.isDefault, true);
});

test('applyPaymentOp setDefault: 존재하지 않는 id는 PAYMENT_NOT_FOUND를 던진다', () => {
  assert.throws(
    () => applyPaymentOp([], { kind: 'setDefault', id: 'no-such-id' }, NOW, newId),
    (err: unknown) => err instanceof Error && err.message === PAYMENT_NOT_FOUND,
  );
});

// ---- 표시 도우미 ----

test('describeMethod: 유형별 짧은 식별 표시', () => {
  const bank: PaymentMethod = { ...bankInput(), id: 'x', isDefault: true, updatedAt: NOW };
  assert.equal(describeMethod(bank), '계좌이체 · 미쓰비시UFJ 0441321');

  const paypal: PaymentMethod = { ...paypalInput(), id: 'x', isDefault: true, updatedAt: NOW };
  assert.equal(describeMethod(paypal), 'PayPal · SAWADA KEIKO');

  const paypay: PaymentMethod = { type: 'paypay', holder: '田中', currency: 'JPY', id: 'x', isDefault: false, updatedAt: NOW };
  assert.equal(describeMethod(paypay), 'PayPay · 田中');
});

test('formatFee: 부재는 null, grossUp/fixed 문구', () => {
  assert.equal(formatFee(undefined, 'KRW'), null);
  assert.equal(formatFee({ mode: 'grossUp', percent: 5 }, 'KRW'), '송금 수수료 CB 부담 · 5%');
  assert.equal(formatFee({ mode: 'fixed', amount: 165 }, 'JPY'), '송금 수수료 CB 부담 · 165엔');
});

test('getDefaultPaymentMethod: 있으면 반환, 없으면 null', () => {
  assert.equal(getDefaultPaymentMethod([]), null);
  const list = applyPaymentOp([], { kind: 'add', input: bankInput() }, NOW, newId).list;
  assert.equal(getDefaultPaymentMethod(list), list[0]);
});

test('settlementBadge: 명부 목록 배지 5케이스', () => {
  assert.deepEqual(settlementBadge(null), { label: '정산 조건 없음', muted: true });
  assert.deepEqual(settlementBadge({ currency: 'KRW', fee: null }), { label: '₩ 원화 · 인플 부담', muted: false });
  assert.deepEqual(settlementBadge({ currency: 'JPY', fee: null }), { label: '¥ 엔화 · 인플 부담', muted: false });
  assert.deepEqual(
    settlementBadge({ currency: 'JPY', fee: { mode: 'grossUp', percent: 5 } }),
    { label: '¥ 엔화 · CB 5%', muted: false },
  );
  assert.deepEqual(
    settlementBadge({ currency: 'JPY', fee: { mode: 'fixed', amount: 165 } }),
    { label: '¥ 엔화 · CB 165엔', muted: false },
  );
});

// planRosterOverwrite(057) 테스트는 settlementPaymentCorrection.test.ts로 옮겼다 — 병합에 mergePaymentMethodCorrection·toMethodSnapshot이 필요해서다.
