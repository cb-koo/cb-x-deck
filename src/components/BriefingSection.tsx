'use client';
import { useCallback, useEffect, useState } from 'react';
import { useMember } from '@/lib/memberContext';
import type { ColumnRow } from '@/lib/types';
import type { TrendPayload } from '@/lib/trend';
import type { BriefingListRow, BriefingRow } from '@/lib/briefingStore';
import type { BriefingCitation, BriefingContent, TrendModule, TrendStage } from '@/lib/briefingTypes';
import { formatCount } from '@/lib/format';
import { TweetText } from './TweetText';
import { MediaGrid } from './MediaGrid';
import { QuotedCard } from './QuotedCard';
import { ReplyIcon, RepostIcon, LikeIcon, ViewIcon, BookmarkIcon } from './XIcons';
import { median, weeklyJudgment } from '@/lib/trend';

const WEEK_OPTIONS = [2, 4, 8] as const;
// 패턴 분석이 성립하는 최소 표본 — 반응 상위(~20%)에서 같은 특징이 3번 이상 반복되려면 이 정도는 필요
const REFERENCE_MIN = 30;
// 주당 이 밑이면 좋아요 중앙값이 트윗 1건에 좌우돼 널뛰기(스파이크 실측) — 추이 패널 sparse 기준과 동일
const WEEKLY_MIN = 5;

function fmtDay(s: string): string {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// ISO 타임스탬프 → JST 달력 기준 'M/D' (UTC로 자르면 오전 생성분이 하루 밀려 보임)
function fmtDayJst(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3_600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// 주 시작일 → '6/15~21' (월이 바뀌면 '6/29~7/5')
function fmtWeekRange(weekStart: string): string {
  const s = new Date(weekStart + 'T00:00:00Z');
  const e = new Date(s.getTime() + 6 * 86_400_000);
  const end = s.getUTCMonth() === e.getUTCMonth() ? `${e.getUTCDate()}` : `${e.getUTCMonth() + 1}/${e.getUTCDate()}`;
  return `${s.getUTCMonth() + 1}/${s.getUTCDate()}~${end}`;
}

// 본문의 [T번호] 토큰을 각주 칩 [n]으로 렌더 — 마우스를 올리면 트윗 미리보기, 클릭하면 임베드 카드로 스크롤
function inline(line: string, byN: Map<number, BriefingCitation>, keyPrefix: string) {
  return line.split(/(\[T\d+\]|\*\*[^*]+\*\*)/g).map((p, j) => {
    const b = p.match(/^\*\*([^*]+)\*\*$/);
    if (b) return <strong key={`${keyPrefix}-${j}`}>{b[1]}</strong>; // LLM이 표시한 핵심 키워드만 굵게(강조 위계)
    const m = p.match(/^\[T(\d+)\]$/);
    if (!m) return p ? <span key={`${keyPrefix}-${j}`}>{p}</span> : null;
    const c = byN.get(Number(m[1]));
    if (!c) return null;
    const avatar = c.tweet?.authorAvatarUrl ?? null;
    return (
      <span key={`${keyPrefix}-${j}`} className="group relative inline-block">
        <button onClick={() => document.getElementById(`cite-${c.n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="mx-0.5 inline-flex h-[18px] items-center gap-0.5 rounded-full bg-x-blue/10 py-px pl-px pr-1 align-text-top hover:bg-x-blue/25">
          {avatar
            /* eslint-disable-next-line @next/next/no-img-element */
            ? <img src={avatar} alt="" className="h-4 w-4 rounded-full" />
            : null}
          <span className="text-[10px] font-bold leading-none text-x-blue">{c.n}</span>
        </button>
        <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-20 mb-1 w-72 -translate-x-1/2 rounded-lg border border-x-border bg-white p-2 text-left text-xs font-normal leading-4 text-x-text shadow-lg group-hover:visible">
          {c.tweet && (
            <span className="block">
              <span className="font-bold">{c.tweet.authorName ?? c.tweet.authorHandle}</span>
              <span className="text-x-secondary"> @{c.tweet.authorHandle}</span>
            </span>
          )}
          <span className="mt-0.5 line-clamp-3 block whitespace-pre-wrap">{c.text}</span>
          <span className="mt-0.5 block text-x-secondary">♥ {formatCount(c.likes)} · 누르면 트윗 카드로 이동</span>
        </span>
      </span>
    );
  });
}

// 문단 사이 임베드 카드 — 주장(문단) 바로 아래에 근거 트윗이 보이는 뉴스 기사식 배치.
// wide = 문단에 인용이 1개일 때의 큰 카드 / 아니면 가로 스트립용 컴팩트 카드.
function EmbedCard({ c, wide, anchor = true, onToggle, expanded = false }: {
  c: BriefingCitation; wide: boolean; anchor?: boolean; onToggle?: () => void; expanded?: boolean;
}) {
  const t = c.tweet;
  const thumb = t?.media?.[0]?.url ?? null;
  return (
    <div id={anchor ? `cite-${c.n}` : undefined}
         onClick={onToggle}
         title={onToggle ? (expanded ? '누르면 접혀요' : '누르면 원본 크기로 펼쳐요') : undefined}
         className={`${wide ? 'w-full' : 'w-64 shrink-0 snap-start'} rounded-lg border ${expanded ? 'border-x-blue/60' : 'border-x-border'} bg-x-border/20 p-2.5 text-xs leading-4 text-x-text ${onToggle ? 'cursor-pointer hover:border-x-border-strong' : ''}`}>
      <p className="flex items-baseline gap-1">
        <span className="shrink-0 font-bold text-x-blue">{c.n}</span>
        {c.flags.length > 0 && (
          <span title={`薬機法 리스크 용어: ${c.flags.join(', ')} (표식일 뿐, 차단 아님)`}
                className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-700">⚠️</span>
        )}
        {t ? (
          <>
            {t.authorAvatarUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={t.authorAvatarUrl} alt="" className="h-4 w-4 shrink-0 self-center rounded-full" />
            )}
            <span className="truncate font-bold">{t.authorName ?? t.authorHandle}</span>
            <span className="truncate text-x-secondary">@{t.authorHandle}</span>
          </>
        ) : <span className="text-x-secondary">원문 스냅샷 없음</span>}
        <span className="ml-auto shrink-0 text-x-secondary">♥ {formatCount(c.likes)}</span>
      </p>
      <p className={`mt-1 whitespace-pre-wrap ${wide ? 'line-clamp-4' : 'line-clamp-3'}`}>{c.text}</p>
      {thumb && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={thumb} alt="" className={`mt-1.5 w-full rounded object-cover ${wide ? 'h-44' : 'h-24'}`} />
      )}
      {onToggle && (
        <p className="mt-1.5 text-[11px] font-bold text-x-blue">{expanded ? '접기 ⌃' : '원본 보기 ⌄'}</p>
      )}
    </div>
  );
}

// 카드 클릭 시 원본 포맷 — 전문·미디어 그리드·인용RT·지표 바까지(답글 스레드는 제외). 다시 클릭하면 접힘.
function FullTweetCard({ c, onCollapse }: { c: BriefingCitation; onCollapse: () => void }) {
  const t = c.tweet;
  const profileUrl = t ? `https://x.com/${t.authorHandle}` : null;
  const metricBase = 'flex items-center gap-1 text-[13px] text-x-secondary';
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div onClick={onCollapse} title="누르면 접혀요"
         className="my-2 w-full cursor-pointer rounded-lg border border-x-blue/60 bg-white p-3 text-[15px] leading-5 text-x-text">
      <div className="flex gap-2.5">
        <span className="w-5 shrink-0 pt-2 text-right text-[13px] font-bold text-x-blue">{c.n}</span>
        {t && (
          <a href={profileUrl!} target="_blank" rel="noopener" onClick={stop} className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.authorAvatarUrl
              ? <img src={t.authorAvatarUrl} alt="" className="h-10 w-10 rounded-full" />
              : <div className="h-10 w-10 rounded-full bg-x-border-strong" />}
          </a>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1">
            {c.flags.length > 0 && (
              <span title={`薬機法 리스크 용어: ${c.flags.join(', ')} (표식일 뿐, 차단 아님)`}
                    className="rounded bg-amber-100 px-1 text-[10px] font-bold leading-4 text-amber-700">⚠️ 薬機法</span>
            )}
            {t ? (
              <>
                <span className="truncate font-bold">{t.authorName ?? t.authorHandle}</span>
                <span className="truncate text-x-secondary">@{t.authorHandle}</span>
              </>
            ) : <span className="text-x-secondary">원문 스냅샷 없음</span>}
            {c.url && (
              <a href={c.url} target="_blank" rel="noopener noreferrer" onClick={stop}
                 className="ml-auto shrink-0 text-[13px] text-x-blue hover:underline">원문 ↗</a>
            )}
          </div>
          <TweetText text={c.text} className="mt-0.5" />
          {t && <MediaGrid media={t.media} />}
          {t?.quoted && <QuotedCard quoted={t.quoted} />}
          {t && (
            <div className="mt-3 flex max-w-[425px] items-center justify-between">
              <span title="답글 (Reply)" className={metricBase}><ReplyIcon /> {formatCount(t.metrics.replies)}</span>
              <span title="리포스트 (Repost)" className={metricBase}><RepostIcon /> {formatCount(t.metrics.retweets)}</span>
              <span title="좋아요 (Like)" className={metricBase}><LikeIcon /> {formatCount(t.metrics.likes)}</span>
              <span title="조회수 (View)" className={metricBase}><ViewIcon /> {formatCount(t.metrics.views)}</span>
              <span title="북마크 (Bookmark)" className={metricBase}><BookmarkIcon /> {formatCount(t.metrics.bookmarks)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 인용 1개면 넓은 카드 하나, 2개 이상이면 문서 길이가 늘지 않게 가로 스크롤 스트립.
// 어떤 카드든 클릭하면 원본 포맷으로 펼쳐짐(단독=그 자리 교체, 스트립=바로 아래 전개, 한 번에 하나).
function EmbedStrip({ cs, anchorOf }: { cs: BriefingCitation[]; anchorOf?: (n: number) => boolean }) {
  const [expandedN, setExpandedN] = useState<number | null>(null);
  if (cs.length === 0) return null;
  const a = (n: number) => (anchorOf ? anchorOf(n) : true);
  const toggle = (n: number) => setExpandedN((cur) => (cur === n ? null : n));
  if (cs.length === 1) {
    return (
      <div className="my-2">
        {expandedN === cs[0].n
          ? <div id={a(cs[0].n) ? `cite-${cs[0].n}` : undefined}><FullTweetCard c={cs[0]} onCollapse={() => toggle(cs[0].n)} /></div>
          : <EmbedCard c={cs[0]} wide anchor={a(cs[0].n)} onToggle={() => toggle(cs[0].n)} />}
      </div>
    );
  }
  const expanded = cs.find((c) => c.n === expandedN) ?? null;
  return (
    <div className="my-2">
      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        {cs.map((c) => (
          <EmbedCard key={c.n} c={c} wide={false} anchor={a(c.n)}
                     expanded={c.n === expandedN} onToggle={() => toggle(c.n)} />
        ))}
      </div>
      {expanded && <FullTweetCard c={expanded} onCollapse={() => toggle(expanded.n)} />}
    </div>
  );
}

function Body({ content }: { content: BriefingContent }) {
  const byN = new Map(content.citations.map((c) => [c.n, c] as const));
  // 각 인용은 처음 언급된 블록(문단/목록) 바로 아래에 한 번만 임베드
  const embedded = new Set<number>();
  const citationsOf = (texts: string[]): BriefingCitation[] => {
    const out: BriefingCitation[] = [];
    for (const t of texts) {
      for (const m of t.matchAll(/\[T(\d+)\]/g)) {
        const c = byN.get(Number(m[1]));
        if (c && !embedded.has(c.n)) { embedded.add(c.n); out.push(c); }
      }
    }
    return out;
  };

  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: number) => {
    if (bullets.length === 0) return;
    const lines = bullets;
    bullets = [];
    out.push(
      <ul key={`ul-${key}`} className="list-disc space-y-1 pl-5">
        {lines.map((b, i) => <li key={i}>{inline(b, byN, `li-${key}-${i}`)}</li>)}
      </ul>,
    );
    out.push(<EmbedStrip key={`em-ul-${key}`} cs={citationsOf(lines)} />);
  };
  const rawLines = content.body.split('\n');
  rawLines.forEach((line, i) => {
    if (line.startsWith('- ')) { bullets.push(line.slice(2)); return; }
    flush(i);
    if (line.startsWith('## ')) out.push(<h3 key={i} className="mt-4 font-bold">{line.slice(3)}</h3>);
    else if (line.trim()) {
      out.push(<p key={i}>{inline(line, byN, `p-${i}`)}</p>);
      out.push(<EmbedStrip key={`em-${i}`} cs={citationsOf([line])} />);
    }
  });
  flush(rawLines.length);
  // 헤드라인·3줄 요약에서만 인용된 트윗이 남으면 맨 아래에 한 번 보여준다(칩 클릭이 갈 곳을 보장)
  const leftover = content.citations.filter((c) => !embedded.has(c.n));
  return (
    <div className="space-y-2 text-[15px] leading-6 text-x-text">
      {out}
      {leftover.length > 0 && <EmbedStrip cs={leftover} />}
    </div>
  );
}

// 트렌드 모듈 뷰(v3) — 리포트의 단위 = 트렌드 카드. 이름·단계·정의·서술·대표 트윗·해볼 것이 한 덩어리로 완결
const STAGE_BADGE: Record<TrendStage, { label: string; cls: string }> = {
  rising: { label: '🔥 뜨는 중', cls: 'bg-red-50 text-red-600' },
  steady: { label: '➖ 유지', cls: 'bg-x-border/60 text-x-secondary' },
  cooling: { label: '❄️ 식는 중', cls: 'bg-blue-50 text-blue-600' },
};

function TrendCard({ t, byN, idx, anchors }: {
  t: TrendModule; byN: Map<number, BriefingCitation>; idx: number; anchors: Set<number>;
}) {
  const badge = STAGE_BADGE[t.stage];
  const cs = t.tweets.map((n) => byN.get(n)).filter((c): c is BriefingCitation => !!c);
  return (
    <div className="rounded-xl border border-x-border p-3">
      <p className="flex flex-wrap items-baseline gap-1.5">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
        <span className="text-[16px] font-bold">{t.name}</span>
      </p>
      <p className="mt-0.5 text-[13px] text-x-secondary">{inline(t.definition, byN, `def-${idx}`)}</p>
      <p className="mt-1.5">{inline(t.body, byN, `tb-${idx}`)}</p>
      <EmbedStrip cs={cs} anchorOf={(n) => anchors.has(n)} />
      <p className="mt-1.5 rounded-lg bg-x-blue/5 px-2.5 py-1.5 text-[13px]">
        <span className="font-bold text-x-blue">→ 해볼 것</span> {inline(t.action, byN, `act-${idx}`)}
      </p>
    </div>
  );
}

function TrendModules({ content }: { content: BriefingContent }) {
  const byN = new Map(content.citations.map((c) => [c.n, c] as const));
  // 같은 트윗이 여러 모듈의 대표일 수 있음 — 첫 등장 모듈만 cite-{n} 앵커를 가져 id 중복·스크롤 모호성 방지
  const seen = new Set<number>();
  const anchorsPerModule = content.trends!.map((t) => {
    const mine = new Set<number>();
    for (const n of t.tweets) if (!seen.has(n)) { seen.add(n); mine.add(n); }
    return mine;
  });
  return (
    <div className="mt-3 space-y-3 text-[15px] leading-6 text-x-text">
      {content.trends!.map((t, i) => <TrendCard key={i} t={t} byN={byN} idx={i} anchors={anchorsPerModule[i]} />)}
      {content.watchlist && (
        <p className="rounded-lg bg-x-border/30 px-3 py-2 text-[13px] text-x-secondary">
          <span className="font-bold">👀 다음 주 지켜볼 것</span> — {inline(content.watchlist, byN, 'watch')}
        </p>
      )}
    </div>
  );
}

export function BriefingSection({ wsId }: { wsId: string }) {
  const { member } = useMember();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [columnId, setColumnId] = useState('');
  const [weeks, setWeeks] = useState<(typeof WEEK_OPTIONS)[number]>(4);
  const [preview, setPreview] = useState<{ total: number; emptyWeeks: number; since: string; capped: boolean } | null>(null);
  const [previewKey, setPreviewKey] = useState(0); // 백필 후 재조회 트리거
  const [backfilling, setBackfilling] = useState(false);
  const [list, setList] = useState<BriefingListRow[]>([]);
  const [current, setCurrent] = useState<BriefingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const loadList = useCallback(async () => {
    const r = await fetch(`/api/briefings?workspaceId=${wsId}`);
    if (r.ok) setList((await r.json()) as BriefingListRow[]);
  }, [wsId]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/columns?workspaceId=${wsId}`);
      if (r.ok) setColumns((await r.json()) as ColumnRow[]);
    })();
    loadList();
  }, [wsId, loadList]);

  // 표본 미리 확인 — 기존 추이 API 재사용(주별 건수 합산 + 빈 주 감지, 추가 비용 없음)
  useEffect(() => {
    setPreview(null);
    if (!columnId) return;
    let stale = false;
    (async () => {
      try {
        const r = await fetch(`/api/columns/${columnId}/trend`);
        if (!r.ok || stale) return;
        const t = (await r.json()) as TrendPayload;
        if (stale) return;
        const sliced = t.weekly.slice(-weeks);
        setPreview({
          total: sliced.reduce((s, w) => s + w.count, 0),
          emptyWeeks: sliced.filter((w) => w.count === 0).length,
          since: sliced[0]?.weekStart ?? '',
          capped: t.capped ?? false,
        });
      } catch { /* 미리보기는 조용히 생략 — 생성 시 서버가 재검증 */ }
    })();
    return () => { stale = true; };
  }, [columnId, weeks, previewKey]);

  // 기간 중 빈 주 채우기 — 추이 패널 백필과 동일 메커니즘(계정=깊은 페이지네이션 / 검색=기간 지정 재검색)
  async function backfillGaps() {
    if (!preview) return;
    setBackfilling(true); setErr('');
    try {
      const kind = columns.find((c) => c.id === columnId)?.kind;
      const body = kind === 'watchlist'
        ? { maxPages: 10 }
        : { sinceDate: preview.since, untilDate: new Date().toISOString().slice(0, 10) };
      const r = await fetch(`/api/columns/${columnId}/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) setPreviewKey((k) => k + 1);
      else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    } catch { setErr('네트워크 오류 — 다시 시도해주세요'); } finally { setBackfilling(false); }
  }

  async function generate() {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/briefings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId, weeks, memberId: member?.id ?? null }),
      });
      if (r.ok) { setCurrent((await r.json()) as BriefingRow); await loadList(); }
      else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    } catch {
      setErr('네트워크 오류 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setErr('');
    try {
      const r = await fetch(`/api/briefings/${id}`);
      if (r.ok) setCurrent((await r.json()) as BriefingRow);
      else setErr(`브리핑을 불러오지 못했어요 (오류 ${r.status})`);
    } catch { setErr('네트워크 오류 — 다시 시도해주세요'); }
  }
  async function remove(id: string) {
    if (!window.confirm('이 브리핑을 삭제할까요? 되돌릴 수 없어요.')) return;
    setErr('');
    try {
      const r = await fetch(`/api/briefings/${id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(`삭제하지 못했어요 (오류 ${r.status})`); return; }
      if (current?.id === id) setCurrent(null);
      await loadList();
    } catch { setErr('네트워크 오류 — 다시 시도해주세요'); }
  }

  return (
    <section className="border-t border-x-border px-4 py-4">
      <h2 className="font-bold">📋 기간 종합 브리핑 <span className="text-sm font-normal text-x-muted">컬럼 하나를 골라 최근 몇 주간 무슨 일이 있었는지 보고서로 정리해요</span></h2>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select value={columnId} onChange={(e) => setColumnId(e.target.value)}
                className="rounded border border-x-border-strong bg-transparent px-2 py-1">
          <option value="">컬럼 선택…</option>
          {columns.map((c) => <option key={c.id} value={c.id}>{c.kind === 'watchlist' ? '👤 ' : '🔍 '}{c.title}</option>)}
        </select>
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value) as typeof weeks)}
                className="rounded border border-x-border-strong bg-transparent px-2 py-1">
          {WEEK_OPTIONS.map((w) => <option key={w} value={w}>최근 {w}주</option>)}
        </select>
        <button onClick={generate} disabled={busy || backfilling || !columnId || preview?.total === 0}
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40"
                title="이 기간의 트윗을 AI가 읽고 보고서를 만들어요 (약 $0.1 이하)">
          {busy ? '생성 중…' : '브리핑 생성 (약 $0.1 이하)'}
        </button>
        {preview !== null && (
          <span className={`text-xs ${preview.total < REFERENCE_MIN ? 'text-amber-600' : 'text-x-muted'}`}>
            이 기간 표본 {preview.total}건{preview.total === 0 ? ' — 생성할 수 없어요'
              : preview.total < REFERENCE_MIN ? ' — 패턴 분석보다는 참고용이에요' : ''}
          </span>
        )}
      </div>
      {preview?.capped && (
        <p className="mt-1 text-xs text-amber-600">이 컬럼은 수집량이 조회 상한(2,000건)에 닿았어요 — 오래된 주는 실제보다 적게 잡힐 수 있어요.</p>
      )}
      {preview !== null && preview.total > 0 && preview.emptyWeeks > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-amber-600">
          기간 {weeks}주 중 {preview.emptyWeeks}개 주가 비어 있어요 — 과거 트윗을 채우고 생성하면 더 정확해요.
          <button onClick={backfillGaps} disabled={backfilling || busy}
                  className="rounded border border-x-border-strong px-2 py-0.5 text-x-text hover:bg-x-hover disabled:opacity-50"
                  title="이 기간의 과거 트윗을 더 수집해요 (약 $0.01)">
            {backfilling ? '수집 중…' : '빈 주 채우기 (약 $0.01)'}
          </button>
        </p>
      )}
      {err && <p className="mt-1 text-sm text-red-500">{err}</p>}

      {current && (
        /* 트윗 본문 폭(~600px)에 맞춘 읽기 컬럼 — 근거 트윗은 문단 사이에 임베드(뉴스 기사식) */
        <div className="mt-3 max-w-[640px] rounded-xl border border-x-border bg-white text-x-text">
          <div className="flex items-baseline gap-2 border-b border-x-border px-4 py-2">
            <p className="font-bold">{current.columnTitle}</p>
            <span className="text-xs text-x-muted">
              {fmtDay(current.periodFrom)}~{fmtDay(current.periodTo)} · 표본 {current.sampleSize}건 · {fmtDayJst(current.createdAt)} 생성
              {current.member && <span className="ml-1 rounded px-1" style={{ backgroundColor: current.member.color + '33' }}>{current.member.name}</span>}
            </span>
            <button onClick={() => setCurrent(null)} className="ml-auto rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
          </div>

          <div className="px-4 py-3">
            {/* 수치 블록 — AI를 거치지 않은 코드 계산값. 주차는 기간 내 순서(1주차~)로, 단위는 이름으로 표기 */}
            <div className="rounded-lg bg-x-border/30 px-3 py-2 text-xs text-x-secondary">
              <p className="font-bold text-x-muted">주별 흐름 <span className="font-normal">— 올라온 글 수(막대)와 보통 반응(♥ = 좋아요 중앙값, 화살표는 전주 대비)</span></p>
              <ul className="mt-1.5 space-y-1">
                {current.content.stats.weekly.map((w, i, arr) => {
                  const max = Math.max(1, ...arr.map((x) => x.count));
                  const prev = i > 0 ? arr[i - 1].medianLikes : null;
                  const dir = prev === null || prev === 0 ? null
                    : w.medianLikes > prev * 1.1 ? 'up' : w.medianLikes < prev * 0.9 ? 'down' : 'flat';
                  return (
                    <li key={w.weekStart} className="flex items-center gap-2">
                      <span className="w-28 shrink-0">{i + 1}주차 <span className="text-x-muted">({fmtWeekRange(w.weekStart)})</span></span>
                      <span className="h-2 rounded-sm bg-x-blue/60"
                            style={{ width: `${Math.round((w.count / max) * 120)}px`, minWidth: w.count > 0 ? 4 : 0 }} />
                      <span className="shrink-0">글 {w.count}</span>
                      <span className="ml-auto shrink-0" title="그 주 트윗의 보통 반응 수준(좋아요 중앙값)">♥ {formatCount(w.medianLikes)}</span>
                      <span className={`w-4 shrink-0 text-center ${dir === 'up' ? 'text-red-500' : dir === 'down' ? 'text-blue-500' : 'text-x-muted'}`}>
                        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'flat' ? '─' : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {(() => {
                const j = weeklyJudgment(current.content.stats.weekly);
                return j && (
                  <div className="mt-1.5">
                    <p className="font-bold text-x-text">💬 {j.text}</p>
                    <p className="mt-0.5 text-[11px] text-x-muted">근거: {j.basis}</p>
                  </div>
                );
              })()}
              {(() => {
                // 기간 내 전체 주 기준(빈 주 포함) — 빈 주가 절반이면 그 자체가 표본 문제이므로 제외하지 않는다
                const sparse = median(current.content.stats.weekly.map((w) => w.count)) < WEEKLY_MIN;
                return sparse && (
                  <p className="mt-1.5 text-amber-600">
                    주별 표본이 적어요(주당 {WEEKLY_MIN}건 미만) — 아래 &lsquo;변화&rsquo; 내용은 참고만 하세요.
                  </p>
                );
              })()}
            </div>

            {current.content.headline && (
              <p className="mt-3 text-[17px] font-bold leading-6">
                {inline(current.content.headline, new Map(current.content.citations.map((c) => [c.n, c] as const)), 'headline')}
              </p>
            )}
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] leading-6">
              {current.content.tldr.map((l, i) => (
                <li key={i}>{inline(l, new Map(current.content.citations.map((c) => [c.n, c] as const)), `tldr-${i}`)}</li>
              ))}
            </ul>
            {current.content.trends?.length
              ? <TrendModules content={current.content} />
              : <Body content={current.content} />}
          </div>
        </div>
      )}

      {list.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-x-muted">지난 브리핑</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {list.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <button onClick={() => open(b.id)} className="truncate text-left hover:underline">
                  📄 {b.columnTitle} · {fmtDay(b.periodFrom)}~{fmtDay(b.periodTo)}
                </button>
                <span className="shrink-0 text-xs text-x-muted">
                  {fmtDayJst(b.createdAt)} 생성
                  {b.member && <span className="ml-1 rounded px-1" style={{ backgroundColor: b.member.color + '33' }}>{b.member.name}</span>}
                </span>
                <button onClick={() => remove(b.id)} className="shrink-0 rounded px-1 text-xs text-x-muted hover:text-red-500" title="이 브리핑 삭제">삭제</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
