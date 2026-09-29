import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskAgreementValidationError, agreementExtension, agreementDisplayName, MAX_TASK_AGREEMENT_BYTES } from './taskAgreement.ts';
import { TASK_AGREEMENT_NAME_MAX } from './taskAgreementGuard.ts';

test('063) 파일 검증 — PDF·jpg·png, 10MB까지', () => {
  assert.equal(taskAgreementValidationError({ type: 'application/pdf', size: 1000 }), null);
  assert.equal(taskAgreementValidationError({ type: 'image/png', size: MAX_TASK_AGREEMENT_BYTES }), null);
  assert.match(taskAgreementValidationError({ type: 'image/webp', size: 1000 })!, /PDF·jpg·png만/);
  assert.match(taskAgreementValidationError({ type: 'application/pdf', size: MAX_TASK_AGREEMENT_BYTES + 1 })!, /10MB/);
  assert.match(taskAgreementValidationError({ type: 'application/pdf', size: 0 })!, /빈 파일/);
});

test('063) 저장 확장자 — 이름의 허용 확장자가 먼저, 없으면 형식에서', () => {
  assert.equal(agreementExtension({ name: '동의서.PDF', type: 'application/pdf' }), 'pdf');
  assert.equal(agreementExtension({ name: 'scan.jpeg', type: 'image/jpeg' }), 'jpeg');
  assert.equal(agreementExtension({ name: '동의서', type: 'image/png' }), 'png');
  assert.equal(agreementExtension({ name: 'x.exe', type: 'application/pdf' }), 'pdf');
});

test('063) 표시 파일명 — 비면 기본 이름, 너무 길면 확장자를 살려 자른다(서버 상한 안으로)', () => {
  assert.equal(agreementDisplayName('  '), '협찬 동의서');
  assert.equal(agreementDisplayName('동의서.pdf'), '동의서.pdf');
  const long = agreementDisplayName('가'.repeat(300) + '.pdf');
  assert.ok(long.length <= TASK_AGREEMENT_NAME_MAX);
  assert.ok(long.endsWith('….pdf'));
});
