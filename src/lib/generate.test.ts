import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import type postgres from 'postgres';
import { getSql } from './db.ts';
import { generateDraft, regeneratePost, rewriteDraft, GenerateInputError, MAX_REFS, CONTENT_MODEL } from './generate.ts';
import { createClient, createProcedure } from './clientStore.ts';
import { createWorkspace, deleteWorkspace } from './workspaceStore.ts';
import { getDraft, removeDraft, updateDraft } from './draftStore.ts';
import { savePromptOverrides } from './promptSettings.ts';
import { PROMPT_DEFAULTS } from './generatePrompt.ts';
import type { AnthropicLike } from './llm.ts';
import { createCampaign } from './campaignStore.ts';
import { createTasks } from './campaignTaskStore.ts';

const sql = getSql();
const P = 'test-gen-' + process.pid + '-';
const T1 = P + 'tw1';

function fakeLLM(capture?: (p: Record<string, unknown>) => void): AnthropicLike {
  return {
    messages: {
      create: async (p: object) => {
        // 번역 호출(부가물)이 마지막에 오므로 캡처는 원고 호출만 — 테스트 의도 보존
        const prompt = String((p as { messages?: Array<{ content?: unknown }> }).messages?.[0]?.content ?? '');
        if (!prompt.includes('번역가')) capture?.(p as Record<string, unknown>);
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
    const content = ((p as { messages: Array<{ content: string }> }).messages[0]).content;
    // 번역 호출(부가물)이 마지막에 오므로 캡처는 원고 호출만 — 테스트 의도 보존
    if (!content.includes('번역가')) prompt = content;
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

test('인용RT 대상은 보관함 없이 스냅샷으로 저장되고, 다시 쓰기·부분 재생성에도 대상 지시를 쓴다', async () => {
  const targetId = `9${process.pid}12345678`;
  const camp = await createCampaign(sql, {
    clientId: null, clientName: null, name: P + 'quote-target', nameEn: P + 'quote-target',
    startsOn: '2026-09-01', endsOn: '2026-09-07', kind: null, note: '', createdBy: null,
  });
  await sql`insert into tweet (tweet_id, author_handle, author_name, text, metrics)
            values (${targetId}, 'target_author', '대상 작성자', '대상 게시물의 실제 내용', ${sql.json({})})`;
  const [task] = await createTasks(sql, camp.id, {
    type: 'quoteRt', targetTaskId: null, targetTweetUrl: `https://x.com/target_author/status/${targetId}`,
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [],
  });
  let prompt = '';
  const capture: AnthropicLike = { messages: { create: async (p: object) => {
    const content = String((p as { messages: Array<{ content: string }> }).messages[0].content);
    if (!content.includes('번역가')) prompt = content;
    return { content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '인용RT 초안' }] }) }] } as never;
  } } };
  let id: string | null = null;
  let fetched = false;
  try {
    [id] = await generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: [], quoteTargetTaskId: task.id, mode: 'off',
      direction: '', format: 'single', constraintsOn: false, memberId: null,
    }, capture, { getTweetDetail: async () => { fetched = true; return null; } });
    const draft = await getDraft(sql, id);
    assert.deepEqual(draft!.refs.map((r) => [r.tweetId, r.role]), [[targetId, 'quoteTarget']]);
    assert.ok(prompt.includes('인용할 대상 게시물') && prompt.includes('대상 게시물의 실제 내용'));
    assert.equal(fetched, false, '캐시된 대상은 X 상세 조회를 하지 않는다');
    const [saved] = await sql<Array<{ n: string }>>`select count(*) as n from library_item where tweet_id = ${targetId}`;
    assert.equal(Number(saved.n), 0, '인용 대상은 보관함에 자동 저장하지 않는다');
    await rewriteDraft(sql, id, {}, capture);
    assert.ok(prompt.includes('인용할 대상 게시물'));
    await regeneratePost(sql, id, 0, capture);
    assert.ok(prompt.includes('인용할 대상 게시물'));
  } finally {
    if (id) await removeDraft(sql, id);
    await sql`delete from campaign_task where campaign_id = ${camp.id}`;
    await sql`delete from campaign where id = ${camp.id}`;
    await sql`delete from tweet where tweet_id = ${targetId}`;
  }
});

test('없는 일반 레퍼런스는 인용 대상 상세 조회보다 먼저 막는다', async () => {
  const targetId = `8${process.pid}12345678`;
  const camp = await createCampaign(sql, {
    clientId: null, clientName: null, name: P + 'quote-no-ref', nameEn: P + 'quote-no-ref',
    startsOn: '2026-09-01', endsOn: '2026-09-07', kind: null, note: '', createdBy: null,
  });
  const [task] = await createTasks(sql, camp.id, {
    type: 'quoteRt', targetTaskId: null, targetTweetUrl: `https://x.com/target_author/status/${targetId}`,
    draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null, items: [],
  });
  let fetched = false;
  try {
    await assert.rejects(generateDraft(sql, {
      clientId: null, procedureIds: [], refTweetIds: [P + 'missing-ref'], quoteTargetTaskId: task.id, mode: 'both',
      direction: '', format: 'single', constraintsOn: false, memberId: null,
    }, fakeLLM(), { getTweetDetail: async () => { fetched = true; return null; } }), GenerateInputError);
    assert.equal(fetched, false);
  } finally {
    await sql`delete from campaign_task where campaign_id = ${camp.id}`;
    await sql`delete from campaign where id = ${camp.id}`;
  }
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

// prompt_template_version은 최신 행 = 팀 전역 설정이라, 커밋되는 테스트 행은 그 순간 실제 생성에 반영된다.
// 트랜잭션 안에서 저장→generateDraft 왕복을 검증하고 강제 롤백해 프로덕션 오염 창을 0으로 만든다
// (promptSettings.test.ts와 동일한 하네스).
const ROLLBACK = Symbol('rollback');

test('저장한 프롬프트 오버라이드가 생성 프롬프트에 반영된다 (롤백 하네스)', async () => {
  await sql.begin(async (tx) => {
    const txSql = tx as unknown as postgres.Sql;
    await savePromptOverrides(txSql, { system: '오버라이드된 역할 지시', hook: '오버라이드된 훅 지시' }, null);

    let sent: Record<string, unknown> = {};
    // direction만 있으면 3요소(클라·레퍼런스·방향성) 검증 통과 — API 비용 없이 fakeLLM으로 캡처
    // generateDraft 내부의 sql.begin은 count>1일 때만 타므로(count 미지정=1) 중첩 트랜잭션 이슈 없음.
    await generateDraft(txSql, {
      clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
      direction: '반영 확인용', format: 'single', constraintsOn: false, memberId: null,
    }, fakeLLM((p) => { sent = p; }));

    assert.equal(sent.system, '오버라이드된 역할 지시');
    const userMsg = (sent.messages as Array<{ content: string }>)[0].content;
    assert.ok(userMsg.includes('오버라이드된 훅 지시'));
    assert.ok(!userMsg.includes(PROMPT_DEFAULTS.hook));

    throw ROLLBACK;
  }).catch((e) => { if (e !== ROLLBACK) throw e; });
  // generateDraft가 tx 안에서 draft를 insert하지만(단일 생성은 sql.begin을 타지 않아도 위 트랜잭션 자체가
  // 이 롤백 하네스이므로) 상위 트랜잭션 롤백과 함께 draft·prompt_template_version 행 모두 사라진다.
  // 하네스 밖 잔존물 재확인은 불필요 — 최신 행 오염 여부는 promptSettings.test.ts가 이미 커버.
});

// 프롬프트로 분기하는 fake — 원고 요청은 posts JSON, 번역 요청(translateDraftPosts의 프롬프트에 '번역가' 포함)은 번호 키+title JSON
function fakeWithGloss(): AnthropicLike {
  return { messages: { create: async (p: unknown) => {
    const prompt = String((p as { messages: Array<{ content: unknown }> }).messages[0].content);
    if (prompt.includes('번역가')) {
      return { content: [{ type: 'text', text: JSON.stringify({ title: '다운타임 후기형', '1': '한국어 대역입니다' }) }] } as never;
    }
    return { content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '日本語の本文' }] }) }] } as never;
  } } };
}

test('생성 시 한국어 대역이 번역 캐시에 저장되고 koLatest로 노출된다', async () => {
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '대역캐시', format: 'single', constraintsOn: false, memberId: null,
  }, fakeWithGloss());
  try {
    const draft = await getDraft(sql, id);
    assert.ok(draft!.translation);                                   // null 아님
    assert.equal(Object.keys(draft!.translation!).length, 1);        // 버전 1개 = 키 1개
    assert.deepEqual(Object.values(draft!.translation!)[0], ['한국어 대역입니다']);
    assert.deepEqual(draft!.koLatest, ['한국어 대역입니다']);         // 최신 버전 파생값
    assert.equal(draft!.koTitle, '다운타임 후기형');                  // 제목도 동승 저장
  } finally {
    await removeDraft(sql, id);
  }
});

test('편집(updateDraft로 edited 변경)하면 koTitle이 null로 파생된다 — 해시 불일치로 스테일 방지', async () => {
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '제목스테일', format: 'single', constraintsOn: false, memberId: null,
  }, fakeWithGloss());
  try {
    const before = await getDraft(sql, id);
    assert.equal(before!.koTitle, '다운타임 후기형');
    // 원문을 편집 — koTitle의 해시(원본 버전)와 최신 버전(edited)의 해시가 어긋난다
    await updateDraft(sql, id, { edited: { posts: [{ text: '편집된 본문', media: [] }] } });
    const after = await getDraft(sql, id);
    assert.equal(after!.koTitle, null); // 저장된 ko_title_hash는 그대로지만 최신 버전과 불일치해 숨김
  } finally {
    await removeDraft(sql, id);
  }
});

test('번역 응답에 title이 없으면 koTitle은 null이고 translation은 정상 저장', async () => {
  const fake: AnthropicLike = { messages: { create: async (p: unknown) => {
    const prompt = String((p as { messages: Array<{ content: unknown }> }).messages[0].content);
    if (prompt.includes('번역가')) {
      return { content: [{ type: 'text', text: JSON.stringify({ '1': '한국어 대역입니다' }) }] } as never; // title 키 없음
    }
    return { content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '日本語の本文' }] }) }] } as never;
  } } };
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '제목없음', format: 'single', constraintsOn: false, memberId: null,
  }, fake);
  try {
    const draft = await getDraft(sql, id);
    assert.equal(draft!.koTitle, null);
    assert.deepEqual(draft!.koLatest, ['한국어 대역입니다']); // 번역 자체는 정상 저장
  } finally {
    await removeDraft(sql, id);
  }
});

test('번역이 실패해도 생성은 성공하고 캐시만 비어 있다', async () => {
  // fakeLLM은 모든 호출(원고+번역)에 posts JSON을 반환 — 번역 요청 파싱은 번호 키가 없어 null이 되고,
  // generateDraft의 try/catch(생략 계약)가 그 null을 그대로 받아들여 생성 자체는 막지 않는다.
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '대역실패', format: 'single', constraintsOn: false, memberId: null,
  }, fakeLLM());
  try {
    const draft = await getDraft(sql, id);
    assert.ok(draft);                       // 생성 자체는 성공
    assert.equal(draft!.translation, null); // 캐시만 비어 있음
    assert.equal(draft!.koLatest, null);
  } finally {
    await removeDraft(sql, id);
  }
});

test('다시 쓰기의 새 버전에도 대역이 저장된다', async () => {
  const [id] = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: P + '대역다시쓰기', format: 'single', constraintsOn: false, memberId: null,
  }, fakeWithGloss());
  // 다시 쓰기 단계는 원본과 다른 일본어 본문을 반환하는 별도 fake를 쓴다 — 두 버전이 같은 텍스트면
  // sourceHash가 같아져 캐시 키가 우연히 겹치고, "버전마다 별도 캐시"라는 이 기능의 핵심을 검증하지 못한다.
  const rewriteFake: AnthropicLike = { messages: { create: async (p: unknown) => {
    const prompt = String((p as { messages: Array<{ content: unknown }> }).messages[0].content);
    if (prompt.includes('번역가')) {
      return { content: [{ type: 'text', text: JSON.stringify({ '1': '한국어 대역입니다' }) }] } as never;
    }
    return { content: [{ type: 'text', text: JSON.stringify({ posts: [{ text: '書き直し日本語本文' }] }) }] } as never;
  } } };
  try {
    const updated = await rewriteDraft(sql, id, {}, rewriteFake);
    assert.deepEqual(updated.koLatest, ['한국어 대역입니다']);              // 최신 버전(새 버전)의 대역
    assert.equal(Object.keys(updated.translation ?? {}).length, 2);      // 원본 버전 + 새 버전
  } finally {
    await removeDraft(sql, id);
  }
});
