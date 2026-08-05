import type postgres from 'postgres';
import { callLLM, type AnthropicLike } from './llm.ts';
import { getClientWithProcedures } from './clientStore.ts';
import { getReferencesByIds } from './referenceStore.ts';
import { buildUserPrompt, draftOutputSchema, DRAFT_SYSTEM } from './generatePrompt.ts';
import { insertDraft, getDraft, updateDraft, type DraftRow } from './draftStore.ts';
import { X_MAX_WEIGHTED } from './xLength.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export const CONTENT_MODEL = () => process.env.CONTENT_MODEL ?? 'claude-opus-5';
export const MAX_REFS = 8; // few-shot 실무 상한 — 초과 시 원고가 레퍼런스 문구를 베낄 위험(over-copying)이 커진다

// 입력이 잘못된 경우 — 라우트가 400 + 평문으로 매핑
export class GenerateInputError extends Error {}

export interface GenerateRequest {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat;
  constraintsOn: boolean; memberId: string | null;
}

export async function generateDraft(
  sql: postgres.Sql, req: GenerateRequest, client?: AnthropicLike,
): Promise<string> {
  const hasClient = !!req.clientId;
  const hasRefs = req.refTweetIds.length > 0 && req.mode !== 'off';
  const hasDirection = req.direction.trim().length > 0;
  if (!hasClient && !hasRefs && !hasDirection) {
    throw new GenerateInputError('클라이언트·레퍼런스·방향성 중 최소 하나는 필요해요');
  }
  if (req.refTweetIds.length > MAX_REFS) {
    throw new GenerateInputError(`레퍼런스는 ${MAX_REFS}건까지 고를 수 있어요 — 서로 다른 앵글로 3~5건이 가장 좋아요`);
  }

  // 재료 로드
  const clientData = req.clientId ? await getClientWithProcedures(sql, req.clientId) : null;
  if (req.clientId && !clientData) throw new GenerateInputError('클라이언트를 찾을 수 없어요 — 목록을 새로고침해 주세요');
  const procedures = (clientData?.procedures ?? []).filter((p) => req.procedureIds.includes(p.id));
  const refRows = hasRefs ? await getReferencesByIds(sql, req.refTweetIds) : [];
  const refs: RefSnapshot[] = refRows.map((r) => ({
    tweetId: r.tweetId, handle: r.authorHandle, name: r.authorName,
    excerpt: r.text, memos: r.memos,
  }));
  if (hasRefs && refs.length < req.refTweetIds.length) {
    throw new GenerateInputError(
      `레퍼런스 ${req.refTweetIds.length - refs.length}건을 보관함에서 찾을 수 없어요 — 목록을 새로고침해 주세요`);
  }

  // 프롬프트 → LLM (구조화 출력)
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: refs, mode: hasRefs ? req.mode : 'off',
    direction: req.direction, format: req.format, constraintsOn: req.constraintsOn,
  });
  const res = await callLLM('anthropic.draft', {
    model: CONTENT_MODEL(),
    max_tokens: 16000, // Opus 5는 thinking 기본 ON — thinking+응답 합산 상한이라 여유 필요
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: draftOutputSchema() } },
  }, client);

  // 파싱 — 구조화 출력이라 JSON 보장이 원칙이나, 방어적으로 검증
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let posts: Array<{ text: string }>;
  try {
    posts = (JSON.parse(text) as { posts: Array<{ text: string }> }).posts;
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  if (!Array.isArray(posts) || posts.length === 0 || posts.some((p) => typeof p.text !== 'string' || !p.text.trim())) {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }

  const content: DraftContent = { posts: posts.map((p) => ({ text: p.text, media: [] })) };
  return insertDraft(sql, {
    clientId: req.clientId, clientName: clientData?.client.name ?? null,
    procedureNames: procedures.map((p) => p.name),
    direction: req.direction, format: req.format,
    referenceMode: hasRefs ? req.mode : 'off', refs,
    content, model: CONTENT_MODEL(), memberId: req.memberId,
  });
}

// 초안 전체 다시 쓰기 — 피드백이 있으면 반영, 없으면 같은 조건으로 재생성(겹치지 않게).
// 결과는 같은 초안의 새 버전(edited)이 되고 직전 표시본은 history에 보존된다.
// 레퍼런스는 초안의 스냅샷(발췌+메모)을 그대로 사용 — 보관함에서 지워져도 다시 쓰기는 동작.
// 클라이언트는 살아 있으면 다시 로드(시술은 스냅샷 이름으로 매칭), 삭제됐으면 없이 진행.
export async function rewriteDraft(
  sql: postgres.Sql, draftId: string, feedback: string | undefined, client?: AnthropicLike,
): Promise<DraftRow> {
  const draft = await getDraft(sql, draftId);
  if (!draft) throw new GenerateInputError('초안을 찾을 수 없어요');
  const base = draft.edited ?? draft.content;

  const clientData = draft.clientId ? await getClientWithProcedures(sql, draft.clientId) : null;
  const procedures = (clientData?.procedures ?? []).filter((p) => draft.procedureNames.includes(p.name));
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: draft.refs, mode: draft.refs.length > 0 ? draft.referenceMode : 'off',
    direction: draft.direction, format: draft.format,
    constraintsOn: false, // 생성 시점의 제약 토글은 초안에 저장되지 않음 — 사후 검수 표식이 항상 커버
    rewrite: { current: base.posts.map((p) => p.text), feedback },
  });

  const res = await callLLM('anthropic.draftRewrite', {
    model: CONTENT_MODEL(), max_tokens: 16000, system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: draftOutputSchema() } },
  }, client);

  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let posts: Array<{ text: string }>;
  try {
    posts = (JSON.parse(text) as { posts: Array<{ text: string }> }).posts;
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  if (!Array.isArray(posts) || posts.length === 0 || posts.some((p) => !p?.text?.trim())) {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  if (draft.format === 'single') posts = posts.slice(0, 1);

  const edited = { posts: posts.map((p, n) => ({ text: p.text, media: base.posts[n]?.media ?? [] })) };
  await updateDraft(sql, draftId, { edited, history: [...draft.history, base] });
  return (await getDraft(sql, draftId)) as DraftRow;
}

// 스레드에서 한 트윗만 다시 — 결과는 edited에 반영(원본 content 불변, 스펙 §2).
// 편집 중 상태(edited)가 있으면 그 위에서 교체한다.
export async function regeneratePost(
  sql: postgres.Sql, draftId: string, postIndex: number, client?: AnthropicLike,
): Promise<DraftRow> {
  const draft = await getDraft(sql, draftId);
  if (!draft) throw new GenerateInputError('초안을 찾을 수 없어요');
  const base = draft.edited ?? draft.content;
  if (!Number.isInteger(postIndex) || postIndex < 0 || postIndex >= base.posts.length) {
    throw new GenerateInputError('다시 만들 트윗을 찾을 수 없어요');
  }

  const thread = base.posts.map((p, n) => `${n + 1}. ${p.text}`).join('\n---\n');
  const user = [
    '아래는 X 스레드 초안입니다. 다른 포스트는 그대로 두고,',
    `${postIndex + 1}번 포스트만 같은 맥락에서 다른 표현·접근으로 다시 쓰세요.`,
    `가중 ${X_MAX_WEIGHTED}자(일본어 약 140자) 이내.`,
    draft.direction.trim() ? `방향성: ${draft.direction.trim()}` : '',
    '',
    thread,
    '',
    `출력: 다시 쓴 ${postIndex + 1}번 포스트 1개만 posts 배열에 담으세요.`,
  ].filter((l, n, arr) => l !== '' || arr[n - 1] !== '').join('\n');

  const res = await callLLM('anthropic.draftRegen', {
    model: CONTENT_MODEL(), max_tokens: 16000, system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: draftOutputSchema() } },
  }, client);

  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let posts: Array<{ text: string }>;
  try {
    posts = (JSON.parse(text) as { posts: Array<{ text: string }> }).posts;
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  if (!posts?.[0]?.text?.trim()) throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');

  const edited = {
    posts: base.posts.map((p, n) => (n === postIndex ? { text: posts[0].text, media: p.media } : p)),
  };
  // 직전 표시본을 이력에 보존 — ‹ 1/2 › 페이저로 이전 버전 열람 가능
  await updateDraft(sql, draftId, { edited, history: [...draft.history, base] });
  return (await getDraft(sql, draftId)) as DraftRow;
}
