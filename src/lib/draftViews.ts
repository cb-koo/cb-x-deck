import { DRAFT_STATUSES, type DraftStatus } from '@/lib/draftStatus';

// 뷰 공용 파생 — 테이블·칸반이 같은 계산을 쓰도록 순수 함수로 (스펙 2차 §draftViews)
interface PreviewSource { posts: Array<{ text: string }> }

export function draftPreviewLine(d: { content: PreviewSource; edited: PreviewSource | null }): string {
  const text = (d.edited ?? d.content).posts[0]?.text ?? '';
  return (text.split('\n')[0] ?? '').trim();
}

// campaignTaskStore.toRow의 draftPreview와 같은 게이트(전문, 자르지 않음·빈 값은 null) — 패널 카드가
// 다시 쓰기·재생성 직후에도 표(작업 행)와 같은 문구를 보이려면 이 규칙을 공유해야 한다(TaskRow.draftPreview).
export function draftPreviewFull(d: { content: PreviewSource; edited: PreviewSource | null }): string | null {
  const text = (d.edited ?? d.content).posts[0]?.text ?? '';
  return text.trim() ? text : null;
}

interface PreviewMediaSource { posts: Array<{ media: Array<{ url: string }> }> }

// TaskRow.draftFirstImage와 같은 계산(첫 포스트 첫 미디어 url) — mergeRow가 draft 편집 직후 표를 맞추는 용도.
export function draftFirstMediaUrl(d: { content: PreviewMediaSource; edited: PreviewMediaSource | null }): string | null {
  return (d.edited ?? d.content).posts[0]?.media[0]?.url ?? null;
}

// 캐시된 한국어 대역의 첫 줄 — 없으면 null(호출부가 원문 미리보기로 폴백)
export function draftKoLine(d: { koLatest: string[] | null }): string | null {
  const t = d.koLatest?.[0];
  if (!t) return null;
  const line = (t.split('\n')[0] ?? '').trim();
  return line || null;
}

// 목록·보드 항목 라벨 폴백 체인 — 사람이 붙인 제목 → 자동 제목 → 한국어 대역 첫 줄 → 원문 첫 줄
// (5차 스펙 §표시를 2026-08-13 설계 §A로 확장). 사람이 붙인 제목이 맨 앞인 이유는 그것만이
// 본문 편집에도 살아남는 값이라, 사용자가 "내가 지은 이름"으로 원고를 찾을 수 있어야 하기 때문이다.
export function draftLabel(d: { title: string | null; koTitle: string | null; koLatest: string[] | null; content: PreviewSource; edited: PreviewSource | null }):
  { text: string; kind: 'title' | 'ko' | 'original' } {
  const manual = d.title?.trim();
  if (manual) return { text: manual, kind: 'title' };
  if (d.koTitle) return { text: d.koTitle, kind: 'title' };
  const ko = draftKoLine(d);
  if (ko) return { text: ko, kind: 'ko' };
  return { text: draftPreviewLine(d) || '(내용 없음)', kind: 'original' };
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

// 검색 — 공백 분리 토큰 전부(AND)가 이름·제목·대역·원문(최신 버전)·방향성 중 어딘가에 포함(대소문자 무시).
// 사람이 붙인 title이 맨 앞인 이유는 그것이 사용자가 "이 원고"라고 부르는 이름이기 때문이다 —
// 이름을 붙여놓고 그 이름으로 못 찾으면 이름을 붙일 이유가 없다(2026-08-13 누락 수정).
export function searchDrafts<T extends {
  title: string | null; koTitle: string | null; koLatest: string[] | null; direction: string;
  content: PreviewSource; edited: PreviewSource | null;
}>(list: T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return list;
  return list.filter((d) => {
    const hay = [
      d.title ?? '', d.koTitle ?? '', ...(d.koLatest ?? []),
      ...(d.edited ?? d.content).posts.map((p) => p.text),
      d.direction,
    ].join('\n').toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function filterByProcedure<T extends { procedureNames: string[] }>(list: T[], name: string): T[] {
  return name ? list.filter((d) => d.procedureNames.includes(name)) : list;
}

export type Period = 'all' | 'today' | '7d' | '30d';

// now를 인자로 받아 순수 유지. 'today'는 로컬 자정 기준(사용자 시간대 = 서울 운영 전제, relTime 관례)
export function filterByPeriod<T extends { createdAt: string }>(list: T[], period: Period, now: number): T[] {
  if (period === 'all') return list;
  let start: number;
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); start = d.getTime(); }
  else start = now - (period === '7d' ? 7 : 30) * 86_400_000;
  return list.filter((x) => Date.parse(x.createdAt) >= start);
}

// 시술 필터 옵션 — 실제 존재하는 시술만(거짓 어포던스 방지), 유니크·가나다
export function procedureOptions(list: Array<{ procedureNames: string[] }>): string[] {
  return [...new Set(list.flatMap((d) => d.procedureNames))].sort((a, b) => a.localeCompare(b, 'ko'));
}

// 기간 렌즈 값 — 프리셋 또는 직접 지정 범위('YYYY-MM-DD', 빈 문자열=단측 개방)
export type PeriodValue = { kind: 'preset'; preset: Period } | { kind: 'range'; from: string; to: string };

// 'YYYY-MM-DD' → 로컬 자정 타임스탬프. 형식이 아니면 null(미적용)
function localDayStart(d: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

// 역전 범위(시작>끝)는 적용하지 않고 전체 반환 — 호출부(PeriodPicker)가 안내 캡션 담당
export function isRangeInverted(value: PeriodValue): boolean {
  return value.kind === 'range' && !!value.from && !!value.to && value.from > value.to;
}

export function applyPeriod<T extends { createdAt: string }>(list: T[], value: PeriodValue, now: number): T[] {
  if (value.kind === 'preset') return filterByPeriod(list, value.preset, now);
  if (isRangeInverted(value)) return list;
  const from = value.from ? localDayStart(value.from) : null;
  const toStart = value.to ? localDayStart(value.to) : null;
  const to = toStart !== null ? toStart + 86_400_000 : null; // 끝 날짜 포함 — 다음날 자정 미만
  return list.filter((x) => {
    const t = Date.parse(x.createdAt);
    return (from === null || t >= from) && (to === null || t < to);
  });
}

export function formatPeriodLabel(value: PeriodValue): string {
  if (value.kind === 'preset') {
    return value.preset === 'all' ? '전체 기간' : value.preset === 'today' ? '오늘'
      : value.preset === '7d' ? '최근 7일' : '최근 30일';
  }
  const md = (s: string) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s); return m ? `${Number(m[1])}.${Number(m[2])}` : s; };
  if (value.from && value.to) return `${md(value.from)} – ${md(value.to)}`;
  if (value.from) return `${md(value.from)} 이후`;
  if (value.to) return `${md(value.to)}까지`;
  return '전체 기간';
}
