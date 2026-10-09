// 리포트 글 상세 패널(스펙 2026-10-09 §10) — 리포트의 어느 차트에서든 글을 누르면 오른쪽에 열린다.
// 어떤 캠페인의 어떤 인플의 어떤 글이고, 성과가 어땠는지를 차트를 가리지 않고 옆에서 본다(뒤를 막는 배경 없음).
// 작업·캠페인·최신 지표는 현황 응답에 이미 있고, 글 본문(이미지)과 측정 이력만 열 때 부른다.
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientStatus, StatusPost } from '@/lib/clientStatusStore';
import { TASK_TYPE_LABEL } from '@/lib/campaignJudgment';
import { mdLabel } from '@/lib/clientStatus';
import { TargetPreview } from '@/app/campaigns/flow/panel/TargetPreview';
import { useTweetPreview } from '@/app/campaigns/flow/panel/useTweetPreview';
import { GrowthCurves } from '@/components/charts/GrowthCurves';
import { NUM, compact } from '@/components/charts/tokens';
import { normalRange, verdictOf } from '@/components/charts/normal';

type Snap = { capturedAt: string; metrics: { views: number | null } };
const MIN_COMPARE = 4; // 비교할 다른 글이 이보다 적으면 '많은 편/적은 편' 판정을 하지 않는다

const kst = (iso: string, withTime = true) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
});
const won = (n: number) => `${NUM.format(Math.round(n))}원`;

// ids = 누른 자리의 글들(같은 날 여러 개일 수 있음), picked = 그중 고른 한 개. 여러 개에서 고른 뒤엔 '← 글 목록'으로 돌아간다.
export function PostPanel({ s, ids, picked, onPick, onClose }: { s: ClientStatus; ids: string[]; picked: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const posts = (picked ? [picked] : ids).map((id) => s.posts.find((p) => p.id === id)).filter((p): p is StatusPost => !!p);

  return (
    <aside aria-label="글 상세" className="fixed right-0 top-0 z-40 flex h-full w-[460px] max-w-full flex-col border-l border-x-border bg-white shadow-xl">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-x-border px-5">
        {picked && ids.length > 1
          ? <button type="button" onClick={() => onPick(null)} className="text-ui text-x-blue-text hover:underline">← 글 목록 ({ids.length})</button>
          : <span className="text-[16px] font-semibold">{posts.length > 1 ? `함께 올린 글 ${posts.length}개` : '글 상세'}</span>}
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded-full p-1.5 text-x-secondary hover:bg-x-text/5">✕</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {posts.length === 0 && <p className="py-10 text-center text-ui text-x-muted">이 글의 기록을 찾을 수 없어요</p>}
        {posts.length > 1 && <PostList posts={posts} onPick={onPick} />}
        {posts.length === 1 && <PostDetail key={posts[0].id} s={s} p={posts[0]} />}
      </div>
    </aside>
  );
}

function PostList({ posts, onPick }: { posts: StatusPost[]; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col">
      <p className="mb-2 text-[13px] text-x-muted">글을 누르면 상세가 열려요</p>
      {[...posts].sort((a, b) => b.bookmarks - a.bookmarks).map((p) => (
        <button key={p.id} type="button" onClick={() => onPick(p.id)}
          className="flex min-h-[52px] items-center justify-between gap-3 border-b border-x-border px-1 text-left last:border-b-0 hover:bg-x-hover">
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">@{p.handle}</span>
            <span className="block truncate text-[13px] text-x-muted">{p.campaignName}</span>
          </span>
          <span className="shrink-0 text-right text-[13px] tabular-nums text-x-secondary">
            북마크 <b className="text-x-text">{NUM.format(p.bookmarks)}</b> · 조회 {compact(p.views)} ›
          </span>
        </button>
      ))}
    </div>
  );
}

function PostDetail({ s, p }: { s: ClientStatus; p: StatusPost }) {
  const url = `https://x.com/${p.handle}/status/${p.tweetId}`;
  const { preview, loading, failed } = useTweetPreview(url);
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

  // 이 클라이언트 최근 8주 다른 글과 비교 — 북마크가 신규 인입과 가장 잘 맞는 반응 지표라 기준으로 쓴다
  const others = s.posts.filter((o) => o.id !== p.id);
  const rank = [...s.posts].sort((a, b) => b.bookmarks - a.bookmarks).findIndex((o) => o.id === p.id) + 1;
  const band = others.length >= MIN_COMPARE ? normalRange(others.map((o) => o.bookmarks)) : null;
  const v = band ? verdictOf(p.bookmarks, band) : null;
  const verdictText = v === 'above' ? '다른 글보다 반응이 많은 편이에요' : v === 'below' ? '다른 글보다 반응이 적은 편이에요' : v === 'normal' ? '다른 글과 비슷한 반응이에요' : '비교할 다른 글이 적어 판단을 미뤄요';

  const hours = (iso: string) => (Date.parse(iso) - Date.parse(p.postedAt)) / 3600e3;
  const points: Array<[number, number]> = (snaps ?? []).filter((x) => x.metrics.views !== null)
    .map((x): [number, number] => [Math.round(hours(x.capturedAt) * 10) / 10, x.metrics.views as number]).sort((a, b) => a[0] - b[0]);
  const drawable = points.filter(([h]) => h >= 1).length >= 2;
  const curves = [{ id: p.id, label: `@${p.handle}`, points }, ...s.growth.filter((g) => g.id !== p.id)];

  const metrics: Array<[string, number]> = [['조회', p.views], ['좋아요', p.likes], ['북마크', p.bookmarks], ['리포스트', p.retweets], ['답글', p.replies], ['인용', p.quotes]];

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="text-[18px] font-bold">@{p.handle}</div>
        <dl className="mt-2 grid grid-cols-[72px_1fr] gap-y-1.5 text-[14px]">
          <dt className="text-x-muted">캠페인</dt><dd className="truncate">{p.campaignName}</dd>
          <dt className="text-x-muted">작업</dt><dd>{TASK_TYPE_LABEL[p.taskType as keyof typeof TASK_TYPE_LABEL] ?? p.taskType}</dd>
          <dt className="text-x-muted">게시</dt><dd>{kst(p.postedAt)}</dd>
          <dt className="text-x-muted">비용</dt><dd className="tabular-nums">{p.costKrw > 0 ? won(p.costKrw) : '비용 없음'}</dd>
        </dl>
      </section>

      <section>
        {p.unavailable
          ? <p className="rounded-2xl border border-dashed border-x-border-strong px-3.5 py-3 text-center text-ui text-x-secondary">삭제됐거나 비공개로 바뀐 글이에요 — 성과는 마지막으로 잰 값이에요</p>
          : <TargetPreview state={{ kind: 'link', url }} preview={preview} loading={loading} failed={failed} lines={3} />}
      </section>

      <section>
        <h3 className="text-[16px] font-semibold">성과</h3>
        <p className="mt-1 text-[15px]">{verdictText}</p>
        <p className="text-[13px] text-x-muted">
          최근 8주 이 클라이언트 글 {s.posts.length}개 중 북마크 {rank}위{band ? ` · 다른 글 가운데 절반 ${NUM.format(band[0])}~${NUM.format(band[1])}` : ''}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-3 rounded-xl bg-x-surface px-4 py-3">
          {metrics.map(([label, n]) => (
            <div key={label}>
              <div className="text-[13px] text-x-muted">{label}</div>
              <div className={`text-[18px] font-bold tabular-nums ${label === '북마크' ? 'text-x-blue-text' : ''}`}>{NUM.format(n)}</div>
            </div>
          ))}
        </div>
        {p.costKrw > 0 && (
          <p className="mt-2 text-[14px] tabular-nums text-x-secondary">
            조회 1회당 <b className="text-x-text">{p.views ? won(p.costKrw / p.views) : '—'}</b> · 북마크 1개당 <b className="text-x-text">{p.bookmarks ? won(p.costKrw / p.bookmarks) : '—'}</b>
          </p>
        )}
        <p className="mt-1 text-[13px] text-x-muted">{p.capturedAt ? `${kst(p.capturedAt)}에 잰 값` : '아직 측정 전이에요'}</p>
      </section>

      <section>
        <h3 className="text-[16px] font-semibold">게시 후 조회가 쌓인 모습</h3>
        {snaps === null && <p className="mt-2 text-ui text-x-muted">측정 기록 불러오는 중…</p>}
        {snaps !== null && !drawable && <p className="mt-2 text-ui text-x-muted">측정이 {snaps.length}번뿐이라 곡선을 그리기 어려워요 — 10월부터 게시 후 7일간 자동으로 재요.</p>}
        {snaps !== null && drawable && (
          <>
            <p className="mt-1 text-[13px] text-x-muted">파란 선 = 이 글 · 회색 = 최근 2주 다른 글 · 측정 {snaps.length}번</p>
            <div className="mt-2"><GrowthCurves curves={curves} highlightId={p.id} height={220} /></div>
          </>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t border-x-border pt-4">
        <a href={url} target="_blank" rel="noreferrer" className="rounded-full border border-x-border-strong bg-white px-3 py-1 text-ui hover:bg-x-hover">X에서 보기 ↗</a>
        <Link href={`/campaigns/flow?id=${p.campaignId}&task=${p.taskId}`} className="rounded-full bg-x-blue px-3 py-1 text-ui font-medium text-white hover:bg-x-blue-hover">캠페인에서 이 작업 열기</Link>
      </div>
      <p className="-mt-3 text-right text-[12px] text-x-muted">{mdLabel(p.date)} 게시 · 작업 패널이 열린 채로 이동해요</p>
    </div>
  );
}
