'use client';
import { useCallback, useEffect, useState } from 'react';
import type { PillarPayload } from '@/lib/pillarStats';
import { formatCount } from '@/lib/format';

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtPeriod(p: [string, string] | null): string {
  return p ? ` (${fmtDay(p[0])}~${fmtDay(p[1])})` : '';
}

export function PillarPanel({ columnId, topicFilter, onTopicFilter, onData, onAfterBackfill, onClose }: {
  columnId: string;
  topicFilter: string | null;
  onTopicFilter: (topicId: string | null) => void;
  onData: (p: PillarPayload) => void;         // Column이 tweetTopics로 목록 필터링
  onAfterBackfill: () => void;                // 백필 후 Column 트윗 목록 재조회
  onClose: () => void;
}) {
  const [data, setData] = useState<PillarPayload | null>(null);
  const [busy, setBusy] = useState<'' | 'analyze' | 'backfill'>('');
  const [err, setErr] = useState('');

  const apply = useCallback((p: PillarPayload) => { setData(p); onData(p); }, [onData]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/columns/${columnId}/pillar`);
    if (r.ok) apply((await r.json()) as PillarPayload);
  }, [columnId, apply]);
  useEffect(() => { load(); }, [load]);

  async function run(mode: 'full' | 'incremental') {
    setBusy('analyze'); setErr('');
    const r = await fetch(`/api/columns/${columnId}/pillar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    });
    if (r.ok) apply((await r.json()) as PillarPayload);
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy('');
  }

  // 표본 부족 시 과거 백필(새로고침 10페이지) — 수집만 하고, 분류는 사용자가 버튼으로(비용 opt-in)
  async function backfill() {
    setBusy('backfill'); setErr('');
    const r = await fetch(`/api/columns/${columnId}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxPages: 10 }),
    });
    if (r.ok) { onAfterBackfill(); await load(); }
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy('');
  }

  const a = data?.analysis ?? null;
  const stats = data?.stats ?? null;
  const smallBtn = 'rounded border border-x-border-strong px-2 py-1 text-xs hover:bg-x-hover disabled:opacity-50';
  const primaryBtn = 'rounded bg-x-blue px-2 py-1 text-xs font-bold text-white hover:bg-x-blue/90 disabled:opacity-50';

  return (
    <div className="border-b border-x-border px-3 py-2 text-[13px]">
      <div className="flex items-baseline gap-2">
        <p className="font-bold">주제 분석</p>
        {a && (
          <span className="text-xs text-x-muted">
            표본 {a.sampleSize}건{fmtPeriod(data?.samplePeriod ?? null)} · 투고 {stats?.postCount ?? 0} · 인용RT {stats?.quoteCount ?? 0} · 분석 {fmtDay(a.analyzedAt)}
          </span>
        )}
        <button onClick={onClose} className="ml-auto rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
      </div>

      {data && !a && (
        <div className="mt-1">
          <p className="text-xs text-x-secondary">이 계정의 트윗을 주제별로 묶어 게시량 대비 반응(좋아요 중앙값)을 비교해요. (약 $0.05 이하)</p>
          <button onClick={() => run('full')} disabled={busy !== ''} className={`mt-1 ${primaryBtn}`}>
            {busy === 'analyze' ? '분석 중…' : '분석 시작'}
          </button>
        </div>
      )}

      {a && stats && (
        <>
          <p className="mt-1 text-xs text-x-muted">주제를 누르면 아래에 그 트윗만 표시돼요</p>
          <ul className="mt-1">
            {stats.rows.map((r) => (
              <li key={r.topicId}>
                <button onClick={() => onTopicFilter(topicFilter === r.topicId ? null : r.topicId)}
                        className={`w-full rounded px-1 py-0.5 text-left hover:bg-x-hover ${topicFilter === r.topicId ? 'bg-x-blue/10' : ''}`}>
                  <span className="font-bold">{r.verdict === 'opportunity' ? '⭐ ' : ''}{r.label}</span>
                  <span className="float-right text-x-secondary">{r.count}건({r.sharePct}%) · ♥{formatCount(r.medianLikes)}</span>
                  <span className="block text-xs text-x-muted">{r.judgment}{r.quoteCount > 0 ? ` · 인용RT ${r.quoteCount}건 포함` : ''}</span>
                </button>
              </li>
            ))}
            {stats.unclassifiedCount > 0 && (
              <li className="px-1 py-0.5 text-xs text-x-muted">미분류 {stats.unclassifiedCount}건</li>
            )}
          </ul>
          <div className="mt-1 flex flex-wrap gap-1">
            {(data?.unassignedCount ?? 0) > 0 && (
              <button onClick={() => run('incremental')} disabled={busy !== ''} className={primaryBtn}
                      title="분석 이후 들어온 트윗을 기존 주제에 배정해요">
                {busy === 'analyze' ? '분류 중…' : `새 트윗 ${data!.unassignedCount}건 분류`}
              </button>
            )}
            {a.sampleSize < 50 && (
              <button onClick={backfill} disabled={busy !== ''} className={smallBtn}
                      title="표본이 적으면 판정이 흔들려요 — 과거 트윗을 더 수집합니다 (약 $0.01)">
                {busy === 'backfill' ? '수집 중…' : '표본이 적어요 — 과거 트윗 더 가져오기'}
              </button>
            )}
            <button onClick={() => run('full')} disabled={busy !== ''} className={smallBtn}
                    title="주제 목록을 처음부터 다시 만들어요 · 전체 재분석 (약 $0.05 이하)">
              주제 다시 도출
            </button>
          </div>
        </>
      )}

      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}
