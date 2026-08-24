// 실 API 응답을 fixtures/에 저장 — reportSeries 파생 테스트와 화면 개발의 참조용.
// 실행: node --import tsx --env-file-if-exists=.env scripts/capture-report-fixtures.ts
import { writeFileSync } from 'node:fs';
import { fetchReportMetrics } from '../src/lib/reportApi.ts';

const CASES = [
  { name: 'report-month-velyb-2026-07', clinic: 'velybjp', start: '2026-07-01', end: '2026-07-31', compare: 'calendar' as const },
  { name: 'report-day-velyb-2026-07-15', clinic: 'velybjp', start: '2026-07-15', end: '2026-07-15', compare: 'none' as const },
  { name: 'report-week-sonyouna-2026-07-06', clinic: 'sonyounajp', start: '2026-07-06', end: '2026-07-12', compare: 'none' as const },
];
(async () => {
  for (const c of CASES) {
    const r = await fetchReportMetrics({ clinic: c.clinic, start: c.start, end: c.end, dateBasis: 'both', compare: c.compare, groupBy: 'branch' });
    if (r.kind !== 'ok') { console.error(c.name, r); process.exit(1); }
    writeFileSync(`fixtures/${c.name}.json`, JSON.stringify(r.report, null, 2));
    console.log('saved', c.name);
    await new Promise((res) => setTimeout(res, 1200)); // 분당 60회 제한
  }
})();
