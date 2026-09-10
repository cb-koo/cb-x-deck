// 읽기 전용 — 적재 결과를 DB에서 다시 읽어 원천 JSON과 대조한다(스크립트 출력이 아니라 DB가 근거).
// 실행: node --env-file=.env --import tsx scripts/audit-week2-loaded.ts
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { postedOnSeoul } from './tweetDate.ts';

interface Task { no: number; campaign: string; handle: string; type: string; cost: { amount: number }; post_url: string | null; note: string }
interface Camp { key: string; name: string; starts_on: string; ends_on: string; client_name: string }
const D = JSON.parse(readFileSync(new URL('../data-work/week2-normalized.json', import.meta.url), 'utf8')) as { campaigns: Camp[]; tasks: Task[] };
const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const sql = getSql();
  const fails: string[] = [];
  const rows = await sql.unsafe(`
    select c.name as camp, c.client_name, to_char(c.starts_on,'YYYY-MM-DD') as starts_on,
           to_char(c.ends_on,'YYYY-MM-DD') as ends_on, c.kind,
           t.influencer_handle as handle, t.type, t.cost, t.post_url,
           to_char(t.posted_at,'YYYY-MM-DD') as posted_at, t.posted_source, t.note,
           t.scheduled_on, t.draft_id, t.target_task_id
      from campaign c join campaign_task t on t.campaign_id = c.id
     order by c.name, t.created_at`);
  console.log(`DB에서 읽음 — 작업 ${rows.length}건 (원천 ${D.tasks.length}건)`);
  if (rows.length !== D.tasks.length) fails.push(`작업 수 불일치: DB ${rows.length} ≠ 원천 ${D.tasks.length}`);

  for (const c of D.campaigns) {
    const mine = rows.filter((r: Record<string, unknown>) => r.camp === c.name);
    const src = D.tasks.filter((t) => t.campaign === c.key);
    const sum = mine.reduce((a: number, r: Record<string, { amount: number }>) => a + Number(r.cost.amount), 0);
    const posted = mine.filter((r: Record<string, unknown>) => r.posted_at !== null);
    console.log(`\n━━ ${c.name} · ${mine[0]?.starts_on}~${mine[0]?.ends_on} · ${mine[0]?.client_name} · ${mine.length}건 · ${man(sum)} · 게시일 있음 ${posted.length}건`);
    if (mine.length !== src.length) fails.push(`${c.name}: DB ${mine.length} ≠ 원천 ${src.length}`);
    if (mine[0]?.starts_on !== c.starts_on || mine[0]?.ends_on !== c.ends_on) fails.push(`${c.name}: 기간 DB ${mine[0]?.starts_on}~${mine[0]?.ends_on} ≠ 원천 ${c.starts_on}~${c.ends_on}`);

    for (const t of src) {
      const hit = mine.find((r: Record<string, string>) => r.handle === t.handle && r.type === t.type);
      if (!hit) { fails.push(`${c.name} @${t.handle} ${t.type}: DB에 없음`); continue; }
      if (Number(hit.cost.amount) !== t.cost.amount) fails.push(`${c.name} @${t.handle}: 금액 DB ${hit.cost.amount} ≠ ${t.cost.amount}`);
      if (hit.cost.currency !== 'KRW') fails.push(`${c.name} @${t.handle}: 통화 ${hit.cost.currency}`);
      if ((hit.post_url ?? null) !== t.post_url) fails.push(`${c.name} @${t.handle}: post_url 불일치`);
      const want = t.post_url ? postedOnSeoul(t.post_url) : null;
      if ((hit.posted_at ?? null) !== want) fails.push(`${c.name} @${t.handle}: posted_at DB ${hit.posted_at} ≠ 기대 ${want}`);
      if (t.post_url && hit.posted_source !== 'manual') fails.push(`${c.name} @${t.handle}: posted_source ${hit.posted_source}`);
      if (hit.scheduled_on !== null) fails.push(`${c.name} @${t.handle}: scheduled_on 이 비어 있지 않다 — ${hit.scheduled_on}`);
      if (want !== null && (want < c.starts_on || want > c.ends_on)) fails.push(`${c.name} @${t.handle}: 게시일 ${want} 이 기간 밖`);
      console.log(`   @${String(hit.handle).padEnd(17)} ${String(hit.type).padEnd(8)} ${man(Number(hit.cost.amount)).padStart(7)}  ${hit.posted_at ? '게시 ' + hit.posted_at : '게시 전  '}`);
    }
  }

  const [x] = await sql.unsafe(`select
    (select count(*) from payment_request) as req,
    (select count(*) from draft d where exists (select 1 from campaign_task t where t.draft_id = d.id)) as draft_linked,
    (select count(*) from client) as client`);
  console.log(`\n건드리지 않은 것 — 정산 요청 ${x.req}건 · 원고 연결 ${x.draft_linked}건 · 클라이언트 ${x.client}곳`);
  if (Number(x.req) !== 0) fails.push(`정산 요청이 ${x.req}건 생겼다 — 적재는 요청을 만들지 않아야 한다`);

  console.log('\n════════════');
  if (fails.length === 0) console.log('✓ DB 대조 통과 — 원천과 완전히 일치');
  else { console.log(`✗ 불일치 ${fails.length}건`); for (const f of fails) console.log(`   ✗ ${f}`); }
  await sql.end();
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
