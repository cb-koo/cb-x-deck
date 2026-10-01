import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskAgreementValidationError, agreementExtension, agreementDisplayName, agreementPasteName, MAX_TASK_AGREEMENT_BYTES } from './taskAgreement.ts';
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

test('붙여 넣은 동의서 이름 — 동의서_@핸들_YYYYMMDD.확장자(서울 날짜), 핸들 없으면 동의서_YYYYMMDD', () => {
  assert.equal(agreementPasteName('mirineinseoul', '2026-10-01', 'image/png'), '동의서_@mirineinseoul_20261001.png');
  assert.equal(agreementPasteName('@saachan0013', '2026-10-01', 'image/jpeg'), '동의서_@saachan0013_20261001.jpg');
  assert.equal(agreementPasteName('abc', '2026-12-31', 'application/pdf'), '동의서_@abc_20261231.pdf');
  assert.equal(agreementPasteName(null, '2026-10-01', 'image/png'), '동의서_20261001.png');
  assert.equal(agreementPasteName('  ', '2026-10-01', 'image/png'), '동의서_20261001.png');
  assert.equal(agreementPasteName('@', '2026-10-01', 'image/png'), '동의서_20261001.png');
  // 허용 밖 형식은 확장자 없이(검증이 먼저 거른다 — 그래도 결과는 정해져 있다)
  assert.equal(agreementPasteName('abc', '2026-10-01', 'image/webp'), '동의서_@abc_20261001');
});
