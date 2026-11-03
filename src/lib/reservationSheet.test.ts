import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientSheetInputPosition,
  createClientSheet,
  fillClientSheetTemplate,
  formatReservationName,
  normalizeFollowerTier,
  readClientSheet,
  readClientSheetInput,
  readClientSheetInputs,
  sheetDifferences,
  sheetHandle,
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

const BENJAMIN_SHEET = `[X인플루언서 방문협찬 예약폼]
- 인플루언서 계정 링크: https://x.com/yuki_tokyo?s=20
- 인플루언서 팔로워 : 마이크로
1. 성함(여권 영문명): YUKI TANAKA
2. 국적: 일본
3. 생년월일: 1995-03-02
4. 초진 / 재진: 초진
5. 성별: 여
6. 예약 날짜 및 시간: 2026-12-05 14:00
7. 지점: 신사점
8. 상담 희망 항목: 리프팅`;

test('벤자민 시트 라벨을 읽는다', () => {
  const f = readClientSheetInputs(BENJAMIN_SHEET);
  assert.equal(f.name, 'YUKI TANAKA');
  assert.equal(f.preferred, '2026-12-05T14:00');
  assert.equal(f.treatment, '리프팅');
  assert.equal(f.nationality, '일본');
  assert.equal(f.branch, '신사점');
  assert.equal(f.followerTier, '마이크로');
  assert.equal(f.profileUrl, 'https://x.com/yuki_tokyo?s=20');
});

test('벤자민 시트 항목 줄 순서 — 없는 줄은 null', () => {
  const keys = ['followerTier', 'name', 'visitType', 'gender', 'preferred', 'branch', 'treatment'] as const;
  const at = keys.map((k) => clientSheetInputPosition(BENJAMIN_SHEET, k)!);
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.equal(clientSheetInputPosition(BENJAMIN_SHEET, 'koreanAbility'), null);
});

test('콜론으로 끝나는 줄에 값을 쓰면 한 칸 띄운다', () => {
  assert.equal(updateClientSheetInput('- 인플루언서 팔로워 :', 'followerTier', '마이크로'), '- 인플루언서 팔로워 : 마이크로');
});

test('등급 안내 문구는 빈 값', () => {
  assert.equal(normalizeFollowerTier('영역 (나노/마이크로/메가)'), '');
  assert.equal(normalizeFollowerTier('메가'), '메가');
});

test('지점 줄 차이는 sheetDifferences가 내지 않는다', () => {
  const other = BENJAMIN_SHEET.replace('7. 지점: 신사점', '7. 지점: 명동점');
  assert.deepEqual(sheetDifferences(BENJAMIN_SHEET, other), []);
  // 다른 항목이 함께 바뀌면 그 항목만 나온다(지점은 추가 문구로도 안 샌다)
  const both = other.replace('2. 국적: 일본', '2. 국적: 한국');
  assert.deepEqual(sheetDifferences(BENJAMIN_SHEET, both).map((d) => d.field), ['nationality']);
});

test('추출 지점이 비면 문맥 지점(본점)을 쓴다', () => {
  const out = fillClientSheetTemplate('지점: {{branch}}\n1. 성함: {{name}}', 'hana', { name: '하나' },
    { clinic: 'C', branch: '본점', naver: '', google: '' });
  assert.ok(out.includes('지점: 본점'));
  const named = fillClientSheetTemplate('7. 지점:', 'hana', { branch: '신사점' }, { clinic: 'C', branch: '본점', naver: '', google: '' });
  assert.ok(named.includes('지점: 신사점'));
});

test('sheetHandle — 핸들 줄이 없으면 계정 링크 URL에서 계정을 읽는다', () => {
  const link = (url: string) => `- 인플루언서 계정 링크: ${url}\n1. 희망 일시: 2026-10-28 16:00`;
  assert.equal(sheetHandle(link('https://x.com/Hana_Mozu?s=20')), 'hana_mozu');
  assert.equal(sheetHandle(link('https://x.com/hana_mozu/')), 'hana_mozu');
  assert.equal(sheetHandle(link('https://twitter.com/hana_mozu')), 'hana_mozu');
  assert.equal(sheetHandle(link('https://mobile.x.com/hana_mozu')), 'hana_mozu');
  assert.equal(sheetHandle(link('https://x.com/@hana_mozu')), 'hana_mozu');
  assert.equal(sheetHandle(link('https://x.com/hana_mozu/status/1')), 'hana_mozu');
  // X 예약 경로는 계정이 아니다 — 계정 없음('')
  assert.equal(sheetHandle(link('https://x.com/i/user/123456')), '');
  assert.equal(sheetHandle(link('https://x.com/intent/follow?screen_name=hana_mozu')), '');
  assert.equal(sheetHandle(link('https://x.com/Home')), '');
  // 스킴 없는 글자는 링크로 보지 않는다 — 계정 없음('')
  assert.equal(sheetHandle(link('x.com/hana_mozu')), '');
  // 핸들 줄이 있으면 URL과 달라도 핸들 줄이 이긴다
  assert.equal(sheetHandle('@hana_mozu\nhttps://x.com/other?s=20\n\n1. 희망 일시: 2026-10-28 16:00'), 'hana_mozu');
});

test('입력란 하나 읽기 — 줄이 없으면 null, 빈 값은 빈 문자열', () => {
  const sheet = '@hana\n\n1. 희망 일시: 2026-10-28 16:00\n8. 희망 예산 범위: 50만원\n9. 성형·시술 이력 (또는 예정): -';
  assert.equal(readClientSheetInput(sheet, 'budget'), '50만원');
  assert.equal(readClientSheetInput(sheet, 'treatmentHistory'), '');
  assert.equal(readClientSheetInput(sheet, 'companion'), null);
  assert.equal(readClientSheetInput(sheet, 'preferred'), '2026-10-28T16:00');
});
