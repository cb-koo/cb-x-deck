// 슬랙 `9월2주차` 스레드 4건 → 클라이언트 1개 + 캠페인 4개 + 작업 26건 적재.
// 원천은 data-work/week2-normalized.json 하나뿐이다(검수표와 같은 파일 — 표와 적재가 갈릴 수 없게).
//
// 먼저 scripts/verify-week2.ts 로 검산하고, 그 다음 이 스크립트를 드라이런 → --apply 순으로 쓴다.
// 한 트랜잭션이다 — 중간에 실패하면 아무것도 남지 않는다.
//
// 안전장치: ① 4개 캠페인 이름 중 하나라도 이미 있으면 중단(두 번 적재 방지)
//           ② --apply 는 --expect-tasks N 과 함께 써야 한다
//           ③ 정산 요청은 만들지 않는다 — 적재는 작업까지고, 지급 요청은 화면에서 사람이 낸다
// 되돌리기: scripts/reset-campaigns.ts (캠페인 전량 삭제) — 클라이언트는 지우지 않는다
//
// 실행: node --env-file=.env --import tsx scripts/load-week2.ts [--apply --expect-tasks 26]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { postedOnSeoul, postedAtSeoul } from './tweetDate.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313'; // 박구건 — created_by

interface Task {
  no: number; campaign: string; handle: string; type: string;
  cost: { amount: number; currency: string };
  post_url: string | null; 게시: boolean; 답글일: string; 명부: boolean; note: string;
}
interface Camp {
  key: string; name: string; name_en: string; client_name: string; client_id: string | null;
  starts_on: string; ends_on: string; kind: string; note: string;
  슬랙_비용: { 월_예산: number };
}

const DATA = JSON.parse(readFileSync(new URL('../data-work/week2-normalized.json', import.meta.url), 'utf8')) as {
  campaigns: Camp[]; tasks: Task[];
};
const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const ei = argv.indexOf('--expect-tasks');
  const expect = ei >= 0 ? Number(argv[ei + 1]) : null;
  const { campaigns, tasks } = DATA;
  const sql = getSql();

  console.log(`적재 대상 — 캠페인 ${campaigns.length}건 · 작업 ${tasks.length}건 · 합 ${man(tasks.reduce((a, t) => a + t.cost.amount, 0))}`);

  // ① 중복 적재 방지
  const dup = await sql.unsafe(`select name from campaign where name = any($1::text[])`, [campaigns.map((c) => c.name)]);
  if (dup.length) {
    console.error(`\n✗ 이미 있는 캠페인: ${dup.map((r: Record<string, string>) => r.name).join(', ')}`);
    console.error('  두 번 적재하지 않도록 중단합니다.');
    await sql.end(); process.exit(1);
  }

  // 생성할 클라이언트
  const needClient = campaigns.filter((c) => c.client_id === null);
  for (const c of needClient) {
    const hit = await sql.unsafe(`select id from client where name = $1`, [c.client_name]);
    if (hit.length) { console.error(`\n✗ '${c.client_name}' 가 이미 DB에 있습니다 — week2-normalized.json 의 client_id 를 채우고 다시 실행하세요.`); await sql.end(); process.exit(1); }
  }

  console.log('\n══ 만들 클라이언트 ══');
  if (!needClient.length) console.log('(없음)');
  for (const c of needClient) {
    console.log(`🆕 ${c.client_name} (name_en=${c.name_en.split('-')[0]} · 월 예산 ${man(c.슬랙_비용.월_예산)})`);
    console.log('   landing_url 은 비워 둡니다 — 백수약국 링크 2개는 지도 트래킹 링크라 브릿지 랜딩이 아닙니다(캠페인 메모에 남김)');
  }

  console.log('\n══ 만들 캠페인·작업 ══');
  for (const c of campaigns) {
    const mine = tasks.filter((t) => t.campaign === c.key);
    console.log(`\n━━ ${c.name} (${c.name_en}) · ${c.starts_on}~${c.ends_on} · ${c.kind} · ${c.client_name}`);
    console.log(`   메모: ${c.note}`);
    for (const t of mine) {
      const bits = [t.type, man(t.cost.amount)];
      if (t.post_url) bits.push(`게시 ${postedAtSeoul(t.post_url)} (답글 ${t.답글일})`); else bits.push('게시 전');
      if (!t.명부) bits.push('⚠️명부없음');
      if (t.note) bits.push(`메모: ${t.note}`);
      console.log(`   ${String(t.no).padStart(2)}. @${t.handle.padEnd(17)} ${bits.join(' · ')}`);
    }
    console.log(`   ─ ${mine.length}건 · ${man(mine.reduce((a, t) => a + t.cost.amount, 0))}`);
  }

  console.log('\n══ 게시일 ══');
  console.log('게시물 URL의 트윗 ID(스노플레이크)에서 파생한다 — 답글 시각이 아니다(scripts/tweetDate.ts, API 2건 대조 검증).');
  const posted = tasks.filter((t) => t.post_url);
  const days = [...new Set(posted.map((t) => postedOnSeoul(t.post_url as string)))].sort();
  console.log(`게시물 URL 있는 작업 ${posted.length}건(RT는 URL이 없어 여기 안 잡힌다) · 게시일 범위 ${days[0]} ~ ${days[days.length - 1]} · posted_source='manual'`);

  console.log('\n══ 넣지 않는 것 ══');
  console.log('· scheduled_on — 게시 예정일 정보가 슬랙에 없다');
  console.log('· 정산 요청 — 적재는 작업까지. 지급 요청은 화면에서 사람이 낸다');
  console.log('· 월 예산의 예외 달·랜딩 URL — 클라이언트 화면에서 별도로');

  if (!apply) {
    console.log(`\n드라이런입니다 — 실제로 넣으려면: --apply --expect-tasks ${tasks.length}`);
    await sql.end(); return;
  }
  if (expect === null) { console.error('\n✗ --apply 는 --expect-tasks N 과 함께 써야 합니다.'); await sql.end(); process.exit(2); }
  if (expect !== tasks.length) { console.error(`\n✗ 작업 수가 예상과 다릅니다 (예상 ${expect} · 실제 ${tasks.length}) — 중단합니다.`); await sql.end(); process.exit(2); }

  await sql.begin(async (tx) => {
    const clientIds = new Map<string, string>();
    for (const c of campaigns) if (c.client_id) clientIds.set(c.client_name, c.client_id);

    for (const c of needClient) {
      const [{ pos }] = await tx`select coalesce(max(position), -1) + 1 as pos from client`;
      const [row] = await tx`
        insert into client (name, name_en, monthly_budget, position)
        values (${c.client_name}, ${c.name_en.split('-')[0]}, ${c.슬랙_비용.월_예산}, ${pos})
        returning id`;
      clientIds.set(c.client_name, row.id as string);
      console.log(`✓ 클라이언트 ${c.client_name} → ${row.id}`);
    }

    let n = 0;
    for (const c of campaigns) {
      const clientId = clientIds.get(c.client_name);
      const [camp] = await tx`
        insert into campaign (client_id, client_name, name, name_en, starts_on, ends_on, kind, note, created_by)
        values (${clientId ?? null}, ${c.client_name}, ${c.name}, ${c.name_en},
                ${c.starts_on}, ${c.ends_on}, ${c.kind}, ${c.note}, ${KOO})
        returning id`;
      const mine = tasks.filter((t) => t.campaign === c.key);
      for (const t of mine) {
        const postedOn = t.post_url ? postedOnSeoul(t.post_url) : null;
        await tx`
          insert into campaign_task (campaign_id, influencer_handle, type, post_url, posted_at, posted_source, cost, note, created_by)
          values (${camp.id}, ${t.handle}, ${t.type}, ${t.post_url},
                  ${postedOn}, ${postedOn ? 'manual' : null},
                  ${tx.json(t.cost)}, ${t.note}, ${KOO})`;
        n += 1;
      }
      console.log(`✓ ${c.name} → 작업 ${mine.length}건`);
    }
    console.log(`\n적재 완료 — 캠페인 ${campaigns.length} · 작업 ${n}`);
  });

  const [after] = await sql.unsafe(`select
    (select count(*) from client) as client,
    (select count(*) from campaign) as campaign,
    (select count(*) from campaign_task) as task,
    (select count(*) from payment_request) as req`);
  console.log(`확인 — 클라이언트 ${after.client} · 캠페인 ${after.campaign} · 작업 ${after.task} · 정산 요청 ${after.req}(건드리지 않음)`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
