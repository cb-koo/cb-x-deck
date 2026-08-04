import type { DraftContent } from './draftTypes.ts';
import { draftFlags, flagKey, type DraftFlag } from './complianceFlags.ts';

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
