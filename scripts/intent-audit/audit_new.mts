// 넣을 후보 검수 — 시범·완전 사이클 21개 시술에서 키워드 플래너 값이 있고 DB에 없는 검색어를 모아,
// 대시보드 규칙(주인 시술·제외·다른 뜻)을 그대로 적용한 뒤 '시술이 아닐 수 있는' 말이 든 것을 따로 뽑는다. 쓰기 없음.
import postgres from 'postgres';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tagKeyword, norm } from '../../src/lib/searchIntent.ts';
import { ownerResolver } from '../../src/lib/trendStore.ts';
const D = (f: string) => new URL(`./data/${f}`, import.meta.url);
const reg = JSON.parse(readFileSync(new URL('./procs.json', import.meta.url), 'utf8')) as Record<string, { pid: string; name: string }>;
const KEYS: Record<string, string> = { rejuran: 'p28', hifu: 'p49', potenza: 'p127', botox: 'p11', threadlift: 'p78', dermapen: 'p64', picotoning: 'p187', lipolysis: 'p72',
  ...Object.fromEntries(Object.entries(reg).filter(([, v]) => v.pid !== 'p194').map(([k, v]) => [k, v.pid])) };
// 시술이 아닐 수 있는 말(사람 검수 대상) — 화장품·영양제·집에서·기기 판매·업계·다른 뜻
const SUSPECT = /サプリ|飲む|内服|錠|ドリンク|美顔器|家庭用|ホーム|エステ|サロン|スパ|ドラッグ|市販|薬局|通販|販売|購入|ネット|楽天|amazon|qoo10|メガ割|ドンキ|コスメ|化粧|美容液|クリーム|ローション|パック|シャンプー|歯磨き|求人|資格|講習|導入|メーカー|代理店|開業|株|意味|歌|ゲーム|犬|猫|ペット|食べ物|食品|料理|魚|鮭|レシピ/i;
const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const { procs, have } = await sql.begin('read only', async (tx) => ({
    procs: await tx<Array<{ id: string; jp: string; kr: string }>>`select id, jp, kr from trend_procedure where market = 'jp' and not hidden`,
    have: new Set((await tx<Array<{ norm: string }>>`select norm from trend_keyword where market = 'jp'`).map((r) => r.norm)),
  }));
  const owner = ownerResolver(procs); const byId = new Map(procs.map((p) => [p.id, p]));
  const cand: Array<{ key: string; text: string; owner: string | null; ownerKr: string; tag: string; v: number }> = [];
  const seen = new Set<string>();
  for (const [key] of Object.entries(KEYS)) {
    const f = D(`kp-${key}.json`); if (!existsSync(f)) continue;
    for (const r of JSON.parse(readFileSync(f, 'utf8')).results as Array<{ text: string; keywordMetrics?: { monthlySearchVolumes?: Array<{ monthlySearches?: string }> } }>) {
      const mv = r.keywordMetrics?.monthlySearchVolumes ?? []; if (mv.length !== 48) continue;
      const v = mv.slice(-12).reduce((a, x) => a + Number(x.monthlySearches ?? 0), 0) / 12; if (v <= 0) continue;
      const n = norm(r.text); if (have.has(n) || seen.has(n)) continue; seen.add(n);
      const o = owner(r.text); const p = o ? byId.get(o) : undefined;
      cand.push({ key, text: r.text, owner: o, ownerKr: p?.kr ?? '(주인 없음)', tag: p ? tagKeyword(r.text, [p.jp]) : 'none', v });
    }
  }
  const sum = (xs: typeof cand) => Math.round(xs.reduce((a, x) => a + x.v, 0));
  const noOwner = cand.filter((c) => !c.owner), dropped = cand.filter((c) => c.owner && ['exclude', 'noise'].includes(c.tag));
  const keep = cand.filter((c) => c.owner && !['exclude', 'noise'].includes(c.tag));
  const sus = keep.filter((c) => SUSPECT.test(norm(c.text)));
  const otherProc = keep.filter((c) => c.owner !== KEYS[c.key]);
  console.log(`후보(값 있고 DB에 없음) ${cand.length}개 월 ${sum(cand).toLocaleString()}`);
  console.log(`- 주인 시술 없음(시술명이 안 들어 있음) ${noOwner.length}개 월 ${sum(noOwner).toLocaleString()} → 넣지 않음`);
  console.log(`- 대시보드 규칙이 제외·다른 뜻으로 거름 ${dropped.length}개 월 ${sum(dropped).toLocaleString()} → 넣어도 숫자에 안 들어감`);
  console.log(`- 남는 것 ${keep.length}개 월 ${sum(keep).toLocaleString()} (그중 다른 시술 몫으로 넘어가는 것 ${otherProc.length}개 월 ${sum(otherProc).toLocaleString()})`);
  console.log(`- 남는 것 중 '시술이 아닐 수 있는 말'이 든 것 ${sus.length}개 월 ${sum(sus).toLocaleString()}`);
  console.log('  상위:', sus.sort((a, b) => b.v - a.v).slice(0, 25).map((c) => `${c.text}=${Math.round(c.v)}(${c.ownerKr}/${c.tag})`).join(', '));
  console.log('제외로 걸러진 상위:', dropped.sort((a, b) => b.v - a.v).slice(0, 10).map((c) => `${c.text}=${Math.round(c.v)}`).join(', '));
  writeFileSync(D('audit-new.csv'), '﻿text,monthly,owner,tag,suspect,from\n' + keep.sort((a, b) => b.v - a.v).map((c) => `"${c.text}",${Math.round(c.v)},${c.ownerKr},${c.tag},${SUSPECT.test(norm(c.text)) ? 'Y' : ''},${c.key}`).join('\n'));
} finally { await sql.end(); }
