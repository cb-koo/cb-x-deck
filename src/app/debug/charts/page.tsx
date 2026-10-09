import { ChartCard, Delta, VerdictChip } from '@/components/charts/ChartCard';
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

// 차트 키트 샘플(2026-10-09) — 실제 부품 + 미모드림 실제 집계값. 사이드바 미노출(주소로만, 로그인 필요).
// 글 줄이기 원칙: 카드 = 결론 한 줄 + 숫자. 뜻·계산·보는 법·주의는 ? 설명 창(항목별 짧은 줄). 다음 행동은 규칙에 걸린 카드에만.

const Icon = {
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" /></svg>,
  bookmark: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  list: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  funnel: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z" /></svg>,
  scatter: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4v16h16" /><circle cx="9" cy="14" r="1.6" /><circle cx="13" cy="9" r="2.2" /><circle cx="17.5" cy="12" r="1.4" /></svg>,
  grid: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>,
};

export default function ChartKitSample() {
  const inflowBand = normalRange(D.weeklyInflow);
  const inflowNow = D.weeklyInflow.at(-1) as number, inflowPrev = D.weeklyInflow.at(-2) as number;
  const bmBand = normalRange(D.weeklyX.bookmarks);
  const bmNow = D.weeklyX.bookmarks.at(-1) as number, bmPrev = D.weeklyX.bookmarks.at(-2) as number;
  const costBand = normalRange(D.weeklyX.costPerBookmark);
  const dayBand = normalRange(D.dailyInflow);
  const ov = D.overview.map((o) => { const band = normalRange(o.weekly); const now = o.weekly.at(-1) as number; return { ...o, band, now, v: verdictOf(now, band) }; });
  const aboveNames = ov.filter((o) => o.v === 'above').map((o) => o.name);
  const bestG = [...D.postGroupsData].sort((a, b) => b.lift - a.lift)[0];

  return (
    <main style={{ background: '#fff', minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: C.muted }}>차트 키트 샘플 · 미모드림 실제 데이터 · 9/28~10/4 기준</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800 }}>클라이언트 현황 차트</h1>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16 }}>
          <ChartCard icon={Icon.users} title="신규 인입 · 주별" value={`${inflowNow}명`}
            delta={<Delta diff={inflowNow - inflowPrev} unit="명" good="up" base={`그 전주 ${inflowPrev}명`} />}
            headline={`지난주 신규 인입은 ${VERDICT_TEXT[verdictOf(inflowNow, inflowBand)]}`}
            info={{ what: '그 주에 LINE으로 처음 말을 건 사람 수', calc: ['기존 고객 재문의는 빼요', NORMAL_RULE], read: ['파란 막대 = 지난주', '회색 띠 = 평소 범위', '증감에 마우스를 올리면 비교 기준이 보여요'] }}>
            <CategoryBars labels={D.weeks} values={D.weeklyInflow} band={inflowBand} bandLabel={`평소 ${inflowBand[0]}~${inflowBand[1]}`} />
          </ChartCard>

          <ChartCard icon={Icon.bookmark} title="X 북마크 · 주별" value={NUM.format(bmNow)}
            delta={<Delta diff={bmNow - bmPrev} good="up" base={`그 전주 ${NUM.format(bmPrev)}`} />}
            headline={`지난주 북마크는 ${VERDICT_TEXT[verdictOf(bmNow, bmBand)]}`}
            info={{ what: '그 주에 올린 게시물의 북마크 합계', calc: ['9월 글은 마지막 측정값', '10월부터는 게시 7일 시점 값', NORMAL_RULE], read: ['아래 줄 = 북마크 1개당 집행 비용', '⚠ = 평소보다 비싼 주'], note: ['북마크가 신규 인입과 가장 잘 맞는 반응 지표예요'] }}>
            <CategoryBars labels={D.weeklyX.labels} values={D.weeklyX.bookmarks} band={bmBand} bandLabel="평소"
              sub={D.weeklyX.costPerBookmark.map((v) => `${v}원`)} subWarn={D.weeklyX.costPerBookmark.map((v) => v > costBand[1])}
              subLabel="북마크 1개당 비용 · 낮을수록 좋음" />
          </ChartCard>

          <ChartCard icon={Icon.calendar} title="클라이언트별 신규 인입 · 8주"
            headline={aboveNames.length ? `${aboveNames.join('·')}가 평소보다 많았어요` : '모두 평소 수준이에요'}
            info={{ what: '클라이언트마다 지난 8주 신규 인입 흐름', calc: [NORMAL_RULE, '판정은 각 클라이언트 자기 평소와 비교'], read: ['선 끝 파란 점 = 지난주', '회색 띠 = 그 클라이언트의 평소 범위'] }}
            action="닥터손유나는 인입이 늘었지만 예약이 5주째 0건 — 상담 단계를 확인해요">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {ov.map((o, i) => (
                <div key={o.name} title={`평소 ${o.band[0]}~${o.band[1]}명`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px auto', alignItems: 'center', gap: 12, minHeight: 52, borderTop: i ? '1px solid #eceff1' : 'none' }}>
                  <div style={{ fontSize: 14 }}>{o.name} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{o.now}명</b></div>
                  <Sparkline values={o.weekly} band={o.band} />
                  <VerdictChip verdict={o.v} text={VERDICT_SHORT[o.v]} />
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <ChartCard icon={Icon.users} title="게시물과 신규 인입 · 일별 8주"
          headline="북마크가 많이 나온 글 다음 날, 신규 인입이 튀었어요"
          info={{ what: '게시한 날과 그 뒤 하루하루의 신규 인입', read: ['위 원 = 게시한 날, 크기 = 그날 글들의 북마크 합', '원 안 숫자 = 그날 올린 글 수', `파란 막대 = 크게 튄 날(하루 ${spikeThreshold(dayBand)}명 넘음)`, '세로선 = 주 구분'], calc: [`평소 하루 ${dayBand[0]}~${dayBand[1]}명 (${NORMAL_RULE})`, '크게 튄 날 = 평소 위쪽 끝의 2배를 넘는 날'], note: ['8월은 우리 게시 기록이 없어 흐리게 표시해요'] }}>
          <DayBarsChart days={D.days} values={D.dailyInflow} band={dayBand} bandLabel="평소" highlightAbove={spikeThreshold(dayBand)} events={D.postEvents}
            dimBefore={D.recordsFrom} dimText="8월 게시 기록 없음" notes={D.dayNotes} valueName="신규 인입" height={200} />
        </ChartCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ChartCard icon={Icon.list} title="게시물 성적표 · 게시 묶음별"
            headline={`가장 효과가 컸던 건 ${bestG.posts[0].handle.replace(/_4HInE$/, '')} 묶음 (+${bestG.lift}명)`}
            info={{
              what: '게시 묶음마다 신규 인입이 평소보다 얼마나 늘었나',
              calc: ['묶음 = 게시일이 하루 안팎인 글들', `인입 증가 = 묶음 기간 신규 인입 − 평소 하루 ${D.typicalDay}명 × 일수`, `북마크 ${D.MIN_BOOKMARKS} 미만 글 ${D.smallPostCount}개는 영향이 작아 제외`],
              read: ['줄을 누르면 묶음 안 글이 펼쳐져요', '글별 숫자는 북마크 비율로 나눈 추정이에요'],
              note: ['신규 인입은 클리닉 전체 합계라 글 하나의 효과는 직접 잴 수 없어요'],
            }}>
            <PostScoreTable groups={D.postGroupsData} />
          </ChartCard>

          <ChartCard icon={Icon.scatter} title="조회와 인입의 관계 · 게시 묶음별"
            headline="조회가 많다고 인입이 느는 건 아니에요"
            info={{
              what: '게시 묶음마다 조회수와 신규 인입 증가를 한 점으로',
              read: ['오른쪽일수록 조회가 많은 묶음', '위쪽일수록 인입이 많이 늘어난 묶음', '원이 클수록 북마크가 많음', '원에 마우스를 올리면 상세가 보여요'],
              calc: ['가로 눈금은 한 칸마다 10배(1만 → 10만 → 100만)', '인입 증가는 성적표와 같은 셈법'],
              note: ['묶음이 5개뿐이라 경향을 보는 용도예요'],
            }}>
            <BubbleScatter points={D.bubbles} xName="조회수" yName="인입 증가(명)" height={320} />
          </ChartCard>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>

          <ChartCard icon={Icon.funnel} title="9월 고객 흐름 · 8월 비교"
            headline="상담은 크게 늘었는데(+76명), 예약은 +2명에 그쳤어요"
            info={{
              what: '신규 인입에서 방문까지 단계별 사람 수',
              read: ['막대 = 신규 인입 대비 남은 비율', '앞 단계에서 = 바로 앞 단계 중 넘어온 비율', '증감에 마우스를 올리면 8월 값이 보여요'],
              calc: ['상담 = CS가 문의·예약 상담으로 표시한 사람', '예약 = LINE 계정 기준 예약자', '예약·방문은 접수일 기준'],
              note: ['방문은 아직 진행 중이라 8월과 비교하지 않아요'],
            }}
            action="9월 실주 23건 — 상담에서 예약으로 못 넘어간 이유를 CS와 확인해요">
            <FunnelList steps={D.funnel} compareName="8월" />
          </ChartCard>

        <ChartCard icon={Icon.grid} title="첫 문의 후 예약까지 · 주별 누적"
          headline="예약하는 사람은 대부분 첫 문의 3일 안에 해요"
          info={{
            what: '그 주에 처음 문의한 사람 중 N일 안에 예약한 비율',
            read: ['진할수록 높은 비율', '빈칸 = 아직 그만큼 시간이 지나지 않음', '흐린 줄 = 인원 20명 미만(표본 적음)'],
            calc: ['평균 = 인원 20명 이상인 주만, 인원 가중', '평균은 2주 이상 모일 때만 표시'],
            note: ['LINE 대시보드 일회성 분석(10/9) — 자동 반영은 연동 후'],
          }}>
          <CohortGrid columns={D.cohortColumns} rows={D.cohortRows} max={50} minN={20} />
        </ChartCard>
        </div>
      </div>
    </main>
  );
}
