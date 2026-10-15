import { test } from 'node:test';
import assert from 'node:assert/strict';
import { risingOnly, groupCandidates, risingMonths, alreadyCounted, variantAction, isBroadTerm } from './trendDiscover.ts';

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
    { text: 'クレンジング ピーリング', now: 1600, yearAgo: 677, increase: 923, series: [] },
    { text: 'ピーリング クレンジング', now: 1600, yearAgo: 677, increase: 923, series: [] },
    { text: 'ボットクス と は', now: 52233, yearAgo: 18100, increase: 34133, series: [] },
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
  const raw = [{ text: '蓄熱式脱毛 効果', now: 3633, yearAgo: 2600, increase: 1007, series: [] }, { text: '蓄熱式 脱毛 痛み', now: 3000, yearAgo: 2100, increase: 900, series: [] }];
  const g = groupCandidates(raw, [
    { text: '蓄熱式脱毛 効果', kind: 'new', term: '蓄熱式脱毛', ko: '축열식 제모' },
    { text: '蓄熱式 脱毛 痛み', kind: 'new', term: '蓄熱式', ko: '축열식 제모' },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].texts.length, 2);
  assert.equal(g[0].increase, 1007);
});

test('이미 세는 검색 — 유사 표기로 묶이거나 4년치 숫자가 같으면(ボットクス = ボトックス)', () => {
  const ours = { norms: new Set(['ボトックス', 'ボトックスとは']), seriesKeys: new Set([[60500, 60500, 90500].join(',')]) };
  assert.equal(alreadyCounted({ text: 'ボットクス', closeVariants: ['ボトックス'], series: null }, ours), true);
  assert.equal(alreadyCounted({ series: [60500, 60500, 90500] }, ours), true);
  assert.equal(alreadyCounted({ text: '肌育注射', closeVariants: [], series: [6600, 6600, 8100] }, ours), false);
  assert.equal(alreadyCounted({ series: [10, 10, 10] }, { norms: new Set(), seriesKeys: new Set(['10,10,10']) }), false);  // 작은 값은 우연히 같을 수 있다
});

test('다른 표기 — 우리 표기보다 3배 이상이면 표기 바꾸기', () => {
  assert.equal(variantAction(22200, 320), 'replace');   // ピコフラクショナル vs ピコフラクセル
  assert.equal(variantAction(6600, 1300), 'replace');
  assert.equal(variantAction(2400, 8100), 'add');       // 刺青 消す vs タトゥー除去
  assert.equal(variantAction(500, null), 'replace');    // 우리 표기가 값 없음
});

test('몇 달째 늘어난 상태인지 — 반짝 검색은 1, 꾸준히 늘면 여러 달', () => {
  const steady = ramp(1000, 3000);
  assert.ok(risingMonths(steady) >= 6);
  const blip = [...Array(23).fill(1000), 4000];
  assert.equal(risingMonths(blip), 1);
});

test('넓은 말로는 표기를 바꾸지 않는다(RF·毛穴) — 더하기만', () => {
  const jps = ['毛穴縮小', 'ピコフラクセル', 'サーマクール'];
  assert.equal(isBroadTerm('RF', jps), true);           // 영문 3자 이하
  assert.equal(isBroadTerm('毛穴', jps), true);          // 毛穴縮小가 통째로 품음
  assert.equal(isBroadTerm('ピコフラクショナル', jps), false);
  assert.equal(isBroadTerm('肌育注射', jps), false);
  assert.equal(variantAction(9900, 100, true), 'add');
  assert.equal(variantAction(22200, 320, false), 'replace');
});
