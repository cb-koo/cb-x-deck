// scripts/seed-staging-status.ts — 클라이언트 현황(스펙 2026-10-09-client-status-design.md §9) 확인용으로
// 운영 DB의 LINE 연동 3개 클리닉 데이터를 연습용 DB에 복사한다.
// 운영은 읽기 전용 트랜잭션으로만 읽고(.env), 쓰기는 연습용(.env.staging, assertStaging 통과)에만 한다. 재실행하면 지우고 다시.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { getSql } from '../src/lib/db.ts';
import { assertStaging } from './stagingGuard.ts';

assertStaging();

const SINCE = '2026-06-01';
type Row = Record<string, unknown>;

function prodSql(): postgres.Sql {
  const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]));
  if (env.PGHOST === process.env.PGHOST) { console.error('원본과 대상이 같은 DB예요 — 중단'); process.exit(2); }
  return postgres({ host: env.PGHOST, port: Number(env.PGPORT ?? 5432), username: env.PGUSER, password: env.PGPASSWORD, database: env.PGDATABASE, ssl: 'require', prepare: false, max: 1 });
}

(async () => {
  const dst = getSql();
  const src = prodSql();
  const data = await src.begin('read only', async (s) => {
    const clients = await s<Row[]>`select id, name, clinic_code from client where clinic_code is not null`;
    const ids = clients.map((c) => c.id as string), codes = clients.map((c) => c.clinic_code as string);
    const snaps = await s<Row[]>`select * from report_snapshot where clinic_code in ${s(codes)} and period_start >= ${SINCE}`;
    const camps = await s<Row[]>`select * from campaign where client_id in ${s(ids)} and starts_on >= ${SINCE}`;
    const campIds = camps.map((c) => c.id as string);
    const tasks = campIds.length ? await s<Row[]>`select * from campaign_task where campaign_id in ${s(campIds)}` : [];
    const taskIds = tasks.map((t) => t.id as string);
    const posts = taskIds.length ? await s<Row[]>`select * from tracked_post where task_id in ${s(taskIds)}` : [];
    const postIds = posts.map((p) => p.id as string);
    const metrics = postIds.length ? await s<Row[]>`select * from post_metric_snapshot where tracked_post_id in ${s(postIds)}` : [];
    const budgets = await s<Row[]>`select * from client_budget_period where client_id in ${s(ids)}`;
    return { clients, snaps, camps, tasks, posts, metrics, budgets };
  });
  await src.end();

  // 운영 클라이언트를 같은 id로 연습용에 둔다(없으면 만들고, clinic_code는 이 행으로 옮긴다)
  const map = new Map<string, string>(data.clients.map((c) => [c.id as string, c.id as string]));
  const json = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' && !(v instanceof Date) ? dst.json(v as postgres.JSONValue) : v]));
  const insert = async (table: string, rows: Row[]) => { for (let i = 0; i < rows.length; i += 200) await dst`insert into ${dst(table)} ${dst(rows.slice(i, i + 200).map(json))}`; };
  const taskSet = new Set(data.tasks.map((t) => t.id));

  await dst.begin(async (t) => {
    const codes = data.clients.map((c) => c.clinic_code as string);
    await t`update client set clinic_code = null where clinic_code in ${t(codes)} and id not in ${t([...map.values()])}`;
    for (const c of data.clients) await t`insert into client (id, name, clinic_code) values (${c.id as string}, ${c.name as string}, ${c.clinic_code as string})
      on conflict (id) do update set name = excluded.name, clinic_code = excluded.clinic_code`;
    await t`delete from report_snapshot where clinic_code in ${t(codes)}`;
    await t`delete from campaign where id in ${t(data.camps.map((c) => c.id as string).concat('00000000-0000-0000-0000-000000000000'))}`; // 작업·(task_id만 비는) 게시물은 cascade/set null
    await t`delete from tracked_post where tweet_id in ${t(data.posts.map((p) => p.tweet_id as string).concat('-'))}`;
    await t`delete from client_budget_period where client_id in ${t([...map.values()])}`;
  });
  await insert('report_snapshot', data.snaps);
  await insert('campaign', data.camps.filter((c) => map.has(c.client_id as string)).map((c) => ({ ...c, client_id: map.get(c.client_id as string), created_by: null })));
  await insert('campaign_task', data.tasks.map((t) => ({ ...t, draft_id: null, cancelled_draft_id: null, created_by: null, settled_elsewhere_by: null, visit_completed_by: null, payment_method_id: null, target_task_id: null })));
  for (const t of data.tasks) if (t.target_task_id && taskSet.has(t.target_task_id)) await dst`update campaign_task set target_task_id = ${t.target_task_id as string} where id = ${t.id as string}`;
  await insert('tracked_post', data.posts.map((p) => ({ ...p, created_by: null, draft_id: null })));
  await insert('post_metric_snapshot', data.metrics);
  await insert('client_budget_period', data.budgets.filter((b) => map.has(b.client_id as string)).map((b) => ({ ...b, client_id: map.get(b.client_id as string) })));

  console.log(`복사 완료 — 클라이언트 ${map.size} · 리포트 ${data.snaps.length} · 캠페인 ${data.camps.length} · 작업 ${data.tasks.length} · 게시물 ${data.posts.length} · 측정 ${data.metrics.length} · 예산 ${data.budgets.length}`);
  await dst.end();
})().catch((e) => { console.error(e); process.exit(1); });
