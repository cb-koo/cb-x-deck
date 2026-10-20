// X 업로드 현황 › 줄을 누르면 열리는 오른쪽 패널 — 팔로워 추이 + 주차별 게시물. 스펙 2026-10-20 §2-1
// 지운 글도 그 주 횟수에 든다 — 줄에 '지워짐'만 붙여 감독자가 알 수 있게 한다(스펙 §4-3).
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { weekShort, type ChannelDetail, type PostKind } from '@/lib/ownedChannels';

const KIND_LABEL: Record<PostKind, string> = { original: '새 글', quote: '인용', retweet: 'RT 제외', reply: '답글 제외' };
const KIND_CHIP: Record<PostKind, string> = {
  original: 'bg-[#e8f0fe] text-[#1d4ed8]', quote: 'bg-[#f3e8ff] text-[#7e22ce]',
  retweet: 'bg-x-surface text-x-muted', reply: 'bg-x-surface text-x-muted',
};

export function ChannelDetailPanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ChannelDetail | null>(null);
  const [err, setErr] = useState(false);
  const [attempt, setAttempt] = useState(0);

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

  const shown = detail?.channelId === channelId ? detail : null;
  const max = shown ? Math.max(1, ...shown.followers.values.filter((v): v is number => v !== null)) : 1;
  const min = shown ? Math.min(...shown.followers.values.filter((v): v is number => v !== null), max) : 0;

  return (
    <aside role="dialog" aria-label="계정 자세히" className="fixed inset-y-0 right-0 z-40 flex w-[440px] flex-col border-l border-x-border bg-white shadow-xl">
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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        {!shown && !err && <p className="py-8 text-center text-ui text-x-muted">불러오는 중…</p>}
        {err && (
          <div className="py-8 text-center">
            <p className="mb-2 text-ui text-x-secondary">불러오지 못했어요</p>
            <Button onClick={() => { setErr(false); setAttempt((n) => n + 1); }}>다시 시도</Button>
          </div>
        )}
        {shown && (
          <>
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
            <div className="space-y-2.5">
              {shown.weeks.map((w) => (
                <div key={w.weekStart} className="overflow-hidden rounded-xl border border-x-border">
                  <div className="flex items-center justify-between bg-x-surface px-3.5 py-2.5 text-[14px]">
                    <b className="font-semibold">{w.isCurrent ? `이번 주 ${w.title}` : w.title}</b>
                    {w.count === null || w.target === null ? <span className="text-ui text-x-muted">{w.count === null ? '기록 시작 전' : `${w.count}회, 이 주는 약속 없음`}</span> : (
                      <span className={`text-ui font-semibold ${w.met === null ? 'text-x-secondary' : w.met ? 'text-[#15803d]' : 'text-[#dc2626]'}`}>
                        {w.count} / {w.target}회{w.met === null ? '' : w.met ? ' 채움' : ' 못 채움'}
                      </span>
                    )}
                  </div>
                  {w.posts.length === 0 && w.count !== null && <p className="border-t border-x-border px-3.5 py-2.5 text-ui text-x-muted">올린 글이 없어요</p>}
                  {w.posts.map((p) => {
                    const body = (
                      <>
                        <span className="flex shrink-0 flex-col gap-1">
                          <span className={`rounded-md px-1.5 py-0.5 text-caption font-semibold ${KIND_CHIP[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
                          {p.deletedNote && <span className="rounded-md bg-x-surface px-1.5 py-0.5 text-caption font-semibold text-x-muted">지워짐</span>}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`line-clamp-2 ${p.counted && !p.deletedNote ? '' : 'text-x-muted'}`}>{p.text || '(글자 없음)'}</span>
                          {p.deletedNote && <span className="mt-0.5 block text-caption text-x-muted">{p.deletedNote}</span>}
                        </span>
                        <span className="shrink-0 text-ui text-x-muted">{p.day}</span>
                      </>
                    );
                    const cls = 'flex gap-2.5 border-t border-x-border px-3.5 py-2.5 text-[14px] leading-snug';
                    // 지운 글은 열리지 않으므로 링크를 두지 않는다
                    return p.deletedNote ? <div key={p.postId} className={cls}>{body}</div> : (
                      <a key={p.postId} href={`https://x.com/${shown.handle}/status/${p.postId}`} target="_blank" rel="noreferrer" className={`${cls} hover:bg-x-hover`}>{body}</a>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-4 text-ui text-x-muted">
              약속 횟수는 <Link href={`/clients?client=${shown.clientId}`} className="text-x-blue-text hover:underline">클라이언트 설정</Link>에서 바꿀 수 있어요. 바꾸면 이번 주부터 새 값으로 판정해요.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
