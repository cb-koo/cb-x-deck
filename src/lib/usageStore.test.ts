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

test('summarizeByDay: range를 주면 기록 없는 날도 0원 막대로 채워 7일이 모두 나온다', () => {
  // 실제 제보 재현: 8/2~8/3(주말)엔 사용 기록이 아예 없어 막대가 5개만 나왔다.
  // range를 주면 그 이틀도 0원 자리로 채워져 라벨("최근 7일")과 막대 수가 맞아야 한다.
  const daily = [
    { day: '2026-08-04', api: 'getxapi', operation: '', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-08-05', api: 'getxapi', operation: '', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-08-06', api: 'getxapi', operation: '', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-08-07', api: 'getxapi', operation: '', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
    { day: '2026-08-08', api: 'getxapi', operation: '', model: null, calls: 1000, inputTokens: 0, outputTokens: 0 },
  ];
  const from = new Date('2026-08-02T00:00:00+09:00'); // 한국 자정, "최근 7일"의 시작
  const to = new Date('2026-08-08T14:06:00+09:00'); // 제보 당시 "지금"
  const out = summarizeByDay(daily, { from, to });
  assert.deepEqual(out.map((d) => d.day), [
    '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
  ]);
  assert.equal(out[0].costUsd, 0); // 8/2 — 주말, 기록 없음
  assert.equal(out[1].costUsd, 0); // 8/3 — 주말, 기록 없음
  assert.equal(out[2].costUsd, 1); // 8/4 — 1000 * 0.001
});

test('totalCostUsd', () => {
  assert.equal(totalCostUsd(rows), 1.5 + 7 + 1);
});
