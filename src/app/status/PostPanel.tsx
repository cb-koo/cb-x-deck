// 리포트 글 상세 패널(스펙 2026-10-09 §10) — 리포트의 어느 차트에서든 글을 누르면 오른쪽에 열린다.
// 읽는 순서 = 판단에 필요한 순서: 이 글은 잘됐나(판정·핵심 숫자) → 신규 인입에 영향이 있었나 → 실제 글 → 조회가 늘어난 속도.
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
const won = (n: number) => `${n < 10 ? n.toFixed(1) : NUM.format(Math.round(n))}원`;
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

  // 판정 기준 = 북마크(신규 인입과 가장 잘 맞는 반응). 문장에도 '북마크'라고 쓴다 — 계산과 말이 같아야 한다.
  const others = s.posts.filter((o) => o.id !== p.id);
  const rank = [...s.posts].sort((a, b) => b.bookmarks - a.bookmarks).findIndex((o) => o.id === p.id) + 1;
  const band = others.length >= MIN_COMPARE ? normalRange(others.map((o) => o.bookmarks)) : null;
  const v = band ? verdictOf(p.bookmarks, band) : null;
  const verdict = v === 'above' ? '북마크가 많은 편이에요' : v === 'below' ? '북마크가 적은 편이에요' : v === 'normal' ? '북마크가 보통이에요' : '비교할 글이 아직 적어요';

  // 신규 인입 효과 — 성적표와 같은 계산(게시 묶음의 인입 증가를 북마크 비율로 나눈 추정)
  const group = s.groups.find((g) => g.posts.some((x) => (x as WithId).id === p.id));
  const mine = group?.posts.find((x) => (x as WithId).id === p.id);
  const windowEnd = group ? group.to : null;

  const hours = (iso: string) => (Date.parse(iso) - Date.parse(p.postedAt)) / 3600e3;
  const points: Array<[number, number]> = (snaps ?? []).filter((x) => x.metrics.views !== null)
    .map((x): [number, number] => [Math.round(hours(x.capturedAt) * 10) / 10, x.metrics.views as number]).sort((a, b) => a[0] - b[0]);
  const drawable = points.filter(([h]) => h >= 1).length >= 2;
  const curves = [{ id: p.id, label: `@${p.handle}`, points }, ...s.growth.filter((g) => g.id !== p.id)];

  return (
    <div className="flex flex-col">
      {/* 1. 이 글은 잘됐나 */}
      <section className="px-5 pb-5 pt-4">
        <h3 className="text-[18px] font-bold">{verdict}</h3>
        <p className="text-[14px] text-x-secondary">이 클라이언트 최근 8주 글 {s.posts.length}개 중 {rank}위</p>
        {band && <PositionStrip values={others.map((o) => o.bookmarks)} value={p.bookmarks} band={band} />}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="조회" value={compact(p.views)} />
          <Stat label="북마크" value={NUM.format(p.bookmarks)} sub={p.views ? `조회의 ${((p.bookmarks / p.views) * 100).toFixed(2)}%` : undefined} strong />
          <Stat label="북마크 1개 비용" value={p.costKrw > 0 && p.bookmarks ? won(p.costKrw / p.bookmarks) : '—'}
            sub={p.costKrw > 0 ? (p.views ? `조회 1회 ${won(p.costKrw / p.views)}` : undefined) : '비용 없음'} />
        </div>
        <p className="mt-3 text-[14px] tabular-nums text-x-secondary">
          좋아요 {NUM.format(p.likes)} · 리포스트 {NUM.format(p.retweets)} · 인용 {NUM.format(p.quotes)} · 답글 {NUM.format(p.replies)}
        </p>
        <p className="mt-1 text-[13px] text-x-muted">
          {p.costKrw > 0 ? `비용 ${NUM.format(p.costKrw)}원 · ` : ''}{p.capturedAt ? `${when(p.capturedAt)} 측정` : '아직 측정 전'}
        </p>
      </section>

      {/* 2. 신규 인입에 영향이 있었나 */}
      <section className="border-t border-x-border px-5 py-5">
        <h3 className="text-[16px] font-semibold">신규 인입에 준 영향</h3>
        {group && mine && windowEnd ? (
          <>
            <p className="mt-2 text-[22px] font-bold tabular-nums" style={{ color: mine.estLift > 0 ? C.primaryDeep : C.secondary }}>
              {signed(mine.estLift)}{group.posts.length > 1 ? <span className="ml-1.5 text-[14px] font-normal text-x-muted">추정</span> : null}
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-x-secondary">
              {group.lift > 0
                ? `${span([group.from, windowEnd])} 신규 인입이 평소보다 ${group.lift}명 많았어요.`
                : `${span([group.from, windowEnd])} 신규 인입은 평소와 비슷했어요.`}
              {group.posts.length > 1 ? ` 같은 때 올린 글 ${group.posts.length}개의 북마크 비율로 나눈 값이에요.` : ''}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[14px] leading-relaxed text-x-secondary">북마크가 {MIN_BOOKMARKS}개 미만이라 계산하지 않았어요. 신규 인입은 클리닉 전체 숫자라 반응이 작은 글의 몫은 가려낼 수 없어요.</p>
        )}
      </section>

      {/* 3. 실제 글 */}
      <section className="border-t border-x-border px-5 py-5">
        <h3 className="mb-3 text-[16px] font-semibold">게시글</h3>
        {p.unavailable
          ? <Notice>삭제됐거나 비공개로 바뀐 글이에요. 위 숫자는 마지막으로 잰 값이에요.</Notice>
          : loading ? <Notice>글을 불러오는 중…</Notice>
          : failed || !preview || preview.kind !== 'ok' ? <Notice>글을 불러오지 못했어요. 아래 [X에서 보기]로 확인해 주세요.</Notice>
          : <XPost t={preview.tweet} postedAt={p.postedAt} />}
      </section>

      {/* 4. 조회가 늘어난 속도 */}
      <section className="border-t border-x-border px-5 py-5">
        <h3 className="text-[16px] font-semibold">조회가 늘어난 속도</h3>
        {snaps === null && <p className="mt-2 text-[14px] text-x-muted">불러오는 중…</p>}
        {snaps !== null && !drawable && <p className="mt-2 text-[14px] text-x-secondary">측정 기록이 {snaps.length}번뿐이라 그래프를 그릴 수 없어요.</p>}
        {snaps !== null && drawable && (
          <>
            <p className="mt-1 text-[13px] text-x-muted">파란 선이 이 글, 회색 선은 최근 2주에 올린 다른 글이에요.</p>
            <div className="mt-2"><GrowthCurves curves={curves} highlightId={p.id} height={220} showLabel={false} /></div>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-x-muted">{label}</div>
      <div className={`text-[20px] font-bold tabular-nums ${strong ? 'text-x-blue-text' : ''}`}>{value}</div>
      {sub && <div className="truncate text-[12px] text-x-muted">{sub}</div>}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-x-border-strong px-4 py-4 text-center text-[14px] text-x-secondary">{children}</p>;
}

// 이 글이 다른 글들 사이 어디쯤인지 — 회색 점 = 다른 글, 띠 = 다른 글 절반이 모인 범위, 파란 점 = 이 글. 북마크는 글마다 수백 배 차이라 로그 눈금.
function PositionStrip({ values, value, band }: { values: number[]; value: number; band: [number, number] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const H = 44, cy = 16;
  const lo = Math.max(1, Math.min(value, ...values)), hi = Math.max(lo * 10, value, ...values);
  const x = scaleLog().domain([lo, hi]).range([8, Math.max(width - 8, 9)]).clamp(true);
  const xv = (n: number) => x(Math.max(n, lo));
  return (
    <div ref={ref} className="mt-3" style={{ height: H }}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`북마크 ${value}, 다른 글 절반은 ${band[0]}~${band[1]}`}>
          <rect x={xv(band[0])} y={cy - 9} width={Math.max(2, xv(band[1]) - xv(band[0]))} height={18} rx={4} fill={C.band} />
          <line x1={8} x2={width - 8} y1={cy} y2={cy} stroke={C.grid} />
          {values.map((n, i) => <circle key={i} cx={xv(n)} cy={cy} r={3.5} fill={C.neutralBar} />)}
          <circle cx={xv(value)} cy={cy} r={6.5} fill={C.primary} stroke="#fff" strokeWidth={2} />
          <text x={8} y={H - 2} fontSize={11} fill={C.muted}>{NUM.format(lo)}</text>
          <text x={(xv(band[0]) + xv(band[1])) / 2} y={H - 2} fontSize={11} fill={C.secondary} textAnchor="middle">다른 글 절반</text>
          <text x={width - 8} y={H - 2} fontSize={11} fill={C.muted} textAnchor="end">{NUM.format(hi)}</text>
        </svg>
      )}
    </div>
  );
}

// X 원문 모양 그대로 — 아바타·이름·핸들, 본문 전체(자르지 않음), 이미지 전부(누르면 크게), 인용한 글, 게시 시각 줄.
function XPost({ t, postedAt }: { t: DeckTweet; postedAt: string }) {
  const [zoom, setZoom] = useState<number | null>(null);
  const imgs = t.media.slice(0, 4);
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
      <TweetText text={t.text} className="mt-3 text-[16px] leading-[1.45]" />
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
