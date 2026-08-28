// 정산 설정(스펙 2026-08-28 §2-2) — 순수. 저장·버전은 settlementStore가, 규칙 적용은 settlementCalc가.
import { TASK_TYPES, TASK_TYPE_LABEL, type TaskType } from './campaignJudgment.ts';

export interface SettlementCategory {
  id: string;            // 화면 편집용 안정 키(uuid 문자열이면 충분, 형식 검증 없음)
  label: string;         // 표시명
  sendAs: string;        // 정산 쪽 이름 — payment_request.category에 스냅샷되는 값
  hidden: boolean;       // 새 요청 드롭다운에서만 숨김. 기존 요청 표시엔 영향 없음
  defaultFor: TaskType[];// 이 유형의 기본값. 한 유형은 한 옵션에만
}
export interface SettlementSettings { categories: SettlementCategory[]; rateKrwPerJpy: number }

// 첫 화면부터 동작하는 기본값 — 슬랙 3채널 실데이터의 분류 3종. 인용RT는 어느 옵션에도 없다(요청자 최근 선택, calc §3-3).
export const SETTLEMENT_DEFAULTS: SettlementSettings = {
  categories: [
    { id: 'promo-rt', label: '프로모션 RT·인용RT', sendAs: '마케팅비 > X(트위터) 프로모션 RT·인용RT', hidden: false, defaultFor: ['rt'] },
    { id: 'fee', label: '인플루언서 협찬 원고료', sendAs: '마케팅비 > X(트위터) 인플루언서 협찬 원고료', hidden: false, defaultFor: [] },
    { id: 'info-post', label: '정보성콘텐츠 업로드 (게시물)', sendAs: '마케팅비 > X(트위터) 정보성콘텐츠 업로드 (게시물)', hidden: false, defaultFor: [] },
  ],
  rateKrwPerJpy: 10,
};
// 캠페인 종류 규칙(§3-3 2단계)이 가리키는 옵션 id — calc가 쓴다
export const CATEGORY_ID_FEE = 'fee';
export const CATEGORY_ID_INFO = 'info-post';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function sanitizeSettlementSettings(v: unknown): SettlementSettings | string {
  if (!v || typeof v !== 'object') return '설정 형식이 올바르지 않아요';
  const o = v as { categories?: unknown; rateKrwPerJpy?: unknown };
  if (!Array.isArray(o.categories) || o.categories.length === 0) return '분류가 하나 이상 필요해요';
  const categories: SettlementCategory[] = [];
  const ids = new Set<string>();
  const seenType = new Map<TaskType, string>();
  for (const raw of o.categories as unknown[]) {
    const c = (raw ?? {}) as { id?: unknown; label?: unknown; sendAs?: unknown; hidden?: unknown; defaultFor?: unknown };
    const id = str(c.id); const label = str(c.label); const sendAs = str(c.sendAs);
    if (!id) return '분류 id가 비어 있어요';
    if (ids.has(id)) return '분류 id가 겹쳐요';
    ids.add(id);
    if (!label) return '분류 이름을 입력해 주세요';
    if (!sendAs) return '정산 쪽 이름을 입력해 주세요';
    const hidden = c.hidden === true;
    const defaultFor: TaskType[] = [];
    for (const t of Array.isArray(c.defaultFor) ? c.defaultFor : []) {
      if (!(TASK_TYPES as readonly string[]).includes(String(t))) return '알 수 없는 작업 유형이에요';
      const tt = t as TaskType;
      if (seenType.has(tt)) return `한 유형은 한 분류의 기본값으로만 둘 수 있어요 (${TASK_TYPE_LABEL[tt]})`;
      seenType.set(tt, id);
      if (!defaultFor.includes(tt)) defaultFor.push(tt);
    }
    categories.push({ id, label, sendAs, hidden, defaultFor });
  }
  const rate = o.rateKrwPerJpy;
  if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 1) return '환율은 1 이상 정수예요';
  return { categories, rateKrwPerJpy: rate };
}

export function visibleCategories(s: SettlementSettings): SettlementCategory[] {
  return s.categories.filter((c) => !c.hidden);
}
export function categoryBySendAs(s: SettlementSettings, sendAs: string | null): SettlementCategory | null {
  if (!sendAs) return null;
  return s.categories.find((c) => c.sendAs === sendAs) ?? null;
}
export function defaultCategoryFor(s: SettlementSettings, type: TaskType): SettlementCategory | null {
  return visibleCategories(s).find((c) => c.defaultFor.includes(type)) ?? null;
}
