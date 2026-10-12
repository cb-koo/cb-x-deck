'use client';
// 클라이언트 현황 월간 상세(스펙 §3-3, koo 10-10) — 큰 방향(확대·유지·축소·전환)을 기록하는 화면.
// 순서는 주간과 같다: 방향 기록 → 결과(매출·비용 대비·예산) → 전환 → 캠페인 → 주차별 요약(누르면 그 주차로).
import { useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { DECISION_LABEL, DIRECTIONS, DIRECTION_LABEL, DIRECTION_HELP, mdLabel, type Decision, type Direction } from '@/lib/clientStatus';
import type { ClientMonth, MonthReview } from '@/lib/clientMonthStore';
import { Button } from '@/components/ui';
import { ChartCard, Delta } from '@/components/charts/ChartCard';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { FunnelList } from '@/components/charts/FunnelList';
import { BulletList } from '@/components/charts/BulletList';
import { NUM, compact } from '@/components/charts/tokens';
import { PeriodNav } from './PeriodNav';
import { RevenueWeeks, RoasBars, man } from './RevenueWeeks';
import { Icon, fmtX, SectionHead, StatusBar, budgetHeadline } from './shared';
import { DecisionChip, DirectionChip } from './DecisionChip';

const pctChange = (now: number | null, prev: number | null) => (now === null || prev === null || prev === 0 ? null : Math.round(((now - prev) / prev) * 100));
const changeText = (p: number | null) => (p === null ? '' : p >= 10 ? `전월보다 ${p}% 늘었어요` : p <= -10 ? `전월보다 ${-p}% 줄었어요` : '전월과 비슷해요');

export function MonthView({ m, onSaved, onPeriod }: { m: ClientMonth; onSaved: (r: MonthReview) => void; onPeriod: (param: string) => void }) {
  const cur = m.months[m.months.length - 1], prev = m.months[m.months.length - 2];
  const labels = m.months.map((x) => x.label);
  const approx = cur.rec.source === 'days';
  const revPct = pctChange(cur.rec.revCreated, prev?.rec.revCreated ?? null);
  const status = cur.rec.status;

  return (
    <div className="mt-3 flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold">{m.client.name}</h1>
        <div className="mt-2"><PeriodNav info={m.period} onChange={onPeriod} /></div>
      </div>

      <DirectionPanel m={m} onSaved={onSaved} />

      <SectionHead stage="result" title="결과 · 예약 매출" checks={[]} />
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        <ChartCard icon={Icon.calendar} title="예약 매출 · 월별" value={cur.rec.revCreated === null ? '—' : `${man(cur.rec.revCreated)}원`} valueSub="접수일 기준"
          delta={cur.rec.revCreated !== null && prev?.rec.revCreated != null ? <Delta diff={Math.round((cur.rec.revCreated - prev.rec.revCreated) / 1e4)} unit="만" good="up" base={`전월 ${man(prev.rec.revCreated)}원`} /> : undefined}
          headline={cur.rec.revCreated === null ? '이 달 매출 기록이 없어요' : changeText(revPct) || `이 달 예약 매출 ${man(cur.rec.revCreated)}원`}
          info={{ what: 'LINE으로 들어온 예약의 금액(클리닉 전체)', read: ['막대 = 접수일 기준', '선 = 방문일 기준', '점선 = 이 달 — 접수일 기준은 취소·미예약으로 줄 수 있고, 방문일 기준은 늘어요'], calc: ['금액은 예약 금액(실제 결제 금액이 아님)'] }}>
          <RevenueWeeks labels={labels} created={m.months.map((x) => x.rec.revCreated)} visit={m.months.map((x) => x.rec.revVisit)} recent={1} recentLabel="이 달" />
        </ChartCard>
        <ChartCard icon={Icon.bookmark} title="작업 비용 대비 매출 · 이 달"
          value={cur.roas === null ? '—' : `${fmtX(cur.roas)}배`}
          delta={cur.roas !== null && prev?.roas != null ? <Delta diff={Math.round((cur.roas - prev.roas) * 10) / 10} unit="배" good="up" base={`전월 ${fmtX(prev.roas)}배`} /> : undefined}
          headline={cur.roas === null ? '이 달 게시한 작업 비용이 없어요' : cur.roas < 1 ? '작업 비용보다 예약 매출이 적어요' : `작업 비용 1원에 예약 매출 ${fmtX(cur.roas)}원`}
          caution="클리닉 LINE 예약 매출 전체 ÷ 우리 작업 비용 — 우리 글만의 성과가 아니라 방향을 보는 숫자예요"
          info={{ what: '이 달 예약 매출(접수일 기준) ÷ 이 달 게시한 우리 작업 비용', calc: ['비용 = 이 클라이언트 작업 중 이 달에 게시된 것의 비용(엔 ×10원)'] }}>
          <RoasBars revenue={cur.rec.revCreated ?? 0} cost={cur.cost} />
        </ChartCard>
        <ChartCard icon={Icon.calendar} title={m.budget ? `예산 · ${m.budget.label}` : '예산'}
          headline={m.budget ? budgetHeadline(m.budget) : '이 달과 겹치는 예산 기간이 없어요'}
          info={{ what: '이 달 예산을 날짜에 맞게 썼나', read: ['진한 파랑 = 집행(게시까지 끝난 작업)', '연한 파랑 = 예정까지 포함', '검은 세로선 = 적정 소진선(끝난 달은 끝)'], calc: ['기간에 시작한 캠페인의 작업 비용 합(엔은 ×10원)'] }}>
          {m.budget
            ? <BulletList rows={[{ label: '이 달', total: m.budget.total, spent: m.budget.spent, planned: m.budget.planned, pace: m.budget.pace }]} paceLabel={m.period.inProgress ? '오늘 기준 적정' : '기간 끝 기준'} />
            : <p className="text-ui text-x-muted">클라이언트 설정에서 예산 기간을 넣으면 여기서 소진을 볼 수 있어요.</p>}
        </ChartCard>
      </div>

      <SectionHead stage="conversion" title="전환 · 인입에서 예약까지" checks={[]} />
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
        <ChartCard icon={Icon.funnel} title="고객 흐름 · 전월 비교"
          caution={approx ? '진행 중이거나 월 기록이 없는 달은 일별 기록을 더한 값이라 상담·예약자 수가 실제보다 조금 많을 수 있어요' : undefined}
          info={{ what: '이 달 신규 인입에서 예약까지 단계별 사람 수', read: ['막대 = 신규 인입 대비 남은 비율', '증감에 마우스를 올리면 전월 값이 보여요'], calc: ['상담 = CS가 문의·예약 상담으로 표시한 사람', '예약 = LINE 계정 기준 예약자(접수일 기준)'] }}>
          <FunnelList compareName="전월" steps={[
            { name: '신규 인입', count: cur.rec.newInflow, prevCount: prev?.rec.newInflow ?? null, sub: 'LINE에 처음 말을 건 사람' },
            { name: '상담', count: cur.rec.consulted, prevCount: prev?.rec.consulted ?? null, sub: 'CS가 문의·예약 상담으로 표시' },
            { name: '예약', count: cur.rec.reservers, prevCount: prev?.rec.reservers ?? null, sub: 'LINE 계정 기준' },
          ]} />
        </ChartCard>
        <ChartCard icon={Icon.list} title="예약 상태 · 이 달 접수"
          info={{ what: '이 달 접수된 예약이 지금 어떤 상태인지', calc: ['미예약 = 문의는 왔지만 예약이 성사되지 않은 건(CS가 표시) — 취소·노쇼와는 달라요', '미예약은 CS가 후속 연락 뒤에 표시해 늦게 정리돼요 — 끝난 지 2주가 안 된 달은 미예약이 덜 잡혀 있어요'] }}>
          {status ? <StatusBar c={status} /> : <p className="text-[13px] text-x-muted">이 달 예약 기록이 없어요</p>}
        </ChartCard>
      </div>

      <SectionHead stage="campaign" title="캠페인 · X 성과와 신규 인입" checks={[]} />
      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
        <ChartCard icon={Icon.users} title="신규 인입 · 월별" value={cur.rec.newInflow === null ? '—' : `${cur.rec.newInflow}명`}
          delta={cur.rec.newInflow !== null && prev?.rec.newInflow != null ? <Delta diff={cur.rec.newInflow - prev.rec.newInflow} unit="명" good="up" base={`전월 ${prev.rec.newInflow}명`} /> : undefined}
          headline={changeText(pctChange(cur.rec.newInflow, prev?.rec.newInflow ?? null)) || '이 달 신규 인입'}
          info={{ what: '그 달에 LINE으로 처음 말을 건 사람 수', read: ['파란 막대 = 이 달'] }}>
          <CategoryBars labels={labels} values={m.months.map((x) => x.rec.newInflow ?? 0)} />
        </ChartCard>
        <ChartCard icon={Icon.bookmark} title="X 성과 · 월별" value={NUM.format(cur.bookmarks)} valueSub={`북마크 · 글 ${cur.postCount}개 · 조회 ${compact(cur.views)}`}
          delta={prev ? <Delta diff={cur.bookmarks - prev.bookmarks} good="up" base={`전월 ${NUM.format(prev.bookmarks)}`} /> : undefined}
          headline={cur.postCount === 0 ? '이 달엔 X 게시가 없었어요' : `글 ${cur.postCount}개 · 조회 ${compact(cur.views)}`}
          info={{ what: '그 달에 올린 우리 게시물의 북마크 합계', calc: ['게시물마다 마지막으로 잰 값', '아래 줄 = 그 달 작업 비용'] }}>
          <CategoryBars labels={labels} values={m.months.map((x) => x.bookmarks)} sub={m.months.map((x) => (x.cost ? `${man(x.cost)}` : '—'))} subLabel="작업 비용(원)" />
        </ChartCard>
      </div>

      <SectionHead stage="campaign" title="주차별 요약" checks={[]} />
      <WeekTable m={m} onPeriod={onPeriod} />
    </div>
  );
}

const WCOLS = 'minmax(150px,1.2fr) 132px 96px minmax(130px,1fr) 110px 100px';
function WeekTable({ m, onPeriod }: { m: ClientMonth; onPeriod: (param: string) => void }) {
  const today = m.period.inProgress ? m.weeks.find((w) => w.inProgress)?.start ?? m.period.end : m.period.end;
  return (
    <div className="overflow-x-auto rounded-xl border border-x-border">
      <div className="min-w-[760px]">
        <div className="grid items-center gap-4 border-b border-x-border bg-x-surface px-4 text-[13px] text-x-muted" style={{ gridTemplateColumns: WCOLS, height: 40 }}>
          <span>주차</span><span>판정</span><span>신규 인입</span><span>X 북마크 · 글</span><span>예약 매출</span><span>작업 비용</span>
        </div>
        {m.weeks.map((w) => {
          const future = w.start > today && m.period.inProgress;
          return (
            <button key={w.param} type="button" disabled={future} onClick={() => onPeriod(w.param)}
              className="grid w-full items-center gap-4 border-b border-x-border px-4 text-left text-[15px] last:border-b-0 hover:bg-x-hover disabled:opacity-40 disabled:hover:bg-transparent"
              style={{ gridTemplateColumns: WCOLS, minHeight: 52 }}>
              <span className="truncate"><b>{w.label}</b> <span className="text-[13px] text-x-muted">{mdLabel(w.start)}~{mdLabel(w.end)} · {w.days}일</span></span>
              <span>{future ? <span className="text-[13px] text-x-muted">아직</span> : w.inProgress ? <span className="text-[13px] text-[#a15c00]">진행 중</span>
                : w.verdict ? <DecisionChip decision={w.verdict as Decision} /> : <span className="text-[13px] text-x-muted" title="이 주차 판정을 아직 확정하지 않았어요">미확정</span>}</span>
              <span className="tabular-nums">{w.newInflow ?? '—'}명</span>
              <span className="tabular-nums">{w.postCount ? <>{NUM.format(w.bookmarks)} <span className="text-x-muted">· {w.postCount}</span></> : <span className="text-x-muted">게시 없음</span>}</span>
              <span className="tabular-nums">{w.revCreated === null ? '—' : man(w.revCreated)}</span>
              <span className="tabular-nums text-x-secondary">{w.cost ? man(w.cost) : '—'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DirectionPanel({ m, onSaved }: { m: ClientMonth; onSaved: (r: MonthReview) => void }) {
  const [dir, setDir] = useState<Direction | null>(m.review?.direction ?? null);
  const [memo, setMemo] = useState(m.review?.memo ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const cur = m.months[m.months.length - 1];
  const counts: Partial<Record<Decision, number>> = {};
  for (const w of m.weeks) if (w.verdict) counts[w.verdict] = (counts[w.verdict] ?? 0) + 1;
  const changed = !!dir && (!m.review || m.review.direction !== dir || m.review.memo !== memo.trim());

  if (m.period.inProgress) return (
    <section className="rounded-xl border border-dashed border-x-border-strong bg-white p-5">
      <span className="text-[16px] font-semibold">이 달 방향</span>
      <p className="mt-1 text-[14px] text-x-secondary">진행 중인 달이에요. 아래 숫자는 지금까지 쌓인 값이고, 방향은 달이 끝난 뒤({mdLabel(m.period.end)} 다음 날)부터 기록할 수 있어요.</p>
    </section>
  );

  const save = async () => {
    if (!dir) return;
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(`/api/status/${m.client.id}/review`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ direction: dir, memo, period: m.period.param }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? '저장하지 못했어요'); return; }
      onSaved(j as MonthReview);
    } catch { setMsg('저장하지 못했어요 — 다시 시도해 주세요'); } finally { setSaving(false); }
  };

  const snap = m.review?.snapshot;
  const diffs: Array<[string, string, string]> = snap ? ([
    ['신규 인입', `${snap.newInflow ?? '—'}명`, `${cur.rec.newInflow ?? '—'}명`],
    ['예약 매출', snap.revenue === null ? '—' : `${man(snap.revenue)}원`, cur.rec.revCreated === null ? '—' : `${man(cur.rec.revCreated)}원`],
    ['비용 대비 매출', snap.roas === null ? '—' : `${fmtX(snap.roas)}배`, cur.roas === null ? '—' : `${fmtX(cur.roas)}배`],
  ] as Array<[string, string, string]>).filter(([, a, b]) => a !== b) : [];

  return (
    <section className="rounded-xl border border-x-border bg-white p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[16px] font-semibold">이 달 방향</span>
        {m.review ? <DirectionChip direction={m.review.direction} /> : <span className="rounded-full border border-dashed border-x-border-strong px-2.5 py-0.5 text-[13px] text-x-muted">미정</span>}
        <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-x-secondary">
          주차 판정 {(['keep', 'watch', 'adjust', 'hold'] as Decision[]).filter((k) => counts[k]).map((k) => `${DECISION_LABEL[k]} ${counts[k]}`).join(' · ') || '확정 없음'}
          {m.budget && m.budget.total ? ` · 예산 ${Math.round((m.budget.spent / m.budget.total) * 100)}% 집행` : ''}
        </span>
      </div>
      {m.review && (
        <p className="mt-1 text-[13px] text-x-muted">
          {m.review.decidedByName || '알 수 없음'}님이 {new Date(m.review.decidedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 기록
        </p>
      )}
      {snap && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-x-muted">기록 당시 → 지금</span>
          {diffs.length === 0 ? <span className="text-x-secondary">숫자가 그대로예요</span> : diffs.map(([label, a, b]) => (
            <span key={label} className="rounded-md bg-x-surface px-2 py-0.5 tabular-nums text-x-secondary">{label} <span className="text-x-muted">{a}</span> → <b className="text-x-text">{b}</b></span>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="월 방향">
        {DIRECTIONS.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={dir === d} onClick={() => setDir(d)}
            className={`rounded-lg border px-3 py-2 text-left ${dir === d ? 'border-x-blue bg-x-blue/5' : 'border-x-border hover:bg-x-hover'}`}>
            <span className="block text-[15px] font-semibold">{DIRECTION_LABEL[d]}</span>
            <span className="block text-[13px] text-x-muted">{DIRECTION_HELP[d]}</span>
          </button>
        ))}
      </div>
      <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={1000}
        placeholder="다음 달에 무엇을 할지 (선택) — 예: 11월 예산 300만으로 증액, 인플 2명 교체"
        className="mt-3 w-full rounded-lg border border-x-border px-3 py-2 text-[15px] focus:border-x-blue focus:outline-none" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-x-muted">
          {m.lastReview ? <>전월 방향: <b>{DIRECTION_LABEL[m.lastReview.direction]}</b>{m.lastReview.memo ? ` — ${m.lastReview.memo}` : ''}</> : '전월 방향 기록이 없어요'}
        </span>
        <span className="flex items-center gap-3">
          {msg && <span className="text-[13px] text-red-600">{msg}</span>}
          <Button variant="primary" onClick={save} disabled={saving || !changed}>{saving ? '저장 중…' : m.review ? '방향 고치기' : '이 방향으로 기록'}</Button>
        </span>
      </div>
    </section>
  );
}
