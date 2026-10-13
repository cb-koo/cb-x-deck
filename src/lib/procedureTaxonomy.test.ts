import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, CATEGORIES } from './procedureTaxonomy.ts';

const snap = JSON.parse(readFileSync(new URL('../app/trends/snapshot.json', import.meta.url), 'utf8')) as
  { procedures: Array<{ major: string; middle: string; name: string; kr: string }> };

test('시트의 모든 시술이 분류된다(빠짐 없음)', () => {
  for (const p of snap.procedures) {
    const c = classify(p);
    assert.ok(CATEGORIES.includes(c.category), `${p.name}: ${c.category}`);
    assert.ok(c.sub, `${p.name}: 중분류 비어 있음`);
  }
});

test('표기 흔들림은 하나로 모인다', () => {
  const sub = (major: string, middle: string) => classify({ major, middle, name: 'x', kr: 'x' }).sub;
  assert.equal(sub('초음파 리프팅', 'HIFU'), sub('초음파 리프팅', 'HIFU (고강도초음파)'));
  assert.equal(sub('고주파 리프팅', 'RF (Mono)'), sub('고주파 리프팅', 'RF (단극성/모노)'));
  assert.equal(sub('복합/레이저 리프팅', 'Hybrid'), sub('복합/레이저 리프팅', '하이브리드'));
  assert.equal(sub('스킨부스터 (주사)', 'Cocktail'), sub('스킨부스터 (주사)', '복합성분 (칵테일)'));
});

test('작은 대분류는 일반 분류로 합쳐진다', () => {
  assert.equal(classify({ major: '기타 스킨부스터', middle: 'PCL (액상)', name: '고우리', kr: '고우리' }).category, '스킨부스터');
  assert.equal(classify({ major: '남성 시술', middle: '제모', name: '수염제모', kr: '수염제모' }).category, '제모');
  assert.equal(classify({ major: '바디 슬리밍', middle: '가스 주입', name: '카복시', kr: '카복시' }).category, '바디·비만');
});

test('CO2 병변 제거·점빼기는 점·사마귀 제거, 기타 레이저의 여드름 장비는 여드름', () => {
  assert.equal(classify({ major: '흉터/모공/박피', middle: '병변 제거 (CO2)', name: '쥐젖', kr: '쥐젖제거' }).category, '점·사마귀 제거');
  assert.equal(classify({ major: '흉터/모공/박피', middle: 'CO2/어븀', name: 'CO2레이저', kr: '점빼기' }).category, '점·사마귀 제거');
  assert.equal(classify({ major: '흉터/모공/박피', middle: 'CO2/어븀', name: 'CO2레이저', kr: '이산화탄소프락셔널' }).sub, '프락셔널 레이저');
  assert.deepEqual(classify({ major: '기타 레이저', middle: '홍조/여드름', name: '카프리', kr: '카프리레이저' }), { category: '여드름', sub: '피지선 치료' });
});

test('일반/증상 — 상위어는 해당 분류의 대표 검색어, 고민은 피부 고민', () => {
  assert.deepEqual(classify({ major: '일반/증상', middle: '카테고리', name: '보톡스', kr: '보톡스' }), { category: '보톡스', sub: '대표 검색어' });
  assert.deepEqual(classify({ major: '일반/증상', middle: '고민 해결', name: '기미', kr: '기미치료' }), { category: '피부 고민', sub: '기미' });
});
