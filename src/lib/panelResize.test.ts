import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPanelWidth, PANEL_DEFAULT, PANEL_MIN, PANEL_MAX } from './panelResize.ts';

test('clampPanelWidth: 정상 범위는 그대로', () => {
  assert.equal(clampPanelWidth(300, 1200), 300);
});

test('clampPanelWidth: 하한·상한에서 고정', () => {
  assert.equal(clampPanelWidth(100, 1200), PANEL_MIN);
  assert.equal(clampPanelWidth(900, 1200), PANEL_MAX);
});

test('clampPanelWidth: 좁은 창에서는 우측 최소 폭(480)이 상한을 낮춘다', () => {
  assert.equal(clampPanelWidth(480, 900), 420); // 900 - 480 = 420
});

test('clampPanelWidth: 상한이 하한보다 작아지는 창 폭은 하한으로 (스택 폴백 구간)', () => {
  assert.equal(clampPanelWidth(400, 600), PANEL_MIN);
});

test('clampPanelWidth: 깨진 저장값(NaN)은 기본 폭', () => {
  assert.equal(clampPanelWidth(Number('abc'), 1200), PANEL_DEFAULT);
});
