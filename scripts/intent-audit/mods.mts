// 검색어 목록(MODS) 넓히기 검수 — 실제 검색어(자동완성 → 키워드 플래너 값)에서 '시술명 뒤에 붙는 말'을 뽑아,
// 여러 시술에 공통인 말을 목록에 더하면 DB에 없던 의도 검색을 얼마나 되찾는지 잰다. 반영 없음(계산만).
// 평가는 한 시술을 빼고 나머지에서 뽑은 말로(leave-one-out) — 자동완성 안 한 시술에 적용할 때와 같은 조건.
import { readFileSync, writeFileSync } from 'node:fs';
import { tagKeyword, norm } from '../../src/lib/searchIntent.ts';
import { MODS } from '../../src/lib/trendCollect.ts';

const B2B = '/Users/koo/orca/projects/b2b-marketing/reports/search-trends/data';
const D = (f: string) => new URL(`./data/${f}`, import.meta.url);
type Kp = { text: string; keywordMetrics?: { monthlySearchVolumes?: Array<{ monthlySearches?: string }> } };
const P = [
  { k: 'rejuran', name: 'リジュラン', kp: D('kp-rejuran.json'), db: D('db-rejuran.json') },
  { k: 'hifu', name: 'ハイフ', kp: D('kp-hifu.json'), db: D('db-hifu.json') },
  { k: 'potenza', name: 'ポテンツァ', kp: D('kp-potenza.json'), db: D('db-potenza.json') },
  { k: 'juvelook', name: 'ジュベルック', kp: `${B2B}/kp-juvelook/historical.json`, db: `${B2B}/juvelook_keywords.json` },
  { k: 'thermage', name: 'サーマクール', kp: `${B2B}/kp-thermage/historical.json`, db: `${B2B}/thermage_keywords.json` },
];
const y = (r: Kp) => { const mv = r.keywordMetrics?.monthlySearchVolumes ?? []; return mv.length === 48 ? mv.slice(-12).reduce((a, x) => a + Number(x.monthlySearches ?? 0), 0) / 12 : null; };
const INTENT = new Set(['info', 'effect', 'worry', 'concern', 'cost', 'place', 'korea']);
const cur = new Set(MODS.map(norm));

const data = P.map((p) => {
  const db = new Set((JSON.parse(readFileSync(p.db, 'utf8')) as Array<{ norm: string }>).map((r) => r.norm));
  const n = norm(p.name);
  const rows = (JSON.parse(readFileSync(p.kp, 'utf8')).results as Kp[]).flatMap((r) => {
    const v = y(r); if (v === null || v <= 0) return [];
    const tag = tagKeyword(r.text, [p.name]); if (!INTENT.has(tag)) return [];
    const t = norm(r.text);
    const mod = t.startsWith(n) && t.length > n.length ? t.slice(n.length) : null;  // 시술명 뒤에 붙은 말(목록은 '시술명 말' 꼴만 만든다)
    return [{ text: r.text, v, tag, inDb: db.has(t), mod }];
  });
  return { ...p, rows };
});

// 말마다: 몇 개 시술에서 나왔나, 합계 검색량
const stat = new Map<string, { procs: Set<string>; v: number; tag: string }>();
for (const p of data) for (const r of p.rows) if (r.mod) {
  const s = stat.get(r.mod) ?? { procs: new Set(), v: 0, tag: r.tag }; s.procs.add(p.k); s.v += r.v; stat.set(r.mod, s);
}
const pick = (exclude: string | null, minProcs: number) =>
  new Set([...stat].filter(([m, s]) => !cur.has(m) && [...s.procs].filter((k) => k !== exclude).length >= minProcs).map(([m]) => m));

const out: string[] = [];
for (const minProcs of [2, 3]) {
  out.push(`\n### 다른 시술 ${minProcs}개 이상에서 나온 말을 더하면 (평가 시술은 빼고 뽑음)`);
  out.push('시술|DB에 없던 의도 검색(월)|되찾음(월)|비율|되찾은 상위');
  for (const p of data) {
    const mods = pick(p.k, minProcs);
    const miss = p.rows.filter((r) => !r.inDb);
    const got = miss.filter((r) => r.mod && (mods.has(r.mod) || cur.has(r.mod)));
    const M = miss.reduce((a, r) => a + r.v, 0), G = got.reduce((a, r) => a + r.v, 0);
    out.push(`${p.k}|${Math.round(M).toLocaleString()}|${Math.round(G).toLocaleString()}|${Math.round(G / M * 100)}%|${got.sort((a, b) => b.v - a.v).slice(0, 4).map((r) => `${r.text}=${Math.round(r.v)}`).join(', ')}`);
  }
}
// 못 되찾는 것의 성격 — 시술명이 앞에 오지 않는 꼴 / 그 시술에만 있는 말
for (const p of data) {
  const mods = pick(p.k, 2);
  const left = p.rows.filter((r) => !r.inDb && !(r.mod && (mods.has(r.mod) || cur.has(r.mod))));
  const pre = left.filter((r) => !r.mod).reduce((a, r) => a + r.v, 0), own = left.filter((r) => r.mod).reduce((a, r) => a + r.v, 0);
  out.push(`${p.k} 못 되찾는 것: 시술명이 뒤에 오는 꼴 월 ${Math.round(pre).toLocaleString()} / 그 시술에만 있는 말 월 ${Math.round(own).toLocaleString()} — 상위 ${left.sort((a, b) => b.v - a.v).slice(0, 5).map((r) => `${r.text}=${Math.round(r.v)}`).join(', ')}`);
}
const cand = [...stat].filter(([m, s]) => !cur.has(m) && s.procs.size >= 2).sort((a, b) => b[1].procs.size - a[1].procs.size || b[1].v - a[1].v);
out.push(`\n### 후보 말 ${cand.length}개 (2개 시술 이상, 지금 목록 17개 제외)`);
out.push(`3개 이상 ${cand.filter(([, s]) => s.procs.size >= 3).length}개`);
writeFileSync(D('mods-candidates.csv'), '﻿mod,procs,tag,monthly_sum,procedures\n' + cand.map(([m, s]) => `${m},${s.procs.size},${s.tag},${Math.round(s.v)},${[...s.procs].join(' ')}`).join('\n'));
console.log(out.join('\n'));
