import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { generateDraft, GenerateInputError, MAX_REFS, CONTENT_MODEL } from './generate.ts';
import { createClient, createProcedure } from './clientStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { getDraft, removeDraft } from './draftStore.ts';
import type { AnthropicLike } from './llm.ts';

const sql = getSql();
const P = 'test-gen-' + process.pid + '-';
const T1 = P + 'tw1';

function fakeLLM(capture?: (p: Record<string, unknown>) => void): AnthropicLike {
  return {
    messages: {
      create: async (p: object) => {
        capture?.(p as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '正直迷ってた。\n\n良かった。' }] }) }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: 'end_turn',
        };
      },
    },
  };
}

after(async () => {
  await sql`delete from draft where direction like ${P + '%'}`;
  await sql`delete from tweet where tweet_id like ${P + '%'}`;
  await sql`delete from client where name like ${P + '%'}`;
  await sql`delete from workspace where name like ${P + '%'}`;
  await sql`delete from member where name like ${P + '%'}`;
  await sql.end();
});

test('3요소 전부 비면 GenerateInputError', async () => {
  await assert.rejects(
    generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
      direction: '   ', format: 'single', constraintsOn: false, memberId: null,
    }, fakeLLM()),
    GenerateInputError,
  );
});

test('레퍼런스 8건 초과면 GenerateInputError', async () => {
  const ids = Array.from({ length: MAX_REFS + 1 }, (_, i) => `x${i}`);
  await assert.rejects(
    generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: ids, mode: 'both',
      direction: 'x', format: 'single', constraintsOn: false, memberId: null,
    }, fakeLLM()),
    GenerateInputError,
  );
});

test('생성 왕복: 스냅샷·모델 기록·프롬프트에 클라+레퍼런스+메모 포함', async () => {
  const ws = await createWorkspace(sql, P + 'ws');
  const c = await createClient(sql, P + 'A클리닉');
  await createProcedure(sql, c.id, { name: '보톡스', effectPhrases: '주름 완화' });
  const [m] = await sql<Array<{ id: string }>>`
    insert into member (name) values (${P + 'm'}) returning id`;
  await sql`insert into tweet (tweet_id, author_handle, text) values (${T1}, 'mika', '正直迷ってた')`;
  await sql`insert into library_item (workspace_id, tweet_id) values (${ws.id}, ${T1})`;
  await sql`insert into candidate (tweet_id, workspace_id, member_id, memo)
            values (${T1}, ${ws.id}, ${m.id}, '앵글이 신선')`;

  const client = await getClientProcIds(c.id);
  let sent: Record<string, unknown> = {};
  const id = await generateDraft(sql, {
    clientId: c.id, procedureIds: client, refTweetIds: [T1], mode: 'both',
    direction: P + '다운타임 강조', format: 'single', constraintsOn: false, memberId: null,
  }, fakeLLM((p) => { sent = p; }));

  try {
    assert.equal(sent.model, CONTENT_MODEL());
    assert.ok(sent.system);
    assert.ok(sent.output_config);
    const userMsg = (sent.messages as Array<{ content: string }>)[0].content;
    assert.ok(userMsg.includes(P + 'A클리닉') && userMsg.includes('正直迷ってた') && userMsg.includes('앵글이 신선'));

    const draft = await getDraft(sql, id);
    assert.equal(draft!.clientName, P + 'A클리닉');
    assert.deepEqual(draft!.procedureNames, ['보톡스']);
    assert.equal(draft!.refs[0].tweetId, T1);
    assert.equal(draft!.refs[0].memos[0].text, '앵글이 신선');
    assert.equal(draft!.content.posts.length, 1);
    assert.deepEqual(draft!.content.posts[0].media, []);
    assert.equal(draft!.model, CONTENT_MODEL());
  } finally {
    await removeDraft(sql, id);
    await deleteWorkspace(sql, ws.id);
  }
});

async function getClientProcIds(clientId: string): Promise<string[]> {
  const rows = await sql<Array<{ id: string }>>`
    select id from client_procedure where client_id = ${clientId}`;
  return rows.map((r) => r.id);
}
