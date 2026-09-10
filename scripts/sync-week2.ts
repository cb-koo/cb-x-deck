// data-work/week2-normalized.json → 이미 있는 캠페인에 **이어붙인다**. load-week2.ts 의 후속용.
//
// 왜 따로 있나: 슬랙 스레드에는 답글이 계속 붙는다(09-10 저녁에도 더스퀘어에 2건 추가됐다).
// load-week2.ts 는 캠페인이 이미 있으면 중단하므로(두 번 적재 방지), 그 뒤의 변화는 이 스크립트가 맡는다.
//
// 하는 일 — 원천 JSON을 기준으로 DB를 맞춘다(캠페인+핸들+유형으로 짝을 찾는다):
//   ① 없는 작업 → insert
//   ② 있는데 게시물 URL/게시일이 비어 있고 원천에 있으면 → update(채우기만)
//   ③ 금액·메모가 달라졌으면 → update
// **지우지 않는다.** DB에만 있는 작업은 건드리지 않고 보고만 한다(사람이 화면에서 넣은 것일 수 있다).
// 게시일은 항상 게시물 URL에서 파생한다(tweetDate.ts) — 답글 시각이 아니다.
//
// 기본은 드라이런. 실제 반영은 --apply. 정산 요청은 만들지 않는다.
// 실행: node --env-file=.env --import tsx scripts/sync-week2.ts [--apply]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { postedOnSeoul } from './tweetDate.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313'; // 박구건

interface Task {
  no: number; campaign: string; handle: string; type: string;
  cost: { amount: number; currency: string };
  post_url: string | null; 게시: boolean; 답글일: string; 명부: boolean; note: string;
}
interface Camp { key: string; name: string; starts_on: string; ends_on: string }

const DATA = JSON.parse(readFileSync(new URL('../data-work/week2-normalized.json', import.meta.url), 'utf8')) as {
  campaigns: Camp[]; tasks: Task[];
};
const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const { campaigns, tasks } = DATA;
  const sql = getSql();

  const inserts: { camp: Camp; t: Task }[] = [];
  const updates: { camp: Camp; t: Task; id: string; changes: string[] }[] = [];
  const orphans: string[] = [];
  const outside: string[] = [];

  for (const c of campaigns) {
    const [row] = await sql`select id from campaign where name = ${c.name}`;
    if (!row) { console.error(`✗ 캠페인 '${c.name}' 이 DB에 없습니다 — 먼저 load-week2.ts 를 돌리세요.`); await sql.end(); process.exit(1); }
    const campaignId = row.id as string;
    const db = await sql`
      select id, influencer_handle as handle, type, post_url, cost, note,
             to_char(posted_at,'YYYY-MM-DD') as posted_at, posted_source
        from campaign_task where campaign_id = ${campaignId}`;

    const src = tasks.filter((t) => t.campaign === c.key);
    const matched = new Set<string>();

    for (const t of src) {
      const hit = db.find((r) => String(r.handle).toLowerCase() === t.handle.toLowerCase() && r.type === t.type);
      const want = t.post_url ? postedOnSeoul(t.post_url) : null;
      if (want !== null && (want < c.starts_on || want > c.ends_on)) {
        outside.push(`${c.name} @${t.handle}: 게시일 ${want} 이 캠페인 기간(${c.starts_on}~${c.ends_on}) 밖`);
      }
      if (!hit) { inserts.push({ camp: c, t }); continue; }
      matched.add(hit.id as string);
      const changes: string[] = [];
      if ((hit.post_url ?? null) !== t.post_url) changes.push(`게시물 URL ${hit.post_url ? '변경' : '채움'}: ${t.post_url ?? '(없음)'}`);
      if ((hit.posted_at ?? null) !== want) changes.push(`게시일 ${hit.posted_at ?? '(없음)'} → ${want ?? '(없음)'}`);
      if (Number((hit.cost as { amount: number } | null)?.amount ?? -1) !== t.cost.amount) changes.push(`금액 ${man(Number((hit.cost as { amount: number }).amount))} → ${man(t.cost.amount)}`);
      if (String(hit.note ?? '') !== t.note) changes.push('메모 갱신');
      if (changes.length) updates.push({ camp: c, t, id: hit.id as string, changes });
    }
    for (const r of db) {
      if (!matched.has(r.id as string)) orphans.push(`${c.name} @${r.handle} ${r.type} — DB에만 있음(건드리지 않음)`);
    }
  }

  console.log(`동기화 대상 — 새 작업 ${inserts.length}건 · 갱신 ${updates.length}건 · DB에만 있는 것 ${orphans.length}건`);
  if (outside.length) { console.log('\n🔴 기간 밖 게시일:'); for (const o of outside) console.log(`   ${o}`); }

  if (inserts.length) {
    console.log('\n══ 새로 넣을 작업 ══');
    for (const { camp, t } of inserts) {
      const on = t.post_url ? postedOnSeoul(t.post_url) : null;
      console.log(`   ${camp.name}  ${t.no}. @${t.handle.padEnd(15)} ${t.type.padEnd(8)} ${man(t.cost.amount).padStart(7)}  ${on ? '게시 ' + on : '게시 전'}${t.명부 ? '' : ' ⚠️명부없음'}${t.note ? ' · ' + t.note : ''}`);
    }
  }
  if (updates.length) {
    console.log('\n══ 갱신할 작업 ══');
    for (const u of updates) console.log(`   ${u.camp.name}  ${u.t.no}. @${u.t.handle} — ${u.changes.join(' · ')}`);
  }
  if (orphans.length) {
    console.log('\n══ DB에만 있는 작업(그대로 둠) ══');
    for (const o of orphans) console.log(`   ${o}`);
  }

  if (!inserts.length && !updates.length) { console.log('\n✓ 이미 원천과 같습니다 — 할 일 없음.'); await sql.end(); return; }
  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면: --apply'); await sql.end(); return; }

  await sql.begin(async (tx) => {
    for (const { camp, t } of inserts) {
      const [c] = await tx`select id from campaign where name = ${camp.name}`;
      const on = t.post_url ? postedOnSeoul(t.post_url) : null;
      await tx`
        insert into campaign_task (campaign_id, influencer_handle, type, post_url, posted_at, posted_source, cost, note, created_by)
        values (${c.id}, ${t.handle}, ${t.type}, ${t.post_url}, ${on}, ${on ? 'manual' : null},
                ${tx.json(t.cost)}, ${t.note}, ${KOO})`;
      console.log(`✓ 추가 ${camp.name} @${t.handle}`);
    }
    for (const u of updates) {
      const on = u.t.post_url ? postedOnSeoul(u.t.post_url) : null;
      await tx`
        update campaign_task set
          post_url = ${u.t.post_url}, posted_at = ${on},
          posted_source = ${on ? 'manual' : null},
          cost = ${tx.json(u.t.cost)}, note = ${u.t.note}, updated_at = now()
        where id = ${u.id}`;
      console.log(`✓ 갱신 ${u.camp.name} @${u.t.handle}`);
    }
  });

  const [after] = await sql.unsafe(`select
    (select count(*) from campaign_task) as task,
    (select count(*) from payment_request) as req`);
  console.log(`\n확인 — 작업 ${after.task}건 · 정산 요청 ${after.req}건(건드리지 않음)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
