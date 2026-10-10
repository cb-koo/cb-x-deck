// 캠페인 주차(달 경계에서 잘린 주) 리포트 1회성 백필 — 클라이언트 현황의 짧은 주차를 정확한 사람 수로(스펙 §2, koo 10-10).
// 새벽 동기화는 최근 90일만 채우므로 그 전(2월~)은 이 스크립트로 한 번 채운다. 꽉 찬 월~일은 주별 스냅샷으로 충분해 건너뛴다.
// 운영 DB에 쓴다 — koo 확인 후 실행: node --import tsx --env-file=.env scripts/backfill-cweek.ts --from 2026-02-23 [--force]
// REPORT_API_KEY가 필요하다(운영 환경변수). 분당 60회 제한 준수(1.1초 간격). 이미 있는 주차는 건너뛴다(--force로 재수집).
import { getSql } from '../src/lib/db.ts';
import { fetchReportMetrics } from '../src/lib/reportApi.ts';
import { getStoredFetchedAt, taskKey, upsertSnapshot } from '../src/lib/reportStore.ts';
import { campaignWeekOf, nextCampaignWeek } from '../src/lib/campaignWeek.ts';
import { kstToday } from '../src/lib/datetime.ts';

(async () => {
  const sql = getSql();
  try {
    const FROM = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : '2026-02-23';
    const FORCE = process.argv.includes('--force');
    if (!process.env.REPORT_API_KEY) throw new Error('REPORT_API_KEY가 없어요 — 운영 환경변수로 실행해 주세요');
    const clinics = (await sql<{ clinic_code: string }[]>`select clinic_code from client where clinic_code is not null`).map((c) => c.clinic_code);
    const today = kstToday();
    const stored = await getStoredFetchedAt(sql, clinics, FROM);
    let saved = 0, skipped = 0;
    const failed: string[] = [];
    for (const clinic of clinics) {
      for (let w = campaignWeekOf(FROM); w.end < today; w = nextCampaignWeek(w)) {
        if (w.days === 7 || w.start < FROM) continue;
        if (!FORCE && stored.has(taskKey({ clinicCode: clinic, granularity: 'cweek', start: w.start }))) { skipped++; continue; }
        const r = await fetchReportMetrics({ clinic, start: w.start, end: w.end, dateBasis: 'both', compare: 'none', groupBy: 'branch' });
        if (r.kind === 'ok') { await upsertSnapshot(sql, { clinicCode: clinic, granularity: 'cweek', periodStart: w.start, periodEnd: w.end, payload: r.report.current }); saved++; }
        else failed.push(`${clinic} ${w.start}: ${r.kind === 'rate_limited' ? 'rate limited' : r.message}`);
        await new Promise((res) => setTimeout(res, 1100));
      }
    }
    console.log(`저장 ${saved} · 건너뜀 ${skipped} · 실패 ${failed.length}`);
    for (const f of failed) console.log('  실패', f);
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
