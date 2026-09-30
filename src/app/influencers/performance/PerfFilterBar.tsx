// 인플루언서 성과 — 표 위 한 줄: 검색 → 기간·클라이언트·유형·최소 게시 수 → 오른쪽 끝 중앙값/평균. 스펙 §15-2
// 모양은 정산 필터(CandidateTable의 SEL)·캠페인 검색칸(FlowFilterBar)과 같은 계열. 한 줄 안 컨트롤은 전부 h-8·같은 테두리라
// 높이·선 굵기가 맞는다(SEL의 py-1.5 대신 고정 높이, 옆 토글과 같은 x-border-strong). 좁으면 줄바꿈(가로 스크롤 없음).
'use client';
import { SearchIcon } from '@/components/XIcons';
import { TASK_TYPE_LABEL, type TaskType } from '@/lib/campaignJudgment';
import { DISPLAY_TYPE_ORDER } from '@/lib/campaignFlowView';
import {
  PERIOD_LABEL, MIN_LABEL, EMPTY_FILTER,
  type PerfFilter, type Period, type MinPosted, type Agg,
} from '@/lib/influencerPerformance';

const CTRL = 'h-8 rounded-lg border bg-white text-ui';
// 기본값이 아닌 드롭다운은 켜진 게 보이게 — 테두리·글자만 파랑으로 한 단계(배경은 그대로)
const sel = (on: boolean) => `${CTRL} cursor-pointer pl-2.5 pr-1.5 ${on ? 'border-x-blue text-x-blue-text' : 'border-x-border-strong text-x-text'}`;
const AGGS: Array<[Agg, string]> = [['median', '중앙값'], ['mean', '평균']];
const PERIODS: Period[] = ['all', '30', '90'];
const MINS: MinPosted[] = [1, 2, 3];

export interface ClientOption { id: string; name: string }

export function PerfFilterBar({ filter, clients, onChange, agg, onAgg }: {
  filter: PerfFilter;
  clients: ClientOption[];
  onChange: (patch: Partial<PerfFilter>) => void;
  agg: Agg; onAgg: (agg: Agg) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative">
        <span className="sr-only">핸들·이름 검색</span>
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-x-muted" />
        <input type="search" placeholder="핸들·이름 검색" value={filter.q} onChange={(e) => onChange({ q: e.target.value })}
               className={`${CTRL} w-[200px] pl-8 pr-2.5 outline-none placeholder:text-x-muted focus:border-x-blue ${filter.q.trim() ? 'border-x-blue' : 'border-x-border-strong'}`} />
      </label>
      <select aria-label="기간" title="게시일 기준 — 이 기간에 게시한 작업만으로 성과를 다시 계산해요"
              value={filter.period} onChange={(e) => onChange({ period: e.target.value as Period })}
              className={sel(filter.period !== EMPTY_FILTER.period)}>
        {PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
      </select>
      <select aria-label="클라이언트" title="이 클라이언트 캠페인의 작업만으로 성과를 다시 계산해요"
              value={filter.client} onChange={(e) => onChange({ client: e.target.value })}
              className={sel(filter.client !== EMPTY_FILTER.client)}>
        <option value="">전체 클라이언트</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select aria-label="유형" title="이 유형의 작업만으로 성과를 다시 계산해요"
              value={filter.type} onChange={(e) => onChange({ type: e.target.value as TaskType | '' })}
              className={sel(filter.type !== EMPTY_FILTER.type)}>
        <option value="">전체 유형</option>
        {DISPLAY_TYPE_ORDER.map((t) => <option key={t} value={t}>{TASK_TYPE_LABEL[t]}</option>)}
      </select>
      <select aria-label="최소 게시 수" title="게시한 작업이 이만큼 이상인 인플만 보여요 — 숫자는 바뀌지 않아요"
              value={String(filter.min)} onChange={(e) => onChange({ min: Number(e.target.value) as MinPosted })}
              className={sel(filter.min !== EMPTY_FILTER.min)}>
        {MINS.map((n) => <option key={n} value={n}>{MIN_LABEL[n]}</option>)}
      </select>

      {/* 오른쪽 끝 — 성과 열 전체와 정렬이 이 기준으로 바뀐다(스펙 §4-2) */}
      <div className="ml-auto flex items-center gap-3">
        <span className="text-ui text-x-muted">기본은 중앙값 — 한 번 크게 터진 글에 덜 흔들려요</span>
        <div role="group" aria-label="성과 기준" className="flex h-8 w-fit overflow-hidden rounded-lg border border-x-border-strong">
          {AGGS.map(([v, label], i) => (
            <button key={v} type="button" onClick={() => onAgg(v)} aria-pressed={agg === v}
                    className={`h-full px-3.5 text-ui ${i > 0 ? 'border-l border-x-border-strong' : ''} ${agg === v ? 'bg-x-blue font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
