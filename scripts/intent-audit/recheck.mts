// 반영 전 재검토 — (1) 합성 이름 조각(tagNames)이 의도 말을 떼어 버리는지 (2) 시술 밖 관심에 시술 뒤 관리(다운타임 케어) 검색이 섞였는지
// (3) 넣을 검색어끼리·기존과 48개월 값이 같은 중복 (4) 주인 재배정 표본. 운영 DB 읽기 전용, 쓰기 없음.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { tagNames, tagKeyword, norm } from '../../src/lib/searchIntent.ts';
import { ownerResolver } from '../../src/lib/trendStore.ts';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
const INTENT_WORD = /韓国|ソウル|値段|料金|価格|安い|費用|東京|大阪|クリニック|皮膚科|効果|口コミ|経過|ダウンタイム|痛み|副作用|失敗|とは|違い|おすすめ|目の下|ほうれい線|毛穴|たるみ|シワ|しわ|クマ|肝斑|シミ|ニキビ/;
try {
  const { procs, kws } = await sql.begin('read only', async (tx) => ({
    procs: await tx<Array<{ id: string; jp: string; kr: string }>>`select id, jp, kr from trend_procedure where market = 'jp' and not hidden`,
    kws: await tx<Array<{ text: string; procedure_id: string | null; source: string; series: number[] | null; intent_override: string | null }>>`select text, procedure_id, source, series, intent_override from trend_keyword where market = 'jp'`,
  }));
  const all = procs.map((p) => p.jp);
  // (1)
  const parts = procs.map((p) => ({ p, n: tagNames(p.jp, all) })).filter((x) => x.n.length > 1);
  const risky = parts.filter((x) => INTENT_WORD.test(x.n[2]));
  console.log(`(1) 조각으로 쪼개지는 시술 ${parts.length}개 · 떼는 조각이 의도 말인 것 ${risky.length}개: ${risky.map((x) => `${x.p.kr}(${x.n[1]}+${x.n[2]})`).join(', ')}`);
  // (2) 넣을 것 + 기존에서 시술 밖 관심으로 갈 것 중 시술 뒤 관리 말
  const owner = ownerResolver(procs); const jp = new Map(procs.map((p) => [p.id, p.jp]));
  const AFTER = /後|当日|翌日|ダウンタイム|施術|直後|何日/;
  const v = (s: number[] | null) => (s ?? []).slice(-12).reduce((a, b) => a + b, 0) / 12;
  const adj = kws.filter((k) => k.procedure_id && !k.intent_override && tagKeyword(k.text, tagNames(jp.get(k.procedure_id) ?? '', all)) === 'adjacent');
  const after = adj.filter((k) => AFTER.test(norm(k.text)));
  console.log(`(2) 기존 검색어 중 시술 밖 관심 ${adj.length}개 월 ${Math.round(adj.reduce((a, k) => a + v(k.series), 0)).toLocaleString()} · 그중 시술 뒤 관리 말 ${after.length}개 월 ${Math.round(after.reduce((a, k) => a + v(k.series), 0)).toLocaleString()}`);
  console.log('    예:', after.sort((a, b) => v(b.series) - v(a.series)).slice(0, 12).map((k) => `${k.text}=${Math.round(v(k.series))}`).join(', '));
  // (3) 넣을 검색어(insert-preview 직전 목록은 파일로 없으니 kp 파일에서 다시) — 같은 시술 안 48개월 값 동일 묶음
  const byKey = new Map<string, string[]>();
  for (const k of kws) if (k.series && v(k.series) >= 50 && k.procedure_id) { const key = k.procedure_id + '|' + k.series.join(','); byKey.set(key, [...(byKey.get(key) ?? []), k.text]); }
  const dup = [...byKey.values()].filter((x) => x.length > 1);
  console.log(`(3) 기존 DB에서 같은 시술·48개월 값 동일(대시보드 중복 제거가 하나만 셈) 묶음 ${dup.length}개 — 예: ${dup.slice(0, 4).map((d) => d.join(' = ')).join(' / ')}`);
  // (4) 주인 재배정 표본
  const moves = kws.filter((k) => !((k.source === 'name' || k.source === 'korea') && k.procedure_id)).map((k) => ({ k, n: owner(k.text) })).filter((x) => x.n !== x.k.procedure_id);
  const kr = new Map(procs.map((p) => [p.id, p.kr]));
  console.log(`(4) 주인 재배정 ${moves.length}개 표본:`, moves.sort(() => 0.5 - Math.random()).slice(0, 15).map((x) => `${x.k.text}: ${kr.get(x.k.procedure_id ?? '')}→${kr.get(x.n ?? '')}`).join(' | '));
} finally { await sql.end(); }
