'use client';
import Link from 'next/link';
import { Button } from '@/components/ui';
import type { FlowStats } from '@/lib/campaignFlowView';
import { CURRENCIES, formatAmount, formatMoneyBy, moneyParts, type MoneyByCurrency } from '@/lib/campaignCost';
import { toKrw, monthShort, type CampaignMonthBudget } from '@/lib/clientBudget';

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

export function FlowCards({ stats, plannedTotal, budget, clientId, cancelledCount, refreshing, onRefresh }: {
  stats: FlowStats;
  plannedTotal: MoneyByCurrency;   // 계획(작업 비용 + 인플별 추가 비용) — stats.plannedCost(작업 비용만)와는 다른 숫자(위 주석)
  budget: CampaignMonthBudget | null;   // 클라이언트가 없거나 예산 미설정이면 null이 아니라 amount만 null로 온다(clientBudget.ts)
  clientId: string | null;
  cancelledCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const postedPct = stats.planned > 0 ? Math.min(100, (stats.posted / stats.planned) * 100) : 0;

  const extraCost = diffMoney(plannedTotal, stats.plannedCost);
  const hasExtra = moneyParts(extraCost).length > 0;
  const costTip = hasExtra ? `추가 비용 ${formatMoneyBy(extraCost)}은 계획에 포함` : undefined;

  const amount = budget?.amount ?? null;
  const hasBudgetBar = amount !== null && amount > 0;
  // 막대는 예산이 전체 길이 — 회색(이달 다른 캠페인 계획) → 진한 파랑(이 캠페인 소진) → 연한 파랑(이 캠페인 계획 잔여) → 빈칸(남음) 순.
  // 소진이 계획을 넘거나 계획이 예산을 넘어도 막대는 100%에서 잘린다 — 숫자는 실제 값 그대로 보여주고(아래), 여기 폭만 클램프한다.
  let usedPct = 0;
  const segWidth = (pct: number) => { const w = Math.max(0, Math.min(100 - usedPct, pct)); usedPct += w; return w; };
  const spentKrw = toKrw(stats.spent).krw;
  const plannedKrw = toKrw(plannedTotal).krw;
  const wOthers = hasBudgetBar ? segWidth((budget!.othersKrw / amount!) * 100) : 0;
  const wSpent = hasBudgetBar ? segWidth((spentKrw / amount!) * 100) : 0;
  const wPlanned = hasBudgetBar ? segWidth((Math.max(0, plannedKrw - spentKrw) / amount!) * 100) : 0;
  const budgetTip = hasBudgetBar
    ? `${monthShort(budget!.month)} 예산 ${formatAmount(amount!, 'KRW')} · 회색은 이달 다른 캠페인 계획 ${formatAmount(budget!.othersKrw, 'KRW')} · 인플별 추가 비용은 계획에 포함 · 송금 수수료 미포함`
    : undefined;

  return (
    <div className="grid grid-cols-[0.9fr_1.1fr_1.4fr] gap-0">
      {/* 작업 */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0"
           title={cancelledCount ? `취소 ${cancelledCount}건은 빼고 셉니다` : undefined}>
        <p className="text-ui text-x-secondary">작업</p>
        <p className="mt-1 text-[26px] font-bold leading-tight tabular-nums">
          {stats.posted} <span className="text-content font-normal text-x-muted">/ {stats.planned}</span>
        </p>
        <p className="mt-1 text-ui text-x-secondary">게시</p>
        <div className="mt-2 h-1.5 rounded bg-x-border">
          <div className="h-full rounded bg-x-text" style={{ width: `${postedPct}%` }} />
        </div>
      </div>

      {/* 성과 */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0"
           title={`게시물 링크가 있는 ${stats.perf.withPerf}건 합계${stats.perf.noLink ? ` · 링크 없는 게시물 ${stats.perf.noLink}건은 합계 밖` : ''}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-ui text-x-secondary">성과</p>
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
            <p className="text-[20px] font-bold leading-tight tabular-nums">{stats.perf.views.toLocaleString('ko-KR')}</p>
            <p className="mt-0.5 text-ui text-x-secondary">조회</p>
          </div>
          <div>
            <p className="text-[20px] font-bold leading-tight tabular-nums">{stats.perf.likes.toLocaleString('ko-KR')}</p>
            <p className="mt-0.5 text-ui text-x-secondary">좋아요</p>
          </div>
          <div>
            <p className="text-[20px] font-bold leading-tight tabular-nums">{stats.perf.bookmarks.toLocaleString('ko-KR')}</p>
            <p className="mt-0.5 text-ui text-x-secondary">북마크</p>
          </div>
        </div>
      </div>

      {/* 비용 */}
      <div className="border-l border-x-border px-5 first:border-l-0 first:pl-0 last:pr-0">
        <p className="text-ui text-x-secondary">비용</p>
        <div className="mt-1 flex items-start justify-between gap-4">
          <div title={costTip}>
            <p className="text-[26px] font-bold leading-tight tabular-nums">
              {formatMoneyBy(stats.spent)} <span className="text-content font-normal text-x-muted">/ {formatMoneyBy(plannedTotal)}</span>
            </p>
            <p className="mt-1 text-ui text-x-secondary">소진 / 계획</p>
          </div>
          <div className="shrink-0 text-right" title={budgetTip}>
            {amount !== null ? (
              <p className="text-[26px] font-bold leading-tight tabular-nums">{formatAmount(amount, 'KRW')}</p>
            ) : (
              <p className="text-[26px] font-bold leading-tight tabular-nums text-x-muted">—</p>
            )}
            <p className="mt-1 text-ui text-x-secondary">
              {amount !== null
                ? `${monthShort(budget!.month)} 예산`
                : (clientId
                    ? <Link href={`/clients?client=${clientId}`} className="text-x-blue-text hover:underline">예산 미설정</Link>
                    : '예산 미설정')}
            </p>
          </div>
        </div>
        {hasBudgetBar && (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded bg-x-border" title={budgetTip}>
            <div className="h-full bg-x-border-strong" style={{ width: `${wOthers}%` }} />
            <div className="h-full bg-x-blue" style={{ width: `${wSpent}%` }} />
            <div className="h-full bg-x-blue/30" style={{ width: `${wPlanned}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
