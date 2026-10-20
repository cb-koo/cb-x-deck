// X 업로드 현황 — 우리가 클라이언트에게 약속한 주 N회 업로드를 지키는지 본다. 스펙 2026-10-20 §2-1, 시안 6(koo 10-20)
// 위: 이번 주(아직 못 채운 곳만 한 줄씩, 채운 곳은 한 줄로 접는다) / 아래: 지난 8주 흐름. 판정·문구는 서버(lib/ownedChannels)가 만든다.
'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { useToast } from '@/lib/toastContext';
import { Button, PANEL_SPLIT, PANEL_TITLE } from '@/components/ui';
import { HEAD, CELL } from '@/app/settlement/tableStyle';
import { BIG, COMP, BAR } from '@/app/campaigns/flow/cardStyles';
import { weekRangeShort, type ChannelsView, type ThisWeekRow, type Tone } from '@/lib/ownedChannels';
import { ChannelDetailPanel } from './ChannelDetailPanel';

type Payload = { view: ChannelsView; unchecked: number };

// 상태는 칩(짧은 명사형)으로 — 문장보다 빨리 훑인다. 주황 = 먼저 챙길 곳(캠페인 '밀린 작업' 색), 초록 = 달성(캠페인 '게시' 칩 색), 회색 = 진행
const STATUS_CHIP: Record<Tone, string> = {
  ok: 'bg-[#e6f6ee] text-[#15803d]', warn: 'bg-[#fff4e5] font-semibold text-[#b45309]', plain: 'bg-x-surface text-x-secondary',
};

export default function ChannelsPage() {
  const { show } = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/channels');
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as Payload);
      setLoadErr(false);
    } catch {
      setLoadErr(true);   // 실패를 빈 상태로 위장하지 않는다
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 로드, setState는 전부 await 뒤(influencers/performance 관례)
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const r = await apiFetch('/api/channels/refresh', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { show((body as { error?: string }).error ?? '새로 받지 못했어요'); return; }
      setData(body as Payload);
      show('X에서 새로 받아 왔어요');
    } finally { setRefreshing(false); }
  };

  return (
    <main className="min-h-full bg-x-surface px-6 py-8">
      <div className="max-w-[1040px]">
        <h1 className="mb-1 text-[20px] font-bold">X 업로드 현황</h1>
        <p className="mb-6 text-[14px] text-x-secondary">클라이언트별 X 업로드 약속(주 N회) 달성 현황이에요.</p>

        {!data && !loadErr && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
        {loadErr && (
          <div className="py-8 text-center">
            <p className="mb-2 text-ui text-x-secondary">현황을 불러오지 못했어요</p>
            <Button onClick={() => { setLoadErr(false); void load(); }}>다시 시도</Button>
          </div>
        )}
        {data && data.view.thisWeek.total === 0 && (
          <p className="rounded-xl border border-x-border bg-white px-5 py-8 text-center text-content text-x-secondary">
            X 계정과 업로드 약속을 정한 클라이언트가 아직 없어요. 클라이언트 설정에서 정하면 여기에 모여요.{' '}
            <Link href="/clients" className="text-x-blue-text hover:underline">클라이언트로 →</Link>
          </p>
        )}
        {data && data.view.thisWeek.total > 0 && (
          <div className="space-y-5">
            <ThisWeekPanel view={data.view} refreshing={refreshing} onRefresh={refresh}
                           showDone={showDone} onToggleDone={() => setShowDone((v) => !v)} onOpen={setOpenId} />
            <HistoryPanel view={data.view} onOpen={setOpenId} />
            {data.unchecked > 0 && (
              <p className="text-ui text-x-muted">
                업로드 약속이 없는 계정 {data.unchecked}곳은 점검하지 않아요.{' '}
                <Link href="/clients" className="text-x-blue-text hover:underline">클라이언트로 →</Link>
              </p>
            )}
          </div>
        )}
      </div>
      {openId && <ChannelDetailPanel channelId={openId} onClose={() => setOpenId(null)} />}
    </main>
  );
}

function ThisWeekPanel({ view, refreshing, onRefresh, showDone, onToggleDone, onOpen }: {
  view: ChannelsView; refreshing: boolean; onRefresh: () => void;
  showDone: boolean; onToggleDone: () => void; onOpen: (id: string) => void;
}) {
  const w = view.thisWeek;
  const pct = w.total ? Math.round((w.doneCount / w.total) * 100) : 0;
  return (
    <section aria-label="이번 주" className={PANEL_SPLIT}>
      <div className="flex items-start justify-between gap-4 px-5 pb-3.5 pt-4">
        <div>
          <h2 className={PANEL_TITLE}>이번 주</h2>
          <p className="text-ui text-x-muted">{w.title}</p>
        </div>
        <div className="flex items-center gap-2 text-right">
          <p className="text-right text-ui leading-relaxed text-x-muted">
            <b className="text-[14px] font-semibold text-x-text">{w.daysLeftLabel}</b><br />
            {refreshing ? 'X에서 받는 중…' : w.checkedLabel}
          </p>
          <button type="button" onClick={onRefresh} disabled={refreshing}
                  aria-label="X에서 지금 다시 받기" title="X에서 지금 다시 받기 — 계정마다 X 호출 2번쯤(1곳 약 3원)"
                  className="inline-flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full border border-x-border-strong bg-white text-x-text hover:bg-x-hover disabled:opacity-40">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 aria-hidden className={`h-[14px] w-[14px] ${refreshing ? 'animate-spin' : ''}`}>
              <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="px-5 pb-5">
        <p className={BIG}>{w.doneCount}<span className={COMP}>/ {w.total}곳 달성</span></p>
        <div className={`${BAR} mt-2.5`}><i className="block h-full bg-x-text" style={{ width: `${pct}%` }} /></div>
        {w.headline && <p className="mt-3 text-[15px] text-x-text">{w.headline}</p>}
      </div>

      {w.pending.length === 0 ? (
        null
      ) : (
        <WeekTable rows={w.pending} onOpen={onOpen} />
      )}

      {w.done.length > 0 && w.pending.length > 0 && (
        <>
          <button type="button" onClick={onToggleDone} aria-expanded={showDone}
                  className="flex w-full items-center gap-2 border-t border-x-border px-5 py-3 text-left text-[14px] text-x-secondary hover:bg-x-hover">
            <b className="font-semibold text-[#15803d]">달성 {w.done.length}곳</b>
            <span className="min-w-0 truncate">{w.done.map((r) => r.clientName).join(', ')}</span>
            <span className="ml-auto shrink-0 text-ui text-x-muted">{showDone ? '접기 ▴' : '펼치기 ▾'}</span>
          </button>
          {showDone && <WeekTable rows={w.done} onOpen={onOpen} />}
        </>
      )}
      {w.done.length > 0 && w.pending.length === 0 && <WeekTable rows={w.done} onOpen={onOpen} />}
    </section>
  );
}

function WeekTable({ rows, onOpen }: { rows: ThisWeekRow[]; onOpen: (id: string) => void }) {
  return (
    <table className="w-full border-separate border-spacing-0 text-[14px]">
      <thead>
        <tr>
          <th className={`${HEAD} border-t pl-5`}>클라이언트</th>
          <th className={`${HEAD} border-t text-right`}>업로드</th>
          <th className={`${HEAD} border-t`}>상태</th>
          <th className={`${HEAD} border-t`}>최근 업로드</th>
          <th className={`${HEAD} border-t pr-5`}><span className="sr-only">X 계정</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.channelId} onClick={() => onOpen(r.channelId)} className="cursor-pointer hover:bg-x-hover">
            <td className={`${CELL} pl-5`}>
              <span className="font-semibold">{r.clientName}</span>
              <span className="ml-1.5 text-ui text-x-muted">@{r.handle}</span>
            </td>
            {/* 업로드는 숫자만 크게 — '0 / 1회'를 칩에 가두면 상태 칩과 겹쳐 읽힌다 */}
            <td className={`${CELL} text-right tabular-nums`}>
              <b className={`text-[15px] font-semibold ${r.tone === 'ok' ? 'text-[#15803d]' : ''}`}>{r.count === null ? '?' : r.count}</b>
              <span className="text-x-muted"> / {r.target}회</span>
            </td>
            <td className={CELL}>
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-ui ${STATUS_CHIP[r.tone]}`}>{r.situation}</span>
              {r.count === null && (
                <Link href={`/clients?client=${r.clientId}`} onClick={(e) => e.stopPropagation()} className="ml-2 text-ui text-x-blue-text hover:underline">설정 열기</Link>
              )}
            </td>
            <td className={`${CELL} text-x-muted`}>
              {r.lastPost}
              {r.staleNote && <span className="ml-1.5 text-[#b45309]">({r.staleNote})</span>}
            </td>
            <td className={`${CELL} pr-5 text-right`}>
              <a href={`https://x.com/${r.handle}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                 title={`@${r.handle} X에서 열기`} className="text-x-blue-text hover:underline">X ↗</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryPanel({ view, onOpen }: { view: ChannelsView; onOpen: (id: string) => void }) {
  const { weeks, rows } = view.history;
  return (
    <section aria-label="지난 8주" className={PANEL_SPLIT}>
      <div className="px-5 pb-3.5 pt-4">
        <h2 className={PANEL_TITLE}>지난 8주</h2>
        <p className="text-ui text-x-muted">칸 숫자는 그 주(월~일)에 올린 글 수예요. 줄을 누르면 게시물과 팔로워가 보여요.</p>
      </div>
      <table className="w-full border-separate border-spacing-0 text-[14px]">
        <thead>
          <tr>
            <th className={`${HEAD} border-t pl-5`}>클라이언트</th>
            <th className={`${HEAD} border-t`}>약속</th>
            {weeks.map((w, i) => (
              <th key={w} className={`${HEAD} border-t px-1 text-center text-[12px] font-medium leading-tight ${i === 0 ? 'border-l border-l-x-border' : ''} ${i === weeks.length - 1 ? 'text-x-text' : 'text-x-muted'}`}>
                {i === weeks.length - 1 && <span className="block text-[11px] font-semibold">지난주</span>}
                {weekRangeShort(w)}
              </th>
            ))}
            <th className={`${HEAD} border-t border-l border-l-x-border pr-5`}>요약</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channelId} onClick={() => onOpen(r.channelId)} className="cursor-pointer hover:bg-x-hover">
              <td className={`${CELL} pl-5 font-semibold`}>{r.clientName}</td>
              <td className={`${CELL} text-x-muted`}>주 {r.target}회</td>
              {r.cells.map((c, i) => (
                <td key={c.weekStart} className={`${CELL} px-1 text-center ${i === 0 ? 'border-l border-l-x-border' : ''}`}>
                  {c.state === 'beforeRecord' ? (
                    <span className="text-x-border-strong" title="기록 전">—</span>
                  ) : c.met === null ? (
                    // 약속 시작 전·약속 없던 주 — 판정하지 않고 올린 글 수만 흐리게
                    <span title={`${c.state === 'beforeStart' ? '약속 전' : '약속 없음'}이라 판정하지 않아요. 올린 글 ${c.count}개.`}
                          className="inline-flex h-[26px] w-[32px] items-center justify-center rounded-md text-ui tabular-nums text-x-muted shadow-[inset_0_0_0_1px_var(--color-x-border)]">
                      {c.count}
                    </span>
                  ) : (
                    <span title={`${c.met ? '달성' : '미달'}: 약속 ${c.target}회 중 ${c.count}회.${c.deleted ? ` 그중 ${c.deleted}개는 지금 X에서 지워졌어요(올린 것으로 셌어요).` : ''}`}
                          className={`relative inline-flex h-[26px] w-[32px] items-center justify-center rounded-md text-ui font-semibold tabular-nums ${c.met ? 'bg-[#e6f6ee] text-[#15803d]' : 'bg-[#fdecec] text-[#dc2626]'}`}>
                      {c.count}
                      {c.deleted > 0 && <i aria-hidden className="absolute right-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-x-muted" />}
                    </span>
                  )}
                </td>
              ))}
              <td className={`${CELL} border-l border-l-x-border pr-5 ${r.bad ? 'font-semibold text-[#dc2626]' : ''}`}>{r.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4 border-t border-x-border px-5 py-3 text-ui text-x-muted">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-[3px] bg-[#e6f6ee] shadow-[inset_0_0_0_1px_#bfe5cf]" />달성</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-[3px] bg-[#fdecec] shadow-[inset_0_0_0_1px_#f5c2c2]" />미달</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded-[3px] shadow-[inset_0_0_0_1px_var(--color-x-border-strong)]" />약속 전(판정 안 함)</span>
        <span>— 기록 전</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-[5px] w-[5px] rounded-full bg-x-muted" />지워진 글 포함</span>
      </div>
    </section>
  );
}
