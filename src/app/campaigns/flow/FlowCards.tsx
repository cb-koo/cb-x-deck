'use client';
import { Button } from '@/components/ui';
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

export function FlowCards({ stats, plannedTotal, cancelledCount, refreshing, onRefresh }: {
  stats: FlowStats;
  plannedTotal: MoneyByCurrency;   // 계획(작업 비용 + 인플별 추가 비용) — stats.plannedCost(작업 비용만)와는 다른 숫자(위 주석)
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

      {/* 성과 */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-ui text-x-secondary">
            성과<InfoTip text={`게시물 링크가 있는 ${stats.perf.withPerf}건 합계${stats.perf.noLink ? ` · 링크 없는 게시물 ${stats.perf.noLink}건은 합계 밖` : ''}`} label="성과 카드 설명 보기" />
          </p>
          {/* 게시된 작업이 하나도 없을 때만 막는다 — withPerf(스냅샷이 잡힌 수)로 막으면, 연결은 돼 있는데 아직
              지표가 없는 게시물을 두고 "조회할 게 없다"고 잘못 말한다. 실제로 조회할 게 없으면 서버가 total 0으로 답하고
              토스트가 그 사실을 말한다. */}
          <Button variant="subtle" disabled={refreshing || stats.posted === 0} onClick={onRefresh}
                  title={stats.posted === 0 ? '게시 확인된 작업이 아직 없어요' : '게시된 작업의 게시물을 다시 조회해요 — 게시물당 API 1회'}
                  className="h-8 shrink-0 px-2.5">
            {refreshing ? '조회 중…' : '업데이트'}
          </Button>
        </div>
        <div className="mt-2 flex gap-6">
          <div>
            <p className="text-[20px] font-bold leading-tight tabular-nums">
              {stats.perf.views !== null ? stats.perf.views.toLocaleString('ko-KR') : <span className="text-x-muted">—</span>}
              {stats.cpvKrw !== null && <span className="text-[15px] font-normal text-x-muted">({stats.cpvKrw.toFixed(1)}원)</span>}
            </p>
            <p className="mt-0.5 text-ui text-x-secondary">조회(CPV)</p>
          </div>
          <div>
            <p className="text-[20px] font-bold leading-tight tabular-nums">
              {stats.perf.likes !== null ? stats.perf.likes.toLocaleString('ko-KR') : <span className="text-x-muted">—</span>}
              {stats.likeRate !== null && <span className="text-[15px] font-normal text-x-muted">({formatPct(stats.likeRate, 1)})</span>}
            </p>
            <p className="mt-0.5 text-ui text-x-secondary">좋아요(좋아요율)</p>
          </div>
          <div>
            <p className="text-[20px] font-bold leading-tight tabular-nums">
              {stats.perf.bookmarks !== null ? stats.perf.bookmarks.toLocaleString('ko-KR') : <span className="text-x-muted">—</span>}
              {stats.bookmarkRate !== null && <span className="text-[15px] font-normal text-x-muted">({formatPct(stats.bookmarkRate, 1)})</span>}
            </p>
            <p className="mt-0.5 text-ui text-x-secondary">북마크(북마크율)</p>
          </div>
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
