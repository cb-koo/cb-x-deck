import type { DraftRow } from './draftStore.ts';
import { draftLabel } from './draftViews.ts';
import { X_MAX_WEIGHTED, xWeightedLength } from './xLength.ts';
import type { DeckMedia } from './types.ts';

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

// 직접 쓰기(§5-2)의 컴포저 한 칸 — DraftPost와 모양은 같지만 아직 저장된 초안이 아니라 화면 로컬 상태다.
// uploading은 '지금 이 칸에서 올라가는 중인 이미지 수'를 칸 자체에 붙인 값이다(리뷰 지적 1·2) — 부모가
// 따로 인덱스로 관리하는 맵을 두면 칸이 지워지거나 순서가 바뀔 때 값이 엉뚱한 칸에 남을 수 있다(같은
// 파일의 rejectMsg가 실제로 그 사고를 겪었다). posts 배열 항목에 실어 두면 filter·map 같은 배열 연산이
// 칸을 지우거나 옮길 때 이 값도 함께 따라가므로 따로 청소할 필요가 없다.
export interface ComposerPost { text: string; media: DeckMedia[]; uploading: number }

// 직접 쓰기(§5-2) 저장 판정 — 스레드의 모든 칸이 비지 않고 각 칸이 X 상한 안이어야 한다.
// 빈 칸을 허용하면 X에 올릴 수 없는 글이 저장되고, 사용자는 저장된 뒤에야 안다.
// 판정도 저장과 같은 문자열(trim)을 잰다(리뷰 minor) — 안 그러면 뒤 공백만 있는 글이 "글자 수 초과"로
// 잘못 막히거나, 반대로 트림하면 상한 안인데 원문 기준으로는 넘는다고 잘못 통과시킬 수 있다.
export function composerCanSave(posts: ComposerPost[]): boolean {
  if (posts.length === 0) return false;
  return posts.every((p) => {
    const t = p.text.trim();
    return t.length > 0 && xWeightedLength(t) <= X_MAX_WEIGHTED;
  });
}
