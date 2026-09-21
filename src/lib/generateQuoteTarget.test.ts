import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks, type TaskCreateInput } from './campaignTaskStore.ts';
import { generateDraft, type GenerateRequest } from './generate.ts';
import { getDraft } from './draftStore.ts';
import type { AnthropicLike } from './llm.ts';

const sql = getSql();
const prefix = `test-quote-${process.pid}-`;
let campaignId: string;
let sequence = 0;
const tweets: string[] = [];
const drafts: string[] = [];
const nextTweetId = () => {
  const id = `97${process.pid}${++sequence}00000`;
  tweets.push(id);
  return id;
};
before(async () => {
  const campaign = await createCampaign(sql, {
    clientId: null, clientName: null, name: prefix, nameEn: prefix,
    startsOn: '2026-09-01', endsOn: '2026-09-07', kind: null, note: '', createdBy: null,
  });
  campaignId = campaign.id;
});
after(async () => {
  if (drafts.length) await sql`delete from draft where id = any(${drafts}::uuid[])`;
  if (campaignId) await sql`delete from campaign where id = ${campaignId}`;
  if (tweets.length) await sql`delete from tweet where tweet_id = any(${tweets})`;
  await sql.end();
});

async function task(overrides: Partial<TaskCreateInput> = {}) {
  const [row] = await createTasks(sql, campaignId, {
    type: 'quoteRt', targetTaskId: null, targetTweetUrl: null, draftId: null,
    scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [], ...overrides,
  });
  return row;
}
function request(id: string, patch: Partial<GenerateRequest> = {}): GenerateRequest {
  return { clientId: null, procedureIds: [], refTweetIds: [], mode: 'both',
    direction: prefix, format: 'single', constraintsOn: false, memberId: null,
    quoteTargetTaskId: id, ...patch };
}
function llm() {
  const calls: object[] = [];
  const client: AnthropicLike = { messages: { create: async (params) => {
    calls.push(params);
    return { content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '生成された原稿' }] }) }] };
  } } };
  return { calls, client };
}
const raw = (id: string) => ({ id, text: '対象の本文', author: { userName: 'target' } });

test('처음 읽는 대상은 조회 후 캐시에만 저장하고, 다음 생성은 캐시를 사용한다', async () => {
  const id = nextTweetId();
  const row = await task({ targetTweetUrl: `https://x.com/target/status/${id}` });
  let fetches = 0;
  const x = { getTweetDetail: async () => { fetches++; return raw(id); } };
  const mock = llm();
  const created = await generateDraft(sql, request(row.id), mock.client, x);
  drafts.push(...created);
  assert.equal(fetches, 1);
  const saved = await getDraft(sql, created[0]);
  assert.equal(saved?.refs[0].role, 'quoteTarget');
  assert.equal(saved?.taskId, null); // 문맥 제공은 시안 부착이 아니다.
  const library = await sql`select 1 from library_item where tweet_id = ${id}`;
  assert.equal(library.length, 0);
  drafts.push(...await generateDraft(sql, request(row.id), mock.client, x));
  assert.equal(fetches, 1);
});

test('대상 조회 실패·빈 본문·다른 게시물 응답이면 AI를 호출하지 않는다', async () => {
  const id = nextTweetId();
  const row = await task({ targetTweetUrl: `https://x.com/target/status/${id}` });
  const cases = [
    { read: async () => null, message: /대상 게시물을 읽을 수 없어요/ },
    { read: async () => { throw new Error('upstream unavailable'); }, message: /잠시 후 다시 시도/ },
    { read: async () => ({ ...raw(id), text: '' }), message: /내용을 읽을 수 없어요/ },
    { read: async () => raw('999'), message: /대상 링크를 다시 확인/ },
  ];
  for (const example of cases) {
    const mock = llm();
    await assert.rejects(generateDraft(sql, request(row.id), mock.client, { getTweetDetail: example.read }), example.message);
    assert.equal(mock.calls.length, 0);
  }
});

test('대상과 겹치는 레퍼런스는 보관함에 없어도 한 번만 포함한다', async () => {
  const id = nextTweetId();
  const row = await task({ targetTweetUrl: `https://x.com/target/status/${id}` });
  const mock = llm();
  const created = await generateDraft(sql, request(row.id, { refTweetIds: [id, id] }), mock.client, { getTweetDetail: async () => raw(id) });
  drafts.push(...created);
  assert.deepEqual((await getDraft(sql, created[0]))?.refs.map((r) => r.tweetId), [id]);
});

test('대상 포함 9건이면 대상 조회와 AI 호출 전에 거절한다', async () => {
  const id = nextTweetId();
  const row = await task({ targetTweetUrl: `https://x.com/target/status/${id}` });
  const mock = llm();
  let fetched = false;
  await assert.rejects(generateDraft(sql, request(row.id, {
    refTweetIds: Array.from({ length: 8 }, (_, n) => `ref-${n}`),
  }), mock.client, { getTweetDetail: async () => { fetched = true; return raw(id); } }), /8건까지/);
  assert.equal(fetched, false);
  assert.equal(mock.calls.length, 0);
});

test('대상 작업의 게시 링크를 읽고, 게시 전에는 방향성만으로 생성할 수 있다', async () => {
  const target = await task({ type: 'post' });
  const row = await task({ targetTaskId: target.id });
  const mock = llm();
  let fetched = false;
  const id = nextTweetId();
  const x = { getTweetDetail: async () => { fetched = true; return raw(id); } };
  const pending = await generateDraft(sql, request(row.id), mock.client, x);
  drafts.push(...pending);
  assert.equal(fetched, false);
  assert.deepEqual((await getDraft(sql, pending[0]))?.refs, []);
  await sql`update campaign_task set post_url = ${`https://x.com/target/status/${id}`} where id = ${target.id}`;
  const posted = await generateDraft(sql, request(row.id), mock.client, x);
  drafts.push(...posted);
  assert.equal(fetched, true);
  assert.equal((await getDraft(sql, posted[0]))?.refs[0].tweetId, id);
});

test('취소된 대상 작업·인용RT가 아닌 문맥·잘못된 작업 ID는 비용 발생 전에 거절한다', async () => {
  const target = await task({ type: 'post' });
  const row = await task({ targetTaskId: target.id });
  await sql`update campaign_task set cancelled_at = now() where id = ${target.id}`;
  const mock = llm();
  let fetched = false;
  const x = { getTweetDetail: async () => { fetched = true; return null; } };
  await assert.rejects(generateDraft(sql, request(row.id), mock.client, x), /대상 작업이 취소/);
  await assert.rejects(generateDraft(sql, request(target.id), mock.client, x), /인용RT 작업에서만/);
  await assert.rejects(generateDraft(sql, request('invalid'), mock.client, x), /작업 정보가 올바르지/);
  assert.equal(fetched, false);
  assert.equal(mock.calls.length, 0);
});
