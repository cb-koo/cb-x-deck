import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTaskAgreementPath, isTaskAgreementPathFor, parseTaskAgreementInput, taskAgreementOf, agreementLine,
  MAX_TASK_AGREEMENT_BYTES, TASK_AGREEMENT_NAME_MAX, agreementMeta, formatBytes, agreementKind } from './taskAgreementGuard.ts';

const TASK = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const FILE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OK = `task/${TASK}/${FILE}.pdf`;

test('063) 경로 — 정상 형태(pdf·jpg·jpeg·png)만 통과', () => {
  for (const ext of ['pdf', 'jpg', 'jpeg', 'png']) assert.equal(isTaskAgreementPath(`task/${TASK}/${FILE}.${ext}`), true, ext);
  for (const bad of ['https://evil.example/a.pdf', `task/${TASK}/${FILE}.webp`, `task/${TASK}/${FILE}.pdf?x=1`, `task/${TASK}/../${FILE}.pdf`,
    `TASK/${TASK}/${FILE}.PDF`, `draft/${TASK}/${FILE}.pdf`, '', null, 1]) {
    assert.equal(isTaskAgreementPath(bad), false, String(bad));
  }
});

test('063) 경로 — 이 작업 것만(모양만 맞는 남의 작업 경로는 거절)', () => {
  assert.equal(isTaskAgreementPathFor(TASK, OK), true);
  assert.equal(isTaskAgreementPathFor(OTHER, OK), false);
});

test('063) 요청 값 — 경로·이름·크기·형식이 다 맞아야 하고 이름은 앞뒤 공백을 걷는다', () => {
  const good = { path: OK, name: ' 동의서.pdf ', size: 1000, mime: 'application/pdf' };
  assert.deepEqual(parseTaskAgreementInput(good), { path: OK, name: '동의서.pdf', size: 1000, mime: 'application/pdf' });
  assert.equal(parseTaskAgreementInput({ ...good, path: 'https://evil.example/a.pdf' }), null);
  assert.equal(parseTaskAgreementInput({ ...good, name: '   ' }), null);
  assert.equal(parseTaskAgreementInput({ ...good, name: 'a'.repeat(TASK_AGREEMENT_NAME_MAX + 1) }), null);
  assert.equal(parseTaskAgreementInput({ ...good, size: MAX_TASK_AGREEMENT_BYTES + 1 }), null);
  assert.equal(parseTaskAgreementInput({ ...good, size: 0 }), null);
  assert.equal(parseTaskAgreementInput({ ...good, size: 1.5 }), null);
  assert.equal(parseTaskAgreementInput({ ...good, mime: 'image/webp' }), null);
  assert.equal(parseTaskAgreementInput(OK), null);   // 증빙처럼 경로 문자열만 보내면 안 된다
  assert.equal(parseTaskAgreementInput(null), null);
});

test('063) jsonb 읽기 — 검증 통과분만, 깨진 값은 null', () => {
  const a = { url: OK, name: '동의서.pdf', size: 1000, mime: 'application/pdf', by: null, byName: '박구건', at: '2026-09-29T01:00:00.000Z' };
  assert.deepEqual(taskAgreementOf(a), a);
  assert.equal(taskAgreementOf({ ...a, url: 'https://evil.example/a.pdf' }), null);
  assert.equal(taskAgreementOf({ ...a, mime: 'text/html' }), null);
  assert.equal(taskAgreementOf({ ...a, at: '' }), null);
  assert.equal(taskAgreementOf('x'), null);
  assert.equal(taskAgreementOf(null), null);
});

test('063) 표시 한 줄 — 파일명 · 올린 사람 · M/D(KST), 이름이 비면 뺀다', () => {
  // 09-28 15:30Z = KST 09-29 00:30 — UTC로 자르면 하루 전(9/28)으로 보인다
  assert.equal(agreementLine({ name: '동의서.pdf', byName: '박구건', at: '2026-09-28T15:30:00.000Z' }), '동의서.pdf · 박구건 · 9/29');
  assert.equal(agreementLine({ name: '동의서.pdf', byName: '', at: '2026-09-29T01:00:00.000Z' }), '동의서.pdf · 9/29');
});

test('파일 카드 — 둘째 줄(올린 사람·날짜·크기)과 형식 딱지', () => {
  assert.equal(agreementMeta({ byName: '박구건', at: '2026-09-29T01:00:00.000Z', size: 250_880 }), '박구건 · 9/29 올림 · 245KB');
  assert.equal(agreementMeta({ byName: '', at: '2026-09-29T01:00:00.000Z', size: 0 }), '9/29 올림');   // 올린 직후 낙관값
  assert.equal(formatBytes(900), '900B');
  assert.equal(formatBytes(3.4 * 1024 * 1024), '3.4MB');
  assert.equal(agreementKind('application/pdf'), 'PDF');
  assert.equal(agreementKind('image/jpeg'), 'JPG');
  assert.equal(agreementKind('text/plain'), '파일');
});
