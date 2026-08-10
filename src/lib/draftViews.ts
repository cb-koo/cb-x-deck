import { DRAFT_STATUSES, type DraftStatus } from '@/lib/draftStatus';

// 뷰 공용 파생 — 테이블·칸반이 같은 계산을 쓰도록 순수 함수로 (스펙 2차 §draftViews)
interface PreviewSource { posts: Array<{ text: string }> }

export function draftPreviewLine(d: { content: PreviewSource; edited: PreviewSource | null }): string {
  const text = (d.edited ?? d.content).posts[0]?.text ?? '';
  return (text.split('\n')[0] ?? '').trim();
}

// 캐시된 한국어 대역의 첫 줄 — 없으면 null(호출부가 원문 미리보기로 폴백)
export function draftKoLine(d: { koLatest: string[] | null }): string | null {
  const t = d.koLatest?.[0];
  if (!t) return null;
  const line = (t.split('\n')[0] ?? '').trim();
  return line || null;
}

export type TableSortKey = 'createdAt' | 'client' | 'status';
export interface TableSort { key: TableSortKey; dir: 'asc' | 'desc' }

// 원본 불변. client 정렬은 표시명 기준이라 이름 해석 함수를 받는다(한국어 locale 비교).
export function sortDrafts<T extends { createdAt: string; clientId: string | null; status: DraftStatus }>(
  list: T[], sort: TableSort, clientNameOf: (id: string | null) => string,
): T[] {
  const flip = sort.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    if (sort.key === 'client') return clientNameOf(a.clientId).localeCompare(clientNameOf(b.clientId), 'ko') * flip;
    const x = sort.key === 'createdAt' ? Date.parse(a.createdAt) : DRAFT_STATUSES.indexOf(a.status);
    const y = sort.key === 'createdAt' ? Date.parse(b.createdAt) : DRAFT_STATUSES.indexOf(b.status);
    return (x - y) * flip;
  });
}

// 칸반 열 데이터 — 5개 상태 열이 항상 존재, 열 내부는 최신순
export function groupByStatus<T extends { status: DraftStatus; createdAt: string }>(list: T[]): Record<DraftStatus, T[]> {
  const out = Object.fromEntries(DRAFT_STATUSES.map((s) => [s, [] as T[]])) as Record<DraftStatus, T[]>;
  for (const d of list) out[d.status].push(d);
  for (const s of DRAFT_STATUSES) out[s].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return out;
}
