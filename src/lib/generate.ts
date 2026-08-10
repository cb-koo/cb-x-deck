import type postgres from 'postgres';
import { callLLM, type AnthropicLike } from './llm.ts';
import { getClientWithProcedures } from './clientStore.ts';
import { getReferencesByIds } from './referenceStore.ts';
import { buildUserPrompt, draftOutputSchema, variantsOutputSchema, draftSystem } from './generatePrompt.ts';
import { getPromptOverrides } from './promptSettings.ts';
import { insertDraft, getDraft, updateDraft, draftVersionHash, type DraftRow, type DraftTranslation } from './draftStore.ts';
import { translateDraftPosts } from './translateDraft.ts';
import { X_MAX_WEIGHTED } from './xLength.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';

export const CONTENT_MODEL = () => process.env.CONTENT_MODEL ?? 'claude-opus-5';
export const MAX_REFS = 8; // few-shot 실무 상한 — 초과 시 원고가 레퍼런스 문구를 베낄 위험(over-copying)이 커진다

// 대역은 부가물 — 번역이 지연·행에 빠져도 이미 과금된 원고 저장을 지연시키지 않는다 (최종 리뷰)
const GLOSS_TIMEOUT_MS = 15_000;
function withGlossTimeout(p: Promise<string[] | null>): Promise<string[] | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), GLOSS_TIMEOUT_MS))]);
}

// 입력이 잘못된 경우 — 라우트가 400 + 평문으로 매핑
export class GenerateInputError extends Error {}

export interface GenerateRequest {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat;
  constraintsOn: boolean; memberId: string | null;
  count?: number; // 시안 수 (1~5, 기본 1) — 라우트가 범위 검증
}

export async function generateDraft(
  sql: postgres.Sql, req: GenerateRequest, client?: AnthropicLike,
): Promise<string[]> {
  const count = req.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    throw new GenerateInputError('시안 수는 1~5 사이여야 해요');
  }
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

  // 팀이 /prompt에서 편집한 지시문 오버라이드 — 생성 시점의 최신 저장본 1회 로드
  const promptOverrides = await getPromptOverrides(sql);

  // 프롬프트 → LLM (구조화 출력) — count 1이면 기존 posts 스키마·프롬프트 그대로 (스펙 §1)
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: refs, mode: hasRefs ? req.mode : 'off',
    direction: req.direction, format: req.format, constraintsOn: req.constraintsOn,
    ...(count > 1 ? { variantCount: count } : {}),
  }, promptOverrides);
  const res = await callLLM('anthropic.draft', {
    model: CONTENT_MODEL(),
    max_tokens: 16000, // Opus 5는 thinking 기본 ON — thinking+응답 합산 상한이라 여유 필요
    system: draftSystem(promptOverrides),
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: count > 1 ? variantsOutputSchema() : draftOutputSchema() } },
  }, client);

  // 파싱 — 구조화 출력이라 JSON 보장이 원칙이나, 방어적으로 검증
  const text = res.content.find((b) => b.type === 'text')?.text ?? '';
  let variants: Array<{ posts: Array<{ text: string }> }>;
  try {
    variants = count > 1
      ? (JSON.parse(text) as { variants: Array<{ posts: Array<{ text: string }> }> }).variants
      : [JSON.parse(text) as { posts: Array<{ text: string }> }];
  } catch {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  const bad = (v: { posts?: Array<{ text?: string }> }) =>
    !Array.isArray(v?.posts) || v.posts.length === 0 || v.posts.some((p) => typeof p?.text !== 'string' || !p.text.trim());
  if (!Array.isArray(variants) || variants.length === 0 || variants.some(bad)) {
    throw new Error('AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해주세요');
  }
  // 모델이 count보다 적게/많게 반환하면 받은 만큼만 — 도착한 카드 수가 곧 사실 (스펙 §3)
  variants = variants.slice(0, count);

  // 한국어 대역 — 부가물이라 실패(null·예외)해도 생성을 막지 않는다. mock client를 그대로 전달(테스트 가능성)
  const glosses = await Promise.all(variants.map(async (v) => {
    try { return await withGlossTimeout(translateDraftPosts(v.posts.map((p) => p.text), client)); }
    catch (e) { console.warn('[draft] 대역 생성 생략', { err: e instanceof Error ? e.message : String(e) }); return null; }
  }));
  const glossOf = (i: number): DraftTranslation | null => {
    const g = glosses[i];
    if (!g) return null;
    return { [draftVersionHash(variants[i].posts)]: g };
  };

  const batchId = count > 1 ? crypto.randomUUID() : null;
  const toContent = (v: { posts: Array<{ text: string }> }): DraftContent =>
    ({ posts: v.posts.map((p) => ({ text: p.text, media: [] })) });
  const insertOne = (tx: postgres.Sql, i: number) => insertDraft(tx, {
    clientId: req.clientId, clientName: clientData?.client.name ?? null,
    procedureNames: procedures.map((p) => p.name),
    direction: req.direction, format: req.format,
    referenceMode: hasRefs ? req.mode : 'off', refs,
    content: toContent(variants[i]), model: CONTENT_MODEL(), memberId: req.memberId,
    batchId, variantIndex: batchId ? i : null,
    translation: glossOf(i),
  });
  // 배치는 한 단위 — 중간 실패 시 고아 부분 배치가 남지 않게 트랜잭션. 단일 생성은 기존 경로 그대로.
  if (!batchId) return [await insertOne(sql, 0)];
  return sql.begin((tx) => Promise.all(variants.map((_, i) => insertOne(tx as unknown as postgres.Sql, i)))) as Promise<string[]>;
}

// 초안 전체 다시 쓰기 — 피드백이 있으면 반영, 없으면 같은 조건으로 재생성(겹치지 않게).
// baseIndex로 기준 버전을 고를 수 있다(기본 = 최신) — 같은 원본에 코멘트만 바꿔 여러 버전 생성.
// 결과는 같은 초안의 새 버전(edited)이 되고 직전 표시본은 history에 보존된다(타임라인은 항상 선형).
// 레퍼런스는 초안의 스냅샷(발췌+메모)을 그대로 사용 — 보관함에서 지워져도 다시 쓰기는 동작.
// 클라이언트는 살아 있으면 다시 로드(시술은 스냅샷 이름으로 매칭), 삭제됐으면 없이 진행.
export async function rewriteDraft(
  sql: postgres.Sql, draftId: string,
  opts: { feedback?: string; baseIndex?: number }, client?: AnthropicLike,
): Promise<DraftRow> {
  const draft = await getDraft(sql, draftId);
  if (!draft) throw new GenerateInputError('초안을 찾을 수 없어요');
  const versions = [...draft.history, draft.edited ?? draft.content];
  const idx = opts.baseIndex ?? versions.length - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= versions.length) {
    throw new GenerateInputError('기준 버전을 찾을 수 없어요 — 새로고침해 주세요');
  }
  const base = versions[idx];
  const feedback = opts.feedback;

  const clientData = draft.clientId ? await getClientWithProcedures(sql, draft.clientId) : null;
  const procedures = (clientData?.procedures ?? []).filter((p) => draft.procedureNames.includes(p.name));
  // 팀이 /prompt에서 편집한 지시문 오버라이드 — 생성 시점의 최신 저장본 1회 로드
  const promptOverrides = await getPromptOverrides(sql);
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: draft.refs, mode: draft.refs.length > 0 ? draft.referenceMode : 'off',
    direction: draft.direction, format: draft.format,
    constraintsOn: false, // 생성 시점의 제약 토글은 초안에 저장되지 않음 — 사후 검수 표식이 항상 커버
    rewrite: { current: base.posts.map((p) => p.text), feedback },
  }, promptOverrides);

  const res = await callLLM('anthropic.draftRewrite', {
    model: CONTENT_MODEL(), max_tokens: 16000, system: draftSystem(promptOverrides),
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
  // 새 버전의 한국어 대역 — 같은 텍스트로 되돌아온 버전은 재과금 없이 캐시 재사용, 실패 시 생략(번역 버튼 경로가 커버)
  const h = draftVersionHash(edited.posts);
  let gloss: string[] | null = draft.translation?.[h] ?? null;
  if (!gloss) {
    try { gloss = await withGlossTimeout(translateDraftPosts(edited.posts.map((p) => p.text), client)); }
    catch (e) { console.warn('[draft] 대역 생성 생략', { err: e instanceof Error ? e.message : String(e) }); gloss = null; }
  }
  // 직전 표시본(기준 버전이 아니라 최신)을 이력에 보존 — 어떤 버전을 기준으로 썼든 타임라인은 선형
  await updateDraft(sql, draftId, {
    edited, history: [...draft.history, draft.edited ?? draft.content],
    ...(gloss ? { translation: { ...(draft.translation ?? {}), [h]: gloss } } : {}),
  });
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

  // 팀이 /prompt에서 편집한 지시문 오버라이드 — 생성 시점의 최신 저장본 1회 로드
  const promptOverrides = await getPromptOverrides(sql);
  const res = await callLLM('anthropic.draftRegen', {
    model: CONTENT_MODEL(), max_tokens: 16000, system: draftSystem(promptOverrides),
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
  // 새 버전의 한국어 대역 — 같은 텍스트로 되돌아온 버전은 재과금 없이 캐시 재사용, 실패 시 생략(번역 버튼 경로가 커버)
  const h = draftVersionHash(edited.posts);
  let gloss: string[] | null = draft.translation?.[h] ?? null;
  if (!gloss) {
    try { gloss = await withGlossTimeout(translateDraftPosts(edited.posts.map((p) => p.text), client)); }
    catch (e) { console.warn('[draft] 대역 생성 생략', { err: e instanceof Error ? e.message : String(e) }); gloss = null; }
  }
  // 직전 표시본을 이력에 보존 — ‹ 1/2 › 페이저로 이전 버전 열람 가능
  await updateDraft(sql, draftId, {
    edited, history: [...draft.history, base],
    ...(gloss ? { translation: { ...(draft.translation ?? {}), [h]: gloss } } : {}),
  });
  return (await getDraft(sql, draftId)) as DraftRow;
}
