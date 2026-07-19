'use client';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import type { DeckTweet } from '@/lib/types';
import type { ExpansionUser } from '@/lib/mappers';
import { formatCount } from '@/lib/format';
import { useMember } from '@/lib/memberContext';
import { ChevronDownIcon } from './XIcons';

type Kind = 'replies' | 'thread' | 'retweeters';
const LABEL: Record<Kind, string> = { replies: '답글', thread: '스레드', retweeters: '리포스터' };
const EMPTY: Record<Kind, string> = { replies: '답글 없음', thread: '스레드 없음', retweeters: '리포스터 없음' };
const TITLE: Record<Kind, string> = {
  replies: '이 트윗에 달린 답글을 불러와요 · 1회 $0.001',
  thread: '이어지는 타래를 불러와요 · 1회 $0.001',
  retweeters: '리포스트한 계정 목록을 불러와요 · 1회 $0.001',
};
const CANDIDATE_MIN_FOLLOWERS = 5000; // 시딩 후보 기준선(마이크로 인플루언서 하한) — 조정 지점

// 확장 탐색 — 클릭 시에만 호출(opt-in), 결과는 컴포넌트 상태로만 유지(DB 저장 없음)
// 단, 리포스터의 "섭외 후보" 저장은 예외적으로 별도 API(/api/scouts)로 영속화된다.
export function TweetExpansion({ tweetId, toolbarRight }: { tweetId: string; toolbarRight?: ReactNode }) {
  const params = useParams<{ wsId?: string }>();
  const wsId = params?.wsId;
  const { member } = useMember();
  const [kind, setKind] = useState<Kind | null>(null);
  const [tweets, setTweets] = useState<DeckTweet[]>([]);
  const [users, setUsers] = useState<ExpansionUser[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [savedHandles, setSavedHandles] = useState<Set<string>>(new Set());
  const [restOpen, setRestOpen] = useState(false);
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
        if (replace && wsId) {
          // 저장된 섭외 후보 표시용 — 실패해도 목록 표시 자체는 그대로 유지
          fetch(`/api/scouts?workspaceId=${encodeURIComponent(wsId)}`)
            .then((rr) => (rr.ok ? rr.json() : null))
            .then((jj: { scouts?: Array<{ handle: string }> } | null) => {
              if (gen !== genRef.current || !jj?.scouts) return;
              setSavedHandles(new Set(jj.scouts.map((s) => s.handle)));
            })
            .catch(() => {});
        }
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
    setKind(k); setTweets([]); setUsers([]); setCursor(null); setErr(''); setRestOpen(false);
    fetchPage(k, null, true);
  }

  async function toggleScout(u: ExpansionUser) {
    if (!wsId || !member) return; // 버튼 자체가 이 경우 비노출 — 방어적 가드
    const saved = savedHandles.has(u.handle);
    try {
      if (saved) {
        const r = await fetch(`/api/scouts?workspaceId=${encodeURIComponent(wsId)}&handle=${encodeURIComponent(u.handle)}`, { method: 'DELETE' });
        if (r.ok) setSavedHandles((prev) => { const next = new Set(prev); next.delete(u.handle); return next; });
      } else {
        const r = await fetch('/api/scouts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: wsId, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl, bio: u.bio,
            followers: u.followers, verified: u.verified, sourceTweetId: tweetId, memberId: member.id,
          }),
        });
        if (r.ok) setSavedHandles((prev) => new Set(prev).add(u.handle));
      }
    } catch {
      // 저장 실패는 조용히 무시 — 목록 표시(핵심 기능)는 영향 없음, 버튼은 저장 전 상태 유지
    }
  }

  const empty = kind === 'retweeters' ? users.length === 0 : tweets.length === 0;
  const sortedUsers = kind === 'retweeters' ? [...users].sort((a, b) => (b.followers ?? 0) - (a.followers ?? 0)) : [];
  const candidates = sortedUsers.filter((u) => (u.followers ?? 0) >= CANDIDATE_MIN_FOLLOWERS);
  const rest = sortedUsers.filter((u) => (u.followers ?? 0) < CANDIDATE_MIN_FOLLOWERS);

  function UserRow({ u }: { u: ExpansionUser }) {
    const saved = savedHandles.has(u.handle);
    return (
      <div className="border-b border-x-border py-1 last:border-b-0">
        <div className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
            : <div className="h-5 w-5 shrink-0 rounded-full bg-x-border-strong" />}
          <a href={`https://x.com/${u.handle}`} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-medium hover:underline">
            {u.name ?? u.handle}
          </a>
          {u.verified && <span className="shrink-0 text-x-blue" title="인증 계정">✓</span>}
          <span className="shrink-0 text-x-secondary">@{u.handle}</span>
          <span className="ml-auto shrink-0 text-caption text-x-muted">
            {[
              u.followers !== null ? `팔로워 ${formatCount(u.followers)}` : null,
              u.following !== null ? `팔로잉 ${formatCount(u.following)}` : null,
            ].filter(Boolean).join(' · ')}
          </span>
          {wsId && member && (
            <button
              onClick={() => toggleScout(u)}
              title={saved ? undefined : '보관함의 섭외 후보 목록에 저장해요'}
              className={`shrink-0 rounded px-1.5 py-0.5 text-caption hover:bg-x-hover ${saved ? 'text-x-blue' : 'text-x-secondary'}`}
            >
              {saved ? '★ 저장됨' : '☆ 섭외 후보'}
            </button>
          )}
        </div>
        {u.bio && <p className="truncate text-x-muted">{u.bio}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-0.5">
        {(Object.keys(LABEL) as Kind[]).map((k) => (
          <button key={k} onClick={() => toggle(k)} title={TITLE[k]}
                  className={`flex items-center gap-0.5 rounded-full px-2.5 py-1 text-ui hover:bg-x-text/5 ${kind === k ? 'bg-white font-medium text-x-text shadow-[inset_0_0_0_1px_var(--color-x-border-strong)]' : 'text-x-secondary'}`}>
            {LABEL[k]}{kind === k ? ' ✕' : <ChevronDownIcon className="h-3 w-3 opacity-60" />}
          </button>
        ))}
        {toolbarRight}
      </div>
      {kind && (
        <div className="mt-1 rounded-lg border border-x-border bg-white p-2 text-ui">
          {err && (
            <p className="text-caption text-red-500">
              {err} <button onClick={() => fetchPage(kind, cursor, empty)} className="underline">다시 시도</button>
            </p>
          )}
          {busy && empty && <p className="text-caption text-x-muted">불러오는 중…</p>}
          {kind !== 'retweeters' && tweets.map((t) => (
            <div key={t.tweetId} className="border-b border-x-border py-1 last:border-b-0">
              <span className="font-bold">{t.authorName ?? t.authorHandle}</span>
              <span className="text-x-secondary"> @{t.authorHandle} · ♥{formatCount(t.metrics.likes)}</span>
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
            </div>
          ))}
          {kind === 'retweeters' && users.length > 0 && (
            candidates.length > 0 ? (
              <p className="mb-1 font-medium text-x-text">
                ✦ 시딩 후보 {candidates.length}명 (팔로워 5천 이상){cursor ? ' · 더 불러오면 늘 수 있어요' : ''}
              </p>
            ) : (
              <p className="mb-1 text-x-muted">
                시딩 후보 없음 — 불러온 {users.length}명 전부 팔로워 5천 미만(일반 확산형){cursor ? ' · 더 보기로 추가 확인 가능' : ''}
              </p>
            )
          )}
          {/* 멤버 미선택 안내는 행마다 반복하지 않고 한 줄만 (행에서는 저장 버튼 비노출) */}
          {kind === 'retweeters' && users.length > 0 && wsId && !member && (
            <p className="mb-1 text-caption text-x-muted">후보를 저장하려면 사이드바에서 멤버를 선택하세요</p>
          )}
          {kind === 'retweeters' && candidates.map((u) => <UserRow key={u.handle} u={u} />)}
          {kind === 'retweeters' && rest.length > 0 && (
            <button onClick={() => setRestOpen((v) => !v)} className="mt-1 w-full rounded py-1 text-center text-caption text-x-blue hover:bg-x-hover">
              {restOpen ? `접기 (${rest.length}명)` : `${rest.length}명 더 보기(팔로워 5천 미만)`}
            </button>
          )}
          {kind === 'retweeters' && restOpen && rest.map((u) => <UserRow key={u.handle} u={u} />)}
          {!busy && !err && empty && <p className="text-caption text-x-muted">{EMPTY[kind]}</p>}
          {cursor && (
            <button onClick={() => fetchPage(kind, cursor, false)} disabled={busy}
                    className="mt-1 w-full rounded py-1 text-center text-caption text-x-blue hover:bg-x-hover disabled:opacity-50">
              {busy ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
