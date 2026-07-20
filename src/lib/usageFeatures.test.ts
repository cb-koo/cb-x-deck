import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureLabel, apiLabel } from './usageFeatures.ts';

test('operation → 기능 라벨', () => {
  assert.equal(featureLabel('getxapi.search'), '트윗 검색');
  assert.equal(featureLabel('getxapi.thread'), '트윗 확장 탐색');
  assert.equal(featureLabel('exa.search'), '웹 기사 검색');
  assert.equal(featureLabel('anthropic.suggest'), '키워드 추천');
  assert.equal(featureLabel('anthropic.translateTags'), '번역');
  assert.equal(featureLabel('anthropic.briefing'), '브리핑 생성');
});

test('미지 operation은 원문 폴백', () => {
  assert.equal(featureLabel('getxapi.unknown'), 'getxapi.unknown');
});

test('apiLabel', () => {
  assert.equal(apiLabel('getxapi'), 'getxapi (X 데이터)');
  assert.equal(apiLabel('exa'), 'Exa (웹 검색)');
  assert.equal(apiLabel('anthropic'), 'Anthropic (AI)');
});
