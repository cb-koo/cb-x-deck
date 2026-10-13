import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClientSheet,
  formatReservationName,
  readClientSheet,
  readClientSheetInputs,
  sheetDifferences,
  splitReservationName,
  updateClientSheetInput,
} from './reservationSheet.ts';

const SHEET = createClientSheet('@hana_mozu', {
  preferred: '2026-10-28T16:00',
  name: '곤도 사에(kondo sae)',
  treatment: '울쎄라',
});

test('새 시트는 핸들·프로필 링크·번호 항목을 만들고, 빈 값은 - 로 남긴다', () => {
  const lines = SHEET.split('\n');
  assert.equal(lines[0], '@hana_mozu');
  assert.equal(lines[1], 'https://x.com/hana_mozu?s=20');
  assert.equal(lines[3], '1. 희망 일시: 2026-10-28 16:00');
  assert.equal(lines[4], '2. 초진/재진: -');
  assert.deepEqual(readClientSheet(SHEET), { name: '곤도 사에(kondo sae)', treatment: '울쎄라', preferred: '2026-10-28T16:00', preferred2: '' });
});

test('희망 일시는 달력에 있는 날·시각만 읽는다', () => {
  assert.equal(readClientSheet('1. 희망 일시: 2026-02-30 16:00').preferred, '');
  assert.equal(readClientSheet('1. 희망 일시: 2028-02-29 09:05').preferred, '2028-02-29T09:05');
  assert.equal(readClientSheet('1. 희망 일시: 2026-10-28 24:00').preferred, '');
});

test('한 항목만 고쳐도 CRLF·라벨 표기·전각 콜론·추가 문구를 그대로 보존한다', () => {
  const raw =
    '@hana_mozu\r\nhttps://x.com/hana_mozu\r\n\r\n  1. 희망 일시： 2026-10-28 16:00  \r\n7. 희망 시술 내용: 울쎄라\r\n\r\n추가 문구  \r\n';
  const changed = updateClientSheetInput(raw, 'preferred', '2026-11-01T15:00');
  assert.equal(changed, raw.replace('2026-10-28 16:00', '2026-11-01 15:00'));
  assert.equal(readClientSheetInputs(changed).preferred, '2026-11-01T15:00');
  // 같은 값(T/공백만 다름)은 원문을 다시 쓰지 않는다
  assert.equal(updateClientSheetInput(raw, 'preferred', '2026-10-28T16:00'), raw);
});

test('시트에 없는 기한 줄은 끝에 추가한다', () => {
  const next = updateClientSheetInput(SHEET, 'uploadDeadline', '2026-11-11');
  assert.equal(next, `${SHEET}\n업로드 기한: 2026-11-11`);
  assert.equal(readClientSheetInputs(next).uploadDeadline, '2026-11-11');
});

test('이름은 한글·로마자 순서와 무관하게 나누고 한쪽만 있어도 보존한다', () => {
  for (const name of ['곤도 사에(kondo sae)', 'kondo sae（곤도 사에）', '곤도 사에 ( kondo sae )'])
    assert.deepEqual(splitReservationName(name), { korean: '곤도 사에', roman: 'kondo sae' });
  assert.deepEqual(splitReservationName('곤도 사에'), { korean: '곤도 사에', roman: '' });
  assert.deepEqual(splitReservationName('kondo sae'), { korean: '', roman: 'kondo sae' });
  assert.equal(formatReservationName({ korean: '', roman: ' kondo sae ' }), 'kondo sae');
  assert.equal(formatReservationName({ korean: ' 곤도 사에 ', roman: '' }), '곤도 사에');
  assert.equal(formatReservationName({ korean: '', roman: '' }), '');
});

test('이름 두 칸을 함께 고친 저장은 이름 한 건의 차이로 남는다', () => {
  const original = SHEET.replace(/\n/g, '\r\n');
  const edited = updateClientSheetInput(original, 'name', formatReservationName({ korean: '곤도 사에코', roman: 'Kondo Saeko' }));
  assert.equal(edited, original.replace('곤도 사에(kondo sae)', '곤도 사에코(Kondo Saeko)'));
  assert.deepEqual(sheetDifferences(original, edited), [
    { field: 'name', label: '이름', before: '곤도 사에(kondo sae)', after: '곤도 사에코(Kondo Saeko)' },
  ]);
});

test('입력란으로 설명되지 않는 추가 문구는 시트 전체 전후로 남긴다', () => {
  const after = `${SHEET}\n추가 안내`;
  assert.deepEqual(sheetDifferences(SHEET, after), [{ field: 'sheet', label: '기재 시트 추가 문구', before: SHEET, after }]);
});

test('형식만 다른 시트는 차이가 없다', () => {
  const text = SHEET.split('\n').map((s) => `  ${s}  `).join('\r\n\r\n').replace('2026-10-28 16:00', '2026-10-28T16:00');
  assert.deepEqual(sheetDifferences(SHEET, text), []);
});
