// 자동완성 입력별 수확 — DB에 없던 의도 검색(월)을 처음 찾아 준 입력으로 나눈다(시술명만 / 가나 행 / 추가 입력). 계산만.
import { readFileSync } from 'node:fs';
import { tagKeyword, norm } from '../../src/lib/searchIntent.ts';
const D = (f: string) => new URL(`./data/${f}`, import.meta.url);
const NAME: Record<string, string> = { rejuran: 'リジュラン', hifu: 'ハイフ', potenza: 'ポテンツァ' };
const INTENT = new Set(['info', 'effect', 'worry', 'concern', 'cost', 'place', 'korea']);
for (const k of Object.keys(NAME)) {
  const ac = JSON.parse(readFileSync(D(`autocomplete-${k}.json`), 'utf8')) as Record<string, string[]>;
  const db = new Set((JSON.parse(readFileSync(D(`db-${k}.json`), 'utf8')) as Array<{ norm: string }>).map((r) => r.norm));
  const vol = new Map<string, number>();
  for (const r of JSON.parse(readFileSync(D(`kp-${k}.json`), 'utf8')).results as Array<{ text: string; keywordMetrics?: { monthlySearchVolumes?: Array<{ monthlySearches?: string }> } }>) {
    const mv = r.keywordMetrics?.monthlySearchVolumes ?? []; if (mv.length !== 48) continue;
    if (!INTENT.has(tagKeyword(r.text, [NAME[k]]))) continue;
    vol.set(norm(r.text), mv.slice(-12).reduce((a, x) => a + Number(x.monthlySearches ?? 0), 0) / 12);
  }
  const seen = new Set<string>(); const by: Record<string, number> = {}; let all = 0;
  const groups = Object.keys(ac).map((q) => [q, q.trim() === NAME[k] ? '1 시술명만' : /^\S+ [あかさたなはまやらわ]$/.test(q) ? '2 가나 행' : '3 추가 입력'] as const);
  for (const [g] of [['1 시술명만'], ['2 가나 행'], ['3 추가 입력']]) for (const [q, gg] of groups) if (gg === g) for (const s of ac[q]) {
    const n = norm(s); if (seen.has(n)) continue; seen.add(n);
    const v = vol.get(n); if (v === undefined || db.has(n)) continue; by[g] = (by[g] ?? 0) + v; all += v;
  }
  console.log(k, Object.entries(by).sort().map(([g, v]) => `${g} ${Math.round(v).toLocaleString()} (${Math.round(v / all * 100)}%)`).join(' / '));
}
