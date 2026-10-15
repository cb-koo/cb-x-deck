import { test } from 'node:test';
import assert from 'node:assert/strict';
import { risingOnly, groupCandidates } from './trendDiscover.ts';

const ramp = (from: number, to: number) => Array.from({ length: 24 }, (_, i) => (i < 12 ? from : Math.round(from + ((to - from) * (i - 11)) / 12)));

test('늘어난 검색만 — 월 300 이상·1년 +300건·+30% 이상(1년 전 거의 없으면 신규로 통과)', () => {
  const r = risingOnly([
    { text: 'ルメッカ 肝斑', series: ramp(1900, 2800) },      // +47%·+900 → 통과
    { text: '肌治療', series: ramp(6000, 7000) },               // +17% → 탈락(큰 말의 작은 출렁임)
    { text: '小さい新語', series: ramp(50, 250) },              // 월 300 미만 → 탈락
    { text: '新しい注射', series: ramp(20, 900) },              // 1년 전 거의 없음 → 신규로 통과
  ]);
  assert.deepEqual(r.map((x) => x.text), ['ルメッカ 肝斑', '新しい注射']);
});

test('같은 핵심어로 분류된 검색어는 한 후보 — 어순·띄어쓰기만 다른 것 포함', () => {
  const raw = [
    { text: 'クレンジング ピーリング', now: 1600, yearAgo: 677, increase: 923 },
    { text: 'ピーリング クレンジング', now: 1600, yearAgo: 677, increase: 923 },
    { text: 'ボットクス と は', now: 52233, yearAgo: 18100, increase: 34133 },
  ];
  const g = groupCandidates(raw, [
    { text: 'クレンジング ピーリング', kind: 'self', term: 'ピーリングクレンジング' },
    { text: 'ピーリング クレンジング', kind: 'self', term: 'ピーリング クレンジング' },
    { text: 'ボットクス と は', kind: 'variant', term: 'ボットクス', of: 'ボトックス', ko: '보톡스' },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].term, 'ボットクス');  // 늘어난 수 큰 순
  assert.equal(g[1].texts.length, 2);
});

test('핵심어 표기가 달라도 한국어 이름이 같으면 한 후보(축열식 제모)', () => {
  const raw = [{ text: '蓄熱式脱毛 効果', now: 3633, yearAgo: 2600, increase: 1007 }, { text: '蓄熱式 脱毛 痛み', now: 3000, yearAgo: 2100, increase: 900 }];
  const g = groupCandidates(raw, [
    { text: '蓄熱式脱毛 効果', kind: 'new', term: '蓄熱式脱毛', ko: '축열식 제모' },
    { text: '蓄熱式 脱毛 痛み', kind: 'new', term: '蓄熱式', ko: '축열식 제모' },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].texts.length, 2);
  assert.equal(g[0].increase, 1007);
});
