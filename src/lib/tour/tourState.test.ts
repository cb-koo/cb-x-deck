import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

(async () => {
  // node 환경엔 window/localStorage가 없으므로 가짜 주입 (모듈은 호출 시점에 전역을 읽음)
  class FakeStorage {
    private m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) { this.m.set(k, v); }
    removeItem(k: string) { this.m.delete(k); }
    clear() { this.m.clear(); }
  }
  const store = new FakeStorage();
  (globalThis as unknown as { window: object }).window = {};
  (globalThis as unknown as { localStorage: FakeStorage }).localStorage = store;

  const { hasSeenTour, markTourSeen, resetTourSeen } = await import('./tourState.ts');

  beforeEach(() => store.clear());

  test('처음엔 안 본 상태', () => {
    assert.equal(hasSeenTour('deck'), false);
  });

  test('mark 후 본 상태로', () => {
    markTourSeen('deck');
    assert.equal(hasSeenTour('deck'), true);
  });

  test('reset 후 다시 안 본 상태', () => {
    markTourSeen('deck');
    resetTourSeen('deck');
    assert.equal(hasSeenTour('deck'), false);
  });

  test('id별로 독립', () => {
    markTourSeen('deck');
    assert.equal(hasSeenTour('briefing'), false);
  });
})();
