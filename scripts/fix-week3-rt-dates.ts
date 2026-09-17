// 9월3주차 RT 6건의 게시 확인일(posted_at)을 슬랙 증빙 답글이 올라온 날로 맞춘다 (koo 지시 2026-09-17).
//
// 왜: 지금 값이 캠페인 단위로 일괄 적용돼 있다(백수약국 전부 09-15 · 미모드림 전부 09-16).
// RT 는 자기 게시물이 없어 트윗 ID로 날짜를 못 뽑으므로, posted_at 은 스키마상 '게시 확인일' —
// 모에카가 증빙을 슬랙에 올린 날이 근거다. 답글마다 날짜가 다르므로 작업별로 다르게 들어가야 한다.
//
// 근거(슬랙 #f-x-채널-통합관리 C0AD9E5HE1K, 증빙 이미지가 붙은 답글의 시각·KST):
//   미모드림 1789366144.350499 — 06.@for_hk_ 09-15 15:47:15 · 08.@mpchan_a 09-15 15:47:20 · 09.@y_yunicha2 09-15 15:47:25
//   백수약국 1789366166.539959 — 04.@shioringo1224 09-15 16:02:21 · 05.@aik_ooooo 09-15 16:02:22 · 06.@umm___nnn 09-16 18:28:59
//
// 증빙(proof)은 건드리지 않는다 — 날짜만 고친다. 증빙이 없는 RT 는 손대지 않는다(증빙 없는 게시됨을 만들지 않는다).
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/fix-week3-rt-dates.ts [--apply]
import { getSql } from '../src/lib/db.ts';

// 핸들 → {게시 확인일, 슬랙 답글 시각(근거 표기용)}
const CONFIRMED: Record<string, { on: string; reply: string }> = {
  for_hk_:        { on: '2026-09-15', reply: '09-15 15:47:15' },
  mpchan_a:       { on: '2026-09-15', reply: '09-15 15:47:20' },
  y_yunicha2:     { on: '2026-09-15', reply: '09-15 15:47:25' },
  shioringo1224:  { on: '2026-09-15', reply: '09-15 16:02:21' },
  aik_ooooo:      { on: '2026-09-15', reply: '09-15 16:02:22' },
  umm___nnn:      { on: '2026-09-16', reply: '09-16 18:28:59' },
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const rows = await sql<Array<{ id: string; camp: string; h: string; posted: string | null; has_proof: boolean }>>`
    select t.id, c.name as camp, t.influencer_handle as h,
           to_char(t.posted_at,'YYYY-MM-DD') as posted, t.proof is not null as has_proof
      from campaign_task t join campaign c on c.id = t.campaign_id
     where c.name like '%9월3주차' and t.type = 'rt'
     order by c.name, t.influencer_handle`;

  console.log(`9월3주차 RT ${rows.length}건\n`);
  const jobs: Array<{ id: string; h: string; from: string | null; to: string; reply: string }> = [];
  const skips: string[] = [];

  for (const r of rows) {
    const c = CONFIRMED[r.h];
    if (!c) { skips.push(`@${r.h}: 슬랙 근거 표에 없음 — 손대지 않습니다`); continue; }
    if (!r.has_proof) { skips.push(`@${r.h}: 증빙이 없습니다 — 날짜만 고치면 '증빙 없는 게시됨'이 됩니다. 손대지 않습니다`); continue; }
    const mark = r.posted === c.on ? '그대로' : `${r.posted ?? '없음'} → ${c.on}`;
    console.log(`  @${r.h.padEnd(16)} ${r.camp.replace('_9월3주차','').padEnd(8)} 슬랙 답글 ${c.reply}  ·  ${mark}`);
    if (r.posted !== c.on) jobs.push({ id: r.id, h: r.h, from: r.posted, to: c.on, reply: c.reply });
  }

  if (skips.length) { console.log('\n건너뜀:'); for (const s of skips) console.log(`   · ${s}`); }
  if (!jobs.length) { console.log('\n고칠 것이 없습니다 — 이미 슬랙과 같습니다.'); await sql.end(); return; }

  console.log(`\n고칠 것 ${jobs.length}건 (posted_source 는 'manual' 그대로, 증빙은 건드리지 않습니다)`);
  if (!apply) { console.log('\n드라이런입니다 — 실제로 고치려면 --apply'); await sql.end(); return; }

  await sql.begin(async (tx) => {
    for (const j of jobs) {
      await tx`update campaign_task set posted_at = ${j.to}::date, updated_at = now() where id = ${j.id}`;
      console.log(`✓ @${j.h} ${j.from ?? '없음'} → ${j.to} (슬랙 답글 ${j.reply})`);
    }
  });

  const after = await sql<Array<{ h: string; posted: string }>>`
    select t.influencer_handle as h, to_char(t.posted_at,'YYYY-MM-DD') as posted
      from campaign_task t join campaign c on c.id = t.campaign_id
     where c.name like '%9월3주차' and t.type = 'rt' order by t.influencer_handle`;
  const bad = after.filter((r) => CONFIRMED[r.h] && CONFIRMED[r.h].on !== r.posted);
  console.log(`\n확인 — RT ${after.length}건 중 슬랙과 다른 건 ${bad.length}건`);
  for (const r of after) console.log(`   @${r.h.padEnd(16)} ${r.posted}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
