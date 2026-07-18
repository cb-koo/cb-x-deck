'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ColumnKind } from '@/lib/types';
import type { TrendPayload } from '@/lib/trend';
import { formatCount } from '@/lib/format';

function fmtWeek(weekStart: string): string {
  const d = new Date(weekStart + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
const DIR_ICON = { up: '▲', flat: '─', down: '▼' } as const;
const DIR_COLOR = { up: 'text-red-500', flat: 'text-x-muted', down: 'text-blue-500' } as const;

export function TrendPanel({ columnId, kind, onAfterBackfill, onClose }: {
  columnId: string;
  kind: ColumnKind;
  onAfterBackfill: () => void; // 백필 수집 후 Column 트윗 목록 재조회
  onClose: () => void;
}) {
  const [data, setData] = useState<TrendPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/columns/${columnId}/trend`);
    if (r.ok) setData((await r.json()) as TrendPayload);
    else setErr(`오류 ${r.status}`);
  }, [columnId]);
  useEffect(() => { load(); }, [load]);

  // 표본 부족 시 과거 수집 — 계정: 깊은 페이지네이션 / 검색: 기간 지정(since/until) 재검색
  async function backfill() {
    if (!data) return;
    setBusy(true); setErr('');
    try {
      const body = kind === 'watchlist'
        ? { maxPages: 10 }
        : { sinceDate: data.weekly[0].weekStart, untilDate: new Date().toISOString().slice(0, 10) };
      const r = await fetch(`/api/columns/${columnId}/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (r.ok) { onAfterBackfill(); await load(); }
      else setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `오류 ${r.status}`);
    } catch {
      setErr('네트워크 오류 — 다시 시도해주세요');
    } finally {
      setBusy(false);
    }
  }

  const maxCount = data ? Math.max(1, ...data.weekly.map((b) => b.count)) : 1;
  const smallBtn = 'rounded border border-x-border-strong px-2 py-1 text-xs hover:bg-x-hover disabled:opacity-50';

  return (
    <div className="border-b border-x-border px-3 py-2 text-[13px]">
      <div className="flex items-baseline gap-2">
        <p className="font-bold">주간 추이</p>
        <span className="text-xs text-x-muted">이 컬럼에 쌓인 트윗 기준 · 추가 비용 없음</span>
        <button onClick={onClose} className="ml-auto rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
      </div>

      {data && data.sufficiency === 'insufficient' && (
        <div className="mt-1">
          <p className="text-xs text-x-secondary">아직 데이터가 {data.dataWeeks}주치뿐이라 추이를 보기 어려워요.</p>
          <button onClick={backfill} disabled={busy} className={`mt-1 ${smallBtn}`}
                  title="과거 트윗을 더 수집해 기간을 채워요 (약 $0.01)">
            {busy ? '수집 중…' : '과거 트윗 더 가져오기 (약 $0.01)'}
          </button>
        </div>
      )}

      {data && data.sufficiency !== 'insufficient' && (
        <>
          <ul className="mt-1 space-y-0.5">
            {data.weekly.map((b) => (
              <li key={b.weekStart} className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-xs text-x-muted">{fmtWeek(b.weekStart)}주</span>
                <span className="h-2 rounded-sm bg-x-blue/60" style={{ width: `${Math.round((b.count / maxCount) * 100)}%`, minWidth: b.count > 0 ? 4 : 0 }} />
                <span className="shrink-0 text-xs text-x-secondary">{b.count}건</span>
                <span className="ml-auto shrink-0 text-xs text-x-secondary"
                      title="그 주 트윗의 보통 반응 수준(좋아요 중앙값)">♥{formatCount(b.medianLikes)}</span>
              </li>
            ))}
            {data.partialWeek && (
              <li className="flex items-center gap-2 opacity-60">
                <span className="w-9 shrink-0 text-xs text-x-muted">{fmtWeek(data.partialWeek.weekStart)}주</span>
                <span className="text-xs text-x-muted">▒ 집계 중 ({data.partialWeek.count}건) — 이번 주는 아직 숫자가 낮게 나와요</span>
              </li>
            )}
          </ul>
          {data.judgment && <p className="mt-1 text-xs font-bold">💬 {data.judgment}</p>}
          {data.sufficiency === 'sparse' && (
            <p className="mt-1 text-xs text-x-muted">표본이 적어 추이가 흔들릴 수 있어요 — 참고용으로만 보세요.</p>
          )}
          {data.capped && (
            <p className="mt-1 text-xs text-amber-600">수집량이 조회 상한(2,000건)에 닿았어요 — 오래된 주는 실제보다 적게 보일 수 있어요.</p>
          )}

          {kind === 'watchlist' && (
            data.topicTrends === null
              ? <p className="mt-2 text-xs text-x-muted">주제 분석을 먼저 실행하면 주제별 추이도 보여요.</p>
              : data.topicTrends.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-x-muted">주제별 추이 (2주 단위 비교 — 주제는 표본이 적어 2주씩 묶어요)</p>
                  <ul className="mt-0.5">
                    {data.topicTrends.map((t) => (
                      <li key={t.topicId} className="flex items-baseline gap-1 px-1 py-0.5">
                        <span className="truncate">{t.label}</span>
                        <span className="ml-auto shrink-0 text-xs text-x-secondary">
                          ♥{formatCount(t.previous.medianLikes)} → ♥{formatCount(t.recent.medianLikes)}
                        </span>
                        <span className={`shrink-0 text-xs ${DIR_COLOR[t.direction]}`}>{DIR_ICON[t.direction]} {t.judgment}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
          )}
        </>
      )}

      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}
