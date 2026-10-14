// 판정 칩 — 색만으로 읽히지 않게 화살표·글자를 같이 쓴다.
import { STATE_LABEL, type TrendState } from '@/lib/searchTrend';
import { STAGE_LABEL, STAGE_HINT, type Stage } from '@/lib/searchIntent';
import { INTEREST_LABEL, INTEREST_CONTENT, type Interest } from '@/lib/trendInterest';


const STYLE: Record<TrendState, string> = {
  surge: 'bg-green-100 text-green-800',
  up: 'bg-green-50 text-green-700',
  flat: 'bg-x-surface text-x-secondary',
  down: 'bg-red-50 text-red-700',
  peaked: 'bg-amber-50 text-amber-800',
  spiked: 'bg-amber-50 text-amber-800',
  low: 'text-x-muted',
  nodata: 'text-x-muted',
};
const MARK: Partial<Record<TrendState, string>> = { surge: '▲▲', up: '▲', down: '▼', peaked: '↘', spiked: '↗↘' };

export function StateChip({ state }: { state: TrendState }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-ui font-medium ${STYLE[state]}`}>
      {MARK[state] && <span className="mr-0.5">{MARK[state]}</span>}{STATE_LABEL[state]}
    </span>
  );
}

// 성격(단계) 칩 — 함께 찾는 말로 본 고객 여정 단계. 판단 보류면 대시.

const STAGE_STYLE: Record<Stage, string> = {
  learning: 'bg-sky-50 text-sky-800',
  considering: 'bg-violet-50 text-violet-800',
  choosing: 'bg-orange-50 text-orange-800',
};

export function StageChip({ stage }: { stage: Stage | null }) {
  if (!stage) return <span className="text-ui text-x-muted" title="연관 검색어 부족 — 판단 보류">—</span>;
  return <span title={STAGE_HINT[stage]} className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-ui font-medium ${STAGE_STYLE[stage]}`}>{STAGE_LABEL[stage]}</span>;
}

// 많이 찾는 것 — 전체 시술 평균보다 유난히 많이 찾는 관심사(trendInterest). 색 하나(보라)로 통일하고 글자로 읽게 한다.
export function InterestChip({ interest }: { interest: Interest }) {
  if (!interest) return <span className="text-ui text-x-muted" title="효과·가격 등이 붙은 검색이 월 100건 미만 — 판단 보류">검색 적음</span>;
  if (interest.kind === 'even') return <span className="text-ui text-x-secondary" title="평균보다 1.3배 이상 두드러진 관심사 없음">고르게</span>;
  return (
    <span title={`${INTEREST_LABEL[interest.key]} 검색이 시술 평균의 ${interest.ratio.toFixed(1)}배 → ${INTEREST_CONTENT[interest.key]}`}
          className="inline-block whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-ui font-medium text-violet-800">
      {INTEREST_LABEL[interest.key]} <span className="tabular-nums font-normal">{interest.ratio.toFixed(1)}배</span>
    </span>
  );
}
