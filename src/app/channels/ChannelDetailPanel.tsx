// X 업로드 현황 › 줄을 누르면 열리는 오른쪽 패널 — 팔로워 추이 + 주차별 게시물 표. 스펙 2026-10-20 §2-1
// 게시물은 한 표로, 주차는 묶음이 아니라 'N월 N주차' 열로(koo 10-20, 캠페인 주차 규칙). 성과(조회·반응)는 넣지 않는다 — 이 화면은 올렸는지만 본다(koo 10-20). 왼쪽 가장자리를 끌어 너비 조절, 브라우저에 기억한다.
// 지운 글도 그 주 횟수에 든다 — 줄에 '지워짐'만 붙여 감독자가 알 수 있게 한다(스펙 §4-3).
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { weekShort, type ChannelDetail, type PostKind } from '@/lib/ownedChannels';

const KIND_LABEL: Record<PostKind, string> = { original: '새 글', quote: '인용', retweet: 'RT', reply: '답글' };
const KIND_CHIP: Record<PostKind, string> = {
  original: 'bg-[#e8f0fe] text-[#1d4ed8]', quote: 'bg-[#f3e8ff] text-[#7e22ce]',
  retweet: 'bg-x-surface text-x-muted', reply: 'bg-x-surface text-x-muted',
};

const WIDTH_KEY = 'channels.panelW';
const W_DEFAULT = 680, W_MIN = 440, W_MAX = 1200;
// 게시물 표에 보일 글 — 기본은 약속 횟수에 드는 글(새 글, 인용)만. 켜면 RT·답글도(koo 10-20). 브라우저에 기억한다
type PostScope = 'counted' | 'all';
const SCOPE_KEY = 'channels.postScope';
function storedScope(): PostScope {
  try { return localStorage.getItem(SCOPE_KEY) === 'all' ? 'all' : 'counted'; } catch { return 'counted'; }
}
function storedWidth(): number {
  try { const v = Number(localStorage.getItem(WIDTH_KEY)); return v >= W_MIN && v <= W_MAX ? v : W_DEFAULT; } catch { return W_DEFAULT; }
}

const TH = 'whitespace-nowrap border-b border-x-border bg-x-surface px-3 py-2 text-left text-ui font-semibold text-x-secondary';
const TD = 'h-11 border-b border-x-border/60 px-3 align-middle';


export function ChannelDetailPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [err, setErr] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(storedWidth);
  const [scope, setScope] = useState<PostScope>(storedScope);
  useEffect(() => { try { localStorage.setItem(SCOPE_KEY, scope); } catch { /* 저장소를 못 쓰는 창 */ } }, [scope]);

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
  const otherCount = shown ? shown.posts.filter((p) => !p.counted).length : 0;
  const visible = shown ? (scope === 'all' ? shown.posts : shown.posts.filter((p) => p.counted)) : [];
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
              <div className="mb-2 mt-6 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-semibold">게시물</h3>
                {/* 보기 전환 — 두 칸짜리 선택(누르면 그쪽으로). 다른 유형 개수를 미리 보여 켤지 판단하게 */}
                <div role="radiogroup" aria-label="게시물 보기" className="inline-flex rounded-full border border-x-border-strong p-0.5 text-ui">
                  {([['counted', '새 글과 인용'], ['all', `다른 유형도${otherCount ? `(+${otherCount})` : ''}`]] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={scope === v} onClick={() => setScope(v)}
                            className={`rounded-full px-3 py-1 ${scope === v ? 'bg-x-text font-semibold text-white' : 'text-x-secondary hover:text-x-text'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 주차는 묶음이 아니라 열로(koo 10-20) — 캠페인과 같은 'N월 N주차'. 최근 글이 위 */}
            <table className="w-full table-fixed border-separate border-spacing-0 text-[14px]">
              <colgroup><col style={{ width: 104 }} /><col style={{ width: 132 }} /><col style={{ width: 96 }} /><col /></colgroup>
              <thead>
                <tr>
                  <th className={`${TH} border-t pl-6`}>주차</th>
                  <th className={`${TH} border-t`}>게시</th>
                  <th className={`${TH} border-t`}>종류</th>
                  <th className={`${TH} border-t pr-6`}>내용</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr><td colSpan={4} className={`${TD} pl-6 text-ui text-x-muted`}>
                    {scope === 'counted' && otherCount > 0 ? `지난 8주 동안 새 글과 인용이 없어요(RT와 답글 ${otherCount}개는 '다른 유형도'에서 보여요)` : '지난 8주 동안 올린 글이 없어요'}
                  </td></tr>
                )}
                {visible.map((p) => {
                  const dim = !p.counted || !!p.deletedNote;
                  return (
                    <tr key={p.postId} className={p.deletedNote ? '' : 'hover:bg-x-hover'}>
                      <td className={`${TD} whitespace-nowrap pl-6 text-x-secondary`}>{p.weekLabel}</td>
                      <td className={`${TD} whitespace-nowrap tabular-nums text-x-secondary`}>{p.day}</td>
                      <td className={TD}>
                        <span className="flex flex-wrap gap-1">
                          <span title={p.counted ? '약속 횟수에 들어가요' : '약속 횟수에서 빠져요'}
                                className={`rounded-md px-1.5 py-0.5 text-caption font-semibold ${KIND_CHIP[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                          {p.deletedNote && <span title={p.deletedNote} className="rounded-md bg-x-surface px-1.5 py-0.5 text-caption font-semibold text-x-muted">지워짐</span>}
                        </span>
                      </td>
                      <td className={`${TD} min-w-0 pr-6`}>
                        {/* 지운 글은 열리지 않으므로 링크를 두지 않는다 */}
                        {p.deletedNote ? (
                          <span title={`${p.text}\n\n${p.deletedNote}`} className="block truncate text-x-muted">{p.text || '(글자 없음)'}</span>
                        ) : (
                          <a href={`https://x.com/${shown.handle}/status/${p.postId}`} target="_blank" rel="noreferrer" title={p.text}
                             className={`block truncate hover:underline ${dim ? 'text-x-muted' : ''}`}>{p.text || '(글자 없음)'}</a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-4 px-6 text-ui text-x-muted">
              {scope === 'all' && 'RT와 답글은 약속 횟수에서 빠져요. '}약속 횟수와 시작일은 <Link href={`/clients?client=${shown.clientId}`} className="text-x-blue-text hover:underline">클라이언트 설정</Link>에서 바꿀 수 있어요.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
