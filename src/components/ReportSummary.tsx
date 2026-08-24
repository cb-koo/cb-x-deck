'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ReportResponse, ReservationsBlock } from '@/lib/reportApi';
import { ratio } from '@/lib/reportSeries';

// null("모름")과 0("정말 0")을 항상 구분한다 — 표기 규칙(전역 제약).
const num = (v: number | null | undefined) => v === null || v === undefined ? '—' : v.toLocaleString('ko-KR');
const won = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${v.toLocaleString('ko-KR')}원`;
const pct = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;

function Delta({ cur, prev, label }: { cur: number | null | undefined; prev: number | null | undefined; label: string }) {
  if (cur === null || cur === undefined || prev === null || prev === undefined)
    return <span className="text-caption text-x-muted">비교 불가</span>;
  const d = cur - prev;
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

  return (
    <section className="mt-6">
      <h2 className="text-base font-bold">① 기간 요약 <span className="text-caption font-normal text-x-muted">({compareLabel} · 방금 조회)</span></h2>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Tile label="LINE 친구 (기간 끝 기준)" value={num(cur.followers?.total_at_end)}
              sub={cur.followers ? <Delta cur={cur.followers.total_at_end} prev={prev?.followers?.total_at_end} label={compareLabel} /> :
                <span className="text-caption text-x-muted">{unavailable.followers?.message ?? '수집 안 됨'}</span>} />
        <Tile label="인입 고객" value={num(cur.funnel?.active_customers)}
              sub={<Delta cur={cur.funnel?.active_customers} prev={prev?.funnel?.active_customers} label={compareLabel} />} />
        <Tile label="상담" value={num(cur.funnel?.consulted_customers)}
              sub={<Delta cur={cur.funnel?.consulted_customers} prev={prev?.funnel?.consulted_customers} label={compareLabel} />} />
        <Tile label="예약 건수" value={num(res?.reservation_count)}
              sub={<Delta cur={res?.reservation_count} prev={prevRes?.reservation_count} label={compareLabel} />} />
        <Tile label="예약 매출" value={won(res?.revenue.total)}
              sub={<Delta cur={res?.revenue.total} prev={prevRes?.revenue.total} label={compareLabel} />} />
      </div>
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

      <h2 className="mt-6 text-base font-bold">② 기간 구성</h2>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <Panel title="고객 흐름 (인입 → 방문)">
          <FlowBar label="인입" v={cur.funnel?.active_customers ?? null} max={cur.funnel?.active_customers ?? null} />
          <FlowBar label="상담" v={cur.funnel?.consulted_customers ?? null} max={cur.funnel?.active_customers ?? null}
                   conv={ratio(cur.funnel?.consulted_customers, cur.funnel?.active_customers)} />
          <FlowBar label="예약자" v={cur.funnel?.reservers.by_line_id ?? null} max={cur.funnel?.active_customers ?? null}
                   conv={ratio(cur.funnel?.reservers.by_line_id, cur.funnel?.consulted_customers)} />
          <FlowBar label="방문" v={cur.funnel?.visitors.by_line_id ?? null} max={cur.funnel?.active_customers ?? null} />
          <p className="mt-1 text-caption text-x-muted">신규 {num(cur.funnel?.new_customers)} · 기존 {cur.funnel ? num(cur.funnel.active_customers - cur.funnel.new_customers) : '—'} (계산) · 사람 수는 LINE ID 기준</p>
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
          <p className="text-[13px]">초진 {won(res?.revenue.first_visit)} · 재진 {won(res?.revenue.repeat_visit)} ·
            재진 비율 {pct(ratio(res?.revenue.repeat_visit, res?.revenue.total))} (계산)</p>
          <p className="mt-1 text-[13px]">객단가 {won(res && res.reservers.by_line_id ? Math.round(res.revenue.total / res.reservers.by_line_id) : null)}
            <span className="text-caption text-x-muted"> /LINE ID 기준 (계산)</span></p>
          <p className="mt-1 text-[13px]">예약자 {num(res?.reservers.by_line_id)}명(LINE ID) / {num(res?.reservers.by_name)}명(이름) ·
            취소 {num(res?.status_counts.cancelled)} · 노쇼 {num(res?.status_counts.noshow)}</p>
          <p className="mt-1 text-caption text-x-muted">지금 이후 확정 예약 {num(cur.reservations?.upcoming_confirmed)}건
            — 조회 기간과 무관하게 &quot;오늘부터 미래 전체&quot;예요</p>
        </Panel>
        <Panel title="비용">
          {unavailable.costs ? <p className="text-caption text-x-muted">가져오지 못함 — {unavailable.costs.message}</p> : <>
            <p className="text-[13px]">광고비 {won(cost)}{cur.costs?.marketing_cost.by_media.length ?
              ` (${cur.costs.marketing_cost.by_media.map((m) => `${m.media} ${won(m.amount)}`).join(' · ')})` : ''}</p>
            {costZero && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-caption text-amber-800">
              광고비 0원은 &quot;안 썼다&quot;와 &quot;시트에 입력 안 됐다&quot;를 구분할 수 없어요 — 보고서에 쓰기 전에 입력 여부를 확인해 주세요</p>}
            {!costZero && <p className="mt-1 text-[13px]">ROAS {cur.costs?.roas === null || cur.costs?.roas === undefined ? '—' : cur.costs.roas.toFixed(2)} ·
              CPA {won(cur.costs?.cpa.by_line_id)} <span className="text-caption text-x-muted">/LINE ID 기준 · 항상 접수일 기준</span></p>}
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
function FlowBar({ label, v, max, conv, suffix, title, money }: {
  label: string; v: number | null; max: number | null; conv?: number | null; suffix?: string; title?: string; money?: boolean;
}) {
  const w = v !== null && max ? Math.max(2, (v / max) * 100) : 0;
  return <div className="my-1" title={title}>
    <div className="flex items-center gap-2 text-[12px]">
      <span className="w-16 shrink-0 text-right text-x-secondary">{label}{suffix}</span>
      <span className="h-3.5 rounded-r bg-x-blue/70" style={{ width: `${w}%` }} />
      <span className="shrink-0 tabular-nums">{v === null ? '—' : money ? `${v.toLocaleString('ko-KR')}원` : v.toLocaleString('ko-KR')}</span>
      {conv !== undefined && <span className="text-caption text-x-muted">{conv === null ? '' : `↓ ${(conv * 100).toFixed(1)}%`}</span>}
    </div>
  </div>;
}
