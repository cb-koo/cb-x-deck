'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ReportResponse, ReservationsBlock, FunnelBundle } from '@/lib/reportApi';
import { ratio } from '@/lib/reportSeries';

// null("모름")과 0("정말 0")을 항상 구분한다 — 표기 규칙(전역 제약).
const num = (v: number | null | undefined) => v === null || v === undefined ? '—' : v.toLocaleString('ko-KR');
const won = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v.toLocaleString('ko-KR')}원`;

// 매출 스택 색 — ReportTrends의 초진/재진 배색과 통일(같은 지표는 같은 색).
const REVENUE_FIRST = '#2f5590';
const REVENUE_REPEAT = '#9db8dd';

function Delta({ cur, prev, label }: { cur: number | null | undefined; prev: number | null | undefined; label: string }) {
  if (cur === null || cur === undefined || prev === null || prev === undefined)
    return <span className="text-caption text-x-muted">비교 불가</span>;
  const d = cur - prev;
  if (d === 0) return <span className="text-caption text-x-muted">변화 없음 ({label})</span>;
  return <span className={`text-caption ${d >= 0 ? 'text-green-700' : 'text-amber-700'}`}>
    {d >= 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('ko-KR')} {label}</span>;
}

export function ReportSummary({ report, isCalendarMonth }: { report: ReportResponse; isCalendarMonth: boolean }) {
  const [basis, setBasis] = useState<'created_at' | 'reservation_date'>('created_at');
  const [showXViews, setShowXViews] = useState(false);
  const cur = report.current, prev = report.previous;
  const res: ReservationsBlock | null = cur.reservations?.[basis] ?? null;
  const prevRes = prev?.reservations?.[basis] ?? null;
  const compareLabel = isCalendarMonth ? '전월 대비' : '직전 기간 대비';
  const unavailable = report.unavailable ?? {};
  const cost = cur.costs?.marketing_cost.total;
  const costZero = cost === 0;
  const curRoas = cur.costs?.roas ?? null;
  const prevRoas = prev?.costs?.roas ?? null;
  const prevFunnel: FunnelBundle | null = prev?.funnel ?? null;
  const funnelMax = Math.max(cur.funnel?.active_customers ?? 0, prevFunnel?.active_customers ?? 0) || null;

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold">① 기간 요약 <span className="text-caption font-normal text-x-muted">({compareLabel} · 방금 조회)</span></h2>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="인입 고객" value={num(cur.funnel?.active_customers)}
              sub={<Delta cur={cur.funnel?.active_customers} prev={prev?.funnel?.active_customers} label={compareLabel} />} />
        <Tile label="상담" value={num(cur.funnel?.consulted_customers)}
              sub={<Delta cur={cur.funnel?.consulted_customers} prev={prev?.funnel?.consulted_customers} label={compareLabel} />} />
        <Tile label="예약 건수" value={num(res?.reservation_count)}
              sub={<Delta cur={res?.reservation_count} prev={prevRes?.reservation_count} label={compareLabel} />} />
        <Tile label="예약 매출" value={won(res?.revenue.total)}
              sub={<Delta cur={res?.revenue.total} prev={prevRes?.revenue.total} label={compareLabel} />} />
      </div>
      <p className="mt-2 text-caption text-x-muted">
        {cur.followers ? (
          <>LINE 친구 총 {num(cur.followers.total_at_end)}명
            {' '}(이 기간 {cur.followers.change === null ? '변화 비교 불가' :
              `${cur.followers.change >= 0 ? '+' : ''}${cur.followers.change.toLocaleString('ko-KR')}`}
            {' '}· 차단 {num(cur.followers.blocked)} · 도달 가능 {num(cur.followers.reachable)})</>
        ) : (unavailable.followers?.message ?? 'LINE 친구 수 — 수집 안 됨')}
      </p>
      <div className="mt-2 flex items-center gap-3 text-caption text-x-secondary">
        <span>날짜 기준:</span>
        {(['created_at', 'reservation_date'] as const).map((b) => (
          <label key={b} className="flex items-center gap-1">
            <input type="radio" checked={basis === b} onChange={() => setBasis(b)} />
            {b === 'created_at' ? '접수일 (광고 성과용)' : '방문일 (실제 매출용)'}
          </label>
        ))}
        <span className="text-x-muted">— 어느 기준인지 보고서에 함께 적어 주세요</span>
      </div>
      {cur.reservations && !res && (
        <p className="mt-2 text-caption text-x-muted">
          {basis === 'reservation_date' ? '방문일' : '접수일'} 기준 집계가 이 응답에 없어요 — 기준을 바꿔 보세요
        </p>
      )}

      <h2 className="mt-6 text-base font-bold">② 기간 구성</h2>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Panel title="고객 흐름 (인입 → 방문)">
          <FlowBar label="인입" v={cur.funnel?.active_customers ?? null} max={funnelMax}
                   prev={prevFunnel ? prevFunnel.active_customers : undefined} prevMax={funnelMax} />
          <FlowBar label="상담" v={cur.funnel?.consulted_customers ?? null} max={funnelMax}
                   conv={ratio(cur.funnel?.consulted_customers, cur.funnel?.active_customers)}
                   prev={prevFunnel ? prevFunnel.consulted_customers : undefined} prevMax={funnelMax} />
          <FlowBar label="예약자" v={cur.funnel?.reservers.by_line_id ?? null} max={funnelMax}
                   conv={ratio(cur.funnel?.reservers.by_line_id, cur.funnel?.consulted_customers)}
                   prev={prevFunnel ? prevFunnel.reservers.by_line_id : undefined} prevMax={funnelMax} />
          <FlowBar label="방문" v={cur.funnel?.visitors.by_line_id ?? null} max={funnelMax}
                   prev={prevFunnel ? prevFunnel.visitors.by_line_id : undefined} prevMax={funnelMax} />
          <p className="mt-1 text-caption text-x-muted">신규 {num(cur.funnel?.new_customers)} · 기존 {cur.funnel ? num(cur.funnel.active_customers - cur.funnel.new_customers) : '—'} (계산) · 사람 수는 LINE ID 기준
            {prevFunnel && <> · 연회색 가는 막대 = {compareLabel.replace(' 대비', '')}</>}</p>
        </Panel>
        <Panel title="지점별 예약 매출">
          {res?.by_branch?.length ? [...res.by_branch].sort((a, b) => b.revenue.total - a.revenue.total).map((b, i) => (
            <FlowBar key={i}
              label={b.branch_name ?? '기타'} v={b.revenue.total} max={Math.max(...res.by_branch!.map((x) => x.revenue.total))}
              suffix={b.in_master ? '' : ' [미등록]'}
              title={b.branch_name === null ? `표기 불명 원본: ${b.source_values.filter(Boolean).join(', ') || '(빈칸)'}` : undefined}
              money />
          )) : <p className="text-caption text-x-muted">지점 분해 없음</p>}
        </Panel>
        <Panel title="매출 구성과 객단가">
          <RevenueStackBar first={res?.revenue.first_visit ?? null} repeat={res?.revenue.repeat_visit ?? null} />
          <p className="mt-2 text-[13px]">객단가 {won(res && res.reservers.by_line_id ? Math.round(res.revenue.total / res.reservers.by_line_id) : null)}
            <span className="text-caption text-x-muted"> /LINE ID 기준 (계산)</span></p>
          <p className="mt-1 text-[13px]">예약자 {num(res?.reservers.by_line_id)}명(LINE ID) / {num(res?.reservers.by_name)}명(이름) ·
            취소 {num(res?.status_counts.cancelled)} · 노쇼 {num(res?.status_counts.noshow)}</p>
          <p className="mt-1 text-caption text-x-muted">지금 이후 확정 예약 {num(cur.reservations?.upcoming_confirmed)}건
            — 조회 기간과 무관하게 &quot;오늘부터 미래 전체&quot;예요</p>
        </Panel>
        <Panel title="비용">
          {unavailable.costs ? <p className="text-caption text-x-muted">가져오지 못함 — {unavailable.costs.message}</p> : <>
            <p className="text-[13px]">{costSentence(cost, costZero, curRoas, prevRoas)}</p>
            {!costZero && !!cur.costs?.marketing_cost.by_media.length && (
              <p className="mt-1 text-caption text-x-secondary">매체별 {cur.costs.marketing_cost.by_media.map((m) => `${m.media} ${won(m.amount)}`).join(' · ')}</p>
            )}
            {costZero && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-caption text-amber-800">
              광고비 0원은 &quot;안 썼다&quot;와 &quot;시트에 입력 안 됐다&quot;를 구분할 수 없어요 — 보고서에 쓰기 전에 입력 여부를 확인해 주세요</p>}
            {!costZero && <p className="mt-1 text-[13px]">CPA {won(cur.costs?.cpa.by_line_id)} <span className="text-caption text-x-muted">/LINE ID 기준 · 항상 접수일 기준</span></p>}
            <label className="mt-2 flex items-center gap-1.5 text-caption text-x-muted">
              <input type="checkbox" checked={showXViews} onChange={(e) => setShowXViews(e.target.checked)} />
              X 조회수 표시 (외부 집계 — 부정확할 수 있어 기본은 숨김)
            </label>
            {showXViews && <p className="text-[13px]">X 조회수 증가 {num(cur.costs?.x_views?.change)}
              {cur.costs?.x_views === null && <span className="text-caption text-x-muted"> — 이 클리닉은 X 연동 없음</span>}</p>}
          </>}
        </Panel>
      </div>
    </section>
  );
}

// 비용 카드 서술형 문장 — 숫자만 던지지 않고 판단까지: 광고비 → ROAS → (있으면) 직전 대비 해석.
function costSentence(cost: number | null | undefined, costZero: boolean, curRoas: number | null, prevRoas: number | null): string {
  if (costZero) return `광고비 ${won(cost)}`;
  if (curRoas === null) return `광고비 ${won(cost)} → ROAS 계산 불가(매출 또는 광고비 정보 부족)`;
  if (prevRoas === null || prevRoas === undefined)
    return `광고비 ${won(cost)} → ROAS ${curRoas.toFixed(2)}`;
  const diffPct = (curRoas - prevRoas) / prevRoas;
  const cmp = Math.abs(diffPct) <= 0.05
    ? `직전 기간(${prevRoas.toFixed(2)})과 비슷해요`
    : diffPct > 0
      ? `직전 기간(${prevRoas.toFixed(2)})보다 효율이 올랐어요`
      : `직전 기간(${prevRoas.toFixed(2)})보다 효율이 내려갔어요`;
  return `광고비 ${won(cost)} → ROAS ${curRoas.toFixed(2)} — ${cmp}`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub: ReactNode }) {
  return <div className="rounded-lg border border-x-border bg-x-surface p-3">
    <div className="text-caption text-x-muted">{label}</div>
    <div className="text-lg font-bold">{value}</div>
    <div className="mt-0.5">{sub}</div>
  </div>;
}
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-lg border border-x-border bg-x-surface p-3">
    <h3 className="text-[13px] font-bold text-x-secondary">{title}</h3>
    <div className="mt-2">{children}</div>
  </div>;
}
function FlowBar({ label, v, max, conv, suffix, title, money, prev, prevMax }: {
  label: string; v: number | null; max: number | null; conv?: number | null; suffix?: string; title?: string; money?: boolean;
  prev?: number | null; prevMax?: number | null;
}) {
  const w = v !== null && max ? Math.max(2, (v / max) * 100) : 0;
  const showPrev = prev !== undefined;
  const prevW = prev !== null && prev !== undefined && prevMax ? Math.max(2, (prev / prevMax) * 100) : 0;
  return <div className="my-1.5" title={title}>
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-16 shrink-0 text-right text-x-secondary">{label}{suffix}</span>
      <span className="h-3.5 rounded-r bg-x-blue/70" style={{ width: `${w}%` }} />
      <span className="shrink-0 tabular-nums">{v === null ? '—' : money ? `${v.toLocaleString('ko-KR')}원` : v.toLocaleString('ko-KR')}</span>
      {conv !== undefined && <span className="text-caption text-x-muted">{conv === null ? '' : `↓ ${(conv * 100).toFixed(1)}%`}</span>}
    </div>
    {showPrev && (
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-16 shrink-0" />
        <span className="h-1.5 rounded-r bg-x-muted/40" style={{ width: `${prevW}%` }} />
        <span className="shrink-0 tabular-nums text-x-muted">{prev === null ? '—' : prev!.toLocaleString('ko-KR')}</span>
      </div>
    )}
  </div>;
}
function RevenueStackBar({ first, repeat }: { first: number | null; repeat: number | null }) {
  if (first === null || repeat === null) return <p className="text-[13px] text-x-muted">매출 구성 데이터 없음</p>;
  const total = first + repeat;
  const firstPct = total > 0 ? (first / total) * 100 : 0;
  const repeatPct = total > 0 ? 100 - firstPct : 0;
  return <div>
    <div className="flex h-5 w-full overflow-hidden rounded">
      <div className="flex items-center justify-center text-[10px] text-white" style={{ width: `${firstPct}%`, background: REVENUE_FIRST }}>
        {firstPct >= 12 ? `${firstPct.toFixed(0)}%` : ''}
      </div>
      <div className="flex items-center justify-center text-[10px] text-x-secondary" style={{ width: `${repeatPct}%`, background: REVENUE_REPEAT }}>
        {repeatPct >= 12 ? `${repeatPct.toFixed(0)}%` : ''}
      </div>
    </div>
    <div className="mt-1 flex justify-between text-caption text-x-muted">
      <span>초진 {won(first)} ({firstPct.toFixed(0)}%)</span>
      <span>재진 {won(repeat)} ({repeatPct.toFixed(0)}%)</span>
    </div>
  </div>;
}
