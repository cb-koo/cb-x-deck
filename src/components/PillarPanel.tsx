'use client';
import { apiFetch } from '@/lib/apiFetch';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { PillarPayload } from '@/lib/pillarStats';
import { formatCount } from '@/lib/format';
import { kstMonthDay } from '@/lib/datetime';
import { Button, PanelShell } from './ui';

function fmtPeriod(p: [string, string] | null): string {
  return p ? ` (${kstMonthDay(p[0])}~${kstMonthDay(p[1])})` : '';
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
  const [busy, setBusy] = useState<'' | 'full' | 'incremental' | 'backfill'>('');
  const [err, setErr] = useState('');

  const apply = useCallback((p: PillarPayload) => { setData(p); onData(p); }, [onData]);

  const load = useCallback(async () => {
    const r = await apiFetch(`/api/columns/${columnId}/pillar`);
    if (r.ok) apply((await r.json()) as PillarPayload);
  }, [columnId, apply]);
  useEffect(() => { load(); }, [load]);

  async function run(mode: 'full' | 'incremental') {
    setBusy(mode); setErr('');
    const r = await apiFetch(`/api/columns/${columnId}/pillar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
    });
    if (r.ok) apply((await r.json()) as PillarPayload);
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy('');
  }

  // 표본 부족 시 과거 백필(새로고침 10페이지) — 수집만 하고, 분류는 사용자가 버튼으로(비용 opt-in)
  async function backfill() {
    setBusy('backfill'); setErr('');
    const r = await apiFetch(`/api/columns/${columnId}/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ maxPages: 10 }),
    });
    if (r.ok) { onAfterBackfill(); await load(); }
    else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    setBusy('');
  }

  const a = data?.analysis ?? null;
  const stats = data?.stats ?? null;

  // 주제를 판정 문구별로 묶어 소제목 아래 배치 — rows는 verdict 순 정렬돼 있어 같은 판정이 연속 그룹이 된다.
  // 'low'의 두 문구('많이 올리지만 반응 낮음'/'반응 낮음')는 문구 단위 그룹이라 자연히 나뉜다.
  const pillarGroups: { judgment: string; verdict: string; rows: NonNullable<typeof stats>['rows'] }[] = [];
  for (const r of stats?.rows ?? []) {
    const g = pillarGroups[pillarGroups.length - 1];
    if (!g || g.judgment !== r.judgment) pillarGroups.push({ judgment: r.judgment, verdict: r.verdict, rows: [r] });
    else g.rows.push(r);
  }

  return (
    <PanelShell title="주제별로 묶기" onClose={onClose}
                sub={a ? `표본 ${a.sampleSize}건${fmtPeriod(data?.samplePeriod ?? null)} · 투고 ${stats?.postCount ?? 0} · 인용RT ${stats?.quoteCount ?? 0} · 분석 ${kstMonthDay(a.analyzedAt)}` : undefined}>
      {data && !a && (
        <div className="mt-1">
          <p className="text-ui text-x-secondary">이 계정의 트윗을 주제별로 묶어 게시량 대비 반응(좋아요 중앙값)을 비교해요. (약 $0.05 이하)</p>
          <Button variant="primary" onClick={() => run('full')} disabled={busy !== ''} className="mt-1.5">
            {busy === 'full' ? '분석 중…' : '분석 시작'}
          </Button>
        </div>
      )}

      {a && stats && (
        <>
          <p className="mt-1 text-caption text-x-muted">주제를 누르면 아래 목록이 그 트윗만 보여요 · ♥ = 좋아요 중앙값</p>
          <ul className="mt-1 tabular-nums">
            {pillarGroups.map((g, gi) => (
              <Fragment key={`g-${gi}`}>
                {/* 판정 = 분류. 소제목으로 올리고 그 아래에 주제를 묶어 구조를 드러낸다 */}
                <li className={`flex items-center gap-1 px-1.5 pb-0.5 text-caption font-medium text-x-secondary ${gi === 0 ? 'pt-1' : 'pt-2.5'}`}>
                  {g.verdict === 'opportunity' && <span aria-hidden>⭐</span>}
                  <span>{g.judgment}</span>
                </li>
                {g.rows.map((r) => (
                  <li key={r.topicId}>
                    <button onClick={() => onTopicFilter(topicFilter === r.topicId ? null : r.topicId)}
                            className={`grid w-full grid-cols-[1fr_auto_64px] items-baseline gap-x-2 rounded px-1.5 py-1 text-left hover:bg-x-text/5 ${topicFilter === r.topicId ? 'bg-x-blue/10 shadow-[inset_2px_0_0_var(--color-x-blue)]' : ''}`}>
                      <span className="truncate text-ui">{r.label}</span>
                      <span className="text-right text-ui text-x-secondary">{r.count}건 · {r.sharePct}%</span>
                      <span className="text-right text-ui text-x-secondary">♥ {formatCount(r.medianLikes)}</span>
                      {/* 게시량 비중(share%)을 길이로 인코딩 — 어느 주제를 많이/적게 올리는지 한눈에(E: 위치·길이 > 숫자) */}
                      <span className="col-span-3 mt-0.5" aria-hidden>
                        <span className="block h-1 rounded-sm bg-x-blue/40" style={{ width: `${Math.max(2, r.sharePct)}%` }} />
                      </span>
                      {r.quoteCount > 0 && <span className="col-span-3 text-caption text-x-muted">인용RT {r.quoteCount}건 포함</span>}
                    </button>
                  </li>
                ))}
              </Fragment>
            ))}
            {stats.unclassifiedCount > 0 && (
              <li className="px-1.5 pt-2.5 text-caption text-x-muted">미분류 {stats.unclassifiedCount}건</li>
            )}
          </ul>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(data?.unassignedCount ?? 0) > 0 && (
              <Button variant="primary" onClick={() => run('incremental')} disabled={busy !== ''}
                      title="아직 주제가 없는 트윗을 기존 주제에 배정해요">
                {busy === 'incremental' ? '분류 중…' : `미분류 ${data!.unassignedCount}건 분류`}
              </Button>
            )}
            {(stats.classifiedCount + stats.unclassifiedCount) < 50 && (
              <Button variant="subtle" onClick={backfill} disabled={busy !== ''}
                      title="표본이 적으면 판정이 흔들려요 — 과거 트윗을 더 수집합니다 (약 $0.01)">
                {busy === 'backfill' ? '수집 중…' : '표본이 적어요 — 과거 트윗 더 가져오기'}
              </Button>
            )}
            <Button variant="subtle" onClick={() => run('full')} disabled={busy !== ''}
                    title="주제 목록을 처음부터 다시 만들어요 · 전체 재분석 (약 $0.05 이하)">
              {busy === 'full' ? '분석 중…' : '주제 다시 도출'}
            </Button>
          </div>
        </>
      )}

      {err && <p className="mt-1 text-caption text-red-500">{err}</p>}
    </PanelShell>
  );
}
