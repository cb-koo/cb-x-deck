// 클라이언트 현황 — 상세. 판정(규칙 제안 → 사람이 확정) + 근거 차트. 스펙 2026-10-09 §3·5·6
'use client';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { DECISION_LABEL, mdLabel, type Decision } from '@/lib/clientStatus';
import type { ClientStatus, ReviewRow } from '@/lib/clientStatusStore';
import { Button } from '@/components/ui';
import { ChartCard, Delta } from '@/components/charts/ChartCard';
import { CategoryBars } from '@/components/charts/CategoryBars';
import { DayBarsChart, type DayEvent } from '@/components/charts/DayBarsChart';
import { PostScoreTable } from '@/components/charts/PostScoreTable';
import { BubbleScatter, type Bubble } from '@/components/charts/BubbleScatter';
import { FunnelList } from '@/components/charts/FunnelList';
import { GrowthCurves } from '@/components/charts/GrowthCurves';
import { BulletList } from '@/components/charts/BulletList';
import { NUM, compact } from '@/components/charts/tokens';
import { NORMAL_RULE, normalRange, spikeThreshold, verdictOf, VERDICT_TEXT } from '@/components/charts/normal';
import { DecisionChip } from '../DecisionChip';
import { PostPanel } from '../PostPanel';

const WEEKS_SHOWN = 8;
const PANEL_W = 460;      // PostPanel 너비와 같게
const WIDE_MIN = 1280;    // 이보다 넓으면 패널 옆으로 본문을 민다

function useWideScreen(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}
const DECISIONS: Decision[] = ['keep', 'watch', 'adjust', 'hold'];
const DECISION_HELP: Record<Decision, string> = {
  keep: '지금 방향대로 계속',
  watch: '바꾸지 않고 한 주 더 지켜봄',
  adjust: '인플·원고·예산 중 무엇을 바꿀지 검토',
  hold: '데이터가 부족해 판단을 미룸',
};

const Icon = {
  users: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.6.8 2.7 2.6 3 5.2" /></svg>,
  bookmark: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>,
  calendar: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
  list: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>,
  funnel: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z" /></svg>,
  scatter: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4v16h16" /><circle cx="9" cy="14" r="1.6" /><circle cx="13" cy="9" r="2.2" /><circle cx="17.5" cy="12" r="1.4" /></svg>,
};

const fmtLift = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}명`;
// 묶음의 게시일 범위(글 기준) — g.to는 인입을 세는 창의 끝(다음 날 포함)이라 '게시' 날짜로 쓰면 성적표와 어긋난다
const span = (g: { posts: Array<{ date: string }> }) => {
  const ds = g.posts.map((p) => p.date).sort();
  return ds[0] === ds[ds.length - 1] ? mdLabel(ds[0]) : `${mdLabel(ds[0])}~${mdLabel(ds[ds.length - 1])}`;
};
const LABEL_MIN_BM = 1000;
const LABEL_GAP_DAYS = 10; // 이름표끼리 겹치지 않게 — 10일 안에 더 큰 날이 있으면 이름표를 뺀다

export default function ClientStatusPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const [s, setS] = useState<ClientStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`/api/status/${clientId}`);
      if (r.status === 404) { setErr('리포트가 연결된 클라이언트가 아니에요'); return; }
      if (!r.ok) throw new Error(String(r.status));
      setS((await r.json()) as ClientStatus);
      setErr(null);
    } catch { setErr('현황을 불러오지 못했어요'); }
  }, [clientId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 비동기 콜백
  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto max-w-[1180px] px-6 py-8">
      <Link href="/status" className="text-ui text-x-blue-text hover:underline">← 클라이언트 현황</Link>
      {err && <p className="py-10 text-center text-ui text-x-secondary">{err}</p>}
      {!s && !err && <p className="py-10 text-center text-ui text-x-muted">불러오는 중…</p>}
      {s && <Detail s={s} onSaved={(review) => setS({ ...s, review })} />}
    </main>
  );
}

function Detail({ s, onSaved }: { s: ClientStatus; onSaved: (r: ReviewRow) => void }) {
  // 글 상세 패널 — 어느 차트에서 눌렀든 같은 패널(스펙 §10). 여러 글이면 목록부터.
  const [sel, setSel] = useState<{ ids: string[]; picked: string | null } | null>(null);
  const openPosts = (ids: string[]) => setSel({ ids, picked: ids.length === 1 ? ids[0] : null });
  const selIds = sel ? (sel.picked ? [sel.picked] : sel.ids) : [];
  // 넓은 화면에선 패널 자리만큼 본문을 왼쪽으로 민다(패널이 오른쪽 차트를 가리지 않게). 좁으면 위에 덮는다.
  const wide = useWideScreen();
  const n = s.weeks.length;
  const labels = s.weekLabels.slice(-WEEKS_SHOWN);
  const inflow8 = s.newInflow.slice(-WEEKS_SHOWN).map((v) => v ?? 0);
  const inflowBand = s.suggestion.band ?? normalRange(inflow8);
  const inflowNow = s.newInflow[n - 1], inflowPrev = s.newInflow[n - 2];
  const bm8 = s.x.bookmarks.slice(-WEEKS_SHOWN);
  const bmNow = s.x.bookmarks[n - 1], bmPrev = s.x.bookmarks[n - 2];
  const postedWeeks = bm8.filter((_, i) => s.x.postCount[n - WEEKS_SHOWN + i] > 0);
  const bmBand = postedWeeks.length >= 4 ? normalRange(postedWeeks) : undefined;
  const cpb8 = s.x.costPerBookmark.slice(-WEEKS_SHOWN);
  const cpbKnown = cpb8.filter((v): v is number => v !== null);
  const cpbBand = cpbKnown.length >= 4 ? normalRange(cpbKnown) : null;
  const dayBand = normalRange(s.dailyNew);
  const recordsFrom = s.posts.length ? s.posts.reduce((a, p) => (p.date < a ? p.date : a), s.posts[0].date) : undefined;

  const events = useMemo<DayEvent[]>(() => {
    const byDay = new Map<string, ClientStatus['posts']>();
    for (const p of s.posts) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
    const days = [...byDay.entries()].map(([date, ps]) => ({ date, ps: [...ps].sort((a, b) => b.bookmarks - a.bookmarks), bm: ps.reduce((a, p) => a + p.bookmarks, 0) }));
    const labeled = new Set<string>();
    for (const d of [...days].sort((a, b) => b.bm - a.bm)) {
      if (d.bm < LABEL_MIN_BM) break;
      if ([...labeled].every((o) => Math.abs(Date.parse(o) - Date.parse(d.date)) >= LABEL_GAP_DAYS * 864e5)) labeled.add(d.date);
    }
    return days.map(({ date, ps, bm }) => ({ date, weight: bm, count: ps.length,
      label: labeled.has(date) ? `@${ps[0].handle} 북마크 ${NUM.format(bm)}` : undefined,
      posts: ps.map((p) => ({ id: p.id, handle: p.handle, bookmarks: p.bookmarks, views: p.views })) }));
  }, [s.posts]);

  const bubbles = useMemo<Bubble[]>(() => s.groups.map((g) => {
    const top = g.posts[0], more = g.posts.length > 1 ? ` 외 ${g.posts.length - 1}` : '';
    return {
      id: g.from, x: g.views, y: g.lift, size: g.bookmarks, strong: g.lift >= Math.max(...s.groups.map((x) => x.lift)) && g.lift > 0, label: `${top.handle}${more}`,
      tip: {
        title: `@${top.handle}${g.posts.length > 1 ? ` 외 ${g.posts.length - 1}개` : ''}`, sub: `${span(g)} 게시`,
        rows: [
          { label: '인입 증가 (평소 대비)', value: fmtLift(g.lift), strong: true, tone: g.lift > 0 ? 'up' : 'muted' },
          { label: '조회', value: compact(g.views) },
          { label: '북마크', value: `${NUM.format(g.bookmarks)} (${g.views ? ((g.bookmarks / g.views) * 100).toFixed(2) : '0'}%)` },
        ],
        note: g.posts.length > 1 ? `글 ${g.posts.length}개 묶음 — 누르면 글 목록이 열려요` : '누르면 글 상세가 열려요',
      },
    };
  }), [s.groups]);

  const bestG = [...s.groups].sort((a, b) => b.lift - a.lift)[0];
  const highlight = [...s.growth].sort((a, b) => (b.points.at(-1)?.[1] ?? 0) - (a.points.at(-1)?.[1] ?? 0))[0];
  const [f, c, r] = [s.funnel4.newInflow, s.funnel4.consulted, s.funnel4.reservers];
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div className="mt-3 flex flex-col gap-4" style={{ paddingRight: sel && wide ? PANEL_W + 16 : 0, transition: 'padding-right 150ms' }}>
      <div>
        <h1 className="text-[22px] font-bold">{s.client.name}</h1>
        <p className="text-ui text-x-muted">{mdLabel(s.baseWeek.start)}~{mdLabel(s.baseWeek.end)} 결과 기준 · 이번 주 캠페인 방향을 정해요</p>
      </div>

      <ReviewPanel s={s} onSaved={onSaved} />

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))' }}>
        <ChartCard icon={Icon.users} title="신규 인입 · 주별" value={inflowNow === null ? '—' : `${inflowNow}명`}
          delta={inflowNow !== null && inflowPrev !== null ? <Delta diff={inflowNow - inflowPrev} unit="명" good="up" base={`그 전주 ${inflowPrev}명`} /> : undefined}
          headline={inflowNow === null ? '지난주 신규 인입 기록이 없어요' : `지난주 신규 인입은 ${VERDICT_TEXT[verdictOf(inflowNow, inflowBand)]}`}
          info={{ what: '그 주에 LINE으로 처음 말을 건 사람 수', calc: ['기존 고객 재문의는 빼요', NORMAL_RULE], read: ['파란 막대 = 지난주', '회색 띠 = 평소 범위'] }}>
          <CategoryBars labels={labels} values={inflow8} band={inflowBand} bandLabel={`평소 ${inflowBand[0]}~${inflowBand[1]}`} />
        </ChartCard>

        <ChartCard icon={Icon.bookmark} title="X 북마크 · 주별" value={NUM.format(bmNow)}
          delta={<Delta diff={bmNow - bmPrev} good="up" base={`그 전주 ${NUM.format(bmPrev)}`} />}
          headline={s.x.postCount[n - 1] === 0 ? '지난주엔 X 게시가 없었어요' : bmBand ? `지난주 북마크는 ${VERDICT_TEXT[verdictOf(bmNow, bmBand)]}` : `지난주 글 ${s.x.postCount[n - 1]}개, 북마크 ${NUM.format(bmNow)}`}
          info={{ what: '그 주에 올린 우리 게시물의 북마크 합계', calc: ['게시물마다 마지막으로 잰 값', '게시 주는 게시 시각(서울) 기준', '평소 범위는 게시가 있던 주가 4주 이상일 때만'], read: ['아래 줄 = 북마크 1개당 집행 비용(낮을수록 좋음)', '⚠ = 평소보다 비싼 주'], note: ['북마크가 신규 인입과 가장 잘 맞는 반응 지표예요'] }}>
          <CategoryBars labels={labels} values={bm8} band={bmBand} bandLabel="평소"
            sub={cpb8.map((v) => (v === null ? '—' : `${NUM.format(v)}원`))} subWarn={cpb8.map((v) => v !== null && !!cpbBand && v > cpbBand[1])}
            subLabel="북마크 1개당 비용 · 낮을수록 좋음" />
        </ChartCard>

        <ChartCard icon={Icon.calendar} title={s.budget ? `예산 · ${s.budget.label}` : '예산'}
          headline={s.budget ? budgetHeadline(s.budget) : '오늘이 포함된 예산 기간이 없어요'}
          info={{ what: '이번 기간 예산을 날짜에 맞게 쓰고 있나', read: ['진한 파랑 = 집행(게시까지 끝난 작업)', '연한 파랑 = 예정까지 포함', '검은 세로선 = 오늘 기준 적정 소진선'], calc: ['기간에 시작한 캠페인의 작업 비용 합(엔은 ×10원)', '적정 = 기간이 지난 비율 × 예산'] }}>
          {s.budget
            ? <BulletList rows={[{ label: '이번 기간', total: s.budget.total, spent: s.budget.spent, planned: s.budget.planned, pace: s.budget.pace }]} />
            : <p className="text-ui text-x-muted">클라이언트 설정에서 예산 기간을 넣으면 여기서 소진 속도를 볼 수 있어요.</p>}
        </ChartCard>
      </div>

      <ChartCard icon={Icon.users} title="게시물과 신규 인입 · 일별 8주"
        headline={bestG && bestG.lift > 0 ? `${span(bestG)} 게시 뒤 신규 인입이 평소보다 ${bestG.lift}명 늘었어요` : '게시 뒤 신규 인입이 눈에 띄게 늘어난 때는 없었어요'}
        info={{ what: '게시한 날과 그 뒤 하루하루의 신규 인입', read: ['위 원 = 게시한 날, 크기 = 그날 글들의 북마크 합 (누르면 글 상세)', '원 안 숫자 = 그날 올린 글 수', `파란 막대 = 크게 튄 날(하루 ${spikeThreshold(dayBand)}명 넘음)`], calc: [`평소 하루 ${dayBand[0]}~${dayBand[1]}명 (${NORMAL_RULE})`, '크게 튄 날 = 평소 위쪽 끝의 2배를 넘는 날'], note: recordsFrom ? [`${mdLabel(recordsFrom)} 전은 우리 게시 기록이 없어 흐리게 표시해요`] : undefined }}>
        <DayBarsChart days={s.days} values={s.dailyNew} band={dayBand} bandLabel="평소" highlightAbove={spikeThreshold(dayBand)} events={events}
          dimBefore={recordsFrom && recordsFrom > s.days[0] ? recordsFrom : undefined} dimText="게시 기록 없음" valueName="신규 인입" height={200} onSelectPosts={openPosts} selectedPostIds={selIds} />
      </ChartCard>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
        <ChartCard icon={Icon.list} title="게시물 성적표 · 게시 묶음별"
          headline={bestG ? `가장 효과가 컸던 건 ${bestG.posts[0].handle} 묶음 (${fmtLift(bestG.lift)})` : `북마크 50 넘는 글이 없어 성적을 매길 묶음이 없어요`}
          info={{
            what: '게시 묶음마다 신규 인입이 평소보다 얼마나 늘었나',
            calc: ['묶음 = 게시일이 하루 안팎인 글들', `인입 증가 = 묶음 기간 신규 인입 − 평소 하루 ${s.typicalDay}명 × 일수`, `북마크 50 미만 글 ${s.smallPostCount}개는 영향이 작아 제외`],
            read: ['줄을 누르면 오른쪽에 글 상세가 열려요', '글이 여러 개인 묶음은 목록부터 열려요'],
            note: ['신규 인입은 클리닉 전체 합계라 글 하나의 효과는 직접 잴 수 없어요'],
          }}>
          {s.groups.length ? <PostScoreTable groups={s.groups} onSelect={openPosts} selectedIds={selIds} /> : <p className="text-ui text-x-muted">최근 8주 우리 글 {s.posts.length}개 — 모두 북마크 50 미만이에요.</p>}
        </ChartCard>

        <ChartCard icon={Icon.scatter} title="조회와 인입의 관계 · 게시 묶음별"
          headline={s.groups.length < 3 ? '묶음이 3개 미만이라 경향을 보기 어려워요' : '오른쪽 위로 갈수록 조회도 인입도 많았던 묶음이에요'}
          info={{ what: '게시 묶음마다 조회수와 신규 인입 증가를 한 점으로', read: ['오른쪽일수록 조회가 많은 묶음', '위쪽일수록 인입이 많이 늘어난 묶음', '원이 클수록 북마크가 많음', '원을 누르면 글 상세가 열려요'], calc: ['가로 눈금은 한 칸마다 10배', '인입 증가는 성적표와 같은 셈법'] }}>
          {s.groups.length ? <BubbleScatter points={bubbles} xName="조회수" yName="인입 증가(명)" height={300}
            onSelect={(gid) => { const g = s.groups.find((x) => x.from === gid); if (g) openPosts(g.posts.map((p) => p.id).filter((v): v is string => !!v)); }}
            selectedId={s.groups.find((g) => g.posts.some((p) => p.id && selIds.includes(p.id)))?.from ?? null} /> : <p className="text-ui text-x-muted">표시할 묶음이 없어요.</p>}
        </ChartCard>
      </div>

      <div className="grid items-start gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))' }}>
        <ChartCard icon={Icon.funnel} title="고객 흐름 · 최근 4주"
          headline={`신규 인입 ${f[0]}명 중 상담 ${pct(c[0], f[0])}%, 예약 ${pct(r[0], f[0])}% (직전 4주 ${pct(r[1], f[1])}%)`}
          info={{ what: '최근 4주 신규 인입에서 예약까지 단계별 사람 수', read: ['막대 = 신규 인입 대비 남은 비율', '앞 단계에서 = 바로 앞 단계 중 넘어온 비율', '증감에 마우스를 올리면 직전 4주 값이 보여요'], calc: ['상담 = CS가 문의·예약 상담으로 표시한 사람', '예약 = LINE 계정 기준 예약자(접수일 기준)'], note: ['첫 문의 후 예약까지 보통 3일 안 — 최근 주 예약은 조금 더 늘 수 있어요'] }}>
          <FunnelList compareName="직전 4주" steps={[
            { name: '신규 인입', count: f[0], prevCount: f[1], sub: 'LINE에 처음 말을 건 사람' },
            { name: '상담', count: c[0], prevCount: c[1], sub: 'CS가 문의·예약 상담으로 표시' },
            { name: '예약', count: r[0], prevCount: r[1], sub: 'LINE 계정 기준' },
          ]} />
        </ChartCard>

        <ChartCard icon={Icon.users} title="경과 시간별 누적 조회 · 최근 2주 게시물"
          headline={highlight ? `가장 크게 자란 글은 @${highlight.label} (${mdLabel(highlight.date)})` : '최근 2주 측정 기록이 있는 글이 없어요'}
          info={{ what: '게시 후 시간이 지나며 조회가 어떻게 쌓였나', read: ['파란 선 = 가장 크게 자란 글', '회색 선 = 다른 글 (선을 누르면 글 상세)', '회색 띠 = 같은 시각 다른 글들의 가운데 절반'], calc: ['가로·세로 모두 눈금마다 배로 늘어요', '측정은 게시 후 15분~7일 자동 측정 기록'] }}>
          {highlight ? <GrowthCurves curves={s.growth} highlightId={sel?.picked && s.growth.some((g) => g.id === sel.picked) ? sel.picked : highlight.id} height={260} onSelect={(id) => openPosts([id])} /> : <p className="text-ui text-x-muted">게시물이 등록되면 자동 측정이 쌓여 여기 그려져요.</p>}
        </ChartCard>
      </div>
      {sel && <PostPanel s={s} ids={sel.ids} picked={sel.picked} onPick={(id) => setSel({ ...sel, picked: id })} onClose={() => setSel(null)} />}
    </div>
  );
}

function budgetHeadline(b: NonNullable<ClientStatus['budget']>): string {
  const gap = b.total ? b.spent / b.total - b.pace : 0;
  const state = gap < -0.1 ? '집행이 느려요' : gap > 0.1 ? '집행이 빨라요' : '적정 속도예요';
  return `${state} — 집행 ${Math.round((b.spent / (b.total || 1)) * 100)}% · 예정 포함 ${Math.round((b.planned / (b.total || 1)) * 100)}%`;
}

function ReviewPanel({ s, onSaved }: { s: ClientStatus; onSaved: (r: ReviewRow) => void }) {
  const [verdict, setVerdict] = useState<Decision>(s.review?.verdict ?? s.suggestion.decision);
  const [memo, setMemo] = useState(s.review?.memo ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const changed = !s.review || s.review.verdict !== verdict || s.review.memo !== memo.trim();

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch(`/api/status/${s.client.id}/review`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verdict, memo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? '저장하지 못했어요'); return; }
      onSaved(j as ReviewRow);
    } catch { setMsg('저장하지 못했어요 — 다시 시도해 주세요'); } finally { setSaving(false); }
  };

  return (
    <section className="rounded-xl border border-x-border bg-white p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[16px] font-semibold">이번 주 판정</span>
        {s.review ? <DecisionChip decision={s.review.verdict} /> : <DecisionChip decision={s.suggestion.decision} draft />}
        <span className="text-ui text-x-secondary">
          규칙 제안: <b>{DECISION_LABEL[s.suggestion.decision]}</b> — {s.suggestion.reason}
        </span>
      </div>
      {s.review && (
        <p className="mt-1 text-[13px] text-x-muted">
          {s.review.decidedByName || '알 수 없음'}님이 {new Date(s.review.decidedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 확정
          {s.review.verdict !== s.review.suggested ? ` · 규칙 제안(${DECISION_LABEL[s.review.suggested]})과 다르게 정함` : ''}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="판정">
        {DECISIONS.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={verdict === d} onClick={() => setVerdict(d)}
            className={`rounded-lg border px-3 py-2 text-left ${verdict === d ? 'border-x-blue bg-x-blue/5' : 'border-x-border hover:bg-x-hover'}`}>
            <span className="block text-[15px] font-semibold">{DECISION_LABEL[d]}{d === s.suggestion.decision ? <span className="ml-1 text-[12px] font-normal text-x-muted">제안</span> : null}</span>
            <span className="block text-[13px] text-x-muted">{DECISION_HELP[d]}</span>
          </button>
        ))}
      </div>
      <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={1000}
        placeholder="왜 이렇게 정했는지, 이번 주에 무엇을 할지 (선택) — 예: 상담 단계 이탈 확인, 다음 주 인플 2명 교체"
        className="mt-3 w-full rounded-lg border border-x-border px-3 py-2 text-[15px] focus:border-x-blue focus:outline-none" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-x-muted">
          {s.lastReview ? <>지난주 판정: <b>{DECISION_LABEL[s.lastReview.verdict]}</b>{s.lastReview.memo ? ` — ${s.lastReview.memo}` : ''}</> : '지난주 판정 기록이 없어요'}
        </span>
        <span className="flex items-center gap-3">
          {msg && <span className="text-[13px] text-red-600">{msg}</span>}
          <Button variant="primary" onClick={save} disabled={saving || !changed}>{saving ? '저장 중…' : s.review ? '판정 고치기' : '이 판정으로 확정'}</Button>
        </span>
      </div>
    </section>
  );
}
