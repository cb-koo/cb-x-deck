import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { generateDraft, regeneratePost, rewriteDraft, GenerateInputError, MAX_REFS, CONTENT_MODEL } from './generate.ts';
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
  const [id] = await generateDraft(sql, {
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

function fakeThread(): AnthropicLike {
  return { messages: { create: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '1番' }, { text: '2番' }, { text: '3番' }] }) }],
    usage: { input_tokens: 100, output_tokens: 50 },
    stop_reason: 'end_turn',
  }) } };
}

test('스레드 부분 재생성: 해당 post만 edited에 반영, content 불변', async () => {
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '스레드', format: 'thread', constraintsOn: false, memberId: null,
  }, fakeThread());
  const regenFake: AnthropicLike = { messages: { create: async () => ({
    content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '新2番' }] }) }],
    usage: { input_tokens: 100, output_tokens: 20 },
    stop_reason: 'end_turn',
  }) } };
  try {
    const updated = await regeneratePost(sql, id, 1, regenFake);
    assert.equal(updated.edited!.posts.length, 3);
    assert.equal(updated.edited!.posts[0].text, '1番');   // 나머지 유지
    assert.equal(updated.edited!.posts[1].text, '新2番'); // 대상만 교체
    assert.equal(updated.content.posts[1].text, '2番');   // 원본 불변
    assert.equal(updated.history.length, 1);              // 직전 표시본이 이력에 보존
    assert.equal(updated.history[0].posts[1].text, '2番');

    // 한 번 더 재생성하면 이력이 쌓인다
    const again = await regeneratePost(sql, id, 1, regenFake);
    assert.equal(again.history.length, 2);
    assert.equal(again.history[1].posts[1].text, '新2番');
  } finally {
    await removeDraft(sql, id);
  }
});

test('다시 쓰기: 피드백이 프롬프트에 실리고, 직전 표시본이 history에 보존', async () => {
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '다시쓰기', format: 'single', constraintsOn: false, memberId: null,
  }, fakeLLM());
  let prompt = '';
  const rwFake: AnthropicLike = { messages: { create: async (p: object) => {
    prompt = ((p as { messages: Array<{ content: string }> }).messages[0]).content;
    return {
      content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '書き直し版' }, { text: '余分' }] }) }],
      usage: { input_tokens: 100, output_tokens: 30 },
      stop_reason: 'end_turn',
    };
  } } };
  try {
    const updated = await rewriteDraft(sql, id, { feedback: '비용 얘기는 빼줘' }, rwFake);
    assert.ok(prompt.includes('비용 얘기는 빼줘'));            // 피드백 전달
    assert.ok(prompt.includes('正直迷ってた。'));               // 현재 버전 전문 포함
    assert.equal(updated.edited!.posts.length, 1);             // single은 1개로 절단
    assert.equal(updated.edited!.posts[0].text, '書き直し版');
    assert.equal(updated.history.length, 1);                   // 직전 표시본 보존
    assert.deepEqual(updated.history[0], updated.content);
    // 피드백 없이 한 번 더 — 겹침 금지 지시 확인 + 이력 축적
    const again = await rewriteDraft(sql, id, {}, rwFake);
    assert.ok(prompt.includes('겹치지 않게'));
    assert.equal(again.history.length, 2);
    // 기준 버전 지정 — 1번(원본)을 기준으로: 프롬프트에 원본만 실리고 최신본은 안 실림
    const fromV1 = await rewriteDraft(sql, id, { baseIndex: 0, feedback: '더 캐주얼하게' }, rwFake);
    assert.ok(prompt.includes('正直迷ってた。'));
    assert.ok(!prompt.includes('書き直し版'));
    assert.equal(fromV1.history.length, 3);                    // 타임라인은 선형으로 계속 쌓임
    // 범위 밖 버전이면 GenerateInputError
    await assert.rejects(rewriteDraft(sql, id, { baseIndex: 99 }, rwFake), GenerateInputError);
  } finally {
    await removeDraft(sql, id);
  }
});

test('잘못된 index면 GenerateInputError', async () => {
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '스레드2', format: 'thread', constraintsOn: false, memberId: null,
  }, fakeThread());
  try {
    await assert.rejects(regeneratePost(sql, id, 99, fakeThread()), GenerateInputError);
  } finally {
    await removeDraft(sql, id);
  }
});

test('요청한 레퍼런스가 보관함에 없으면 GenerateInputError (유료 호출 전 차단)', async () => {
  let called = false;
  const fake: AnthropicLike = { messages: { create: async () => { called = true; return { content: [] }; } } };
  await assert.rejects(
    generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: [P + 'no-such-tweet'], mode: 'both',
      direction: '', format: 'single', constraintsOn: false, memberId: null,
    }, fake),
    GenerateInputError,
  );
  assert.equal(called, false);
});

test('count 3 — 1콜로 variants 3개를 받아 3행 삽입, 같은 batch·순번', async () => {
  const fake: AnthropicLike = { messages: { create: async (p: object) => {
    // variants 스키마가 전달됐는지 확인
    const schema = JSON.stringify(
      (p as { output_config?: { format?: { schema?: object } } }).output_config?.format?.schema ?? {});
    assert.ok(schema.includes('variants'));
    return {
      content: [{ type: 'text', text: JSON.stringify({ variants: [
        { posts: [{ text: '시안A本文' }] },
        { posts: [{ text: '시안B本文' }] },
        { posts: [{ text: '시안C本文' }] },
      ] }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    };
  } } };
  const ids = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '다중', format: 'single', constraintsOn: false, memberId: null, count: 3,
  }, fake);
  assert.equal(ids.length, 3);
  const rows = await Promise.all(ids.map((id) => getDraft(sql, id)));
  assert.equal(rows[0]!.content.posts[0].text, '시안A本文');
  assert.equal(rows[2]!.content.posts[0].text, '시안C本文');
  assert.ok(rows[0]!.batchId);                                  // 묶음 생성됨
  assert.equal(rows[1]!.batchId, rows[0]!.batchId);             // 같은 묶음
  assert.deepEqual(rows.map((r) => r!.variantIndex), [0, 1, 2]);
  for (const id of ids) await removeDraft(sql, id);
});

test('count 3인데 모델이 2개만 반환 — 받은 만큼만 삽입', async () => {
  const fake: AnthropicLike = { messages: { create: async (p: object) => {
    const schema = JSON.stringify(
      (p as { output_config?: { format?: { schema?: object } } }).output_config?.format?.schema ?? {});
    assert.ok(schema.includes('variants'));
    return {
      content: [{ type: 'text', text: JSON.stringify({ variants: [
        { posts: [{ text: '시안A本文' }] },
        { posts: [{ text: '시안B本文' }] },
      ] }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    };
  } } };
  const ids = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '부분반환', format: 'single', constraintsOn: false, memberId: null, count: 3,
  }, fake);
  assert.equal(ids.length, 2);
  const rows = await Promise.all(ids.map((id) => getDraft(sql, id)));
  assert.ok(rows[0]!.batchId);
  assert.equal(rows[1]!.batchId, rows[0]!.batchId);
  assert.deepEqual(rows.map((r) => r!.variantIndex), [0, 1]);
  for (const id of ids) await removeDraft(sql, id);
});

test('count 1 — 기존과 동일: posts 스키마·batch null', async () => {
  const fake: AnthropicLike = { messages: { create: async (p: object) => {
    const schema = JSON.stringify(
      (p as { output_config?: { format?: { schema?: object } } }).output_config?.format?.schema ?? {});
    assert.ok(!schema.includes('variants'));                     // 단일은 기존 posts 스키마
    return {
      content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '単発本文' }] }) }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    };
  } } };
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '단발', format: 'single', constraintsOn: false, memberId: null,
  }, fake);
  const row = await getDraft(sql, id);
  assert.equal(row!.batchId, null);
  assert.equal(row!.variantIndex, null);
  await removeDraft(sql, id);
});
