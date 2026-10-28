// 운영 trend_view(jp) 다시 만들기 — 규칙을 바꾼 뒤 화면에 바로 반영할 때. trend_view 한 행만 쓴다(검색어·시술은 그대로).
// 실행: node --env-file=<.env> --import tsx scripts/intent-audit/rebuild.mts
import postgres from 'postgres';
import { rebuildView } from '../../src/lib/trendStore.ts';

const sql = postgres({ host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), username: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
try {
  const doc = await rebuildView(sql, 'jp');
  const stages = Object.values(doc.intent).reduce((m, v) => { const k = v.stage ?? 'null'; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>);
  const [r] = await sql<Array<{ built_at: Date }>>`select built_at from trend_view where market = 'jp'`;
  console.log('built_at', r.built_at.toISOString(), 'procedures', doc.procedures.length, 'stages', JSON.stringify(stages),
    'rejuran info', doc.intent.p28?.profile?.info, 'stage', doc.intent.p28?.stage);
} finally { await sql.end(); }
