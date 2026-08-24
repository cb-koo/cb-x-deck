// 과거 리포트 데이터 1회성 백필 — 일간 + 닫힌 주간·월간 버킷.
// 이미 저장된 버킷은 건너뛴다(--force로 재수집). 분당 60회 제한 준수(1.1초 간격).
// 데이터 시작점 자동 감지: 월간을 최신→과거로 훑다가 활동 0인 달이 2번 연속이면 그 클리닉은 중단.
import { getSql } from '../src/lib/db.ts';
import { fetchReportMetrics, type ReportBundles } from '../src/lib/reportApi.ts';
import { getStoredFetchedAt, taskKey, upsertSnapshot } from '../src/lib/reportStore.ts';
import { addDays, bucketRanges } from '../src/lib/reportSeries.ts';
import { kstToday } from '../src/lib/datetime.ts';

(async () => {
  const sql = getSql();
  try {
    const FROM = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : '2026-04-01';
    const FORCE = process.argv.includes('--force');
    const gap = () => new Promise((r) => setTimeout(r, 1100));

    const looksEmpty = (b: ReportBundles) => {
      const status = b.reservations?.created_at?.status_counts;
      const statusTotal = status ? Object.values(status).reduce((a, x) => a + x, 0) : 0;
      return (b.funnel?.active_customers ?? 0) === 0 && statusTotal === 0;
    };

    const clinics = await sql<{ clinic_code: string }[]>`select clinic_code from client where clinic_code is not null`;
    const today = kstToday();
    const yesterday = addDays(today, -1);
    const stored = await getStoredFetchedAt(sql, clinics.map((c) => c.clinic_code), FROM);
    let calls = 0, saved = 0, skipped = 0;

    async function collect(clinic: string, granularity: 'day' | 'week' | 'month', start: string, end: string): Promise<ReportBundles | null> {
      const key = taskKey({ clinicCode: clinic, granularity, start });
      if (!FORCE && stored.has(key)) { skipped++; return null; }
      calls++;
      const r = await fetchReportMetrics({ clinic, start, end, dateBasis: 'both', compare: 'none', groupBy: 'branch' });
      await gap();
      if (r.kind !== 'ok') { console.error('FAIL', clinic, granularity, start, r); return null; }
      await upsertSnapshot(sql, { clinicCode: clinic, granularity, periodStart: start, periodEnd: end, payload: r.report.current });
      stored.set(key, new Date().toISOString()); // 인접 월의 주간 버킷이 같은 기간을 다시 시도하는 것을 막는다
      saved++;
      return r.report.current;
    }

    for (const { clinic_code: clinic } of clinics) {
      // 최신→과거, 진행 중(아직 안 닫힌) 이번 달도 포함한다 — 일간은 달의 닫힘 여부와 무관하게 항상 수집한다.
      const allMonths = bucketRanges(FROM, yesterday, 'month').reverse();
      let emptyStreak = 0;
      for (const m of allMonths) {
        const isClosed = m.end < today;
        if (isClosed) {
          const payload = await collect(clinic, 'month', m.start, m.end);
          if (payload && looksEmpty(payload)) { emptyStreak++; if (emptyStreak >= 2) { console.log(clinic, m.start, '이전은 데이터 없음으로 판단 — 중단'); break; } }
          else if (payload) emptyStreak = 0;
          for (const w of bucketRanges(m.start, m.end, 'week').filter((w) => w.end < today))
            await collect(clinic, 'week', w.start, w.end);
        }
        const dayStart = m.start < FROM ? FROM : m.start; // 달 첫날이 아니라 --from부터
        const dayEnd = m.end < yesterday ? m.end : yesterday;
        for (const d of bucketRanges(dayStart, dayEnd, 'day'))
          await collect(clinic, 'day', d.start, d.end);
        console.log(clinic, m.start, `누적 호출 ${calls} 저장 ${saved} 건너뜀 ${skipped}`);
      }
    }
    console.log(`완료 — 호출 ${calls}, 저장 ${saved}, 건너뜀 ${skipped}`);
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
