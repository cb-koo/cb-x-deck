// 표 필터 조건이 열의 수집 설정과 모순되는지 본다 (설계 2026-07-31 §C).
//
// 표 필터는 이미 모은 것에서만 좁힌다. 그래서 수집 기준보다
//  - 느슨한 조건은 아무 효과가 없고(사용자는 필터가 고장 났다고 오해)
//  - 반대 방향은 결과가 항상 0건이다(무엇을 해도 0건이라 더 헷갈린다)
// 실측(2026-07-31) 열 38개 중 29개가 수집 필터를 쓰고 있어 실재하는 함정이다.
import { FIELD_SPECS, type FilterCondition } from './tableFilter.ts';
import { formatFull } from './format.ts';
import type { ColumnRow, SearchConfig } from './types.ts';

export interface Conflict {
  conditionId: string;
  kind: 'noEffect' | 'alwaysEmpty';
  message: string;
}

// 축 → 수집 설정 키. 여기 없는 축은 대응 설정이 없어 경고하지 않는다.
const NUM_CONFIG_KEY: Partial<Record<FilterCondition['field'], keyof SearchConfig>> = {
  likes: 'minFaves', retweets: 'minRetweets', replies: 'minReplies', views: 'minViews',
};

// 선택 범위 안 열 전체(검색+인플루언서). 단수/요약 판정은 이 크기로 해야 한다 —
// 검색 열만 세면(searchConfigs 이후) 검색 열 하나 + 인플루언서 열 하나를 골라도
// "범위 안 열 1개"로 오판해 단수형("이 열은 …")을 쓰게 되고, 그 문장은 인플루언서 열까지
// 함께 보이는 표에서는 "어느 열 얘기인지" 대명사가 거짓이 된다.
function scopePool(columns: ColumnRow[], selectedIds: string[]): ColumnRow[] {
  return selectedIds.length > 0 ? columns.filter((c) => selectedIds.includes(c.id)) : columns;
}

function searchConfigs(columns: ColumnRow[], selectedIds: string[]): SearchConfig[] {
  return scopePool(columns, selectedIds).filter((c) => c.kind === 'search').map((c) => c.config as SearchConfig);
}

// total(선택 범위 안 열 전체 수 — 검색+인플루언서)이 1보다 크면 항상 요약형을 쓴다 — 걸린 열이 하나뿐이어도
// "이 열은 …"은 나머지 열까지 그 결론에 묶어버려 거짓이 된다(A2). 요약형만이 선택 전체에 대해 참이다.
function message(kind: Conflict['kind'], label: string, threshold: string, opWord: string, value: string, hitCount: number, total: number): string {
  if (total > 1) {
    if (kind === 'noEffect') return `선택한 열 중 ${hitCount}개는 ${label} ${threshold} 이상만 모아요`;
    return `선택한 열 중 ${hitCount}개는 ${label} ${threshold} 이상만 모아서 그 열에서는 한 건도 나오지 않아요`;
  }
  if (kind === 'noEffect') return `이 열은 ${label} ${threshold} 이상만 모으고 있어서 ${value}으로 낮춰도 더 나오지 않아요`;
  return `이 열은 ${label} ${threshold} 이상만 모으고 있어서 ${value} ${opWord}로는 한 건도 나오지 않아요`;
}

// 날짜 두 축(sinceDate/untilDate)의 메시지 — 숫자 축과 같은 패턴(요약형은 total>1이면 항상)이다.
// bound는 그 방향에서 가장 느슨한 기준일(호출부에서 이미 최솟값/최댓값으로 골라 넘긴다), boundWord는
// 그 기준이 "이후"(sinceDate)인지 "이전"(untilDate)인지 — 두 축이 같은 목소리로 읽히게 이 함수 하나로 만든다.
function dateMessage(kind: Conflict['kind'], bound: string, boundWord: '이후' | '이전', hitCount: number, total: number, value: string): string {
  if (total > 1) {
    if (kind === 'noEffect') return `선택한 열 중 ${hitCount}개는 ${bound} ${boundWord}만 모아요`;
    return `선택한 열 중 ${hitCount}개는 ${bound} ${boundWord}만 모아서 그 열에서는 한 건도 나오지 않아요`;
  }
  if (boundWord === '이후') {
    return kind === 'noEffect'
      ? `이 열은 ${bound} 이후만 모으고 있어서 ${value}으로 낮춰도 더 나오지 않아요`
      : `이 열은 ${bound} 이후만 모으고 있어서 ${value} 이전으로는 한 건도 나오지 않아요`;
  }
  return kind === 'noEffect'
    ? `이 열은 ${bound} 이전만 모으고 있어서 ${value}으로 올려도 더 나오지 않아요`
    : `이 열은 ${bound} 이전만 모으고 있어서 ${value} 이후로는 한 건도 나오지 않아요`;
}

export function findConflicts(
  conditions: FilterCondition[], columns: ColumnRow[], selectedColumnIds: string[],
): Conflict[] {
  const configs = searchConfigs(columns, selectedColumnIds);
  if (configs.length === 0) return [];
  // 단수/요약 판정은 검색 열 수가 아니라 선택 범위 전체의 열 수로 한다 — 검색 열 하나 +
  // 인플루언서 열 하나를 선택해도 "범위 안 열은 하나뿐"이 아니다(위 scopePool 주석 참조).
  const total = scopePool(columns, selectedColumnIds).length;
  const out: Conflict[] = [];

  for (const c of conditions) {
    const label = FIELD_SPECS[c.field]?.label ?? c.field;
    const numKey = NUM_CONFIG_KEY[c.field];

    if (numKey && (c.op === 'gte' || c.op === 'lte')) {
      const v = Number(c.value);
      // 조건보다 엄격하게(=크게) 수집하는 열들
      const stricter = configs.filter((cfg) => {
        const t = cfg[numKey] as number | null | undefined;
        return typeof t === 'number' && v < t;
      });
      if (stricter.length === 0) continue;
      // 여러 열이 다른 기준이면(100과 300) "300 이상만 모아요"는 100인 열엔 거짓이다.
      // 가장 느슨한(=가장 작은) 기준을 대야 선택된 모든 열에 대해 참이다.
      const loosest = Math.min(...stricter.map((cfg) => Number(cfg[numKey])));
      const kind = c.op === 'gte' ? 'noEffect' : 'alwaysEmpty';
      out.push({ conditionId: c.id, kind,
        message: message(kind, label, formatFull(loosest), '이하', formatFull(v), stricter.length, total) });
      continue;
    }

    if (c.field === 'date' && (c.op === 'after' || c.op === 'before')) {
      const v = c.value.trim();
      // 수집은 sinceDate 당일부터 포함한다(buildFilterSql의 'after' >= 와 동일).
      // 그래서 필터 값이 sinceDate와 같을 때:
      //  - 'before'(< v)는 수집 시작일 자체보다 앞을 요구하는 셈이라 항상 0건 → 등호도 경고한다.
      //  - 'after'(>= v)는 수집 하한과 정확히 같아질 뿐이라 단순 무효 → 등호는 조용히 넘어간다
      //    (문구가 "낮춰도"라 실제로 낮추지 않은 등호 상황에는 맞지 않는다).
      const sinceHits = configs.filter((cfg) =>
        typeof cfg.sinceDate === 'string' && (c.op === 'before' ? cfg.sinceDate! >= v : cfg.sinceDate! > v));
      if (sinceHits.length > 0) {
        // 여러 열이 걸리면 가장 이른(=가장 느슨한) sinceDate를 대야 모두에게 참이다.
        const loosest = sinceHits.map((cfg) => cfg.sinceDate!).sort()[0];
        const kind = c.op === 'after' ? 'noEffect' : 'alwaysEmpty';
        out.push({ conditionId: c.id, kind,
          message: dateMessage(kind, loosest, '이후', sinceHits.length, total, v) });
        continue;
      }
      // 수집은 untilDate 당일을 포함하지 않는다(X 검색 연산자 until:은 그 날짜를 뺀다.
      // queryBuilder.ts가 untilDate를 그대로 until:로 넘기고, 이 파일의 기존 문구도
      // "~ 이전만 모으고 있어서"로 buildFilterSql의 'before' < 와 같은 뜻을 쓰고 있었다).
      // 그래서 필터 값이 untilDate와 같을 때:
      //  - 'after'(>= v)는 수집 상한과 정확히 겹치지 않아(수집은 모두 < v) 항상 0건 → 등호도 경고한다.
      //  - 'before'(< v)는 수집 상한과 정확히 같은 경계라 단순 무효(중복) → 등호는 조용히 넘어간다.
      const untilHits = configs.filter((cfg) =>
        typeof cfg.untilDate === 'string' && (c.op === 'after' ? cfg.untilDate! <= v : cfg.untilDate! < v));
      if (untilHits.length > 0) {
        // 여러 열이 걸리면 가장 늦은(=가장 느슨한) untilDate를 대야 모두에게 참이다.
        const loosest = untilHits.map((cfg) => cfg.untilDate!).sort().reverse()[0];
        const kind = c.op === 'before' ? 'noEffect' : 'alwaysEmpty';
        out.push({ conditionId: c.id, kind,
          message: dateMessage(kind, loosest, '이전', untilHits.length, total, v) });
      }
    }
  }
  return out;
}

// 칩 줄에는 경고를 한 줄만 세운다(사용자 결정 2026-07-31). 여러 개일 때 무엇을 세울지가 판정이다.
// '항상 0건'은 '무효'보다 위험하다 — 무엇을 해도 안 나오는데 이유를 알 수 없기 때문이다.
// 같은 종류끼리는 조건이 놓인 순서를 따른다(사용자가 위에서부터 읽는다).
export function summarizeConflicts(
  conflicts: Conflict[],
): { primary: Conflict; extra: number } | null {
  if (conflicts.length === 0) return null;
  const primary = conflicts.find((c) => c.kind === 'alwaysEmpty') ?? conflicts[0];
  return { primary, extra: conflicts.length - 1 };
}
