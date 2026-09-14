// src/lib/runQueue.ts — 동시 N개로 항목을 처리하는 작은 스케줄러(일괄 분석용). 실패는 모아 돌려주고 나머지는 계속.
export async function runQueue<T>(
  items: T[], worker: (item: T) => Promise<void>, concurrency: number,
  onSettled?: (item: T, ok: boolean) => void,
): Promise<{ ok: number; failed: T[] }> {
  const queue = [...items];
  const failed: T[] = [];
  let ok = 0;
  async function lane() {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try { await worker(item); ok += 1; onSettled?.(item, true); }
      catch { failed.push(item); onSettled?.(item, false); }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  return { ok, failed };
}
