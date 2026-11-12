// 캠페인 현황 — 주차 캠페인 카드 한 장(스펙 §4-3, 시안 card()).
// 머리 / 진행 / 성과 / 흐름 / 더 보기, 다섯 층을 가로선과 바탕으로 가른다(koo: 정보 구분이 잘 되게).
// 숫자는 전부 card.perf·card.quantity 그대로 — 여기서 다시 계산하면 패널·캠페인 상세와 어긋난다.
import { formatCpv, type OverviewCard, type CardStatus } from '@/lib/campaignOverview';
import { CumulativeArea } from '@/components/charts/CumulativeArea';
import { compact, NUM } from '@/components/charts/tokens';
import { ProgressBar } from './OverviewTiles';

export type OverviewMetric = 'views' | 'bookmarks';
export const METRIC_LABEL: Record<OverviewMetric, string> = { views: '조회수', bookmarks: '저장수' };

// 네 칩 모두 같은 자리·같은 모양, 색만 다르다(시안 .chip.*)
const CHIP: Record<CardStatus, string> = {
  late: 'bg-[#fff4e5] text-[#b45309]',
  done: 'bg-[#e8f6f0] text-[#0a7d54]',
  onTrack: 'bg-x-surface text-x-secondary',
  unset: 'border border-dashed border-x-border-strong bg-white text-x-secondary',
};

const ZONE = 'border-t border-x-border px-[18px] py-[14px]';
const ZONE_LABEL = 'mb-2 text-[12px] font-semibold text-x-muted';

// 가로 글자: 이번 주(7칸)는 요일 한 글자, 지난 주(게시 뒤 2주까지 늘어남)는 M/D
export function chartLabels(days: string[]): string[] {
  if (days.length <= 7) return days.map((_, i) => '월화수목금토일'[i]);
  return days.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`);
}

function Head({ card }: { card: OverviewCard }) {
  return (
    <div className="flex items-center justify-between gap-2 px-[18px] pb-[14px] pt-4">
      <div className="truncate text-[16px] font-bold">{card.title}</div>
      <span className={`flex-none whitespace-nowrap rounded-full px-[10px] py-[3px] text-[12.5px] font-semibold ${CHIP[card.status]}`}>{card.statusLabel}</span>
    </div>
  );
}

export function CampaignCard({ card, metric, open, onOpen }: { card: OverviewCard; metric: OverviewMetric; open: boolean; onOpen: () => void }) {
  // 세팅 전 — 진행·성과가 아직 없으니 층 대신 안내 두 줄(점선 = 아직 비어 있는 자리)
  if (card.status === 'unset') {
    return (
      <div className="flex flex-col overflow-hidden rounded-[14px] border border-dashed border-x-border-strong bg-white">
        <Head card={card} />
        <div className="border-t border-dashed border-x-border-strong px-[18px] pb-[30px] pt-[26px] text-[14px] text-x-muted">
          아직 작업이 등록되지 않았어요.<br />세팅이 끝나면 진행과 성과가 여기에 나와요.
        </div>
      </div>
    );
  }
  const q = card.quantity, p = card.perf;
  const views = p.views.value, bookmarks = p.bookmarks.value;
  const series = card.chart ? card.chart[metric] : null;
  return (
    <div className={`flex flex-col overflow-hidden rounded-[14px] border bg-white ${open ? 'border-x-blue shadow-[0_0_0_1px_#1d9bf0]' : 'border-x-border-strong'}`}>
      <Head card={card} />

      <div className={ZONE}>
        <div className={ZONE_LABEL}>진행</div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-[15px] text-x-secondary"><b className="text-[22px] tabular-nums text-x-text">{q.posted}</b> / {q.planned}건 게시</span>
          <span className="text-[13px] tabular-nums text-x-secondary">{Math.round((q.posted / q.planned) * 100)}%</span>
        </div>
        <ProgressBar ratio={q.posted / q.planned} />
        <div className="mt-2 flex justify-between text-[13px] text-x-muted">
          <span>
            {q.open > 0 ? <>게시 전 {q.open}건{q.overdue > 0 && <> <span className="font-semibold text-[#b45309]">({q.overdue}건은 예정일 지남)</span></>}</> : '남은 작업 없음'}
          </span>
          <span>{q.cancelled > 0 ? `취소 ${q.cancelled}건` : ''}</span>
        </div>
      </div>

      <div className={ZONE}>
        <div className={ZONE_LABEL}>성과</div>
        <div className="grid grid-cols-3">
          {[
            { l: '조회수', v: views === null ? '-' : compact(views) },
            { l: '저장수', v: bookmarks === null ? '-' : NUM.format(bookmarks) },
            { l: 'CPV', v: formatCpv(p.cpv) },
          ].map((k, i) => (
            <div key={k.l} className={i === 0 ? 'pr-3' : 'border-l border-x-border px-3'}>
              <div className="text-[12px] text-x-secondary">{k.l}</div>
              <div className="text-[20px] font-bold tabular-nums">{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-x-border bg-x-surface px-[18px] pb-2 pt-[14px]">
        <div className={ZONE_LABEL}>날짜별 누적 {METRIC_LABEL[metric]}</div>
        {card.chart && series ? (
          <CumulativeArea labels={chartLabels(card.chart.days)} values={series} todayIndex={card.chart.todayIndex}
                          height={136} ariaLabel={`날짜별 누적 ${METRIC_LABEL[metric]}`} />
        ) : (
          // 게시물이 없거나 아직 잰 값이 없으면 선 대신 안내(R5: chart === null)
          <p className="m-0 pb-[6px] text-[13px] text-x-muted">게시되면 여기에 성과 흐름이 나와요.</p>
        )}
      </div>

      <button type="button" onClick={onOpen} aria-label={`${card.title} 게시물별 지표 보기`}
              className="block w-full cursor-pointer border-t border-x-border bg-white px-[18px] py-[13px] text-right text-[14px] font-semibold text-x-blue-text hover:bg-x-surface">
        게시물별 지표 보기 →
      </button>
    </div>
  );
}
