import { ChartCard, Delta, Legend, VerdictChip } from '@/components/charts/ChartCard';
import { DayBarsChart } from '@/components/charts/DayBarsChart';
import { BubbleScatter } from '@/components/charts/BubbleScatter';
import { FunnelList } from '@/components/charts/FunnelList';
import { CohortGrid } from '@/components/charts/CohortGrid';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { Sparkline } from '@/components/charts/Sparkline';
import { PostScoreTable } from '@/components/charts/PostScoreTable';
import { C, NUM } from '@/components/charts/tokens';
import { NORMAL_RULE, normalRange, spikeThreshold, verdictOf, VERDICT_TEXT, VERDICT_SHORT } from '@/components/charts/normal';
import * as D from './sampleData';

// 차트 키트 샘플(2026-10-09, 사용자 관점 검토 반영) — 실제 부품 + 미모드림 실제 집계값. 사이드바 미노출(주소로만, 로그인 필요).
// 모든 카드: 결론 문장 → 근거 차트 → (있으면) 다음 행동. '평소'는 normal.ts 한 규칙.

const Icon = {
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" /></svg>,
  bookmark: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  list: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  funnel: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z" /></svg>,
  grid: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>,
};

export default function ChartKitSample() {
  // 신규 인입(주)
  const inflowBand = normalRange(D.weeklyInflow);
  const inflowNow = D.weeklyInflow.at(-1) as number, inflowPrev = D.weeklyInflow.at(-2) as number;
  const inflowV = verdictOf(inflowNow, inflowBand);
  // 북마크(주)
  const bmBand = normalRange(D.weeklyX.bookmarks);
  const bmNow = D.weeklyX.bookmarks.at(-1) as number, bmPrev = D.weeklyX.bookmarks.at(-2) as number;
  const costBand = normalRange(D.weeklyX.costPerBookmark);
  // 일별
  const dayBand = normalRange(D.dailyInflow);
  // 클라이언트 개요
  const ov = D.overview.map((o) => { const band = normalRange(o.weekly); const now = o.weekly.at(-1) as number; return { ...o, band, now, v: verdictOf(now, band) }; });
  const aboveNames = ov.filter((o) => o.v === 'above').map((o) => o.name);
  // 게시물
  const best = [...D.postScores].sort((a, b) => b.lift - a.lift)[0];
  const mp = D.postScores.find((p) => p.handle === 'mpchan_a');
  // 코호트 평균(인원 20명 이상 주만)
  const big = D.cohortRows.filter((r) => r.n >= 20);
  const avgAt = (c: number) => { const v = big.filter((r) => r.cells[c] !== null); const n = v.reduce((s, r) => s + r.n, 0); return n ? Math.round(v.reduce((s, r) => s + (r.cells[c] as number) * r.n, 0) / n) : null; };

  return (
    <main style={{ background: '#fff', minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: C.muted }}>차트 키트 샘플 · 미모드림 실제 데이터 (9/28~10/4 기준) · {NORMAL_RULE}</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800 }}>클라이언트 현황 차트</h1>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16 }}>
          <ChartCard icon={Icon.users} title="신규 인입 · 주별" value={`${inflowNow}명`}
            delta={<Delta diff={inflowNow - inflowPrev} unit="명" good="up" base={`그 전주 ${inflowPrev}명`} />}
            headline={<>지난주 신규 인입은 {VERDICT_TEXT[inflowV]} <span style={{ color: C.muted, fontWeight: 400 }}>(평소 {inflowBand[0]}~{inflowBand[1]}명)</span></>}
            definition="그 주에 LINE으로 처음 말을 건 사람 수. 기존 고객 재문의는 빼요."
            legend={<Legend items={[{ label: '지난주', kind: 'bar', color: C.primary }, { label: `평소 ${inflowBand[0]}~${inflowBand[1]}명`, kind: 'band', color: C.band }]} />}>
            <CategoryBars labels={D.weeks} values={D.weeklyInflow} band={inflowBand} format={(v) => `${v}`} />
          </ChartCard>

          <ChartCard icon={Icon.bookmark} title="X 북마크 · 주별" value={NUM.format(bmNow)}
            delta={<Delta diff={bmNow - bmPrev} good="up" base={`그 전주 ${NUM.format(bmPrev)}`} />}
            headline={<>지난주 북마크는 {VERDICT_TEXT[verdictOf(bmNow, bmBand)]} <span style={{ color: C.muted, fontWeight: 400 }}>(평소 {NUM.format(bmBand[0])}~{NUM.format(bmBand[1])})</span></>}
            definition="그 주에 올린 게시물의 북마크 합계. 9월 글은 마지막 측정값, 10월부터는 게시 7일 시점 값이에요.">
            <CategoryBars labels={D.weeklyX.labels} values={D.weeklyX.bookmarks} band={bmBand}
              sub={D.weeklyX.costPerBookmark.map((v) => `${v}원`)} subWarn={D.weeklyX.costPerBookmark.map((v) => v > costBand[1])}
              subLabel="아래 줄 = 북마크 1개당 집행 비용 · 낮을수록 좋아요 · ⚠ 평소보다 비싼 주" />
          </ChartCard>

          <ChartCard icon={Icon.calendar} title="클라이언트별 신규 인입 · 최근 8주"
            headline={aboveNames.length ? `${aboveNames.join('·')}가 지난주 평소보다 많았어요` : '모두 평소 수준이에요'}
            action="닥터손유나는 신규 인입이 늘었지만 예약이 5주째 0건 — 상담에서 막히는지 확인해요">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {ov.map((o, i) => (
                <div key={o.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px auto', alignItems: 'center', gap: 12, minHeight: 60, borderTop: i ? '1px solid #eceff1' : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{o.name} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{o.now}명</b></div>
                    <div style={{ fontSize: 12, color: C.muted }}>평소 {o.band[0]}~{o.band[1]}명{o.note ? ` · ${o.note}` : ''}</div>
                  </div>
                  <Sparkline values={o.weekly} band={o.band} />
                  <VerdictChip verdict={o.v} text={VERDICT_SHORT[o.v]} />
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <ChartCard icon={Icon.users} title="게시물과 신규 인입 · 일별 8주"
          headline="북마크가 많이 나온 글 다음 날, 신규 인입이 튀었어요 (9/17 · 9/28)"
          definition="위: 게시한 날(원 크기 = 그날 글들의 북마크 합, 원 안 숫자 = 글 수). 아래: 하루 신규 인입. 같은 날짜 축, 세로선 = 주 구분."
          legend={<Legend items={[{ label: '게시한 날 · 원 크기 = 북마크', kind: 'dot', color: C.primaryDeep }, { label: `크게 튄 날 (하루 ${spikeThreshold(dayBand)}명 넘음)`, kind: 'bar', color: C.primary }, { label: `평소 하루 ${dayBand[0]}~${dayBand[1]}명`, kind: 'band', color: C.band }]} />}
          action="북마크가 많았던 4nAtumilK·Purichan 글의 형식을 다음 원고에 참고해요">
          <DayBarsChart days={D.days} values={D.dailyInflow} band={dayBand} highlightAbove={spikeThreshold(dayBand)} events={D.postEvents}
            dimBefore={D.recordsFrom} dimText="8월은 게시 기록이 없어 흐리게 표시" notes={D.dayNotes} valueName="신규 인입" height={200} />
        </ChartCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ChartCard icon={Icon.list} title="게시물 성적표 · 조회 2만 이상"
            headline={<>인입을 가장 많이 늘린 글은 {best.handle.replace(/_4HInE$/, '')} (+{best.lift}명){mp ? ` — 조회 ${Math.round(mp.views / 10000)}만인 mpchan_a는 효과가 없었어요` : ''}</>}
            caution="같은 날·다음 날 다른 글이 있으면 효과를 나눌 수 없어요. 그런 글은 막대를 흐리게 표시했어요."
            definition={`인입 증가 = 게시 당일~다음 날 신규 인입 − 평소 하루(${D.typicalDay}명) × 2`}>
            <PostScoreTable rows={D.postScores} baseText={`인입 증가 = 게시 당일~다음 날 신규 인입 − 평소 하루 ${D.typicalDay}명 × 2`} />
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 13, color: C.primaryDeep, cursor: 'pointer' }}>조회수와 인입의 관계를 그래프로 보기</summary>
              <div style={{ marginTop: 8 }}>
                <BubbleScatter points={D.bubbles} xName="조회수 (눈금마다 10배)" yName="인입 증가(명)" />
              </div>
            </details>
          </ChartCard>

          <ChartCard icon={Icon.funnel} title="9월 고객 흐름 · 8월과 비교"
            headline="9월에 상담은 크게 늘었는데(+76명), 예약은 +2명에 그쳤어요"
            action="상담에서 예약으로 이어지지 않은 이유(9월 실주 23건)를 CS와 확인해요">
            <FunnelList steps={D.funnel} compareName="8월" />
          </ChartCard>
        </div>

        <ChartCard icon={Icon.grid} title="첫 문의 후 예약까지 · 첫 문의 주별 누적"
          headline={<>예약하는 사람은 대부분 첫 문의 3일 안에 해요 <span style={{ color: C.muted, fontWeight: 400 }}>(평균 3일 안 {avgAt(1)}% → 30일 안 {avgAt(3)}%)</span></>}
          definition="그 주에 처음 문의한 사람 중 N일 안에 예약한 비율. 빈칸 = 아직 그만큼 시간이 지나지 않음. 평균은 인원 20명 이상인 주만, 인원 가중."
          footnote="LINE 대시보드 일회성 분석(10/9). 리포트 자동 반영은 LINE 쪽 연동 후.">
          <CohortGrid columns={D.cohortColumns} rows={D.cohortRows} max={50} minN={20} />
        </ChartCard>
      </div>
    </main>
  );
}
