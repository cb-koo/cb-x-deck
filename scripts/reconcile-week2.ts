// 3자 대조 — 슬랙 스레드 ↔ 캠페인 작업(DB) ↔ 정산 요청(DB). 읽기 전용.
//
// diff-week2-slack 은 '슬랙 ↔ 원천 JSON'만 본다. 이 스크립트는 거기서 한 걸음 더 가서
// **돈이 실제로 나간 쪽(정산 요청)까지** 같은 값인지 본다. 한 군데라도 어긋나면 지급이 틀어진다.
//
// 보는 것:
//   ① 슬랙 번호행 ↔ DB 작업 — 빠진 것·더 있는 것·핸들·금액
//   ② DB 작업(완료) ↔ 정산 요청 — 요청 안 된 것·작업 없는 요청
//   ③ 금액 — 슬랙 만원 = 작업 cost = 요청 amount_krw
//   ④ 부모 '금주 소진' = 완료 작업 금액 합
//   ⑤ 요청의 실제 송금액 = 순액 + 수수료 (결제 수단 스냅샷과 맞나)
//
// 실행: node --env-file=.env --import tsx scripts/reconcile-week2.ts
import { readFileSync, existsSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { parseReply, parseParentCost } from './slackThreadParse.ts';

interface Task {
  no: number; campaign: string; handle: string; type: string; cost: { amount: number };
  post_url: string | null; 게시: boolean; 명부: boolean; note: string;
  proof_file?: string; slack_handle?: string;
}
interface Excluded { no: number; campaign: string; handle: string | null; 분류: string; 사유: string }
interface Camp { key: string; name: string; 슬랙_비용: { 금주_소진: number | null } }
interface Dump { collected_at: string; threads: Array<{ key: string; name: string; parent: string; replies: string[] }> }

const SRC = new URL('../data-work/week2-normalized.json', import.meta.url);
const DUMP = new URL('../data-work/week2-slack-dump.json', import.meta.url);
const man = (n: number | null) => (n === null ? '—' : `${(n / 10000).toLocaleString('ko-KR')}만원`);

async function main(): Promise<void> {
  const D = JSON.parse(readFileSync(SRC, 'utf8')) as { campaigns: Camp[]; tasks: Task[]; excluded: Excluded[] };
  const dump: Dump | null = existsSync(DUMP) ? JSON.parse(readFileSync(DUMP, 'utf8')) : null;
  if (!dump) console.log('⚠️ 슬랙 덤프가 없습니다 — ①④는 건너뜁니다.\n');
  const sql = getSql();
  const fails: string[] = [];
  const warns: string[] = [];
  const done = (t: Task) => t.게시 || (t.type === 'rt' && Boolean(t.proof_file));

  let totTask = 0, totDone = 0, totReq = 0, sumDone = 0, sumReq = 0;

  for (const c of D.campaigns) {
    const src = D.tasks.filter((t) => t.campaign === c.key);
    const ex = D.excluded.filter((e) => e.campaign === c.key);
    const th = dump?.threads.find((x) => x.key === c.key);

    const dbTasks = await sql`
      select t.id, t.influencer_handle as h, t.type, (t.cost->>'amount')::int as amt,
             t.post_url, to_char(t.posted_at,'YYYY-MM-DD') as posted, t.proof is not null as proof
        from campaign_task t join campaign cc on cc.id = t.campaign_id
       where cc.name = ${c.name}`;
    const reqs = await sql`
      select r.task_id, r.influencer_handle as h, r.task_type, r.amount_krw as krw,
             r.payout_currency as cur, r.amount_net as net, r.fee_amount as fee, r.amount_gross as gross,
             r.status, r.external_status, r.category
        from payment_request r where r.campaign_name = ${c.name}`;

    const dbDone = dbTasks.filter((r) => r.posted !== null);
    const active = reqs.filter((r) => r.status === 'requested');
    totTask += dbTasks.length; totDone += dbDone.length; totReq += active.length;
    sumDone += dbDone.reduce((a, r) => a + Number(r.amt), 0);
    sumReq += active.reduce((a, r) => a + Number(r.krw), 0);

    console.log(`━━ ${c.name}`);
    console.log(`   슬랙 번호행 ${th ? th.replies.filter((x) => parseReply(x).no !== null).length : '?'} · 원천 적재 ${src.length} + 제외 ${ex.length} · DB 작업 ${dbTasks.length} · 완료 ${dbDone.length} · 요청 ${active.length}`);

    // ① 슬랙 ↔ 원천/DB
    if (th) {
      const known = new Map(src.map((t) => [t.no, t]));
      const knownEx = new Map(ex.map((e) => [e.no, e]));
      for (const raw of th.replies) {
        const r = parseReply(raw);
        if (r.no === null) continue;
        const t = known.get(r.no), e = knownEx.get(r.no);
        if (!t && !e) { fails.push(`${c.name} ${r.no}번: 슬랙에 있는데 원천에 없다 (@${r.handle ?? '?'} ${man(r.amountKrw)})`); continue; }
        if (!t) continue;                                  // 제외행은 금액 대조 대상이 아니다
        const want = (t.slack_handle ?? t.handle).toLowerCase();
        if (r.handle && r.handle.toLowerCase() !== want) fails.push(`${c.name} ${r.no}번: 핸들 슬랙 @${r.handle} ≠ 원천 @${t.slack_handle ?? t.handle}`);
        if (r.amountKrw !== null && r.amountKrw !== t.cost.amount) fails.push(`${c.name} ${r.no}번 @${t.handle}: 금액 슬랙 ${man(r.amountKrw)} ≠ 원천 ${man(t.cost.amount)}`);
        const db = dbTasks.find((x) => String(x.h).toLowerCase() === t.handle.toLowerCase() && x.type === t.type);
        if (!db) fails.push(`${c.name} ${r.no}번 @${t.handle}: DB에 작업이 없다`);
        else if (Number(db.amt) !== t.cost.amount) fails.push(`${c.name} @${t.handle}: 금액 원천 ${man(t.cost.amount)} ≠ DB ${man(Number(db.amt))}`);
      }
      // ④ 부모 금주 소진
      const p = parseParentCost(th.parent);
      const doneSum = src.filter(done).reduce((a, t) => a + t.cost.amount, 0);
      if (p.thisWeek === null) warns.push(`${c.name}: 슬랙 부모 '금주 소진' 미갱신(00만원) — 실제 완료 ${man(doneSum)}`);
      else if (p.thisWeek !== doneSum) fails.push(`${c.name}: 부모 금주 소진 ${man(p.thisWeek)} ≠ 완료 작업 합 ${man(doneSum)}`);
      else console.log(`   ✓ 부모 금주 소진 ${man(p.thisWeek)} = 완료 작업 합`);
    }

    // ② 완료 ↔ 요청
    const reqByTask = new Map(active.map((r) => [r.task_id as string, r]));
    for (const d of dbDone) {
      const r = reqByTask.get(d.id as string);
      if (!r) {
        const inf = await sql`select coalesce(jsonb_array_length(payment_methods),0) as pm,
            (select m->>'identifier' from jsonb_array_elements(payment_methods) m where (m->>'isDefault')::bool) as ident,
            (select m->>'type' from jsonb_array_elements(payment_methods) m where (m->>'isDefault')::bool) as ty
          from influencer where lower(handle)=${String(d.h).toLowerCase()}`;
        const pm = inf.length ? Number(inf[0].pm) : 0;
        const why = !inf.length ? '명부 없음' : pm === 0 ? '결제수단 없음'
          : (inf[0].ty === 'paypay' && !inf[0].ident) ? 'PayPay 식별값 없음' : '사유 불명 🔴';
        (why.includes('🔴') ? fails : warns).push(`${c.name} @${d.h}: 완료(${d.posted}) ${man(Number(d.amt))} 인데 요청 없음 — ${why}`);
        continue;
      }
      if (Number(r.krw) !== Number(d.amt)) fails.push(`${c.name} @${d.h}: 요청 금액 ${man(Number(r.krw))} ≠ 작업 ${man(Number(d.amt))}`);
      if (r.task_type !== d.type) fails.push(`${c.name} @${d.h}: 요청 유형 ${r.task_type} ≠ 작업 ${d.type}`);
      if (Number(r.net) + Number(r.fee) !== Number(r.gross)) fails.push(`${c.name} @${d.h}: 순액 ${r.net} + 수수료 ${r.fee} ≠ 총액 ${r.gross}`);
    }
    // 작업 없는 요청 / 완료 아닌 작업의 요청
    for (const r of active) {
      const d = dbTasks.find((x) => x.id === r.task_id);
      if (!d) fails.push(`${c.name} @${r.h}: 요청이 있는데 대응 작업이 없다(task_id ${r.task_id})`);
      else if (d.posted === null) fails.push(`${c.name} @${r.h}: 게시 전인데 요청이 나갔다`);
    }
    console.log('');
  }

  console.log('════════════ 총계 ════════════');
  console.log(`작업 ${totTask} · 완료 ${totDone}(${man(sumDone)}) · 요청 ${totReq}(${man(sumReq)}) · 미요청 ${totDone - totReq}(${man(sumDone - sumReq)})`);
  const [g] = await sql`select count(*) as n, sum(amount_krw) as krw from payment_request where status='requested'`;
  if (Number(g.n) !== totReq) fails.push(`전체 요청 ${g.n}건 ≠ 캠페인별 합 ${totReq}건 — 9월2주차 밖 요청이 있다`);

  console.log('');
  for (const w of warns) console.log(`⚠️  ${w}`);
  if (!fails.length) console.log('\n✓ 3자 대조 통과 — 슬랙·작업·정산 요청이 모두 같다');
  else { console.log(`\n✗ 불일치 ${fails.length}건`); for (const f of fails) console.log(`   ✗ ${f}`); }
  await sql.end();
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
