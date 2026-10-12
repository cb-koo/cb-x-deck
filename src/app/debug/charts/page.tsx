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
import * as P from './partsData';
import * as X from './extrasData';
import { GrowthCurves } from '@/components/charts/GrowthCurves';
import { BulletList } from '@/components/charts/BulletList';
import { DotStrip, Histogram } from '@/components/charts/Distribution';
import { SmallMultiples } from '@/components/charts/SmallMultiples';
import { SegmentedBar, SegmentLegend } from '@/components/charts/SegmentedBar';
import { BarList } from '@/components/charts/BarList';
import { LineChart } from '@/components/charts/LineChart';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { BarSparkline } from '@/components/charts/BarSparkline';
import { Donut } from '@/components/charts/Donut';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';

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
            action="9월 미예약 23건 — 상담에서 예약으로 못 넘어간 이유를 CS와 확인해요">
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

        <div style={{ marginTop: 32, borderTop: '1px solid #e6ebee', paddingTop: 24 }}>
          <div style={{ fontSize: 13, color: C.muted }}>기존 화면(리포트·캠페인·인플루언서·덱·사용량·트래킹)에 쓰는 부품 · 실제 데이터</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>기존 화면용 부품</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ChartCard icon={Icon.list} title="구간 막대 · 캠페인 카드"
            headline="작업 8개 중 4개 게시, 비용은 계획의 64% 집행"
            info={{ what: '진행 막대·구간 진행 막대·미니 막대를 하나의 부품으로', read: ['진한 파랑 = 끝난 것(게시·집행)', '연한 파랑 = 예정', '% 라벨은 끝난 구간 끝을 따라 움직여요'] }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, color: C.secondary, marginBottom: 6 }}>작업 현황 · 게시 {P.campaign.posted} / {P.campaign.live}</div>
                <SegmentedBar total={P.campaign.live} segments={[{ value: P.campaign.posted, color: C.primary, label: '게시' }]} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: C.secondary, marginBottom: 2 }}>캠페인 비용 · 집행 {NUM.format(P.campaign.spent)}원 / 계획 {NUM.format(P.campaign.planned)}원</div>
                <SegmentedBar total={P.campaign.planned} pct={{ upTo: 0 }} segments={[{ value: P.campaign.spent, color: C.primary, label: '집행' }, { value: P.campaign.planned - P.campaign.spent, color: '#cfe6f7', label: '예정' }]} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 13, color: C.secondary, marginBottom: 4 }}>캠페인 목록 미니 막대</div>
                {P.campaignRows.map((r) => (
                  <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 32, fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    <SegmentedBar size="mini" total={r.live} segments={[{ value: r.posted, color: C.primary, label: '게시' }, { value: r.assigned - r.posted, color: '#cfe6f7', label: '배정' }]} />
                    <span style={{ width: 32, textAlign: 'right', color: C.secondary, fontVariantNumeric: 'tabular-nums' }}>{r.posted}/{r.live}</span>
                  </div>
                ))}
              </div>
            </div>
          </ChartCard>

          <ChartCard icon={Icon.calendar} title="구간 막대 · 클라이언트 예산"
            value={`${NUM.format(P.budget.total - P.budget.othersSpent - P.budget.othersPending - P.budget.thisSpent - P.budget.thisPending)}원`} valueSub="남을 예산"
            headline="모든 작업을 마쳐도 예산의 74%가 남아요"
            info={{ what: '이 기간 예산이 어디에 쓰였고 쓰일지', read: ['왼쪽부터 다른 캠페인 집행 → 예정 → 이 캠페인 집행 → 예정', '빈 칸 = 남는 예산'], calc: ['남을 예산 = 예산 − 모든 집행 − 모든 예정'] }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SegmentedBar total={P.budget.total} segments={[
                { value: P.budget.othersSpent, color: '#536471', label: '다른 캠페인 집행' }, { value: P.budget.othersPending, color: '#c9d3d9', label: '다른 캠페인 예정' },
                { value: P.budget.thisSpent, color: C.primary, label: '이 캠페인 집행' }, { value: P.budget.thisPending, color: '#cfe6f7', label: '이 캠페인 예정' }]} />
              <SegmentLegend unit="원" items={[
                { label: '다른 캠페인 집행', value: P.budget.othersSpent, color: '#536471' }, { label: '다른 캠페인 예정', value: P.budget.othersPending, color: '#c9d3d9' },
                { label: '이 캠페인 집행', value: P.budget.thisSpent, color: C.primary }, { label: '이 캠페인 예정', value: P.budget.thisPending, color: '#cfe6f7' }]} />
              <div style={{ fontSize: 13, color: C.secondary, marginTop: 8 }}>매출 구성 · 미모드림 9월(방문일 기준)</div>
              <SegmentedBar inBar total={P.revenueSept.first + P.revenueSept.repeat} segments={[{ value: P.revenueSept.first, color: C.primaryDeep, label: '초진' }, { value: P.revenueSept.repeat, color: '#7cc4f4', label: '재진' }]} />
              <SegmentLegend unit="원" items={[{ label: '초진', value: P.revenueSept.first, color: C.primaryDeep }, { label: '재진', value: P.revenueSept.repeat, color: '#7cc4f4' }]} />
            </div>
          </ChartCard>

          <ChartCard icon={Icon.bookmark} title="막대 목록 · 순위"
            headline="9월 북마크는 Purichan과 4nAtumilK가 이끌었어요"
            info={{ what: '항목별 값을 큰 순서로', read: ['1위만 주색, 나머지는 연하게', '값은 오른쪽 글자'], note: ['지점별 매출·기능별 비용·주간 추이에도 같은 부품'] }}>
            <BarList items={P.influencerBookmarks} />
          </ChartCard>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ChartCard icon={Icon.users} title="다계열 선 · 인입·상담·예약자"
            headline="9월부터 인입과 상담이 함께 늘었어요"
            info={{ what: '주별 인입·상담·예약자 수(미모드림)', read: ['계열 이름은 선 끝에', '마우스를 올리면 그 주 세 값을 함께 보여 줘요'], calc: ['인입 = 대화가 있었던 사람(기존 고객 포함)', '예약자 = LINE 계정 기준'] }}>
            <LineChart labels={P.weeks} series={[{ name: '인입', values: P.inflow }, { name: '상담', values: P.consulted }, { name: '예약자', values: P.reservers }]} />
          </ChartCard>

          <ChartCard icon={Icon.funnel} title="선 + 기준 띠 · 취소·노쇼율"
            headline="8월 첫 주(50%)를 빼면 0~13% 사이에서 움직여요"
            info={{ what: '주별 (취소+노쇼) ÷ 전체 예약', read: ['회색 띠 = 업계 통상 5~8%', '끊긴 곳 = 예약 5건 미만이라 비움'], note: ['예약이 적은 주는 한두 건으로 크게 흔들려요'] }}>
            <LineChart labels={P.weeks} series={[{ name: '취소·노쇼', values: P.cancelRate }]} band={{ range: [5, 8], label: '업계 통상 5~8%' }} unit="%" />
          </ChartCard>

          <ChartCard icon={Icon.users} title="세로 막대 · 음수 · 기록 없음"
            headline="LINE 친구 증감은 8월 말부터 기록돼요"
            info={{ what: '주별 LINE 친구 증감', read: ['옅은 칸 + 없음 = 기록 없음(0이 아니라 모름)', '막대 위 숫자 = 그 주 값'] }}>
            <ColumnChart labels={P.weeks} series={[{ name: '친구 증감', values: P.followerChange, color: C.primary }]} />
          </ChartCard>

          <ChartCard icon={Icon.users} title="세로 막대 · 음수"
            headline="신규 인입은 주마다 크게 오르내려요"
            info={{ what: '신규 인입의 전주 대비 증감', read: ['위 = 늘어난 주(주색)', '아래 = 줄어든 주(회색)'] }}>
            <ColumnChart labels={P.weeks.slice(1)} series={[{ name: '전주 대비', values: P.newDiff, color: C.primary }]} unit="명" />
          </ChartCard>

          <ChartCard icon={Icon.bookmark} title="누적 세로 막대 · 매출 초진/재진"
            headline="9/28 주 접수 매출이 12주 중 가장 커요"
            info={{ what: '주별 접수 기준 매출(만원)', read: ['진한 = 초진, 연한 = 재진', '마우스를 올리면 합계도 보여요'] }}>
            <ColumnChart labels={P.weeks} series={[{ name: '초진', values: P.revFirst, color: C.primaryDeep }, { name: '재진', values: P.revRepeat, color: '#7cc4f4' }]} unit="만" />
          </ChartCard>

          <ChartCard icon={Icon.grid} title="도넛 · 9월 작업 유형"
            headline="9월 작업의 79%가 인용RT였어요"
            info={{ what: '9월에 시작한 캠페인의 작업 유형 구성(취소 제외)', read: ['큰 조각부터 12시 방향', '오른쪽 목록 = 건수와 비율'] }}>
            <Donut items={P.taskTypes} centerLabel="작업" />
          </ChartCard>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ChartCard icon={Icon.calendar} title="달력 히트맵 · 일별 신규 인입"
            headline="튄 날이 9월 중순과 말에 몰려 있어요"
            info={{ what: '미모드림 8주 하루 신규 인입', read: ['열 = 주, 행 = 요일', '진할수록 많음', '칸에 마우스를 올리면 값이 보여요'], calc: ['색 단계는 0을 뺀 값의 4분위로 나눔'] }}>
            <CalendarHeatmap days={D.days} values={D.dailyInflow} valueName="신규 인입" unit="명" />
          </ChartCard>

          <ChartCard icon={Icon.list} title="작은 막대 추이 · 표 한 줄"
            headline="최근 7일 신규 인입"
            info={{ what: '표 한 줄 안에 넣는 7일 막대', read: ['마지막 날만 주색', '막대에 마우스를 올리면 값'] }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {P.clientDaily.map((c, i) => (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, borderTop: i ? '1px solid #eceff1' : 'none', fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <BarSparkline values={c.values} labels={P.last7} unit="명" />
                  <b style={{ width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.values.reduce((a, b) => a + b, 0)}명</b>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <div style={{ marginTop: 32, borderTop: '1px solid #e6ebee', paddingTop: 24 }}>
          <div style={{ fontSize: 13, color: C.muted }}>아직 쓰지 않지만 곧 쓸 차트 · 실제 데이터</div>
          <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>추가 차트</h2>
        </div>

        <ChartCard icon={Icon.users} title="경과 시간별 누적 조회 · 9/25~10/8 게시물"
          headline="Purichan 9/28 글은 첫날부터 다른 글들과 전혀 다른 속도로 컸어요"
          info={{ what: '게시 후 시간이 지나며 조회가 어떻게 쌓였나', read: ['파란 선 = 강조한 글', '회색 선 = 다른 글', '회색 띠 = 같은 시각 다른 글들의 가운데 절반', '마우스를 올리면 그 시각 값과 비교가 보여요'], calc: ['가로·세로 모두 눈금마다 배로 늘어요(1·2·4·8시간…, 1천·1만·10만…)', '측정은 게시 후 15분~7일 자동 측정 기록'], note: ['10월 초 글부터 측정이 촘촘해요. 그 전 글은 측정 간격이 들쭉날쭉해요'] }}>
          <GrowthCurves curves={X.curves} highlightId={X.highlightCurve} />
        </ChartCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'start' }}>
          <ChartCard icon={Icon.calendar} title="불릿 · 10월 예산 소진 속도 (10/9 기준)"
            headline="더스퀘어치과만 적정 속도, 나머지 3곳은 집행이 느려요"
            info={{ what: '이번 기간 예산을 날짜에 맞게 쓰고 있나', read: ['진한 파랑 = 집행', '연한 파랑 = 예정까지 포함', '검은 세로선 = 오늘 기준 적정 소진선'], calc: ['적정 = 기간이 지난 비율 × 예산', '집행이 적정보다 10%p 넘게 낮으면 느림, 높으면 빠름'] }}>
            <BulletList rows={X.budgets} />
          </ChartCard>

          <ChartCard icon={Icon.funnel} title="히스토그램 · 첫 문의 후 방문까지"
            headline="가장 많은 건 첫 문의 후 15~30일에 방문(31%)"
            info={{ what: '미모드림 고객이 첫 문의 후 며칠 만에 방문했나', read: ['막대 위 = 전체 중 비율', '파란 막대 = 가운데값(17일)이 든 구간'], note: ['LINE 대시보드 일회성 분석(10/9)'] }}>
            <Histogram buckets={X.leadBuckets} medianIndex={3} unit="명" />
          </ChartCard>
        </div>

        <ChartCard icon={Icon.scatter} title="점 분포 · 9월 게시물 조회당 비용"
          headline="같은 클라이언트 안에서도 조회당 비용이 100배 넘게 차이 나요"
          info={{ what: '9월 인용RT 게시물 하나하나의 조회당 비용', read: ['점 하나 = 게시물 하나', '검은 세로 막대 = 그 클라이언트의 가운데값', '점에 마우스를 올리면 상세'], calc: ['조회당 비용 = 작업 비용 ÷ 마지막으로 잰 조회', '가로 눈금은 칸마다 10배'] }}>
          <DotStrip rows={X.cpvRows} unit="원" ticks={[0.1, 1, 10, 100]} />
        </ChartCard>

        <ChartCard icon={Icon.grid} title="작은 차트 나란히 · 클라이언트별 신규 인입 12주"
          headline="같은 눈금으로 보면 9월에 크게 늘어난 건 미모드림이에요"
          info={{ what: '같은 지표를 클라이언트마다 같은 모양·같은 세로 눈금으로', read: ['파란 막대 = 지난주', '회색 띠 = 그 클라이언트의 평소 범위', '세로 눈금을 공유해서 크기를 바로 비교할 수 있어요'] }}>
          <SmallMultiples items={X.multiples} labels={X.multiWeeks} unit="명" />
        </ChartCard>
      </div>
    </main>
  );
}
