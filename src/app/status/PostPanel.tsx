// 리포트 글 상세 패널(스펙 2026-10-09 §10) — 리포트의 어느 차트에서든 글을 누르면 오른쪽에 열린다.
// 정보는 종류별로 두 묶음 — 성과(숫자는 전부 여기, 글 대신 그림: 비교 막대·인입 막대·성장 곡선) → 게시글(X 원문 그대로).
// 머리글(누구·어느 캠페인)과 버튼은 스크롤해도 고정. 작업·캠페인·지표는 현황 응답에 있고, 글 원문과 측정 이력만 열 때 부른다.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { scaleLog } from 'd3-scale';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientStatus, StatusPost } from '@/lib/clientStatusStore';
import type { DeckTweet } from '@/lib/types';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { mdLabel } from '@/lib/clientStatus';
import { useTweetPreview } from '@/app/campaigns/flow/panel/useTweetPreview';
import { TweetText } from '@/components/TweetText';
import { QuotedCard } from '@/components/QuotedCard';
import { ImageLightbox } from '@/components/ImageLightbox';
import { GrowthCurves } from '@/components/charts/GrowthCurves';
import { useWidth } from '@/components/charts/ChartCard';
import { C, NUM, compact } from '@/components/charts/tokens';
import { normalRange, verdictOf } from '@/components/charts/normal';
import { LikeIcon, RepostIcon, ReplyIcon } from '@/components/XIcons';

type Snap = { capturedAt: string; metrics: { views: number | null } };
const MIN_COMPARE = 4;      // 비교할 다른 글이 이보다 적으면 많다/적다 판정을 하지 않는다
const MIN_BOOKMARKS = 50;   // 성적표(postGroups)와 같은 기준 — 이 미만 글은 인입 효과를 따로 세지 않는다

const WD = '일월화수목금토';
function parts(iso: string) {
  const d = new Date(Date.parse(iso) + 9 * 3600e3); // 서울 시각
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), wd: WD[d.getUTCDay()], h: d.getUTCHours(), min: d.getUTCMinutes() };
}
const pad = (n: number) => String(n).padStart(2, '0');
/** 9/9(수) 19:18 — 리포트 다른 자리와 같은 짧은 표기 */
const when = (iso: string) => { const p = parts(iso); return `${p.m}/${p.day}(${p.wd}) ${pad(p.h)}:${pad(p.min)}`; };
/** X 원문 아래 시각 줄 — 오후 7:18 · 2026년 9월 9일 */
const xWhen = (iso: string) => { const p = parts(iso); return `${p.h < 12 ? '오전' : '오후'} ${p.h % 12 || 12}:${pad(p.min)} · ${p.y}년 ${p.m}월 ${p.day}일`; };
// 단가는 1원 아래도 흔하다(조회당) — 1원 미만은 소수 둘째, 10원 미만은 첫째 자리까지
const won = (n: number) => `${n < 1 ? n.toFixed(2) : n < 10 ? n.toFixed(1) : NUM.format(Math.round(n))}원`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}명`;
const span = (dates: string[]) => { const d = [...dates].sort(); return d[0] === d[d.length - 1] ? mdLabel(d[0]) : `${mdLabel(d[0])}~${mdLabel(d[d.length - 1])}`; };
type WithId = { id?: string };

// ids = 누른 자리의 글들, picked = 그중 연 글. 여러 개에서 열었으면 머리글에 '← 목록'.
export function PostPanel({ s, ids, picked, onPick, onClose }: {
  s: ClientStatus; ids: string[]; picked: string | null; onPick: (id: string | null) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const find = (id: string) => s.posts.find((p) => p.id === id);
  const listed = ids.map(find).filter((p): p is StatusPost => !!p);
  const post = picked ? find(picked) ?? null : null;
  // 이전·다음 = 이 클라이언트 글 전체를 북마크 많은 순으로
  const order = [...s.posts].sort((a, b) => b.bookmarks - a.bookmarks);
  const at = post ? order.findIndex((p) => p.id === post.id) : -1;

  return (
    <aside aria-label="글 상세" className="fixed right-0 top-0 z-40 flex h-full w-[460px] max-w-full flex-col border-l border-x-border bg-white shadow-xl">
      <header className="shrink-0 border-b border-x-border px-5 py-3">
        {post && listed.length > 1 && (
          <button type="button" onClick={() => onPick(null)} className="mb-1 text-[13px] text-x-blue-text hover:underline">← {span(listed.map((p) => p.date))}에 올린 글 {listed.length}개</button>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {post ? (
              <>
                <div className="truncate text-[17px] font-bold">@{post.handle}</div>
                <div className="truncate text-[13px] text-x-secondary">{post.campaignName} · {TASK_TYPE_LABEL[post.taskType as keyof typeof TASK_TYPE_LABEL] ?? post.taskType} · {when(post.postedAt)}</div>
              </>
            ) : (
              <div className="text-[17px] font-bold">{listed.length ? `${span(listed.map((p) => p.date))}에 올린 글 ${listed.length}개` : '글 상세'}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {post && (
              <>
                <button type="button" disabled={at <= 0} onClick={() => onPick(order[at - 1].id)} title="북마크가 더 많은 글" aria-label="이전 글"
                  className="h-8 w-8 rounded-full text-[18px] text-x-secondary hover:bg-x-text/5 disabled:opacity-30">‹</button>
                <span className="text-[12px] tabular-nums text-x-muted" title="북마크 많은 순">{at + 1}/{order.length}</span>
                <button type="button" disabled={at < 0 || at >= order.length - 1} onClick={() => onPick(order[at + 1].id)} title="북마크가 더 적은 글" aria-label="다음 글"
                  className="h-8 w-8 rounded-full text-[18px] text-x-secondary hover:bg-x-text/5 disabled:opacity-30">›</button>
              </>
            )}
            <button type="button" onClick={onClose} aria-label="닫기" className="ml-1 h-8 w-8 rounded-full text-x-secondary hover:bg-x-text/5">✕</button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!post && listed.length === 0 && <p className="py-10 text-center text-ui text-x-muted">이 글의 기록을 찾을 수 없어요</p>}
        {!post && listed.length > 0 && <PostList posts={listed} onPick={onPick} />}
        {post && <PostDetail key={post.id} s={s} p={post} />}
      </div>

      {post && (
        <footer className="flex shrink-0 justify-end gap-2 border-t border-x-border px-5 py-3">
          <a href={`https://x.com/${post.handle}/status/${post.tweetId}`} target="_blank" rel="noreferrer"
            className="rounded-full border border-x-border-strong bg-white px-3 py-1 text-ui hover:bg-x-hover">X에서 보기 ↗</a>
          <Link href={`/campaigns/flow?id=${post.campaignId}&task=${post.taskId}`}
            className="rounded-full bg-x-blue px-3 py-1 text-ui font-medium text-white hover:bg-x-blue-hover">캠페인에서 작업 열기</Link>
        </footer>
      )}
    </aside>
  );
}

function PostList({ posts, onPick }: { posts: StatusPost[]; onPick: (id: string) => void }) {
  return (
    <div className="px-5 py-2">
      {[...posts].sort((a, b) => b.bookmarks - a.bookmarks).map((p) => (
        <button key={p.id} type="button" onClick={() => onPick(p.id)}
          className="flex min-h-[56px] w-full items-center justify-between gap-3 border-b border-x-border text-left last:border-b-0 hover:bg-x-hover">
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">@{p.handle}</span>
            <span className="block truncate text-[13px] text-x-muted">{p.campaignName} · {when(p.postedAt)}</span>
          </span>
          <span className="shrink-0 text-right text-[13px] tabular-nums text-x-secondary">
            북마크 <b className="text-x-text">{NUM.format(p.bookmarks)}</b> · 조회 {compact(p.views)} <span className="text-x-blue-text">›</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PostDetail({ s, p }: { s: ClientStatus; p: StatusPost }) {
  const url = `https://x.com/${p.handle}/status/${p.tweetId}`;
  const { preview, loading, failed } = useTweetPreview(p.unavailable ? null : url);
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/tracking/${p.id}/snapshots`).catch(() => null);
      const j = r && r.ok ? ((await r.json().catch(() => null)) as Snap[] | null) : null;
      if (alive) setSnaps(j ?? []);
    })();
    return () => { alive = false; };
  }, [p.id]);

  // 판정 기준 = 북마크(신규 인입과 가장 잘 맞는 반응) — 칩 글자도 '북마크'라고 쓴다(계산과 말이 같게)
  const others = s.posts.filter((o) => o.id !== p.id);
  const rank = [...s.posts].sort((a, b) => b.bookmarks - a.bookmarks).findIndex((o) => o.id === p.id) + 1;
  const band = others.length >= MIN_COMPARE ? normalRange(others.map((o) => o.bookmarks)) : null;
  const v = band ? verdictOf(p.bookmarks, band) : null;

  const rate = (o: StatusPost) => (o.views ? (o.bookmarks / o.views) * 100 : 0);
  const cpb = (o: StatusPost) => (o.costKrw > 0 && o.bookmarks > 0 ? o.costKrw / o.bookmarks : null);
  const rows: CompareRow[] = [
    { label: '조회', value: p.views, others: others.map((o) => o.views), fmt: compact },
    { label: '북마크', value: p.bookmarks, others: others.map((o) => o.bookmarks), fmt: (n) => NUM.format(n) },
    { label: '북마크율', value: rate(p), others: others.map(rate), fmt: (n) => `${n.toFixed(2)}%` },
  ];
  const myCpb = cpb(p), otherCpb = others.map(cpb).filter((n): n is number => n !== null);
  if (myCpb !== null && otherCpb.length) rows.push({ label: '북마크 1개 비용', value: myCpb, others: otherCpb, fmt: won, lowerBetter: true });

  // 신규 인입 효과 — 성적표와 같은 계산(게시 묶음의 인입 증가를 북마크 비율로 나눈 추정)
  const group = s.groups.find((g) => g.posts.some((x) => (x as WithId).id === p.id));
  const mine = group?.posts.find((x) => (x as WithId).id === p.id);

  const hours = (iso: string) => (Date.parse(iso) - Date.parse(p.postedAt)) / 3600e3;
  const points: Array<[number, number]> = (snaps ?? []).filter((x) => x.metrics.views !== null)
    .map((x): [number, number] => [Math.round(hours(x.capturedAt) * 10) / 10, x.metrics.views as number]).sort((a, b) => a[0] - b[0]);
  const drawable = points.filter(([h]) => h >= 1).length >= 2;
  const curves = [{ id: p.id, label: `@${p.handle}`, points }, ...s.growth.filter((g) => g.id !== p.id)];

  return (
    <div className="flex flex-col">
      {/* ── 성과: 숫자는 모두 여기, 그림으로 ── */}
      <GroupHead title="성과" right={p.capturedAt ? `${when(p.capturedAt)} 측정` : '측정 전'} />
      <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
        <div>
          <SubHead label="다른 글과 비교" right={<><VerdictChip v={v} />{' '}<span className="text-[13px] tabular-nums text-x-secondary">북마크 {rank}위 / {s.posts.length}</span></>} />
          <CompareBars rows={rows} />
          <div className="mt-1.5 flex items-center gap-4 text-[12px] text-x-muted">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-sm" style={{ background: C.primary }} />이 글</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-0.5" style={{ background: C.text }} />이 클라이언트 글 가운데값</span>
          </div>
          <Reactions p={p} />
        </div>

        <div>
          <SubHead label="신규 인입 변화" right={group && group.posts.length > 1 ? <span className="text-[12px] text-x-muted">함께 올린 글 {group.posts.length}개 · 북마크 비율로 나눔</span> : null} />
          <div className="flex items-end gap-4">
            <div className="w-[92px] shrink-0">
              {group && mine ? (
                <>
                  <div className="text-[26px] font-bold leading-none tabular-nums" style={{ color: mine.estLift > 0 ? C.primaryDeep : C.secondary }}>{signed(mine.estLift)}</div>
                  <div className="mt-1 text-[12px] text-x-muted">평소 대비{group.posts.length > 1 ? ' · 추정' : ''}</div>
                </>
              ) : (
                <>
                  <div className="text-[26px] font-bold leading-none text-x-muted">—</div>
                  <div className="mt-1 text-[12px] text-x-muted">북마크 {MIN_BOOKMARKS} 미만 · 계산 안 함</div>
                </>
              )}
            </div>
            <MiniInflow s={s} from={group?.from ?? p.date} to={group?.to ?? p.date} postDate={p.date} active={!!group} />
          </div>
        </div>

        <div>
          <SubHead label="조회 증가 속도" right={snaps && snaps.length ? <span className="text-[12px] text-x-muted">측정 {snaps.length}회</span> : null} />
          {snaps === null && <div className="h-[220px] animate-pulse rounded-lg bg-x-surface" />}
          {snaps !== null && !drawable && <div className="flex h-[88px] items-center justify-center rounded-lg bg-x-surface text-[13px] text-x-muted">측정이 적어 그래프 없음</div>}
          {snaps !== null && drawable && (
            <>
              <div className="mb-1 flex items-center gap-4 text-[12px] text-x-muted">
                <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4" style={{ background: C.primary }} />이 글</span>
                <span className="flex items-center gap-1.5"><i className="inline-block h-px w-4" style={{ background: C.neutralBar }} />최근 2주 다른 글</span>
                <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: C.band }} />다른 글 절반</span>
              </div>
              <GrowthCurves curves={curves} highlightId={p.id} height={220} showLabel={false} />
            </>
          )}
        </div>
      </div>

      {/* ── 게시글: X에서 보이는 그대로 ── */}
      <GroupHead title="게시글" />
      <div className="px-5 pb-6 pt-4">
        {p.unavailable
          ? <Notice>삭제·비공개된 글 · 성과는 마지막 측정값</Notice>
          : loading ? <div className="h-40 animate-pulse rounded-2xl bg-x-surface" />
          : failed || !preview || preview.kind !== 'ok' ? <Notice>글을 불러오지 못했어요 · 아래 [X에서 보기]</Notice>
          : <XPost t={preview.tweet} postedAt={p.postedAt} />}
      </div>
    </div>
  );
}

// 정보 묶음 머리 — 회색 띠로 '성과'와 '게시글'을 확실히 나눈다
function GroupHead({ title, right }: { title: string; right?: string }) {
  return (
    <div className="flex items-center justify-between border-y border-x-border bg-x-surface px-5 py-2">
      <span className="text-[15px] font-bold">{title}</span>
      {right && <span className="text-[12px] text-x-muted">{right}</span>}
    </div>
  );
}
function SubHead({ label, right }: { label: string; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-2">
      <span className="text-[14px] font-semibold text-x-secondary">{label}</span>
      {right && <span className="flex items-center gap-1.5">{right}</span>}
    </div>
  );
}

const VERDICT_CHIP = {
  above: { text: '북마크 많음', bg: '#e8f5fe', fg: C.primaryDeep },
  normal: { text: '북마크 보통', bg: '#eef1f3', fg: C.secondary },
  below: { text: '북마크 적음', bg: '#fff4e0', fg: '#a15c00' },
} as const;
function VerdictChip({ v }: { v: 'above' | 'normal' | 'below' | null }) {
  if (!v) return <span className="rounded-full bg-x-surface px-2 py-0.5 text-[12px] text-x-muted">비교할 글 적음</span>;
  const c = VERDICT_CHIP[v];
  return <span className="rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: c.bg, color: c.fg }}>{c.text}</span>;
}

// 다른 글과 비교 막대 — 한 줄 = 지표 하나. 막대 = 이 글, 검은 세로선 = 이 클라이언트 글 가운데값.
// 글마다 수십~수백 배 차이라 로그 눈금. 가운데값보다 좋으면 파랑, 아니면 회색(비용은 낮을수록 좋음).
type CompareRow = { label: string; value: number; others: number[]; fmt: (n: number) => string; lowerBetter?: boolean };
const median = (vs: number[]) => { const a = [...vs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
function CompareBars({ rows }: { rows: CompareRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = 92, valueW = 72, rowH = 30;
  const plotW = Math.max(width - labelW - valueW, 10);
  return (
    <div ref={ref} style={{ height: rows.length * rowH }}>
      {width > 0 && (
        <svg width={width} height={rows.length * rowH} role="img" aria-label="다른 글과 비교">
          {rows.map((r, i) => {
            const all = [r.value, ...r.others].filter((n) => n > 0);
            const lo = Math.min(...all) * 0.8, hi = Math.max(...all) * 1.05;
            const x = scaleLog().domain([Math.max(lo, 1e-6), Math.max(hi, lo * 10)]).range([0, plotW]).clamp(true);
            const m = r.others.length ? median(r.others) : null;
            const good = m === null ? true : r.lowerBetter ? r.value <= m : r.value >= m;
            const cy = i * rowH + rowH / 2;
            const fillW = r.value > 0 ? Math.max(3, x(r.value)) : 0;
            return (
              <g key={r.label}>
                <text x={0} y={cy + 4} fontSize={13} fill={C.secondary}>{r.label}</text>
                <rect x={labelW} y={cy - 5} width={plotW} height={10} rx={5} fill="#eef1f3" />
                <rect x={labelW} y={cy - 5} width={fillW} height={10} rx={5} fill={good ? C.primary : C.neutralBar} />
                {m !== null && m > 0 && <line x1={labelW + x(m)} x2={labelW + x(m)} y1={cy - 9} y2={cy + 9} stroke={C.text} strokeWidth={2} strokeLinecap="round" />}
                <text x={width} y={cy + 5} textAnchor="end" fontSize={14} fontWeight={700} fill={good ? C.primaryDeep : C.text}>{r.fmt(r.value)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// 나머지 반응 — X 아이콘 줄처럼 아이콘 + 숫자. 비용은 오른쪽 끝.
function Reactions({ p }: { p: StatusPost }) {
  const items: Array<[React.ReactNode, number, string]> = [
    [<LikeIcon key="l" className="h-4 w-4" />, p.likes, '좋아요'],
    [<RepostIcon key="r" className="h-4 w-4" />, p.retweets, '리포스트'],
    [<span key="q" className="text-[15px] leading-none">❝</span>, p.quotes, '인용'],
    [<ReplyIcon key="c" className="h-4 w-4" />, p.replies, '답글'],
  ];
  return (
    <div className="mt-3 flex items-center justify-between border-t border-x-border pt-3 text-[14px] tabular-nums text-x-secondary">
      <div className="flex items-center gap-4">
        {items.map(([icon, n, label]) => <span key={label} title={label} className="flex items-center gap-1">{icon}{NUM.format(n)}</span>)}
      </div>
      <span title="이 작업 비용">{p.costKrw > 0 ? `비용 ${compact(p.costKrw)}원` : '비용 없음'}</span>
    </div>
  );
}

// 게시 앞뒤 신규 인입 — 막대 = 하루, 회색 띠 = 평소, 파란 막대 = 효과를 센 기간(게시~다음 날), ▲ = 게시일.
function MiniInflow({ s, from, to, postDate, active }: { s: ClientStatus; from: string; to: string; postDate: string; active: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 96, padT = 14, padB = 18, plotH = H - padT - padB;
  const i0 = Math.max(0, s.days.indexOf(from) - 3), i1 = Math.min(s.days.length - 1, (s.days.indexOf(to) < 0 ? s.days.indexOf(from) : s.days.indexOf(to)) + 3);
  if (s.days.indexOf(from) < 0) return <div className="flex h-[96px] flex-1 items-center justify-center rounded-lg bg-x-surface text-[12px] text-x-muted">8주 범위 밖 게시</div>;
  const days = s.days.slice(i0, i1 + 1), vals = s.dailyNew.slice(i0, i1 + 1);
  const band = normalRange(s.dailyNew);
  const max = Math.max(band[1], ...vals.map((v) => v ?? 0), 1);
  const y = (n: number) => padT + plotH - (n / max) * plotH;
  const step = width / days.length, bw = Math.max(4, step * 0.62);
  return (
    <div ref={ref} className="min-w-0 flex-1" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="게시 앞뒤 신규 인입">
          <rect x={0} y={y(band[1])} width={width} height={Math.max(1, y(band[0]) - y(band[1]))} fill={C.band} />
          {days.map((d, k) => {
            const n = vals[k] ?? 0, cx = step * k + step / 2, inWin = active && d >= from && d <= to;
            return (
              <g key={d}>
                <rect x={cx - bw / 2} y={y(n)} width={bw} height={Math.max(0, padT + plotH - y(n))} rx={2} fill={inWin ? C.primary : C.neutralBar} />
                {inWin && <text x={cx} y={y(n) - 3} textAnchor="middle" fontSize={11} fontWeight={700} fill={C.primaryDeep}>{n}</text>}
                {d === postDate && <text x={cx} y={H - 4} textAnchor="middle" fontSize={11} fill={C.primaryDeep}>▲{mdLabel(d)}</text>}
              </g>
            );
          })}
          <line x1={0} x2={width} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} />
          <text x={width} y={y(band[1]) - 3} textAnchor="end" fontSize={10} fill={C.secondary}>평소</text>
        </svg>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-x-border-strong px-4 py-4 text-center text-[14px] text-x-secondary">{children}</p>;
}

// X 원문 모양 그대로 — 아바타·이름·핸들, 본문 전체(자르지 않음), 이미지 전부(누르면 크게), 인용한 글, 게시 시각 줄.
function XPost({ t, postedAt }: { t: DeckTweet; postedAt: string }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const imgs = t.media.slice(0, 4);
  // X는 이미지·인용 글을 가리키는 끝 t.co 링크를 본문에서 감춘다 — 같은 모양으로
  const text = imgs.length || t.quoted ? t.text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '') : t.text;
  return (
    <article className="text-[15px] text-x-text">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {t.authorAvatarUrl ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 rounded-full" /> : <div className="h-10 w-10 rounded-full bg-x-border-strong" />}
        <div className="min-w-0 leading-tight">
          <div className="truncate font-bold">{t.authorName ?? t.authorHandle}</div>
          <div className="truncate text-x-secondary">@{t.authorHandle}</div>
        </div>
      </div>
      <TweetText text={text} className="mt-3 text-[16px] leading-[1.45]" />
      {imgs.length > 0 && (
        <div className={`mt-3 grid ${imgs.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-0.5 overflow-hidden rounded-2xl border border-x-border-strong`}>
          {imgs.map((m, i) => (
            <button key={i} type="button" onClick={() => setZoom(i)} aria-label="이미지 크게 보기"
              className={`${imgs.length === 3 && i === 0 ? 'row-span-2' : ''} block cursor-zoom-in`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" loading="lazy" className={`h-full w-full object-cover ${imgs.length === 1 ? 'max-h-[520px]' : 'aspect-square'}`} />
            </button>
          ))}
        </div>
      )}
      {t.quoted && <QuotedCard quoted={t.quoted} />}
      <p className="mt-3 text-[14px] text-x-secondary">{xWhen(t.tweetCreatedAt ?? postedAt)}</p>
      {zoom !== null && <ImageLightbox urls={imgs.map((m) => m.url)} index={zoom} onIndexChange={setZoom} onClose={() => setZoom(null)} />}
    </article>
  );
}
