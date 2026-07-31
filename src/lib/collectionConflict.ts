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

function searchConfigs(columns: ColumnRow[], selectedIds: string[]): SearchConfig[] {
  const pool = selectedIds.length > 0 ? columns.filter((c) => selectedIds.includes(c.id)) : columns;
  return pool.filter((c) => c.kind === 'search').map((c) => c.config as SearchConfig);
}

function message(kind: Conflict['kind'], label: string, threshold: string, opWord: string, value: string, hitCount: number, total: number): string {
  if (total > 1 && hitCount > 1) return `선택한 열 중 ${hitCount}개는 ${label} ${threshold} 이상만 모아요`;
  if (kind === 'noEffect') return `이 열은 ${label} ${threshold} 이상만 모으고 있어서 ${value}으로 낮춰도 더 나오지 않아요`;
  return `이 열은 ${label} ${threshold} 이상만 모으고 있어서 ${value} ${opWord}로는 한 건도 나오지 않아요`;
}

export function findConflicts(
  conditions: FilterCondition[], columns: ColumnRow[], selectedColumnIds: string[],
): Conflict[] {
  const configs = searchConfigs(columns, selectedColumnIds);
  if (configs.length === 0) return [];
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
      const worst = Math.max(...stricter.map((cfg) => Number(cfg[numKey])));
      const kind = c.op === 'gte' ? 'noEffect' : 'alwaysEmpty';
      out.push({ conditionId: c.id, kind,
        message: message(kind, label, formatFull(worst), '이하', formatFull(v), stricter.length, configs.length) });
      continue;
    }

    if (c.field === 'date' && (c.op === 'after' || c.op === 'before')) {
      const v = c.value.trim();
      // sinceDate보다 과거를 요구하면: '이후'는 무효, '이전'은 항상 0건
      const sinceHits = configs.filter((cfg) => typeof cfg.sinceDate === 'string' && cfg.sinceDate! > v);
      if (sinceHits.length > 0) {
        const worst = sinceHits.map((cfg) => cfg.sinceDate!).sort().reverse()[0];
        const kind = c.op === 'after' ? 'noEffect' : 'alwaysEmpty';
        out.push({ conditionId: c.id, kind,
          message: kind === 'noEffect'
            ? `이 열은 ${worst} 이후만 모으고 있어서 ${v}으로 낮춰도 더 나오지 않아요`
            : `이 열은 ${worst} 이후만 모으고 있어서 ${v} 이전으로는 한 건도 나오지 않아요` });
        continue;
      }
      // untilDate보다 미래를 요구하면: '이전'은 무효, '이후'는 항상 0건
      const untilHits = configs.filter((cfg) => typeof cfg.untilDate === 'string' && cfg.untilDate! < v);
      if (untilHits.length > 0) {
        const worst = untilHits.map((cfg) => cfg.untilDate!).sort()[0];
        const kind = c.op === 'before' ? 'noEffect' : 'alwaysEmpty';
        out.push({ conditionId: c.id, kind,
          message: kind === 'noEffect'
            ? `이 열은 ${worst} 이전만 모으고 있어서 ${v}으로 올려도 더 나오지 않아요`
            : `이 열은 ${worst} 이전만 모으고 있어서 ${v} 이후로는 한 건도 나오지 않아요` });
      }
    }
  }
  return out;
}
