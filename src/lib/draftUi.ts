import type { DraftContent } from './draftTypes.ts';
import { draftFlags, flagKey, type DraftFlag } from './complianceFlags.ts';
import type { DraftStatus } from './draftStatus.ts';

// 첫 단락 = 훅 (스펙 '산출물 규격'). 첫 빈 줄이 경계. 없거나 내용이 뒤에 없으면 null.
export function hookBoundary(text: string): { hook: string; rest: string } | null {
  const i = text.indexOf('\n\n');
  if (i <= 0) return null;
  const rest = text.slice(i + 2);
  if (!rest.trim()) return null;
  return { hook: text.slice(0, i), rest };
}

// 복사 형식 (스펙 §4): 단문=본문 그대로, 스레드=--- 구분 전체
export function draftCopyText(content: DraftContent): string {
  return content.posts.map((p) => p.text).join('\n\n---\n\n');
}

export function draftTimeLabel(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export interface PostFlag { postIndex: number; flag: DraftFlag; key: string; dismissed: boolean }

// 렌더 시 재계산 원칙(스펙 §3) — dismissed_flags만 영속이고 표식 자체는 매번 새로 계산
export function collectDraftFlags(
  content: DraftContent, banned: string[], dismissed: string[],
): PostFlag[] {
  const out: PostFlag[] = [];
  const seen = new Set<string>();
  content.posts.forEach((p, postIndex) => {
    for (const flag of draftFlags(p.text, banned)) {
      const key = flagKey(flag);
      const uniq = `${postIndex}:${key}`;
      if (seen.has(uniq)) continue;
      seen.add(uniq);
      out.push({ postIndex, flag, key, dismissed: dismissed.includes(key) });
    }
  });
  return out;
}

// 편집 모달 dirty 판정 (스펙 3-3) — 열 때의 본문과 현재 입력이 하나라도 다르면 true
export function textsChanged(base: string[], current: string[]): boolean {
  return base.length !== current.length || base.some((t, i) => t !== current[i]);
}

// 레퍼런스 시트 dirty 판정 (스펙 3-4) — 선택 id 집합이 다르면 true (순서 무관)
export function idSetChanged(a: string[], b: string[]): boolean {
  return [...a].sort().join('\0') !== [...b].sort().join('\0');
}

// 취소 후 폴링 병합 (스펙 3-5) — 목록에 없는 id이면서 생성 시작 이후 만들어진 것만.
// sinceMs 기준이 없으면 '삭제 대기 중(5초 실행취소)'인 옛 초안이 폴링으로 되살아난다.
export function newDraftsSince<T extends { id: string; createdAt: string }>(
  cur: T[], fetched: T[], sinceMs: number,
): T[] {
  const known = new Set(cur.map((d) => d.id));
  return fetched.filter((d) => !known.has(d.id) && Date.parse(d.createdAt) >= sinceMs);
}

// /generate 목록 필터 (스펙 3-1) — clientId: '' 전체 · 'none' 클라이언트 없음 · 그 외 해당 id
// 'none'에는 클라이언트 삭제로 고아가 된 초안(client_id ON DELETE SET NULL)도 포함된다.
export interface DraftListFilter { status: DraftStatus | 'all'; clientId: string }

export function filterDrafts<T extends { status: DraftStatus; clientId: string | null }>(
  drafts: T[], f: DraftListFilter,
): T[] {
  return drafts.filter((d) =>
    (f.status === 'all' || d.status === f.status) &&
    (f.clientId === '' || (f.clientId === 'none' ? d.clientId === null : d.clientId === f.clientId)));
}

export function statusCounts(drafts: Array<{ status: DraftStatus }>): Record<DraftStatus, number> {
  const out: Record<DraftStatus, number> = { draft: 0, review: 0, approved: 0, delivered: 0, unused: 0 };
  for (const d of drafts) out[d.status] += 1;
  return out;
}
