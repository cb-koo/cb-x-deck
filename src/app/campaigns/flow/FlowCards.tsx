'use client';
import { kstDateTime } from '@/lib/datetime';
import { InfoTip } from '@/components/InfoTip';
import type { FlowStats } from '@/lib/campaignFlowView';
import { CURRENCIES, formatMoneyBy, moneyParts, type MoneyByCurrency } from '@/lib/campaignCost';
import { toKrw } from '@/lib/clientBudget';
import { formatPct } from '@/lib/performanceJudgment';

// 요약 카드 3장(작업·성과·비용) — 클러터로 반려된 초안 뒤 정해진 모양(b-task-11-brief.md):
// 제목은 한 단어 · 큰 숫자는 하나 · 라벨은 숫자 아래 · 주석은 툴팁으로 · 기호는 '/' 하나.
// 숫자는 전부 flowStats(표·필터와 같은 함수)에서 온다 — 카드가 직접 세면 표와 다른 답이 나온다.
// 예외는 계획 비용(plannedTotal) 하나 — 부모(FlowDetail)가 taskCampaignTotal(deriveTaskInfluencers(tasks, costRows))로
// 계산해 넘긴다. 이유: §3-3의 계획은 작업 비용 + 인플루언서별 추가 비용이고, 기존 /campaigns의 '비용 합계'와 같은
// 함수를 써야 두 화면이 같은 숫자를 말한다. stats.plannedCost(작업 비용만)는 여기서 툴팁 내역에만 쓴다.

// 두 MoneyByCurrency의 차 — 통화 간 합산은 하지 않는다(스펙 §2-4). 0인 통화는 아예 키를 만들지 않는다(moneyParts가 그대로 걸러낸다).
function diffMoney(a: MoneyByCurrency, b: MoneyByCurrency): MoneyByCurrency {
  const out: MoneyByCurrency = {};
  for (const c of CURRENCIES) {
    const d = (a[c] ?? 0) - (b[c] ?? 0);
    if (d !== 0) out[c] = d;
  }
  return out;
}

// 예정(아직 게시 전) 빗금 — 카드와 예산 줄(BudgetStrip)이 같은 무늬를 쓴다: 진한 = 집행, 빗금 = 예정.
export const PENDING_BLUE = 'bg-[repeating-linear-gradient(135deg,#8ecdf8_0_4px,#d2ecfd_4px_8px)]';
export const PENDING_GRAY = 'bg-[repeating-linear-gradient(135deg,#c4ccd2_0_4px,#e6eaed_4px_8px)]';

// 최종 업데이트 시각 'M/D HH:MM'(한국) — 같은 날 여러 번 부를 수 있어 시각까지 보인다.
function updatedLabel(iso: string): string {
  const k = kstDateTime(iso);   // 'YYYY-MM-DD HH:MM'
  return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${k.slice(11, 16)}`;
}

export function FlowCards({ stats, plannedTotal, perfUpdatedAt, cancelledCount, refreshing, onRefresh }: {
  stats: FlowStats;
  plannedTotal: MoneyByCurrency;   // 계획(작업 비용 + 인플별 추가 비용) — stats.plannedCost(작업 비용만)와는 다른 숫자(위 주석)
  perfUpdatedAt: string | null;    // 성과를 가장 최근에 불러온 때(서버, 자동 수집 포함)
  cancelledCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const postedPct = stats.planned > 0 ? Math.min(100, (stats.posted / stats.planned) * 100) : 0;

  const extraCost = diffMoney(plannedTotal, stats.plannedCost);
  const hasExtra = moneyParts(extraCost).length > 0;
  const costTip = hasExtra ? `추가 비용 ${formatMoneyBy(extraCost)}은 계획에 포함` : undefined;

  // 이 캠페인 막대 — 계획이 전체 길이, 진한 파랑 = 집행, 빗금 = 예정(아직 게시 전). 통화가 섞이면 원화 환산으로 비율만 낸다.
  const spentKrw = toKrw(stats.spent).krw;
  const plannedKrw = toKrw(plannedTotal).krw;
  const spentPct = plannedKrw > 0 ? Math.min(100, (spentKrw / plannedKrw) * 100) : 0;

  return (
    <div className="grid grid-cols-[0.9fr_1.4fr_1.1fr] gap-0">
      {/* 작업 */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0">
        <p className="flex items-center gap-1.5 text-ui text-x-secondary">
          작업{cancelledCount ? <InfoTip text={`취소 ${cancelledCount}건은 빼고 셉니다`} label="작업 카드 설명 보기" /> : null}
        </p>
        <p className="mt-1 text-[26px] font-bold leading-tight tabular-nums">
          {stats.posted} <span className="text-content font-normal text-x-muted">/ {stats.planned}</span>
        </p>
        <p className="mt-1 text-ui text-x-secondary">게시</p>
        <div className="mt-2 h-1.5 rounded bg-x-border">
          <div className="h-full rounded bg-x-text" style={{ width: `${postedPct}%` }} />
        </div>
      </div>

      {/* 성과 — [업데이트] 글자 버튼 대신 ↻ 아이콘 + 최종 업데이트 시각(koo 09-28). 버튼은 머리줄 높이를 늘리지 않게(-my-1)
          두어, 세 지표의 숫자 줄이 옆 카드의 큰 숫자 줄과 같은 높이에서 시작한다. 지표 셋은 칸을 3등분해 고르게 놓는다. */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-ui text-x-secondary">
            성과<InfoTip text={`게시물 링크가 있는 ${stats.perf.withPerf}건 합계${stats.perf.noLink ? ` · 링크 없는 게시물 ${stats.perf.noLink}건은 합계 밖` : ''}`} label="성과 카드 설명 보기" />
          </p>
          <div className="-my-1 flex items-center gap-2">
            <span className="text-ui text-x-muted tabular-nums">
              {refreshing ? '불러오는 중…' : perfUpdatedAt ? `${updatedLabel(perfUpdatedAt)} 업데이트` : '아직 불러오지 않았어요'}
            </span>
            {/* 게시된 작업이 하나도 없을 때만 막는다 — withPerf(스냅샷이 잡힌 수)로 막으면, 연결은 돼 있는데 아직
                지표가 없는 게시물을 두고 "조회할 게 없다"고 잘못 말한다. 실제로 조회할 게 없으면 서버가 total 0으로 답하고
                토스트가 그 사실을 말한다. */}
            <button type="button" onClick={onRefresh} disabled={refreshing || stats.posted === 0}
                    aria-label="게시물 성과 다시 불러오기"
                    title={stats.posted === 0 ? '게시 확인된 작업이 아직 없어요' : '게시물 성과 다시 불러오기 — 게시물당 API 1회'}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-x-border-strong text-x-text hover:bg-x-hover disabled:opacity-40 disabled:hover:bg-transparent">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                   aria-hidden className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" />
              </svg>
            </button>
          </div>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-4">
          {([
            ['조회(CPV)', stats.perf.views, stats.cpvKrw !== null ? `${stats.cpvKrw.toFixed(1)}원` : null],
            ['좋아요(좋아요율)', stats.perf.likes, stats.likeRate !== null ? formatPct(stats.likeRate, 1) : null],
            ['북마크(북마크율)', stats.perf.bookmarks, stats.bookmarkRate !== null ? formatPct(stats.bookmarkRate, 1) : null],
          ] as const).map(([label, v, sub]) => (
            <div key={label} className="min-w-0">
              <p className="whitespace-nowrap text-[26px] font-bold leading-tight tabular-nums">
                {v !== null ? v.toLocaleString('ko-KR') : <span className="text-x-muted">—</span>}
                {sub && <span className="text-content font-normal text-x-muted">({sub})</span>}
              </p>
              <p className="mt-1 text-ui text-x-secondary">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 비용 — 이 캠페인만(집행 / 계획). 이 기간 클라이언트 예산은 카드 아래 BudgetStrip이 따로 말한다(koo 09-27 A안) */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0">
        <p className="flex items-center gap-1.5 text-ui text-x-secondary">
          비용<InfoTip text={['집행 = 게시 확인된 작업 비용 · 계획 = 취소 뺀 전체 작업 비용', costTip].filter(Boolean).join(' · ')} label="비용 카드 설명 보기" />
        </p>
        <p className="mt-1 text-[26px] font-bold leading-tight tabular-nums">
          {formatMoneyBy(stats.spent)} <span className="text-content font-normal text-x-muted">/ {formatMoneyBy(plannedTotal)}</span>
        </p>
        <p className="mt-1 text-ui text-x-secondary">집행 / 계획</p>
        {plannedKrw > 0 && (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded bg-x-border">
            <div className="h-full bg-x-blue" style={{ width: `${spentPct}%` }} />
            <div className={`h-full flex-1 ${PENDING_BLUE}`} />
          </div>
        )}
      </div>
    </div>
  );
}
