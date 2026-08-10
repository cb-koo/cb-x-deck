// /generate 워크벤치 좌패널 폭 — 드래그 리사이즈의 경계 규칙 (스펙 2026-08-10 §경계 조건)
export const PANEL_MIN = 260; // 컨트롤이 깨지지 않는 하한
export const PANEL_MAX = 480;
export const PANEL_DEFAULT = 300;
export const RESULTS_MIN = 480; // 우측 카드 영역이 확보해야 하는 최소 폭
export const PANEL_WIDTH_KEY = 'cbx-composer-width';

// 상한은 창 폭에 따라 동적 — 우측이 RESULTS_MIN을 못 지키면 상한을 낮춘다.
// 상한이 하한 아래로 내려가는 창 폭은 스택 폴백(<lg) 구간이므로 하한으로 고정.
export function clampPanelWidth(width: number, containerWidth: number): number {
  if (!Number.isFinite(width)) return PANEL_DEFAULT;
  const max = Math.max(PANEL_MIN, Math.min(PANEL_MAX, containerWidth - RESULTS_MIN));
  return Math.min(Math.max(width, PANEL_MIN), max);
}
