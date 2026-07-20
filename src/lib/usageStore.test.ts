import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordUsageSafe, summarizeByApi, summarizeByFeature, summarizeByDay, totalCostUsd, type AggRow } from './usageStore.ts';

const rows: AggRow[] = [
  { api: 'getxapi', operation: 'getxapi.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
  { api: 'getxapi', operation: 'getxapi.thread', model: null, calls: 500, inputTokens: 0, outputTokens: 0 },
  { api: 'exa', operation: 'exa.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
  { api: 'anthropic', operation: 'anthropic.suggest', model: 'claude-haiku-4-5', calls: 1, inputTokens: 1_000_000, outputTokens: 0 },
];

test('recordUsageSafe: PGHOST 없으면 예외 없이 no-op', () => {
  const prev = process.env.PGHOST;
  delete process.env.PGHOST;
  try {
    assert.doesNotThrow(() => recordUsageSafe({ api: 'getxapi', operation: 'getxapi.search' }));
  } finally {
    if (prev !== undefined) process.env.PGHOST = prev;
  }
});

test('summarizeByApi: API별 호출수·비용', () => {
  const out = summarizeByApi(rows);
  const gx = out.find((r) => r.api === 'getxapi')!;
  assert.equal(gx.calls, 1500);
  assert.equal(gx.costUsd, 1.5); // 1500 * 0.001
  const an = out.find((r) => r.api === 'anthropic')!;
  assert.equal(an.costUsd, 1); // 1M in * $1
});

test('summarizeByFeature: 같은 기능 라벨은 합산', () => {
  const out = summarizeByFeature(rows);
  const search = out.find((r) => r.feature === '트윗 검색')!;
  assert.equal(search.calls, 1000);
  // getxapi.thread → '트윗 확장 탐색' 로 별도 집계
  assert.ok(out.some((r) => r.feature === '트윗 확장 탐색' && r.calls === 500));
});

test('summarizeByDay: 일별 비용 합', () => {
  const daily = [
    { day: '2026-07-19', api: 'getxapi', operation: 'getxapi.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-07-19', api: 'exa', operation: 'exa.search', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-07-20', api: 'getxapi', operation: 'getxapi.search', model: null, calls: 2000, inputTokens: 0, outputTokens: 0 },
  ];
  const out = summarizeByDay(daily);
  assert.deepEqual(out, [
    { day: '2026-07-19', costUsd: 8 }, // 1 + 7
    { day: '2026-07-20', costUsd: 2 },
  ]);
});

test('totalCostUsd', () => {
  assert.equal(totalCostUsd(rows), 1.5 + 7 + 1);
});
