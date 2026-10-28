// 1번 문제 쪼개기 — (가) 시범 3개: 자동완성으로만 찾은 검색어가 의도 검색량의 몇 %인가(수집 부족),
// (나) 전 시술: 지금 규칙이 '기타'로 못 알아본 검색량(규칙 부족). 운영 DB 읽기 전용.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { tagKeyword, norm } from '../../src/lib/searchIntent.ts';
const D = (f: string) => new URL(`./data/${f}`, import.meta.url);
const y = (s: number[]) => s.slice(-12).reduce((a, b) => a + b, 0);
const NAME: Record<string, string> = { rejuran: 'リジュラン', hifu: 'ハイフ', potenza: 'ポテンツァ' };
for (const k of Object.keys(NAME)) {
  const db = new Set((JSON.parse(readFileSync(D(`db-${k}.json`), 'utf8')) as Array<{ norm: string }>).map((r) => r.norm));
  const kp = JSON.parse(readFileSync(D(`kp-${k}.json`), 'utf8')).results as Array<{ text: string; keywordMetrics?: { monthlySearchVolumes?: Array<{ monthlySearches?: string }> } }>;
  let inDb = 0, newOnly = 0; const tops: Array<[string, number, string]> = [];
  for (const r of kp) {
    const mv = r.keywordMetrics?.monthlySearchVolumes ?? []; if (mv.length !== 48) continue;
    const v = y(mv.map((x) => Number(x.monthlySearches ?? 0))); const tag = tagKeyword(r.text, [NAME[k]]);
    if (['name', 'exclude', 'noise'].includes(tag)) continue;
    if (db.has(norm(r.text))) inDb += v; else { newOnly += v; tops.push([r.text, Math.round(v / 12), tag]); }
  }
  tops.sort((a, b) => b[1] - a[1]);
  console.log(`${k}: 의도 검색 중 DB에 없던 것 ${Math.round(newOnly / (inDb + newOnly) * 100)}% (월 ${Math.round(newOnly / 12).toLocaleString()}) 상위 ${tops.slice(0, 5).map((t) => t.join(':')).join(', ')}`);
}
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const rows = await sql.begin('read only', (tx) => tx<Array<{ text: string; jp: string; name: string; series: number[] | null; source: string; intent_override: string | null }>>`
    select k.text, p.jp, p.name, k.series, k.source, k.intent_override from trend_keyword k join trend_procedure p on p.id = k.procedure_id
    where k.market = 'jp' and not p.hidden and k.series is not null`);
  const sum: Record<string, number> = {}; const other: Record<string, number> = {}; const otherKw: Array<[string, string, number]> = [];
  for (const r of rows) {
    const t = (r.intent_override ?? (r.source === 'korea' ? 'korea' : tagKeyword(r.text, [r.jp]))) as string; const v = y(r.series!);
    sum[t] = (sum[t] ?? 0) + v;
    if (t === 'other') { other[r.name] = (other[r.name] ?? 0) + v; otherKw.push([r.name, r.text, Math.round(v / 12)]); }
  }
  const intentTotal = ['info', 'effect', 'worry', 'concern', 'cost', 'place', 'korea'].reduce((a, k) => a + (sum[k] ?? 0), 0);
  console.log(`\n전 시술: 의도 태그 월 ${Math.round(intentTotal / 12).toLocaleString()} / 기타(규칙 못 알아봄) 월 ${Math.round((sum.other ?? 0) / 12).toLocaleString()} = 의도 대비 ${Math.round((sum.other ?? 0) / intentTotal * 100)}%`);
  console.log('기타 많은 시술', Object.entries(other).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, v]) => `${n} ${Math.round(v / 12).toLocaleString()}`).join(', '));
  console.log('기타 상위 검색어', otherKw.sort((a, b) => b[2] - a[2]).slice(0, 15).map((x) => `${x[1]}=${x[2]}`).join(', '));
} finally { await sql.end(); }
