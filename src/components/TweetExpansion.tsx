'use client';
import { useRef, useState } from 'react';
import type { DeckTweet } from '@/lib/types';
import type { ExpansionUser } from '@/lib/mappers';
import { formatCount } from '@/lib/format';

type Kind = 'replies' | 'thread' | 'retweeters';
const LABEL: Record<Kind, string> = { replies: '답글', thread: '스레드', retweeters: '리포스터' };
const EMPTY: Record<Kind, string> = { replies: '답글 없음', thread: '스레드 없음', retweeters: '리포스터 없음' };
const TITLE: Record<Kind, string> = {
  replies: '이 트윗에 달린 답글을 불러와요 · 1회 $0.001',
  thread: '이어지는 타래를 불러와요 · 1회 $0.001',
  retweeters: '리포스트한 계정 목록을 불러와요 · 1회 $0.001',
};

// 확장 탐색 — 클릭 시에만 호출(opt-in), 결과는 컴포넌트 상태로만 유지(DB 저장 없음)
export function TweetExpansion({ tweetId }: { tweetId: string }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [tweets, setTweets] = useState<DeckTweet[]>([]);
  const [users, setUsers] = useState<ExpansionUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 세대 카운터 — toggle()로 kind 전환 시 증가. 응답 도착 시 세대가 달라졌으면(=다른 kind로
  // 이미 전환된 뒤 도착한 stale 응답) 화면에 반영하지 않고 버린다.
  const genRef = useRef(0);

  async function fetchPage(k: Kind, cur: string | null, replace: boolean) {
    const gen = genRef.current;
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/tweets/${tweetId}/${k}${cur ? `?cursor=${encodeURIComponent(cur)}` : ''}`);
      if (gen !== genRef.current) return; // stale — 다른 kind로 전환됨
      if (!r.ok) {
        setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '불러오기 실패 — 다시 시도');
        return;
      }
      const j = (await r.json()) as { tweets?: DeckTweet[]; users?: ExpansionUser[]; nextCursor: string | null };
      if (gen !== genRef.current) return; // stale — json 파싱 대기 중 전환됨
      if (k === 'retweeters') {
        setUsers((prev) => {
          if (replace) return j.users ?? [];
          const seen = new Set(prev.map((u) => u.handle));
          return [...prev, ...(j.users ?? []).filter((u) => !seen.has(u.handle))];
        });
      } else {
        setTweets((prev) => {
          if (replace) return j.tweets ?? [];
          const seen = new Set(prev.map((t) => t.tweetId));
          return [...prev, ...(j.tweets ?? []).filter((t) => !seen.has(t.tweetId))];
        });
      }
      setCursor(j.nextCursor ?? null);
    } catch {
      if (gen === genRef.current) setErr('불러오기 실패 — 다시 시도');
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  }

  function toggle(k: Kind) {
    genRef.current += 1;
    if (kind === k) { setKind(null); return; }
    setKind(k); setTweets([]); setUsers([]); setCursor(null); setErr('');
    fetchPage(k, null, true);
  }

  const empty = kind === 'retweeters' ? users.length === 0 : tweets.length === 0;

  return (
    <div className="mt-1">
      <div className="flex gap-1 text-xs text-x-secondary">
        {(Object.keys(LABEL) as Kind[]).map((k) => (
          <button key={k} onClick={() => toggle(k)} title={TITLE[k]}
                  className={`rounded px-1.5 py-0.5 hover:bg-x-border ${kind === k ? 'font-bold text-x-text' : ''}`}>
            {LABEL[k]}{kind === k ? ' ✕' : ''}
          </button>
        ))}
      </div>
      {kind && (
        <div className="mt-1 rounded border border-x-border bg-x-hover/40 p-2 text-[13px]">
          {err && (
            <p className="text-xs text-red-500">
              {err} <button onClick={() => fetchPage(kind, cursor, empty)} className="underline">다시 시도</button>
            </p>
          )}
          {busy && empty && <p className="text-xs text-x-muted">불러오는 중…</p>}
          {kind !== 'retweeters' && tweets.map((t) => (
            <div key={t.tweetId} className="border-b border-x-border py-1 last:border-b-0">
              <span className="font-bold">{t.authorName ?? t.authorHandle}</span>
              <span className="text-x-secondary"> @{t.authorHandle} · ♥{formatCount(t.metrics.likes)}</span>
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
            </div>
          ))}
          {kind === 'retweeters' && users.length > 0 && (
            <p className="mb-1 text-xs text-x-muted">
              {users.length}명 불러옴 · 팔로워 1만+ {users.filter((u) => (u.followers ?? 0) >= 10000).length}명
              {cursor ? ' · 더 있음' : ''}
            </p>
          )}
          {kind === 'retweeters' && [...users]
            .sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0))
            .map((u) => (
              <div key={u.handle} className="border-b border-x-border py-1 last:border-b-0">
                <div className="flex items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {u.avatarUrl
                    ? <img src={u.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                    : <div className="h-5 w-5 shrink-0 rounded-full bg-x-border-strong" />}
                  <a href={`https://x.com/${u.handle}`} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-bold hover:underline">
                    {u.name ?? u.handle}
                  </a>
                  {u.verified && <span className="shrink-0 text-x-blue" title="인증 계정">✓</span>}
                  <span className="shrink-0 text-x-secondary">@{u.handle}</span>
                  <span className="ml-auto shrink-0 text-xs text-x-muted">
                    {[
                      u.followers !== null ? `팔로워 ${formatCount(u.followers)}` : null,
                      u.following !== null ? `팔로잉 ${formatCount(u.following)}` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {u.bio && <p className="truncate text-x-muted">{u.bio}</p>}
              </div>
            ))}
          {!busy && !err && empty && <p className="text-xs text-x-muted">{EMPTY[kind]}</p>}
          {cursor && (
            <button onClick={() => fetchPage(kind, cursor, false)} disabled={busy}
                    className="mt-1 w-full rounded py-1 text-center text-xs text-x-blue hover:bg-x-hover disabled:opacity-50">
              {busy ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
