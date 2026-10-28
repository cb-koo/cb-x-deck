import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, masterOf, CATEGORIES, PROCEDURE_MASTER } from './procedureTaxonomy.ts';

// 분류표 검증 — b2b-marketing build_master.py의 검증을 옮긴 것(분류표 원본이 여기로 왔다, 10-28)
test('분류표: id·일본어 검색어는 한 줄씩', () => {
  const dup = (k: (m: (typeof PROCEDURE_MASTER)[number]) => string) => {
    const seen = new Set<string>(); return PROCEDURE_MASTER.map(k).filter((x) => seen.has(x) || !seen.add(x));
  };
  assert.deepEqual(dup((m) => m.id), []);
  assert.deepEqual(dup((m) => m.jp.replace(/\s/g, '').toLowerCase()), []);
});

test('분류표: 대분류는 정해진 11개, 고민어만 비어 있다', () => {
  for (const m of PROCEDURE_MASTER) {
    if (m.type === '고민·증상') assert.equal(m.major, '', m.bundle);
    else assert.ok((CATEGORIES as readonly string[]).includes(m.major) && m.major !== '피부 고민', `${m.bundle}: ${m.major}`);
  }
});

test('분류표: 순위 포함은 피부과 일반의 시술·통칭이고 분류가 다 차 있다, 약은 빠진다', () => {
  for (const m of PROCEDURE_MASTER.filter((x) => x.rank)) {
    assert.ok(['시술', '시술 통칭'].includes(m.type) && m.area === '피부과 일반', m.bundle);
    assert.ok(m.major && m.sub && m.method, `분류 빈칸: ${m.bundle}`);
  }
  assert.ok(PROCEDURE_MASTER.filter((m) => m.type === '약').every((m) => !m.rank));
});

test('분류표: 한 묶음은 한 대분류 — 이름만 같고 다른 시술은 예외', () => {
  const SPLIT_OK = new Set(['포토나', '인모드']);  // 포토나 레이저/4D, 인모드 얼굴/바디
  const cats = new Map<string, Set<string>>();
  for (const m of PROCEDURE_MASTER.filter((x) => x.major)) cats.set(m.bundle, (cats.get(m.bundle) ?? new Set()).add(m.major));
  assert.deepEqual([...cats].filter(([b, c]) => c.size > 1 && !SPLIT_OK.has(b)).map(([b]) => b), []);
});

const ref = (id: string, jp: string, name = 'x', major = '', middle = '') => ({ id, jp, name, major, middle });

test('분류표의 시술은 소비자 대분류·중분류로', () => {
  assert.deepEqual(classify(ref('p110', 'ジュベルック')), { category: '스킨부스터', sub: '콜라겐 부스터', derm: true, listed: true });
  // 레니스나 = 쥬베룩 볼륨의 해외 판매명(10-28), 점빼기는 CO2 프락셔널과 다른 묶음
  assert.equal(masterOf(ref('p166', 'レニスナ'))?.bundle, '쥬베룩볼륨');
  assert.equal(classify(ref('p166', 'レニスナ')).category, '필러·볼륨');
  assert.equal(masterOf(ref('p306', 'ほくろ除去'))?.bundle, '점빼기');
});

test('같은 일본어 검색어의 두 번째 줄은 일본어로 찾는다', () => {
  const m = PROCEDURE_MASTER.find((x) => x.jp === '糸リフト')!;
  assert.deepEqual(classify(ref('p-dup', '糸 リフト')), classify(ref(m.id, m.jp)));
});

test('고민어는 피부 고민, 피부과 시술이 아니다', () => {
  assert.deepEqual(classify(ref('p26', 'ほうれい線')), { category: '피부 고민', sub: '주름', derm: false, listed: true });
});

test('다른 진료과·약은 분류는 하되 피부과 시술이 아니다', () => {
  const other = PROCEDURE_MASTER.find((m) => m.area === '다른 과')!;
  const drug = PROCEDURE_MASTER.find((m) => m.type === '약')!;
  assert.equal(classify(ref(other.id, other.jp)).derm, false);
  assert.equal(classify(ref(drug.id, drug.jp)).derm, false);
});

test('앱에서 더한 시술 — 같은 이름의 묶음이 있으면 그 분류, 없으면 고른 분류', () => {
  assert.equal(classify(ref('u1', 'サーマクールNEW', '써마지', '고주파 리프팅', 'RF')).category, '리프팅');
  assert.deepEqual(classify(ref('u2', 'ニューブースター', '새 부스터', '스킨부스터', 'PLA')), { category: '스킨부스터', sub: 'PLA', derm: true, listed: false });
  assert.equal(classify(ref('u3', 'テスト', '새 시술', '보톡스', '')).category, '톡신·윤곽');  // 옛 분류 이름
  assert.equal(classify(ref('u4', 'テスト2', '새 시술2', '', '')).category, '기타');
});
