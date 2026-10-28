import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagKeyword, belongs, ownerOf, dedupe, aggregate, profile, stage, ambiguous, type KeywordSeries } from './searchIntent.ts';

const N = ['ポテンツァ'];

test('태그 — 이름만·한국·비용·불안·효과·정보·장소·부위', () => {
  assert.equal(tagKeyword('ポテンツァ', N), 'name');
  assert.equal(tagKeyword('ポテンツァ 韓国', N), 'korea');
  assert.equal(tagKeyword('韓国 ポテンツァ 値段', N), 'korea');      // 한국이 비용보다 먼저
  assert.equal(tagKeyword('ポテンツァ 値段', N), 'cost');
  assert.equal(tagKeyword('ポテンツァ ダウンタイム', N), 'worry');
  assert.equal(tagKeyword('ポテンツァ 効果ない', N), 'worry');      // 효과 없다 = 불안
  assert.equal(tagKeyword('ポテンツァ 効果', N), 'effect');
  assert.equal(tagKeyword('ポテンツァ とは', N), 'info');
  assert.equal(tagKeyword('ポテンツァ 東京', N), 'place');
  assert.equal(tagKeyword('品川 ポテンツァ', N), 'place');
  assert.equal(tagKeyword('ポテンツァ ニキビ跡', N), 'concern');
  assert.equal(tagKeyword('ポテンツァ マックーム', N), 'other');
  assert.equal(tagKeyword('ポテンツァ 3万円', N), 'cost');
  assert.equal(tagKeyword('円形脱毛症 治療', ['円形脱毛症']), 'name');  // 円 한 글자는 비용이 아님, 治療는 형태라 이름
});

test('부위·대상, 시술 형태만 붙은 말은 이름, 원인·치료법은 정보, 구매는 비용', () => {
  assert.equal(tagKeyword('肩 ボトックス', ['ボトックス']), 'concern');
  assert.equal(tagKeyword('医療脱毛 メンズ', ['医療脱毛']), 'concern');
  assert.equal(tagKeyword('リジュラン 注射', ['リジュラン']), 'name');
  assert.equal(tagKeyword('ミノキシジル 内服', ['ミノキシジル']), 'name');
  assert.equal(tagKeyword('稗粒腫 原因', ['稗粒腫']), 'info');
  assert.equal(tagKeyword('オオサカ堂 ミノキシジル', ['ミノキシジル']), 'cost');
  assert.equal(tagKeyword('イソトレチノイン 怖い', ['イソトレチノイン']), 'worry');
});

test('제외 — 화장품·쇼핑', () => {
  assert.equal(tagKeyword('リジュラン 美容液', ['リジュラン']), 'exclude');
  assert.equal(tagKeyword('リジュラン クリーム 韓国', ['リジュラン']), 'exclude');
  assert.equal(tagKeyword('顔 脱毛 ワックス', ['顔脱毛']), 'exclude');
  assert.equal(tagKeyword('稗粒腫 除去 自分で', ['稗粒腫']), 'exclude');
});

test('제외 — 붙여 쓴 とは 이상값(키워드 플래너가 と は로 쪼개 돌려준 것)', () => {
  assert.equal(tagKeyword('リジュラン と は', ['リジュラン']), 'exclude');
  assert.equal(tagKeyword('医療 ハイフ と は', ['ハイフ']), 'exclude');
  assert.equal(tagKeyword('リジュラン とは', ['リジュラン']), 'info');   // 띄어 쓴 쪽은 그대로 개념
  assert.equal(tagKeyword('リジュランHB とは', ['リジュラン']), 'info');
});

test('belongs — 이름이 들어 있어야 이 시술의 검색어', () => {
  assert.equal(belongs('ポテンツァ 効果', N), true);
  assert.equal(belongs('ダーマペン 効果', N), false);
  assert.equal(belongs('ポ テンツァ', N), true);  // 띄어쓰기 무시
});

const S = (text: string, intent: KeywordSeries['intent'], v: number): KeywordSeries => ({ text, intent, values: Array(24).fill(v) });

test('dedupe — 같은 수치의 어순 변형은 하나만, 작은 값은 그대로', () => {
  const out = dedupe([S('a 効果', 'effect', 500), S('効果 a', 'effect', 500), S('x', 'other', 10), S('y', 'other', 10)]);
  assert.equal(out.length, 3);
});

test('aggregate — 제외는 전체에서 빠지고 한국은 따로', () => {
  const a = aggregate([S('n', 'name', 1000), S('k', 'korea', 100), S('c', 'exclude', 300), S('e', 'effect', 200)], 24);
  assert.equal(a.total[0], 1300);
  assert.equal(a.korea[0], 100);
});

test('profile·stage — 비중이 가장 큰 단계, 수식어 적으면 판단 보류', () => {
  const a = aggregate([S('n', 'name', 5000), S('e', 'effect', 600), S('w', 'worry', 300), S('c', 'cost', 200), S('i', 'info', 100)], 24);
  const p = profile(a)!;
  assert.ok(Math.abs(p.effect - 0.5) < 1e-9);
  assert.equal(stage(p), 'considering');
  // 부위·한국만 있으면 판단 보류
  assert.equal(stage(profile(aggregate([S('n', 'name', 5000), S('c', 'concern', 900), S('k', 'korea', 100)], 24))), null);
  assert.equal(profile(aggregate([S('n', 'name', 5000), S('e', 'effect', 50)], 24)), null);
  assert.equal(stage(null), null);
});

test('다른 뜻 — 태그·전체에서 빠짐·비중 20% 이상이면 점검', () => {
  assert.equal(tagKeyword('ポケモン スカーレット', ['スカーレット']), 'noise');
  assert.equal(tagKeyword('モンブラン スターウォーカー', ['スターウォーカー']), 'noise');
  const a = aggregate([S('n', 'name', 1000), S('p', 'noise', 400)], 24);
  assert.equal(a.total[0], 1000);
  assert.equal(ambiguous(a), true);
  assert.equal(ambiguous(aggregate([S('n', 'name', 1000), S('p', 'noise', 100)], 24)), false);
});

test('이름 자체가 다른 뜻 — 이름 단독은 빼고 수식어 붙은 검색만 센다', () => {
  assert.equal(tagKeyword('フォトナ', ['フォトナ']), 'noise');            // 포트나이트 약칭
  assert.equal(tagKeyword('IPL', ['IPL']), 'noise');                      // 인도 크리켓 리그
  assert.equal(tagKeyword('フォトナ ダウンタイム', ['フォトナ']), 'noise');  // 게임 서버 점검
  assert.equal(tagKeyword('xbox フォトナ', ['フォトナ']), 'noise');
  assert.equal(tagKeyword('フォトナ 値段', ['フォトナ']), 'cost');
  assert.equal(tagKeyword('IPL 効果', ['IPL']), 'effect');
  assert.equal(tagKeyword('インモード', ['インモード']), 'name');           // 다른 시술은 그대로
  // 검색 결과로 확인한 동음이의(수집 때 넘김) — ディスポート는 시설·다트바가 상위 20개 전부
  assert.equal(tagKeyword('ディスポート', ['ディスポート'], new Set(['ディスポート'])), 'noise');
  assert.equal(tagKeyword('ディスポート 効果', ['ディスポート'], new Set(['ディスポート'])), 'effect');
});

test('ownerOf — 더 구체적인 시술 이름이 주인', () => {
  const all = ['ボトックス', 'スキンボトックス', 'エラボトックス'];
  assert.equal(ownerOf('スキン ボトックス 効果', all), 'スキンボトックス');
  assert.equal(ownerOf('ボトックス 値段', all), 'ボトックス');
  assert.equal(ownerOf('ダーマペン', all), null);
});

test('부위 — 手術는 부위가 아님, SBC는 장소', () => {
  assert.notEqual(tagKeyword('ボトックス 手術', ['ボトックス']), 'concern');
  assert.equal(tagKeyword('sbc リジュラン', ['リジュラン']), 'place');
});
