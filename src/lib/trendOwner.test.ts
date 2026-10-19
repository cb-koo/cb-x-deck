import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { reassignOwners, upsertProcedures } from './trendStore.ts';

// 한국 조합은 짧은 이름으로 물은 것도 있어(韓国 肝斑 → 기미 '肝斑治療') 주인을 이름 포함 여부로 다시 정하면 떨어져 나간다(10-19)
const sql = getSql();
const M = 'test-owner';

after(async () => {
  await sql`delete from trend_keyword where market = ${M}`;
  await sql`delete from trend_procedure where market = ${M}`;
  await sql.end();
});

test('시술이 바뀌어도 한국 조합·이름 검색어는 정한 시술에 남고, 수식어 검색어는 이름으로 다시 정한다', async () => {
  await upsertProcedures(sql, [{ id: 'tox1', market: M, major: '색소', majorOrder: 1, middle: '', name: '기미', kr: '기미', jp: '肝斑治療', en: '', note: '' }]);
  const ins = (text: string, source: string, owner: string | null) =>
    sql`insert into trend_keyword (market, text, norm, procedure_id, source) values (${M}, ${text}, ${text.replace(/\s/g, '')}, ${owner}, ${source})`;
  await ins('韓国 肝斑', 'korea', 'tox1');          // 짧은 이름으로 물은 한국 조합 — 남아야 한다
  await ins('肝斑治療', 'name', 'tox1');            // 이름 — 남아야 한다
  await ins('肝斑 薬', 'template', 'tox1');         // 이름이 안 들어 있는 수식어 — 주인 없음으로 다시 정해진다
  await reassignOwners(sql, M);
  const rows = await sql<Array<{ text: string; procedure_id: string | null }>>`select text, procedure_id from trend_keyword where market = ${M} order by text`;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.text, r.procedure_id])), { '韓国 肝斑': 'tox1', '肝斑治療': 'tox1', '肝斑 薬': null });
});
