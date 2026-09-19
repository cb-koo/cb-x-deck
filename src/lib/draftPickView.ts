import type { DraftRow } from './draftStore.ts';
import { draftLabel } from './draftViews.ts';

// '있는 원고 고르기'(§5-3)와 시안 카드가 함께 쓰는 표시 규칙 — 컴포넌트는 그리기만 한다.
export function candidateLine(d: DraftRow): { title: string; body: string; meta: string } {
  const src = d.edited ?? d.content;
  const body = (src.posts[0]?.text ?? '').split('\n')[0].trim();
  const parts = [d.format === 'thread' ? `스레드 ${src.posts.length}` : '단문'];
  if (d.variantIndex !== null && d.variantIndex !== undefined) parts.push(`시안 ${'ABCDE'[d.variantIndex] ?? d.variantIndex + 1}`);
  return { title: draftLabel(d).text, body, meta: parts.join(' · ') };
}

// 검색 한 칸이 두 묶음에 함께 걸린다(§5-3) — 제목과 본문 첫 줄을 본다. 공백만이면 전부 통과.
export function searchDraftCandidates(rows: DraftRow[], q: string): DraftRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((d) => {
    const { title, body } = candidateLine(d);
    return title.toLowerCase().includes(s) || body.toLowerCase().includes(s);
  });
}
