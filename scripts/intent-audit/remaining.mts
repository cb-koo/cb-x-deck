// 완전 사이클(자동완성 18회) 남은 대상 — 화면 기본값(피부과 시술만) 묶음을 12개월 검색량 순으로, 끝낸 것 표시. 읽기만.
import { readFileSync } from 'node:fs';
import { classify } from '../../src/lib/procedureTaxonomy.ts';
const intent = JSON.parse(readFileSync(new URL('./data/view-intent.json', import.meta.url), 'utf8')) as Record<string, { total: number[]; members?: Array<{ id: string }> }>;
const snap = JSON.parse(readFileSync('/Users/koo/orca/projects/b2b-marketing/reports/search-trends/data/trends_snapshot.json', 'utf8'));
const byId = new Map(snap.procedures.map((p: any) => [p.id, p]));
const reg = JSON.parse(readFileSync(new URL('./procs.json', import.meta.url), 'utf8')) as Record<string, { pid: string }>;
const DONE = new Set(['p28', 'p49', 'p127', 'p11', 'p78', 'p64', 'p187', 'p110', 'p73', 'p72', ...Object.values(reg).map((r) => r.pid).filter((id) => id !== 'p194')]);  // p194 젠틀맥스프로는 등록만(제모라 안 돌림)  // 리쥬란 HIFU 포텐자 보톡스 실리프팅 더마펜 피코토닝 + 쥬베룩 써마지(b2b)
const rows = Object.entries(intent).map(([id, v]) => {
  const ids = v.members?.map((m) => m.id) ?? [id];
  const derm = ids.some((i) => byId.get(i) && classify(byId.get(i) as any).derm);
  return { id, kr: (byId.get(id) as any)?.kr ?? id, derm, vol: v.total.slice(-12).reduce((a, b) => a + b, 0), done: ids.some((i) => DONE.has(i)) };
}).filter((r) => r.derm).sort((a, b) => b.vol - a.vol);
const band = (lo: number, hi: number) => rows.filter((r) => r.vol >= lo && r.vol < hi);
console.log(`피부과 시술 묶음 ${rows.length}개 · 끝낸 것 ${rows.filter((r) => r.done).length}개 · 남은 것 ${rows.filter((r) => !r.done).length}개`);
for (const [lo, hi, l] of [[1e6, 1e12, '연 100만+'], [3e5, 1e6, '30만~100만'], [1e5, 3e5, '10만~30만'], [3e4, 1e5, '3만~10만'], [0, 3e4, '3만 미만']] as const) {
  const b = band(lo, hi), left = b.filter((r) => !r.done), noHair = left.filter((r) => !/제모/.test(r.kr) && r.kr !== "젠틀맥스프로");
  console.log(`${l}|${b.length}개|남은 ${left.length}개(제모 빼면 ${noHair.length}개)|SerpAPI ${noHair.length * 18}회|${noHair.slice(0, 40).map((r) => r.kr).join(', ')}`);
}
