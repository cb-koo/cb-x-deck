'use client';
import { useState } from 'react';
import type { TaskReply } from '@/lib/campaignStore';

// 인플 본인 댓글(추가 콘텐츠) — 본 게시물 카드 아래 접힌 한 줄(스펙 2026-10-06-self-replies-design.md §6).
// 0개면 아무것도 그리지 않는다. 펼치면 댓글마다 카드 하나: 본문 2줄 + 정보 한 줄(링크 칩 · 본 게시물 뒤 시간 · 조회 · X에서 열기).
// 성과 숫자(조회·좋아요)는 본 게시물만 센다 — 도움말 한 줄이 그 사실을 말한다(UX 원칙 2·3).
export function SelfRepliesBox({ replies }: { replies: TaskReply[] }) {
  const [open, setOpen] = useState(false);
  if (replies.length === 0) return null;
  return (
    <div className="mt-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="inline-flex h-9 items-center gap-1 rounded-full px-1 text-[14px] font-semibold text-x-secondary hover:text-x-text">
        인플 댓글 {replies.length}개 <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-2">
          {replies.map((r) => (
            <div key={r.tweetId} className="rounded-2xl border border-x-border bg-white px-3.5 py-2.5">
              <p className="line-clamp-2 whitespace-pre-line break-words text-content text-x-text">{r.text || '(본문 없음)'}</p>
              <div className="mt-1.5 flex min-w-0 items-center gap-2 whitespace-nowrap text-[14px] text-x-secondary">
                {r.link && (
                  <a href={r.link} target="_blank" rel="noopener noreferrer" title={r.link}
                     className="min-w-0 truncate rounded-full border border-x-border bg-x-surface px-2.5 py-0.5 text-x-blue-text hover:underline">
                    {r.link.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {r.afterMain && <span className="shrink-0">본 게시물 {r.afterMain} 뒤</span>}
                <span className="shrink-0">조회 {r.views === null ? '—' : r.views.toLocaleString('ko-KR')}</span>
                <a href={r.url} target="_blank" rel="noopener noreferrer" aria-label="X에서 댓글 열기" title="X에서 열기"
                   className="ml-auto shrink-0 px-1 text-x-blue-text hover:underline">↗</a>
              </div>
            </div>
          ))}
          <p className="text-[14px] text-x-muted">인플이 단 댓글은 게시 확인·성과 업데이트 때 자동으로 찾아요 · 성과 숫자엔 더하지 않아요</p>
        </div>
      )}
    </div>
  );
}
