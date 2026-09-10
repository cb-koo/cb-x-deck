// 읽기 전용 — 결제수단 없는 인플을 08-27 건너뜀 문서와 대조해 분류.
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';

const SKIP_DOC = '/Users/koo_clinicbridge/claude-outputs/20260827_결제수단_가져오기_건너뜀.md';

async function main(): Promise<void> {
  const sql = getSql();

  // 문서 표에서 핸들 열만 뽑는다
  const skipped = new Map<string, string[]>();
  for (const line of readFileSync(SKIP_DOC, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*([A-Za-z0-9_]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|/);
    if (!m || m[1] === '핸들') continue;
    const h = m[1].toLowerCase();
    if (!skipped.has(h)) skipped.set(h, []);
    skipped.get(h)!.push(`${m[2].trim()}/${m[3].trim()}`);
  }
  console.log(`건너뜀 문서: 고유 핸들 ${skipped.size}개 (행 ${[...skipped.values()].flat().length}개)\n`);

  const rows = await sql`
    select i.handle, i.followers_count,
           (select count(*) from campaign_task t where lower(t.influencer_handle) = lower(i.handle)) as tasks,
           (select count(*) from campaign_task t join campaign c on c.id = t.campaign_id
             where lower(t.influencer_handle) = lower(i.handle)
               and c.name not like '테스트%' and c.name not like '(삭제)%') as real_tasks
      from influencer i
     where i.payment_methods = '[]'::jsonb
     order by real_tasks desc, tasks desc, i.handle`;

  const inSkip = rows.filter((r) => skipped.has(String(r.handle).toLowerCase()));
  const notInSkip = rows.filter((r) => !skipped.has(String(r.handle).toLowerCase()));

  console.log(`결제수단 없는 인플 ${rows.length}명`);
  console.log(`  ├ 08-27 건너뜀 문서에 있음 (원본에 정보가 없던 계정): ${inSkip.length}명`);
  console.log(`  └ 문서에 없음 (노션에 애초에 없던 계정): ${notInSkip.length}명`);

  const urgent = rows.filter((r) => Number(r.real_tasks) > 0);
  console.log(`\n🔴 실제 캠페인 작업이 있는데 결제수단 없음: ${urgent.length}명`);
  for (const r of urgent) {
    const s = skipped.get(String(r.handle).toLowerCase());
    console.log(`   @${r.handle} — 실제작업 ${r.real_tasks}건 | ${s ? '건너뜀: ' + s.join(', ') : '노션에 없던 계정'}`);
  }

  console.log('\n── 건너뜀 문서에 있는 계정(사유별) ──');
  const byReason = new Map<string, string[]>();
  for (const r of inSkip) {
    for (const s of skipped.get(String(r.handle).toLowerCase())!) {
      if (!byReason.has(s)) byReason.set(s, []);
      byReason.get(s)!.push(String(r.handle));
    }
  }
  for (const [k, v] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`   ${k} (${v.length}명): ${v.join(', ')}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
