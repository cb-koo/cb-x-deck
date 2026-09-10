import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  console.log('── display_name에 "子" 포함 ──');
  for (const r of await sql`select handle, display_name, jsonb_array_length(payment_methods) as pm from influencer where display_name like '%子%' order by handle`)
    console.log(`   @${r.handle} | "${r.display_name}" | 수단 ${r.pm}개`);
  console.log('\n── handle에 bea/yko/yco 포함 ──');
  for (const r of await sql`select handle, display_name from influencer where handle ~* '(bea|yko|yco|y_ko)' order by handle`)
    console.log(`   @${r.handle} | "${r.display_name}"`);
  console.log('\n── display_name이 비어 있는 인플(스냅샷 미조회) ──');
  const [c] = await sql`select count(*) as n from influencer where display_name is null or display_name = ''`;
  console.log(`   ${c.n}명`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
