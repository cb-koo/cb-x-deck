// 판정 칩 — 색만으로 읽히지 않게 화살표·글자를 같이 쓴다.
import { STATE_LABEL, type TrendState } from '@/lib/searchTrend';

const STYLE: Record<TrendState, string> = {
  surge: 'bg-green-100 text-green-800',
  up: 'bg-green-50 text-green-700',
  flat: 'bg-x-surface text-x-secondary',
  down: 'bg-red-50 text-red-700',
  peaked: 'bg-amber-50 text-amber-800',
  low: 'text-x-muted',
  nodata: 'text-x-muted',
};
const MARK: Partial<Record<TrendState, string>> = { surge: '▲▲', up: '▲', down: '▼', peaked: '↘' };

export function StateChip({ state }: { state: TrendState }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-ui font-medium ${STYLE[state]}`}>
      {MARK[state] && <span className="mr-0.5">{MARK[state]}</span>}{STATE_LABEL[state]}
    </span>
  );
}
