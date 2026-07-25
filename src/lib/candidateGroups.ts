import type { CandidateRow, StoredTweet } from './types.ts';
import type { LibraryEntry } from './candidateStore.ts';

// 보관함 공유 코멘트 뷰: 콘텐츠(tweet)당 카드 1장, 멤버별 candidate 행이 코멘트가 된다.
// 그룹핑·필터는 클라이언트 순수 함수 — 스키마·API 무변경 (spec: 2026-07-13-library-shared-comments-design.md)
export interface CandidateGroup {
  tweet: StoredTweet;          // savedBy = 그룹 멤버 합집합
  entries: CandidateRow[];     // 저장 시각 오름차순 (먼저 단 코멘트가 위)
  latestSavedAt: string;
}

export function groupCandidates(rows: CandidateRow[]): CandidateGroup[] {
  const byTweet = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    const list = byTweet.get(r.tweet.tweetId);
    if (list) list.push(r); else byTweet.set(r.tweet.tweetId, [r]);
  }
  const groups: CandidateGroup[] = [];
  for (const entries of byTweet.values()) {
    entries.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    const latest = entries[entries.length - 1];
    groups.push({
      tweet: { ...latest.tweet, savedBy: entries.map((e) => e.member) },
      entries,
      latestSavedAt: latest.savedAt,
    });
  }
  groups.sort((a, b) => b.latestSavedAt.localeCompare(a.latestSavedAt));
  return groups;
}

export function filterGroups(
  groups: CandidateGroup[],
  where: { memberId?: string | null; tag?: string | null },
): CandidateGroup[] {
  if (!where.memberId && !where.tag) return groups;
  return groups.filter((g) =>
    (!where.memberId || g.entries.some((e) => e.member.id === where.memberId)) &&
    (!where.tag || g.entries.some((e) => e.tags.some((t) => t.name === where.tag))));
}

export function filterLibrary(
  entries: LibraryEntry[],
  where: { memberId?: string | null; tag?: string | null },
): LibraryEntry[] {
  if (!where.memberId && !where.tag) return entries;
  return entries.filter((e) =>
    (!where.memberId || e.candidates.some((c) => c.member.id === where.memberId)) &&
    (!where.tag || e.candidates.some((c) => c.tags.some((t) => t.name === where.tag))));
}
