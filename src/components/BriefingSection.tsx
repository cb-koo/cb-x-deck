'use client';
import { useCallback, useEffect, useState } from 'react';
import { useMember } from '@/lib/memberContext';
import type { ColumnRow } from '@/lib/types';
import type { TrendPayload } from '@/lib/trend';
import type { BriefingListRow, BriefingRow } from '@/lib/briefingStore';
import type { BriefingContent } from '@/lib/briefingTypes';
import { formatCount } from '@/lib/format';
import { CitedTweetCard } from './CitedTweetCard';

const WEEK_OPTIONS = [2, 4, 8] as const;
const MIN_SAMPLE = 10;

function fmtDay(s: string): string {
  const d = new Date(s + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

// 본문의 [T번호] 토큰을 각주 칩 [n]으로 렌더 — 문장 흐름을 끊지 않고, 클릭하면 아래 근거 트윗 카드로 스크롤
function inline(line: string, nums: Set<number>, keyPrefix: string) {
  return line.split(/(\[T\d+\])/g).map((p, j) => {
    const m = p.match(/^\[T(\d+)\]$/);
    if (!m) return p ? <span key={`${keyPrefix}-${j}`}>{p}</span> : null;
    const n = Number(m[1]);
    if (!nums.has(n)) return null;
    return (
      <button key={`${keyPrefix}-${j}`} title="아래 근거 트윗으로 이동"
              onClick={() => document.getElementById(`cite-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-x-blue/10 px-1 align-text-top text-[11px] font-bold leading-none text-x-blue hover:bg-x-blue/25">
        {n}
      </button>
    );
  });
}

function Body({ content }: { content: BriefingContent }) {
  const nums = new Set(content.citations.map((c) => c.n));
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: number) => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${key}`} className="list-disc space-y-1 pl-5">
        {bullets.map((b, i) => <li key={i}>{inline(b, nums, `li-${key}-${i}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  const lines = content.body.split('\n');
  lines.forEach((line, i) => {
    if (line.startsWith('- ')) { bullets.push(line.slice(2)); return; }
    flush(i);
    if (line.startsWith('## ')) out.push(<h3 key={i} className="mt-4 font-bold">{line.slice(3)}</h3>);
    else if (line.trim()) out.push(<p key={i}>{inline(line, nums, `p-${i}`)}</p>);
  });
  flush(lines.length);
  return <div className="space-y-2 text-[15px] leading-6 text-x-text">{out}</div>;
}

export function BriefingSection({ wsId }: { wsId: string }) {
  const { member } = useMember();
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [columnId, setColumnId] = useState('');
  const [weeks, setWeeks] = useState<(typeof WEEK_OPTIONS)[number]>(4);
  const [sample, setSample] = useState<number | null>(null);
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

  // 표본 미리 확인 — 기존 추이 API 재사용(주별 건수 합산, 추가 비용 없음)
  useEffect(() => {
    setSample(null);
    if (!columnId) return;
    let stale = false;
    (async () => {
      const r = await fetch(`/api/columns/${columnId}/trend`);
      if (!r.ok || stale) return;
      const t = (await r.json()) as TrendPayload;
      if (stale) return;
      setSample(t.weekly.slice(-weeks).reduce((s, w) => s + w.count, 0));
    })();
    return () => { stale = true; };
  }, [columnId, weeks]);

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
    setErr('');
    try {
      const r = await fetch(`/api/briefings/${id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(`삭제하지 못했어요 (오류 ${r.status})`); return; }
      if (current?.id === id) setCurrent(null);
      await loadList();
    } catch { setErr('네트워크 오류 — 다시 시도해주세요'); }
  }

  return (
    <section className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
      <h2 className="font-bold">📋 기간 종합 브리핑 <span className="text-sm font-normal text-gray-400">컬럼 하나를 골라 최근 몇 주간 무슨 일이 있었는지 보고서로 정리해요</span></h2>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <select value={columnId} onChange={(e) => setColumnId(e.target.value)}
                className="rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-700">
          <option value="">컬럼 선택…</option>
          {columns.map((c) => <option key={c.id} value={c.id}>{c.kind === 'watchlist' ? '👤 ' : '🔍 '}{c.title}</option>)}
        </select>
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value) as typeof weeks)}
                className="rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-700">
          {WEEK_OPTIONS.map((w) => <option key={w} value={w}>최근 {w}주</option>)}
        </select>
        <button onClick={generate} disabled={busy || !columnId || sample === 0}
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40"
                title="이 기간의 트윗을 AI가 읽고 보고서를 만들어요 (약 $0.1 이하)">
          {busy ? '생성 중…' : '브리핑 생성 (약 $0.1 이하)'}
        </button>
        {sample !== null && (
          <span className={`text-xs ${sample < MIN_SAMPLE ? 'text-amber-600' : 'text-gray-400'}`}>
            이 기간 표본 {sample}건{sample === 0 ? ' — 생성할 수 없어요' : sample < MIN_SAMPLE ? ' — 적어서 브리핑이 빈약할 수 있어요' : ''}
          </span>
        )}
      </div>
      {err && <p className="mt-1 text-sm text-red-500">{err}</p>}

      {current && (
        /* 트윗 본문 폭(~600px)에 맞춘 읽기 컬럼 — 화면 전체로 퍼지지 않게 */
        <div className="mt-3 max-w-[640px] rounded-xl border border-x-border bg-white text-x-text">
          <div className="flex items-baseline gap-2 border-b border-x-border px-4 py-2">
            <p className="font-bold">{current.columnTitle}</p>
            <span className="text-xs text-x-muted">
              {fmtDay(current.periodFrom)}~{fmtDay(current.periodTo)} · 표본 {current.sampleSize}건 · {fmtDay(current.createdAt.slice(0, 10))} 생성
              {current.member && <span className="ml-1 rounded px-1" style={{ backgroundColor: current.member.color + '33' }}>{current.member.name}</span>}
            </span>
            <button onClick={() => setCurrent(null)} className="ml-auto rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
          </div>

          <div className="px-4 py-3">
            {/* 수치 블록 — AI를 거치지 않은 코드 계산값 */}
            <div className="flex flex-wrap gap-2 text-xs text-x-secondary">
              {current.content.stats.weekly.map((w) => (
                <span key={w.weekStart} className="rounded bg-x-border/60 px-1.5 py-0.5"
                      title="그 주 트윗의 보통 반응 수준(좋아요 중앙값)">
                  {fmtDay(w.weekStart)}주 {w.count}건 ♥{formatCount(w.medianLikes)}
                </span>
              ))}
            </div>

            <ul className="mt-3 list-disc space-y-1 pl-5 text-[15px] font-bold leading-6">
              {current.content.tldr.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <Body content={current.content} />
          </div>

          {current.content.citations.length > 0 && (
            <div className="mt-1">
              <p className="border-y border-x-border bg-x-border/30 px-4 py-1.5 text-xs font-bold text-x-secondary">
                근거 트윗 {current.content.citations.length}건 — 본문의 파란 번호를 누르면 여기로 이동해요
              </p>
              {current.content.citations.map((c) => <CitedTweetCard key={c.n} c={c} />)}
            </div>
          )}
        </div>
      )}

      {list.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-gray-400">지난 브리핑</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {list.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <button onClick={() => open(b.id)} className="truncate text-left hover:underline">
                  📄 {b.columnTitle} · {fmtDay(b.periodFrom)}~{fmtDay(b.periodTo)}
                </button>
                <span className="shrink-0 text-xs text-gray-400">
                  {fmtDay(b.createdAt.slice(0, 10))} 생성
                  {b.member && <span className="ml-1 rounded px-1" style={{ backgroundColor: b.member.color + '33' }}>{b.member.name}</span>}
                </span>
                <button onClick={() => remove(b.id)} className="shrink-0 rounded px-1 text-xs text-gray-400 hover:text-red-500" title="이 브리핑 삭제">삭제</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
