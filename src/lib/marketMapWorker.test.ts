import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 클리닉 지도 배경지도 worker(public/market-map/maplibre-gl-worker.mjs)는 node_modules에서 손으로 복사한 파일이다.
// maplibre-gl 버전을 올리고 다시 복사하지 않으면 지도와 worker가 어긋나 배경이 안 나온다 — 그때 여기서 실패한다.
// 고치는 법: cp node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs public/market-map/
test('클리닉 지도 worker 파일이 설치된 maplibre-gl과 같다', () => {
  const installed = readFileSync('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', 'utf8');
  const copied = readFileSync('public/market-map/maplibre-gl-worker.mjs', 'utf8');
  assert.ok(installed === copied, 'public/market-map/maplibre-gl-worker.mjs를 node_modules에서 다시 복사해 주세요');
});
