'use client';
import { useState } from 'react';
import type { DeckTweet } from '@/lib/types';
import type { ExpansionUser } from '@/lib/mappers';
import { formatCount } from '@/lib/format';

type Kind = 'replies' | 'thread' | 'retweeters';
const LABEL: Record<Kind, string> = { replies: '답글', thread: '스레드', retweeters: '리포스터' };
const EMPTY: Record<Kind, string> = { replies: '답글 없음', thread: '스레드 없음', retweeters: '리포스터 없음' };

// 확장 탐색 — 클릭 시에만 호출(opt-in), 결과는 컴포넌트 상태로만 유지(DB 저장 없음)
export function TweetExpansion({ tweetId }: { tweetId: string }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [tweets, setTweets] = useState<DeckTweet[]>([]);
  const [users, setUsers] = useState<ExpansionUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function fetchPage(k: Kind, cur: string | null, replace: boolean) {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/tweets/${tweetId}/${k}${cur ? `?cursor=${encodeURIComponent(cur)}` : ''}`);
      if (!r.ok) {
        setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '불러오기 실패 — 다시 시도');
        return;
      }
      const j = (await r.json()) as { tweets?: DeckTweet[]; users?: ExpansionUser[]; nextCursor: string | null };
      if (k === 'retweeters') setUsers((prev) => (replace ? j.users ?? [] : [...prev, ...(j.users ?? [])]));
      else setTweets((prev) => (replace ? j.tweets ?? [] : [...prev, ...(j.tweets ?? [])]));
      setCursor(j.nextCursor ?? null);
    } catch {
      setErr('불러오기 실패 — 다시 시도');
    } finally {
      setBusy(false);
    }
  }

  function toggle(k: Kind) {
    if (kind === k) { setKind(null); return; }
    setKind(k); setTweets([]); setUsers([]); setCursor(null); setErr('');
    fetchPage(k, null, true);
  }

  const empty = kind === 'retweeters' ? users.length === 0 : tweets.length === 0;

  return (
    <div className="mt-1">
      <div className="flex gap-1 text-xs text-x-secondary">
        {(Object.keys(LABEL) as Kind[]).map((k) => (
          <button key={k} onClick={() => toggle(k)} title="X에서 불러와요 · 1회 $0.001"
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
          {kind === 'retweeters' && users.map((u) => (
            <div key={u.handle} className="flex items-baseline gap-1 border-b border-x-border py-1 last:border-b-0">
              <a href={`https://x.com/${u.handle}`} target="_blank" rel="noopener" className="font-bold hover:underline">
                {u.name ?? u.handle}
              </a>
              <span className="text-x-secondary">@{u.handle}</span>
              {u.followers !== null && <span className="ml-auto text-xs text-x-muted">팔로워 {formatCount(u.followers)}</span>}
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
