// 슬랙 9월3주차 스레드를 다시 읽고 달라진 것만 캠페인 작업에 반영한다(멱등).
// 스레드는 답글이 계속 붙고 기존 답글도 수정되므로, 적재는 한 번으로 끝나지 않는다(9월2주차 sync-week2 선례).
//
// 2026-09-19 판독분(09-18분 포함). 근거: 미모드림 1789366144.350499 · 더스퀘어 1789366152.112109 · 백수약국 1789366166.539959
//
// 이 스크립트가 하는 일 4가지:
//   ① 새 작업 추가   ② 링크가 붙은 기존 작업에 post_url·posted_at 채우기(비어 있을 때만)
//   ③ 철 지난 메모 정리   ④ ❌(섭외 불성립)가 붙은 작업에 메모만 남긴다 — 행은 지우지 않는다
//
// 🔴 행 삭제는 하지 않는다. @pometab 은 ❌가 붙어 섭외가 깨졌지만, 지우는 것은 되돌리기 어려우므로
//    메모만 남기고 사람이 판단한다(9월2주차는 애초에 적재하지 않는 방식이었다).
// 게시일은 트윗 ID(스노플레이크)에서 파생한다 — 슬랙 답글 시각이 아니다.
//
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/sync-week3.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { postedOnSeoul, postedAtSeoul } from './tweetDate.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313';

interface Add { camp: string; handle: string; type: string; amount: number; url: string | null; note: string }
interface Link { camp: string; handle: string; url: string; note?: string }
interface Note { camp: string; handle: string; note: string }

// ① 새로 생긴 작업
const ADDS: Add[] = [
  { camp: '미모드림_9월3주차', handle: 'dpsnll', type: 'quoteRt', amount: 40000, url: null,
    note: '09-17 12:35 답글로 추가(10번) — 게시 전' },
  { camp: '더스퀘어치과_9월3주차', handle: 'nasu_seikei', type: 'quoteRt', amount: 80000,
    url: 'https://x.com/nasu_seikei/status/2100553676708594012',
    note: '09-17 14:38 답글로 추가(08번). 백수약국 3주차에도 같은 핸들 작업이 있었으나 그쪽은 09-19 ❌(섭외 불성립) — 결과적으로 이 건만 성사됐다' },
  // 09-19 판독분 — 백수약국 빈 행 3개에 핸들이 채워졌다(07·09는 09-18 저녁 게시, 08은 ❌라 넣지 않는다)
  { camp: '백수약국_9월3주차', handle: 'ararechan_note', type: 'quoteRt', amount: 110000,
    url: 'https://x.com/ararechan_note/status/2100873968085557536',
    note: '09-17 12:36 답글 07번에 핸들·금액이 채워짐' },
  { camp: '백수약국_9월3주차', handle: 'rinnabiyou417', type: 'quoteRt', amount: 100000,
    url: 'https://x.com/rinnabiyou417/status/2100878116101202001',
    note: '09-17 12:36 답글 09번에 핸들·금액이 채워짐' },
];

// ② 링크가 새로 붙은 기존 작업
const LINKS: Link[] = [
  { camp: '더스퀘어치과_9월3주차', handle: 'mpchan_a', url: 'https://x.com/mpchan_a/status/2100512338894049769', note: '' },
  { camp: '더스퀘어치과_9월3주차', handle: 'yuichan___27', url: 'https://x.com/yuichan___27/status/2100525053951778970', note: '연예인(슬랙 표기)' },
  { camp: '백수약국_9월3주차', handle: '_____noay', url: 'https://x.com/_____noay/status/2100873199512875344', note: '' },
];

// ③④ 메모만 고치는 것
const NOTES: Note[] = [
  { camp: '미모드림_9월3주차', handle: '4nAtumilK_4HInE', note: '' },                        // 협의 중 → 게시됨(09-17)
  { camp: '더스퀘어치과_9월3주차', handle: 'pometab', note: '❌ 섭외 불성립(09-18 확인) — 게시되지 않을 작업. 남길지 지울지 사람이 판단' },
  { camp: '백수약국_9월3주차', handle: 'nasu_seikei', note: '❌ 섭외 불성립(09-19 확인) — 같은 핸들이 더스퀘어 3주차에서는 09-17 게시됨' },
  { camp: '미모드림_9월3주차', handle: 'dpsnll', note: '09-17 12:35 답글로 추가(10번) · 💬 리액션 — 협의 중' },
  { camp: '미모드림_9월3주차', handle: 'for_hk_', note: 'RT 증빙 첨부 완료' },
  { camp: '미모드림_9월3주차', handle: 'mpchan_a', note: 'RT 증빙 첨부 완료' },
  { camp: '미모드림_9월3주차', handle: 'y_yunicha2', note: 'RT 증빙 첨부 완료' },
  { camp: '백수약국_9월3주차', handle: 'shioringo1224', note: 'RT 증빙 첨부 완료' },
  { camp: '백수약국_9월3주차', handle: 'aik_ooooo', note: 'RT 증빙 첨부 완료' },
  { camp: '백수약국_9월3주차', handle: 'umm___nnn', note: 'RT 증빙 첨부 완료 · 09-16 18:28 답글로 추가' },
];

const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const camps = new Map<string, string>();
  for (const r of await sql<Array<{ id: string; name: string }>>`select id, name from campaign where name like '%9월3주차'`) camps.set(r.name, r.id);

  const plan: Array<() => Promise<void>> = [];
  console.log('══ ① 새 작업 ══');
  for (const a of ADDS) {
    const cid = camps.get(a.camp);
    if (!cid) { console.log(`   ✗ 캠페인 없음: ${a.camp}`); continue; }
    const [hit] = await sql`select id from campaign_task where campaign_id = ${cid} and lower(influencer_handle) = ${a.handle.toLowerCase()} and type = ${a.type}`;
    if (hit) { console.log(`   · ${a.camp.replace('_9월3주차','')} @${a.handle}: 이미 있음 — 건너뜀`); continue; }
    const on = a.url ? postedOnSeoul(a.url) : null;
    console.log(`   + ${a.camp.replace('_9월3주차','').padEnd(8)} @${a.handle.padEnd(16)} ${a.type} ${man(a.amount)} ${a.url ? `게시 ${postedAtSeoul(a.url)}` : '게시 전'}`);
    plan.push(async () => { await sql`
      insert into campaign_task (campaign_id, influencer_handle, type, post_url, posted_at, posted_source, cost, note, created_by)
      values (${cid}, ${a.handle}, ${a.type}, ${a.url}, ${on}, ${on ? 'manual' : null},
              ${sql.json({ amount: a.amount, currency: 'KRW' })}, ${a.note}, ${KOO})`; });
  }

  console.log('\n══ ② 링크가 붙은 작업 ══');
  for (const l of LINKS) {
    const cid = camps.get(l.camp);
    const [row] = await sql<Array<{ id: string; post_url: string | null; posted_at: string | null }>>`
      select id, post_url, to_char(posted_at,'YYYY-MM-DD') as posted_at from campaign_task
       where campaign_id = ${cid} and lower(influencer_handle) = ${l.handle.toLowerCase()}`;
    if (!row) { console.log(`   ✗ 작업 없음: ${l.camp} @${l.handle}`); continue; }
    if (row.post_url) { console.log(`   · @${l.handle}: 이미 링크 있음 — 건너뜀`); continue; }
    const on = postedOnSeoul(l.url);
    console.log(`   ↑ ${l.camp.replace('_9월3주차','').padEnd(8)} @${l.handle.padEnd(16)} 게시 전 → 게시 ${postedAtSeoul(l.url)}`);
    plan.push(async () => { await sql`
      update campaign_task set post_url = coalesce(post_url, ${l.url}),
        posted_at = coalesce(posted_at, ${on}::date), posted_source = coalesce(posted_source, 'manual'),
        note = ${l.note ?? ''}, updated_at = now() where id = ${row.id}`; });
  }

  console.log('\n══ ③④ 메모 정리 ══');
  for (const n of NOTES) {
    const cid = camps.get(n.camp);
    const [row] = await sql<Array<{ id: string; note: string; h: string }>>`
      select id, note, influencer_handle as h from campaign_task
       where campaign_id = ${cid} and lower(influencer_handle) = ${n.handle.toLowerCase()} order by type limit 1`;
    if (!row) { console.log(`   ✗ 작업 없음: ${n.camp} @${n.handle}`); continue; }
    if (row.note === n.note) { console.log(`   · @${n.handle}: 그대로`); continue; }
    console.log(`   ✎ ${n.camp.replace('_9월3주차','').padEnd(8)} @${n.handle.padEnd(16)} "${row.note.slice(0, 30)}…" → "${n.note.slice(0, 40)}"`);
    plan.push(async () => { await sql`update campaign_task set note = ${n.note}, updated_at = now() where id = ${row.id}`; });
  }

  if (!plan.length) { console.log('\n바뀐 것이 없습니다.'); await sql.end(); return; }
  console.log(`\n반영할 변경 ${plan.length}건`);
  if (!apply) { console.log('드라이런입니다 — 실제로 반영하려면 --apply'); await sql.end(); return; }
  for (const f of plan) await f();
  console.log('\n반영 완료');
  const after = await sql`select c.name, count(*)::int as n, sum((t.cost->>'amount')::int)::int as total,
     count(*) filter (where t.posted_at is not null)::int as pub,
     coalesce(sum((t.cost->>'amount')::int) filter (where t.posted_at is not null),0)::int as pubamt
     from campaign c left join campaign_task t on t.campaign_id=c.id where c.name like '%9월3주차' group by c.name order by c.name`;
  for (const x of after) console.log(`   ${String(x.name).padEnd(20)} 작업 ${x.n}건 ${man(Number(x.total))} · 게시 ${x.pub}건 ${man(Number(x.pubamt))}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
