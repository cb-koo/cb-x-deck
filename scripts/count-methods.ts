import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const [c] = await sql`
    select count(*) as total,
           count(*) filter (where payment_methods <> '[]'::jsonb) as have,
           count(*) filter (where payment_methods = '[]'::jsonb) as none
      from influencer`;
  console.log(`명부 ${c.total}명 | 결제수단 있음 ${c.have} | 없음 ${c.none}`);
  const g = await sql`
    select lower(m->>'email') as email, m->>'holder' as holder, count(*) as n,
           string_agg('@' || i.handle, ', ' order by i.handle) as handles
      from influencer i, jsonb_array_elements(i.payment_methods) m
     where m->>'type' = 'paypal' and m->>'email' is not null
     group by 1,2 having count(*) > 1 order by 3 desc`;
  console.log('\n같은 PayPal 이메일을 쓰는 그룹(DB 기준):');
  for (const r of g) console.log(`   ${r.email} (${r.holder}) — ${r.n}개: ${r.handles}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
