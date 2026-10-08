'use client';
import { kstDateTime } from '@/lib/datetime';
import { InfoTip } from '@/components/InfoTip';
import type { FlowStats } from '@/lib/campaignFlowView';
import type { FlowStage } from '@/lib/campaignJudgment';
import { CURRENCIES, formatMoneyBy, moneyParts, type MoneyByCurrency } from '@/lib/campaignCost';
import { toKrw, formatMoneyIn, JPY_TO_KRW, type ViewCurrency, type CampaignPeriodBudget } from '@/lib/clientBudget';
import { formatPct } from '@/lib/performanceJudgment';
import { isPillActive, nextStagesForPill, pillCount, costTableRows, pctLabelLeft, type StagePill } from '@/lib/flowCards';
import { BudgetCard } from './BudgetCard';
import {
  CARD, LABEL_ROW, LABEL_WRAP, LABEL, BIG, COMP, BAR, TBL, TBL_HEAD, TBL_KEY, TBL_VAL, C_THIS_SPENT, C_THIS_PENDING,
} from './cardStyles';

// 카드 2×2(koo 10-08 시안 B): 작업 현황 | 성과 / 캠페인 비용 | 클라이언트 예산. 같은 줄의 두 카드는 높이가 같다.
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

// 최종 업데이트 시각 'M/D HH:MM'(한국) — 같은 날 여러 번 부를 수 있어 시각까지 보인다.
function updatedLabel(iso: string): string {
  const k = kstDateTime(iso);   // 'YYYY-MM-DD HH:MM'
  return `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${k.slice(11, 16)}`;
}

const PILLS: ReadonlyArray<[StagePill, string]> = [['waiting', '게시 대기'], ['cancelled', '취소']];

export function FlowCards({
  stats, plannedTotal, currency, onCurrencyChange, perfUpdatedAt, refreshing, onRefresh,
  stageCounts, lateCount, stages, onStagesChange, budget, clientId,
}: {
  stats: FlowStats;
  plannedTotal: MoneyByCurrency;   // 계획(작업 비용 + 인플별 추가 비용) — stats.plannedCost(작업 비용만)와는 다른 숫자(위 주석)
  currency: ViewCurrency;          // 비용 카드가 보여 줄 통화 — 합계 줄(flowFooter)과 같은 값을 부모가 내려준다
  onCurrencyChange: (c: ViewCurrency) => void;
  perfUpdatedAt: string | null;    // 성과를 가장 최근에 불러온 때(서버, 자동 수집 포함)
  refreshing: boolean;
  onRefresh: () => void;
  stageCounts: Record<FlowStage, number>;   // 필터 드롭다운과 같은 단계별 개수(부모의 counts.stage)
  lateCount: number;                        // 밀린 작업(isTaskOverdue) — 필터의 '지연'과 같은 수
  stages: ReadonlySet<FlowStage>;           // 지금 목록 필터의 단계 묶음 — 알약이 켜졌는지 판정
  onStagesChange: (s: Set<FlowStage>) => void;
  budget: CampaignPeriodBudget | null;      // null = 클라이언트 없는 캠페인 — 네 번째 칸을 그리지 않는다
  clientId: string | null;
}) {
  const postedPct = stats.planned > 0 ? Math.min(100, (stats.posted / stats.planned) * 100) : 0;

  const extraCost = diffMoney(plannedTotal, stats.plannedCost);
  const hasExtra = moneyParts(extraCost).length > 0;
  const costTip = hasExtra ? `추가 비용 ${formatMoneyBy(extraCost)}은 계획에 포함` : undefined;

  // 이 캠페인 막대 — 계획이 전체 길이, 진한 파랑 = 집행, 옅은 파랑 = 예정(아직 게시 전). 통화가 섞이면 원화 환산으로 비율만 낸다.
  const spentKrw = toKrw(stats.spent).krw;
  const plannedKrw = toKrw(plannedTotal).krw;
  // 큰 숫자는 보기 통화로 환산한 총액, 통화 내역은 아래 작은 표(koo 10-08). 환산이 실제로 일어났을 때만 ≈.
  const spentView = formatMoneyIn(stats.spent, currency);
  const plannedView = formatMoneyIn(plannedTotal, currency);
  const hasConv = spentView.approx || plannedView.approx;
  const convTip = currency === 'KRW'
    ? `엔화는 1엔 = ${JPY_TO_KRW}원으로 환산해 더했어요 — 예산 화면과 같은 기준`
    : `원화는 ${JPY_TO_KRW}원 = 1엔으로 환산해 더했어요 — 참고용이에요`;
  const spentPct = plannedKrw > 0 ? Math.min(100, (spentKrw / plannedKrw) * 100) : 0;
  const costRows = costTableRows(stats.spent, plannedTotal);

  return (
    // 폭은 창이 아니라 이 영역의 폭으로 판단한다(오른쪽 패널이 열리면 좁아진다). 800px 미만이면 한 줄에 한 장 —
    // 예산·비용 카드의 표(라벨 + 130px 두 칸)가 카드 폭 약 390px를 요구해서(시안 글꼴로 실측, 10-08).
    <div className="@container">
    <div className="grid grid-cols-1 gap-[12px] @[800px]:grid-cols-2">
      {/* 작업 현황 — 게시 / 계획(취소 뺀 수)이 주인공. 오른쪽 알약은 누르면 아래 목록을 그 조건으로 거른다(다시 누르면 해제). */}
      <section aria-label="작업 현황" className={CARD}>
        <div className={LABEL_ROW}><span className={LABEL}>작업 현황</span></div>
        <div className="mt-[4px] flex items-center justify-between gap-[12px]">
          <p className={BIG}>{stats.posted}<span className={COMP}>/ {stats.planned} 게시</span></p>
          <span className="inline-flex items-center gap-[8px]">
            {PILLS.map(([pill, label]) => {
              const n = pillCount(stageCounts, pill);
              const on = isPillActive(stages, pill);
              return (
                <button key={pill} type="button" title="누르면 목록이 걸러져요" aria-pressed={on} disabled={n === 0 && !on}
                        onClick={() => onStagesChange(nextStagesForPill(stages, pill))}
                        className={`inline-flex h-[28px] items-center gap-[5px] whitespace-nowrap rounded-full border px-[12px] text-[14px] disabled:cursor-default disabled:opacity-40 ${
                          on ? 'border-x-text bg-x-text text-white' : 'border-x-border-strong bg-white text-x-text hover:bg-x-hover disabled:hover:bg-white'}`}>
                  {label} <b className="font-bold tabular-nums">{n}</b>
                </button>
              );
            })}
          </span>
        </div>
        {lateCount > 0 && (
          <p className="mt-[2px] whitespace-nowrap text-[13px] font-semibold leading-[18px] text-[#b45309]">밀린 작업 {lateCount}건</p>
        )}
        <div className="mt-auto pt-[10px]">
          <div className={BAR}><i className="block h-full bg-x-text" style={{ width: `${postedPct}%` }} /></div>
        </div>
      </section>

      {/* 성과 — ↻ + 최종 업데이트 시각(koo 09-28). 지표 셋은 칸을 3등분, 비율은 숫자 아래 설명 줄로. */}
      <section aria-label="성과" className={CARD}>
        <div className={LABEL_ROW}>
          <span className={LABEL_WRAP}>
            <span className={LABEL}>성과</span>
            <InfoTip text={`게시물 링크가 있는 ${stats.perf.withPerf}건 합계${stats.perf.noLink ? ` · 링크 없는 게시물 ${stats.perf.noLink}건은 합계 밖` : ''} · 비율은 조회 대비예요`} label="성과 기준 설명 보기" />
          </span>
          <span className="inline-flex items-center gap-[8px]">
            <span className="whitespace-nowrap text-[13px] text-x-muted tabular-nums">
              {refreshing ? '불러오는 중…' : perfUpdatedAt ? `${updatedLabel(perfUpdatedAt)} 업데이트` : '아직 불러오지 않았어요'}
            </span>
            {/* 게시된 작업이 하나도 없을 때만 막는다 — withPerf(스냅샷이 잡힌 수)로 막으면, 연결은 돼 있는데 아직
                지표가 없는 게시물을 두고 "조회할 게 없다"고 잘못 말한다. 실제로 조회할 게 없으면 서버가 total 0으로 답하고
                토스트가 그 사실을 말한다. */}
            <button type="button" onClick={onRefresh} disabled={refreshing || stats.posted === 0}
                    aria-label="게시물 성과 다시 불러오기"
                    title={stats.posted === 0 ? '게시 확인된 작업이 아직 없어요' : '게시물 성과 다시 불러오기 — 게시물당 API 1회'}
                    className="inline-flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full border border-x-border-strong bg-white text-x-text hover:bg-x-hover disabled:opacity-40 disabled:hover:bg-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                   aria-hidden className={`h-[14px] w-[14px] ${refreshing ? 'animate-spin' : ''}`}>
                <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
              </svg>
            </button>
          </span>
        </div>
        <div className="mt-[2px] grid grid-cols-3 gap-[16px]">
          {([
            ['조회', stats.perf.views, stats.cpvKrw !== null ? `CPV ${stats.cpvKrw.toFixed(1)}원` : null, '조회 1회에 든 비용'],
            ['좋아요', stats.perf.likes, stats.likeRate !== null ? formatPct(stats.likeRate, 1) : null, '좋아요율(조회 대비)'],
            ['북마크', stats.perf.bookmarks, stats.bookmarkRate !== null ? formatPct(stats.bookmarkRate, 1) : null, '북마크율(조회 대비)'],
          ] as const).map(([label, v, sub, subTitle]) => (
            <div key={label} className="min-w-0">
              <p className="text-[28px] font-extrabold leading-[34px] tabular-nums">
                {v !== null ? v.toLocaleString('ko-KR') : <span className="text-x-muted">—</span>}
              </p>
              <p className="mt-[2px] truncate text-[14px] leading-[18px] text-x-secondary" title={sub ? `${label} · ${subTitle} ${sub}` : label}>
                {label}{sub && <span className="text-[13px] text-x-muted"> · {sub}</span>}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 캠페인 비용 — 이 캠페인만(집행 / 계획). 클라이언트 없는 캠페인은 네 번째 칸이 없어 이 카드가 한 줄을 다 쓴다. */}
      <section aria-label="캠페인 비용" className={`${CARD} ${budget ? '' : '@[800px]:col-span-2'}`}>
        <div className={LABEL_ROW}>
          <span className={LABEL_WRAP}>
            <span className={LABEL}>캠페인 비용</span>
            <InfoTip text={['집행 = 게시 확인된 작업 비용 · 계획 = 취소 뺀 전체 작업 비용', costTip, convTip].filter(Boolean).join(' · ')} label="비용 계산 방법 보기" />
          </span>
          {/* 합계를 볼 통화 — 표 아래 합계 줄도 같이 바뀐다. 작업 한 건의 금액·아래 통화별 표는 원래 통화 그대로. */}
          <div role="group" aria-label="합계를 볼 통화" className="inline-flex h-[30px] flex-none overflow-hidden rounded-full border border-x-border-strong">
            {([['KRW', '원화'], ['JPY', '엔화']] as const).map(([c, label]) => (
              <button key={c} type="button" aria-pressed={currency === c} onClick={() => onCurrencyChange(c)}
                      className={`px-[12px] text-[13px] ${currency === c ? 'bg-x-text font-bold text-white' : 'bg-white text-x-secondary hover:bg-x-hover'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className={`mt-[4px] ${BIG}`}>
          {hasConv && '≈'}{spentView.total}<span className={COMP}>/ {plannedView.total} 계획</span>
        </p>
        {plannedKrw > 0 && (
          // 비율 글자는 집행 칸 끝에 붙어 같이 움직인다(양 끝에서는 막대 밖으로 나가지 않게 가둔다)
          <div className="relative mt-[14px]">
            <span className="absolute top-[-17px] -translate-x-1/2 whitespace-nowrap text-[13px] font-semibold leading-[16px] text-x-blue"
                  style={{ left: pctLabelLeft(spentPct) }}>{Math.round(spentPct)}%</span>
            <div className={BAR}>
              <i className={`block h-full ${C_THIS_SPENT}`} style={{ width: `${spentPct}%` }} />
              <i className={`block h-full flex-1 ${C_THIS_PENDING}`} />
            </div>
          </div>
        )}
        {costRows.length > 0 && (
          <div className="mt-auto pt-[8px]">
            <div className={TBL}>
              <div className={TBL_HEAD} /><div className={TBL_HEAD}>집행</div><div className={TBL_HEAD}>계획</div>
              {costRows.map((r) => (
                <div key={r.currency} className="contents">
                  <div className={TBL_KEY}>{r.label}</div><div className={TBL_VAL}>{r.spent}</div><div className={TBL_VAL}>{r.planned}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {budget && <BudgetCard budget={budget} clientId={clientId} spent={stats.spent} plannedTotal={plannedTotal} />}
    </div>
    </div>
  );
}
