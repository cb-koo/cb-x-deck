import { ChartCard, Delta, Legend } from '@/components/charts/ChartCard';
import { TimeCompareChart } from '@/components/charts/TimeCompareChart';
import { DayBarsChart } from '@/components/charts/DayBarsChart';
import { BubbleScatter } from '@/components/charts/BubbleScatter';
import { FunnelList } from '@/components/charts/FunnelList';
import { CohortGrid } from '@/components/charts/CohortGrid';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { Sparkline } from '@/components/charts/Sparkline';
import { C } from '@/components/charts/tokens';
import * as D from './sampleData';

// 차트 키트 샘플(2026-10-09) — 실제 부품 + 미모드림 실제 집계값. 클라이언트 현황 리포트에 들어갈 부품을 확인하는 화면.
// 사이드바에 노출하지 않는다(주소로만 접근, 로그인 필요).

const Icon = {
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" /></svg>,
  bookmark: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  scatter: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4v16h16" /><circle cx="9" cy="14" r="1.6" /><circle cx="13" cy="9" r="2.2" /><circle cx="17.5" cy="12" r="1.4" /></svg>,
  funnel: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z" /></svg>,
  grid: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>,
};

export default function ChartKitSample() {
  const cur = D.weekCompare.current.reduce((a, b) => a + b, 0);
  const prev = D.weekCompare.previous.reduce((a, b) => a + b, 0);
  return (
    <main style={{ background: '#fff', minHeight: '100vh', color: C.text }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 24px 64px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: C.muted }}>차트 키트 샘플 · 미모드림 실제 데이터 (9/28~10/4 기준)</div>
          <h1 style={{ margin: '4px 0 0', fontSize: 24, fontWeight: 800 }}>클라이언트 현황 차트</h1>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <ChartCard icon={Icon.users} title="신규 인입" value={`${cur}명`} delta={<Delta value={((cur - prev) / prev) * 100} />}
            subtitle="요일별 신규 인입" definition="그 기간에 LINE으로 처음 말을 건 사람 수(기존 고객 재문의 제외)"
            legend={<Legend items={[{ label: '9/28~10/4', kind: 'line', color: C.primary }, { label: '9/21~9/27', kind: 'dash', color: C.primarySoft }]} />}>
            <TimeCompareChart labels={D.weekCompare.labels} current={D.weekCompare.current} previous={D.weekCompare.previous}
              currentName="9/28 주" previousName="9/21 주" unit="명" />
          </ChartCard>

          <ChartCard icon={Icon.bookmark} title="X 북마크" value="3,110" valueSub="직전 4주 평균 1,424" delta={<Delta value={((3110 - 1424) / 1424) * 100} />}
            subtitle="주별 북마크" definition="그 주에 올린 게시물의 북마크 합계. 9월 글은 마지막 측정값, 10월부터 게시 7일 시점 값"
            footnote="막대 아래 = 북마크 1개당 집행 비용">
            <CategoryBars labels={D.weeklyX.labels} values={D.weeklyX.bookmarks} sub={D.weeklyX.costPerBookmark.map((v) => `${v}원`)} />
          </ChartCard>

          <ChartCard icon={Icon.calendar} title="클라이언트별 신규 인입" subtitle="최근 8주 · 띠 = 평소 범위">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {D.overview.map((o, i) => (
                <div key={o.name} style={{ display: 'grid', gridTemplateColumns: '1fr 100px 64px', alignItems: 'center', gap: 12, minHeight: 52, borderTop: i ? '1px solid #eceff1' : 'none' }}>
                  <div style={{ fontSize: 14 }}>{o.name}<div style={{ fontSize: 12, color: C.muted }}>평소 {o.band[0]}~{o.band[1]}명</div></div>
                  <Sparkline values={o.weekly} band={o.band} />
                  <div style={{ textAlign: 'right', fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{o.weekly[o.weekly.length - 1]}명</div>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>

        <ChartCard icon={Icon.users} title="게시물과 신규 인입" subtitle="반응 좋은 글이 나온 날, 신규 인입이 튀어요"
          definition="위: 게시물(원 크기 = 조회수, 진하기 = 북마크율). 아래: 하루 신규 인입. 같은 날짜 축, 세로선 = 주 구분"
          legend={<Legend items={[{ label: '게시물 (진할수록 북마크율 높음)', kind: 'dot', color: C.primaryDeep }, { label: '크게 튄 날 (하루 10명 넘음)', kind: 'bar', color: C.primary }, { label: '그 외', kind: 'bar', color: C.neutralBar }, { label: '평소 하루 2~5명', kind: 'band', color: C.band }]} />}>
          <DayBarsChart days={D.days} values={D.dailyInflow} band={D.dailyBand} highlightAbove={D.dailySpike} events={D.postEvents}
            eventEmpty={{ until: '2026-08-31', text: '캠페인 기록 없음 (9월부터 기록)' }} notes={D.dayNotes} valueName="신규 인입" height={200} />
        </ChartCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
          <ChartCard icon={Icon.scatter} title="게시물별 반응과 인입" subtitle="조회가 많다고 인입이 느는 건 아니에요"
            definition="가로 = 조회수(로그 눈금), 세로 = 게시 당일~다음 날 신규 인입이 평소보다 늘어난 수, 원 크기 = 북마크 수"
            footnote="같은 날 다른 글이 겹친 경우는 효과를 나눠 볼 수 없어요. 원에 마우스를 올리면 상세가 보여요.">
            <BubbleScatter points={D.bubbles} xName="조회수" yName="인입 증가(명)" />
          </ChartCard>

          <ChartCard icon={Icon.funnel} title="9월 고객 흐름" value="26명" valueSub="예약자" delta={<Delta value={((26 - 24) / 24) * 100} />}
            subtitle="신규 인입에서 방문까지 (8월 대비)">
            <FunnelList steps={D.funnel} compareName="8월" />
          </ChartCard>
        </div>

        <ChartCard icon={Icon.grid} title="첫 문의 후 예약까지" subtitle="첫 문의 주별, 며칠 안에 예약했는지 (누적)"
          definition="그 주에 처음 문의한 사람 중 N일 안에 예약한 비율. 빈칸 = 아직 그만큼 시간이 지나지 않음"
          footnote="LINE 대시보드 일회성 분석(10/9). 리포트 자동 반영은 LINE 쪽 연동 후. 평균은 인원 가중.">
          <CohortGrid columns={D.cohortColumns} rows={D.cohortRows} max={50} />
        </ChartCard>
      </div>
    </main>
  );
}
