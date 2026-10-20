// X 업로드 현황 › 줄을 누르면 열리는 오른쪽 패널 — 팔로워 추이 + 주차별 게시물 표. 스펙 2026-10-20 §2-1
// 게시물은 한 표에 주차 머리 줄로 묶는다(koo 10-20: 목록 대신 표). 왼쪽 가장자리를 끌어 너비 조절, 브라우저에 기억한다.
// 지운 글도 그 주 횟수에 든다 — 줄에 '지워짐'만 붙여 감독자가 알 수 있게 한다(스펙 §4-3).
'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { weekShort, type ChannelDetail, type DetailWeek, type PostKind } from '@/lib/ownedChannels';

const KIND_LABEL: Record<PostKind, string> = { original: '새 글', quote: '인용', retweet: 'RT', reply: '답글' };
const KIND_CHIP: Record<PostKind, string> = {
  original: 'bg-[#e8f0fe] text-[#1d4ed8]', quote: 'bg-[#f3e8ff] text-[#7e22ce]',
  retweet: 'bg-x-surface text-x-muted', reply: 'bg-x-surface text-x-muted',
};

const WIDTH_KEY = 'channels.panelW';
const W_DEFAULT = 1000, W_MIN = 440, W_MAX = 1400;
function storedWidth(): number {
  try { const v = Number(localStorage.getItem(WIDTH_KEY)); return v >= W_MIN && v <= W_MAX ? v : W_DEFAULT; } catch { return W_DEFAULT; }
}

const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('ko-KR'));
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(v > 0 && v < 0.001 ? 2 : 1)}%`);
// 성과 열 — 순서는 인플루언서 성과 표와 같다(노출 → 참여율 → 반응 → 확산)
const METRIC_COLS: Array<{ key: 'views' | 'engagement' | 'likes' | 'replies' | 'bookmarks' | 'retweets' | 'quotes'; label: string; width: number; help?: string }> = [
  { key: 'views', label: '조회', width: 76 },
  { key: 'engagement', label: '참여율', width: 68, help: '공개 반응(좋아요, 답글, 북마크, RT, 인용)을 조회수로 나눈 값이에요. 클릭 수가 빠져서 X 분석 화면보다 낮게 나와요' },
  { key: 'likes', label: '좋아요', width: 60 },
  { key: 'replies', label: '답글', width: 52 },
  { key: 'bookmarks', label: '북마크', width: 60 },
  { key: 'retweets', label: 'RT', width: 52 },
  { key: 'quotes', label: '인용', width: 52 },
];
// 표는 내용 칸이 너무 좁아지지 않게 최소 폭을 두고, 패널이 그보다 좁으면 표만 가로로 밀린다
const TABLE_MIN = 132 + 84 + 240 + METRIC_COLS.reduce((s, c) => s + c.width, 0) + 24;
const TH = 'whitespace-nowrap border-b border-x-border bg-x-surface px-3 py-2 text-left text-ui font-semibold text-x-secondary';
const TD = 'h-11 border-b border-x-border/60 px-3 align-middle';

function verdictTone(w: DetailWeek): string {
  if (w.state !== 'judged') return 'text-x-muted';
  if (w.isCurrent) return w.met ? 'text-[#15803d]' : 'text-x-secondary';
  return w.met ? 'text-[#15803d]' : 'text-[#dc2626]';
}

export function ChannelDetailPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [err, setErr] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(storedWidth);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await apiFetch(`/api/channels/${channelId}`);
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as ChannelDetail;
        if (alive) { setDetail(d); setErr(false); }
      } catch { if (alive) setErr(true); }
    })();
    return () => { alive = false; };
  }, [channelId, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => { try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* 저장소를 못 쓰는 창 */ } }, [width]);

  // 왼쪽 가장자리를 끌어 너비 조절(클리닉 지도 패널과 같은 방식). 화면보다 넓어지지 않게 창 폭 − 80px까지.
  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const max = Math.min(W_MAX, window.innerWidth - 80);
    const move = (ev: PointerEvent) => setWidth(Math.max(W_MIN, Math.min(max, w0 + (x0 - ev.clientX))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const shown = detail?.channelId === channelId ? detail : null;
  const vals = shown ? shown.followers.values.filter((v): v is number => v !== null) : [];
  const max = vals.length ? Math.max(...vals) : 1;
  const min = vals.length ? Math.min(...vals) : 0;

  return (
    <aside role="dialog" aria-label="계정 자세히" style={{ width }}
           className="fixed inset-y-0 right-0 z-40 flex max-w-[calc(100vw-80px)] flex-col border-l border-x-border bg-white shadow-xl">
      <div role="separator" aria-orientation="vertical" aria-label="패널 너비 조절"
           title="끌어서 패널 너비 조절, 두 번 누르면 원래대로"
           onPointerDown={startDrag} onDoubleClick={() => setWidth(W_DEFAULT)}
           className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none hover:bg-x-blue/40" />

      <div className="flex items-start justify-between gap-3 border-b border-x-border px-6 pb-4 pt-5">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-bold">{shown?.clientName ?? ' '}</h2>
          {shown && (
            <p className="mt-0.5 text-ui text-x-muted">
              <a href={`https://x.com/${shown.handle}`} target="_blank" rel="noreferrer" className="text-x-blue-text hover:underline">@{shown.handle} ↗</a>
              <span className="ml-2">약속 주 {shown.target}회</span>
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded px-1.5 text-[18px] text-x-secondary hover:bg-x-hover">✕</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        {!shown && !err && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
        {err && (
          <div className="py-8 text-center">
            <p className="mb-2 text-ui text-x-secondary">불러오지 못했어요</p>
            <Button onClick={() => { setErr(false); setAttempt((n) => n + 1); }}>다시 시도</Button>
          </div>
        )}
        {shown && (
          <>
            <div className="px-6">
              <h3 className="mb-2 mt-5 text-[14px] font-semibold">팔로워</h3>
              <div className="flex h-[96px] items-end gap-2 border-b border-x-border px-1">
                {shown.followers.values.map((v, i) => (
                  <div key={shown.followers.weeks[i]} title={v === null ? '기록 없음' : `${v.toLocaleString('ko-KR')}명`}
                       className={`flex-1 rounded-t ${i === shown.followers.values.length - 1 ? 'bg-x-blue' : 'bg-[#bfe3fb]'}`}
                       style={{ height: v === null ? 0 : `${max === min ? 60 : 20 + ((v - min) / (max - min)) * 80}%` }} />
                ))}
              </div>
              <div className="flex gap-2 px-1 pt-1 text-caption text-x-muted">
                {shown.followers.weeks.map((w, i) => (
                  <span key={w} className="flex-1 text-center">{i === shown.followers.weeks.length - 1 ? '이번 주' : weekShort(w)}</span>
                ))}
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-x-secondary">{shown.followers.summary}</p>
              <h3 className="mb-2 mt-6 text-[14px] font-semibold">주차별 게시물</h3>
            </div>

            {/* 한 표에 주차 머리 줄 — 열(게시·종류·내용·조회·좋아요)이 주가 바뀌어도 같은 세로줄에 선다 */}
            <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-0 text-[14px]" style={{ minWidth: TABLE_MIN }}>
              <colgroup>
                <col style={{ width: 132 }} /><col style={{ width: 84 }} /><col />
                {METRIC_COLS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className={`${TH} border-t pl-6`}>게시</th>
                  <th className={`${TH} border-t`}>종류</th>
                  <th className={`${TH} border-t`}>내용</th>
                  {METRIC_COLS.map((c, i) => (
                    <th key={c.key} title={c.help} className={`${TH} border-t px-2 text-right ${i === 0 ? 'border-l border-l-x-border' : ''} ${i === METRIC_COLS.length - 1 ? 'pr-6' : ''} ${c.help ? 'cursor-help underline decoration-dotted underline-offset-4' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.weeks.map((w) => (
                  <Fragment key={w.weekStart}>
                    <tr>
                      <td colSpan={3 + METRIC_COLS.length} className="border-b border-x-border bg-[#fafbfb] px-6 py-2">
                        <span className="flex items-baseline justify-between gap-3">
                          <b className="font-semibold">{w.isCurrent ? `이번 주 ${w.title}` : w.title}</b>
                          <span className={`text-ui font-semibold ${verdictTone(w)}`}>{w.verdict}</span>
                        </span>
                      </td>
                    </tr>
                    {w.posts.length === 0 && w.state !== 'beforeRecord' && (
                      <tr><td colSpan={3 + METRIC_COLS.length} className={`${TD} pl-6 text-ui text-x-muted`}>올린 글이 없어요</td></tr>
                    )}
                    {w.posts.map((p) => {
                      const dim = !p.counted || !!p.deletedNote;
                      return (
                        <tr key={p.postId} className={p.deletedNote ? '' : 'hover:bg-x-hover'}>
                          <td className={`${TD} whitespace-nowrap pl-6 tabular-nums text-x-secondary`}>{p.day}</td>
                          <td className={TD}>
                            <span className="flex flex-wrap gap-1">
                              <span title={p.counted ? '약속 횟수에 들어가요' : '약속 횟수에서 빠져요'}
                                    className={`rounded-md px-1.5 py-0.5 text-caption font-semibold ${KIND_CHIP[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                              {p.deletedNote && <span title={p.deletedNote} className="rounded-md bg-x-surface px-1.5 py-0.5 text-caption font-semibold text-x-muted">지워짐</span>}
                            </span>
                          </td>
                          <td className={`${TD} min-w-0`}>
                            {/* 지운 글은 열리지 않으므로 링크를 두지 않는다 */}
                            {p.deletedNote ? (
                              <span title={`${p.text}\n\n${p.deletedNote}`} className="block truncate text-x-muted">{p.text || '(글자 없음)'}</span>
                            ) : (
                              <a href={`https://x.com/${shown.handle}/status/${p.postId}`} target="_blank" rel="noreferrer" title={p.text}
                                 className={`block truncate hover:underline ${dim ? 'text-x-muted' : ''}`}>{p.text || '(글자 없음)'}</a>
                            )}
                          </td>
                          {METRIC_COLS.map((c, i) => (
                            <td key={c.key} className={`${TD} px-2 text-right tabular-nums ${dim ? 'text-x-muted' : ''} ${i === 0 ? 'border-l border-l-x-border' : ''} ${i === METRIC_COLS.length - 1 ? 'pr-6' : ''}`}>
                              {c.key === 'engagement' ? pct(p.engagement) : fmt(p.metrics[c.key])}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
            </div>
            <p className="mt-4 px-6 text-ui text-x-muted">
              RT와 답글은 약속 횟수에서 빠져요. 약속 횟수와 시작일은 <Link href={`/clients?client=${shown.clientId}`} className="text-x-blue-text hover:underline">클라이언트 설정</Link>에서 바꿀 수 있어요.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
