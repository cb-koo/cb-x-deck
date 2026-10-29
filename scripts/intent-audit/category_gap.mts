// 분류 칸 재설계 근거 — 운영 검색어를 지금 규칙으로 태그한 뒤, '양·횟수·간격'과 '비교' 말이 어느 칸에 얼마나 들어가 있는지 잰다. 읽기만.
import postgres from 'postgres';
import { tagKeyword, norm } from '../../src/lib/searchIntent.ts';
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
const DOSE = /何cc|\dcc|cc|単位|何本|本数|ショット|shot|何回|回数|回目|\d回|一回|頻度|間隔|何ヶ月|ヶ月おき|か月おき|何日おき|持ち|もつ|持続|期間|量|ワンクール|何アンプル|アンプル数/i;
const COMPARE = /違い|比較|vs|どっち|どちら/i;
const v = (s: number[] | null) => ((s ?? []).slice(-12).reduce((a, b) => a + b, 0)) / 12;
try {
  const rows = await sql<Array<{ text: string; jp: string; series: number[] | null; ov: string | null }>>`
    select k.text, p.jp, k.series, k.intent_override ov from trend_keyword k join trend_procedure p on p.id = k.procedure_id where k.market = 'jp'`;
  const tagSum: Record<string, number> = {}; const dose: Record<string, number> = {}; const cmp: Record<string, number> = {};
  const ex: Record<string, Array<[string, number]>> = {};
  for (const r of rows) {
    const t = r.ov ?? tagKeyword(r.text, [r.jp]); const x = v(r.series); tagSum[t] = (tagSum[t] ?? 0) + x;
    if (['noise', 'exclude', 'adjacent', 'name'].includes(t)) continue;
    const bare = norm(r.text).replace(norm(r.jp), '');
    if (DOSE.test(bare)) { dose[t] = (dose[t] ?? 0) + x; (ex['dose:' + t] ??= []).push([norm(r.text), Math.round(x)]); }
    else if (COMPARE.test(bare)) { cmp[t] = (cmp[t] ?? 0) + x; (ex['cmp:' + t] ??= []).push([norm(r.text), Math.round(x)]); }
  }
  const R = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, Math.round(x)]).sort((a, b) => +b[1] - +a[1]));
  console.log('태그별 월 검색량', R(tagSum));
  console.log('양·횟수·간격 말이 든 검색 — 지금 들어간 칸', R(dose));
  console.log('비교 말이 든 검색 — 지금 들어간 칸', R(cmp));
  for (const k of ['dose:effect', 'dose:other', 'dose:worry', 'cmp:info']) console.log(k, (ex[k] ?? []).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a, b]) => `${a}=${b}`).join(' '));
} finally { await sql.end(); }
