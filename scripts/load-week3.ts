// 슬랙 `9월3주차` 스레드 3건 → 이미 있는 캠페인 3개에 작업 19건 적재.
// 원천은 data-work/week3-normalized.json 하나뿐이다(검수표와 같은 파일 — 표와 적재가 갈릴 수 없게).
//
// 9월2주차와 다른 점: 캠페인이 이미 있다(9/14~9/20, 작업 0건). 그래서 캠페인은 만들지 않고
// kind·note 만 채우고 작업을 넣는다.
//
// 안전장치: ① 대상 캠페인에 작업이 이미 있으면 중단(두 번 적재 방지)
//           ② --apply 는 --expect-tasks N 과 함께 써야 한다
//           ③ RT 는 posted_at 을 찍지 않는다 — 증빙 없이 게시됨으로 만들면 RT 증빙 스펙 §5 위반이다.
//              증빙 이미지는 슬랙에 있고, scripts/attach-week3-proofs.ts 가 증빙과 게시일을 한 트랜잭션에서 넣는다.
//           ④ 정산 요청은 만들지 않는다
// 되돌리기: 이 스크립트가 넣은 작업만 지우려면 campaign_task 에서 해당 campaign_id 3개의 행을 지운다.
//
// 실행: node --env-file=.env --import tsx scripts/load-week3.ts [--apply --expect-tasks 19]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { postedOnSeoul, postedAtSeoul } from './tweetDate.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313'; // 박구건 — created_by

interface Task {
  no: number; campaign: string; handle: string; type: string;
  cost: { amount: number; currency: string };
  post_url: string | null; 게시: boolean; 증빙_슬랙: boolean; 명부: boolean; note: string;
}
interface Camp { key: string; id: string; name: string; client_name: string; note: string; 슬랙_비용: { 금주_소진: number } }
interface Ex { no: number; campaign: string; handle: string | null; type: string; amount: number | null; 사유: string; 분류: string }

const D = JSON.parse(readFileSync(new URL('../data-work/week3-normalized.json', import.meta.url), 'utf8')) as {
  campaigns: Camp[]; tasks: Task[]; excluded: Ex[]; roster_missing: { 적재_대상_중_없음: string[]; 실무_규칙: string };
};
const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const ei = argv.indexOf('--expect-tasks');
  const expect = ei >= 0 ? Number(argv[ei + 1]) : null;
  const { campaigns, tasks, excluded } = D;
  const sql = getSql();

  console.log(`적재 대상 — 캠페인 ${campaigns.length}개(이미 있음) · 작업 ${tasks.length}건 · 합 ${man(tasks.reduce((a, t) => a + t.cost.amount, 0))}`);

  // ① 캠페인이 실제로 있는지 + 작업이 비어 있는지
  for (const c of campaigns) {
    const rows = await sql`select name, (select count(*)::int from campaign_task t where t.campaign_id = c.id) as n
                           from campaign c where c.id = ${c.id}`;
    if (!rows.length) { console.error(`\n✗ 캠페인이 없습니다: ${c.name} (${c.id})`); await sql.end(); process.exit(1); }
    if (rows[0].name !== c.name) { console.error(`\n✗ 캠페인 이름이 다릅니다: DB '${rows[0].name}' ≠ JSON '${c.name}'`); await sql.end(); process.exit(1); }
    if (rows[0].n > 0) { console.error(`\n✗ '${c.name}' 에 이미 작업 ${rows[0].n}건이 있습니다 — 두 번 적재하지 않도록 중단합니다.`); await sql.end(); process.exit(1); }
  }

  console.log('\n══ 캠페인별 ══');
  for (const c of campaigns) {
    const mine = tasks.filter((t) => t.campaign === c.key);
    const pub = mine.filter((t) => t.게시);
    console.log(`\n━━ ${c.name}`);
    console.log(`   kind=content 로 채우고 메모를 넣습니다.`);
    for (const t of mine) {
      const bits = [t.type.padEnd(7), man(t.cost.amount).padStart(6)];
      if (t.post_url) bits.push(`게시 ${postedAtSeoul(t.post_url)}`);
      else if (t.type === 'rt' && t.증빙_슬랙) bits.push('RT 증빙 슬랙에 있음 → 2단계에서 게시 표시');
      else bits.push('게시 전');
      if (!t.명부) bits.push('⚠️명부없음');
      if (t.note) bits.push(`— ${t.note}`);
      console.log(`   ${String(t.no).padStart(2)}. @${t.handle.padEnd(16)} ${bits.join(' · ')}`);
    }
    console.log(`   ─ ${mine.length}건 ${man(mine.reduce((a, t) => a + t.cost.amount, 0))} · 슬랙 게시 ${pub.length}건 ${man(pub.reduce((a, t) => a + t.cost.amount, 0))} (헤더 금주 소진 ${man(c.슬랙_비용.금주_소진)} ${pub.reduce((a, t) => a + t.cost.amount, 0) === c.슬랙_비용.금주_소진 ? '✅ 일치' : '❌ 불일치'})`);
  }

  console.log('\n══ 넣지 않는 행 ══');
  for (const e of excluded) console.log(`   ${e.campaign} ${String(e.no).padStart(2)}. ${e.handle ? '@' + e.handle : '(핸들 없음)'} ${e.amount ? man(e.amount) : '—'} — ${e.사유} (${e.분류})`);

  console.log('\n══ 이번에 찍는 게시일 ══');
  const withUrl = tasks.filter((t) => t.post_url);
  console.log(`   게시물 URL 있는 ${withUrl.length}건만 posted_at 을 찍습니다(트윗 ID에서 파생, posted_source='manual').`);
  const rtPending = tasks.filter((t) => t.type === 'rt' && t.증빙_슬랙);
  console.log(`   RT ${rtPending.length}건은 posted_at 을 비워 둡니다 — 증빙 없이 게시됨으로 만들면 RT 증빙 스펙 §5 위반.`);
  console.log(`   → scripts/attach-week3-proofs.ts 가 증빙 업로드와 게시 표시를 한 트랜잭션에서 합니다.`);

  console.log('\n══ 넣지 않는 값 ══');
  console.log('   · scheduled_on — 게시 예정일 정보가 슬랙에 없다');
  console.log('   · 정산 요청 — 적재는 작업까지. 지급 요청은 화면에서 사람이 낸다');
  console.log('   · 백수약국 헤더의 이전주 누적·월 예산 — 더스퀘어 스레드 복사로 보여 반영하지 않는다(캠페인 메모에 남김)');
  if (D.roster_missing.적재_대상_중_없음.length)
    console.log(`   · 명부에 없는 핸들 ${D.roster_missing.적재_대상_중_없음.map((h) => '@' + h).join(' · ')} — ${D.roster_missing.실무_규칙}`);

  if (!apply) { console.log(`\n드라이런입니다 — 실제로 넣으려면: --apply --expect-tasks ${tasks.length}`); await sql.end(); return; }
  if (expect === null) { console.error('\n✗ --apply 는 --expect-tasks N 과 함께 써야 합니다.'); await sql.end(); process.exit(2); }
  if (expect !== tasks.length) { console.error(`\n✗ 작업 수가 예상과 다릅니다 (예상 ${expect} · 실제 ${tasks.length})`); await sql.end(); process.exit(2); }

  await sql.begin(async (tx) => {
    let n = 0;
    for (const c of campaigns) {
      await tx`update campaign set kind = 'content', note = ${c.note}, updated_at = now() where id = ${c.id}`;
      for (const t of tasks.filter((x) => x.campaign === c.key)) {
        const postedOn = t.post_url ? postedOnSeoul(t.post_url) : null;
        await tx`
          insert into campaign_task (campaign_id, influencer_handle, type, post_url, posted_at, posted_source, cost, note, created_by)
          values (${c.id}, ${t.handle}, ${t.type}, ${t.post_url},
                  ${postedOn}, ${postedOn ? 'manual' : null},
                  ${tx.json(t.cost)}, ${t.note}, ${KOO})`;
        n += 1;
      }
      console.log(`✓ ${c.name} → 작업 ${tasks.filter((x) => x.campaign === c.key).length}건`);
    }
    console.log(`\n적재 완료 — 작업 ${n}건`);
  });

  const [after] = await sql`select
    (select count(*)::int from campaign_task t join campaign c on c.id=t.campaign_id where c.name like '%9월3주차') as w3,
    (select count(*)::int from campaign_task) as task,
    (select count(*)::int from payment_request) as req`;
  console.log(`확인 — 3주차 작업 ${after.w3} · 전체 작업 ${after.task} · 정산 요청 ${after.req}(건드리지 않음)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
