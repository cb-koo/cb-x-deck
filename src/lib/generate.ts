import { parseQuoteTargetInput, type QuoteTargetInput } from './quoteTargetInput.ts';
import type postgres from 'postgres';
import { callLLM, type AnthropicLike } from './llm.ts';
import { getClientWithProcedures } from './clientStore.ts';
import { getReferencesByIds } from './referenceStore.ts';
import { buildUserPrompt, draftOutputSchema, variantsOutputSchema, draftSystem, quoteTargetPromptBlock } from './generatePrompt.ts';
import { getPromptOverrides } from './promptSettings.ts';
import { insertDraft, getDraft, updateDraft, draftVersionHash, type DraftRow, type DraftTranslation } from './draftStore.ts';
import { syncInfluencerOnDraftUpdate } from './influencerSync.ts';
import { translateDraftPosts } from './translateDraft.ts';
import { X_MAX_WEIGHTED } from './xLength.ts';
import { CLIENT_NOT_FOUND_MESSAGE } from './campaignInput.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';
import { getTask } from './campaignTaskStore.ts';
import { targetUrlOf, TARGETABLE_TYPES } from './campaignJudgment.ts';
import { parseTweetLink } from './tweetLink.ts';
import { getTweetsByIds, upsertTweets } from './tweetStore.ts';
import { makeClient, type GetxapiClient } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';
import { isUuidLike } from './uuid.ts';

export const CONTENT_MODEL = () => process.env.CONTENT_MODEL ?? 'claude-opus-5';
export const MAX_REFS = 8; // few-shot 실무 상한 — 초과 시 원고가 레퍼런스 문구를 베낄 위험(over-copying)이 커진다

// 대역은 부가물 — 번역이 지연·행에 빠져도 이미 과금된 원고 저장을 지연시키지 않는다 (최종 리뷰)
const GLOSS_TIMEOUT_MS = 15_000;
type Gloss = { posts: string[]; title: string | null };
function withGlossTimeout(p: Promise<Gloss | null>): Promise<Gloss | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), GLOSS_TIMEOUT_MS))]);
}

// 입력이 잘못된 경우 — 라우트가 400 + 평문으로 매핑
export class GenerateInputError extends Error {}

export interface GenerateRequest {
  clientId: string | null; procedureIds: string[]; refTweetIds: string[];
  mode: ReferenceMode; direction: string; format: DraftFormat;
  constraintsOn: boolean; memberId: string | null;
  count?: number; // 시안 수 (1~5, 기본 1) — 라우트가 범위 검증
  // 작업에 붙여 만들기(스펙 §5 /generate?task=) — 라우트가 존재·미부착까지 검증한 값.
  // 다중 시안(count>1)이면 첫 시안에만 붙인다(원고 1개 = 작업 1개).
  taskId?: string | null;
  // 생성에 붙일 작업(taskId)과 별개로, 인용RT 작업의 대상 게시물을 읽는 문맥이다.
  quoteTargetTaskId?: string | null;
  quoteTargetInput?: QuoteTargetInput | null;
}

type QuoteTargetResolution = { tweetId: string | null };

async function resolveQuoteTarget(sql: postgres.Sql, quoteTargetTaskId: string | null | undefined, input?: QuoteTargetInput | null): Promise<QuoteTargetResolution> {
  let source: QuoteTargetInput | null;
  try { source = parseQuoteTargetInput(input); }
  catch (e) { throw new GenerateInputError(e instanceof Error ? e.message : '인용 대상 정보가 올바르지 않아요'); }
  if (source && quoteTargetTaskId) throw new GenerateInputError('저장된 작업과 새 작업의 인용 대상을 함께 보낼 수 없어요');
  if (source) {
    let url: string | null;
    if (source.taskId) {
      const target = await getTask(sql, source.taskId);
      if (!target) throw new GenerateInputError('인용할 대상 작업을 찾을 수 없어요');
      if (target.cancelledAt) throw new GenerateInputError('인용할 대상 작업이 취소됐어요 — 대상을 다시 골라주세요');
      if (!TARGETABLE_TYPES.includes(target.type)) throw new GenerateInputError('이 작업은 인용 대상으로 고를 수 없어요');
      url = target.postUrl;
    } else url = source.url ?? null;
    if (!url) return { tweetId: null };
    const parsed = parseTweetLink(url);
    if (!parsed.ok) throw new GenerateInputError('인용 대상의 X 게시물 링크를 확인해 주세요');
    return { tweetId: parsed.tweetId };
  }
  if (!quoteTargetTaskId) return { tweetId: null };
  if (!isUuidLike(quoteTargetTaskId)) throw new GenerateInputError('인용RT 작업 정보가 올바르지 않아요');
  const task = await getTask(sql, quoteTargetTaskId);
  if (!task) throw new GenerateInputError('인용RT 작업을 찾을 수 없어요 — 화면을 새로고침해 주세요');
  if (task.type !== 'quoteRt') throw new GenerateInputError('인용RT 작업에서만 대상 게시물을 불러올 수 있어요');
  if (task.cancelledAt) throw new GenerateInputError('취소된 인용RT 작업으로는 원고를 만들 수 없어요');
  if (task.targetTaskId && task.target?.cancelledAt) {
    throw new GenerateInputError('인용할 대상 작업이 취소됐어요 — 대상을 다시 정한 뒤 원고를 만들어 주세요');
  }

  const url = targetUrlOf({ targetTaskId: task.targetTaskId, targetPostUrl: task.target?.postUrl ?? null, targetTweetUrl: task.targetTweetUrl });
  if (!url) return { tweetId: null };
  const parsed = parseTweetLink(url);
  if (!parsed.ok) throw new GenerateInputError('인용RT 대상 게시물 링크가 올바르지 않아요 — 대상에서 X 게시물 링크를 확인해 주세요');
  return { tweetId: parsed.tweetId };
}

async function loadQuoteTarget(
  sql: postgres.Sql, tweetId: string | null, xClient?: Pick<GetxapiClient, 'getTweetDetail'>,
): Promise<RefSnapshot | null> {
  if (!tweetId) return null;
  // 대상은 보관함 소속과 무관하다. 캐시가 있으면 우선 쓰고, 없거나 본문이 비어 있으면 사용자가 생성 버튼을
  // 누른 이 시점에만 X 상세 조회를 한다. upsert는 캐시 갱신일 뿐 library_item을 만들지 않는다.
  let tweet = (await getTweetsByIds(sql, [tweetId]))[0] ?? null;
  // 빈 본문 캐시는 대상 내용을 모른 채 조용히 생성하게 만든다. 이 경우만 최신 상세로 보강한다.
  if (!tweet || !tweet.text.trim()) {
    let raw;
    try { raw = await (xClient ?? makeClient()).getTweetDetail(tweetId); }
    catch { throw new GenerateInputError('인용RT 대상 게시물을 확인하지 못했어요 — 잠시 후 다시 시도해 주세요'); }
    if (!raw) throw new GenerateInputError('인용RT 대상 게시물을 읽을 수 없어요 — 삭제되었거나 공개 범위를 확인해 주세요');
    const mapped = mapRawTweet(raw);
    if (!mapped || !mapped.text.trim()) throw new GenerateInputError('인용RT 대상 게시물의 내용을 읽을 수 없어요');
    if (mapped.tweetId !== tweetId) throw new GenerateInputError('인용RT 대상 게시물이 바뀌었어요 — 대상 링크를 다시 확인해 주세요');
    await upsertTweets(sql, [mapped]);
    tweet = mapped;
  }
  return { tweetId: tweet.tweetId, handle: tweet.authorHandle, name: tweet.authorName, excerpt: tweet.text, memos: [], role: 'quoteTarget' };
}

export async function generateDraft(
  sql: postgres.Sql, req: GenerateRequest, client?: AnthropicLike, quoteTargetClient?: Pick<GetxapiClient, 'getTweetDetail'>,
): Promise<string[]> {
  const count = req.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    throw new GenerateInputError('시안 수는 1~5 사이여야 해요');
  }
  const quoteTarget = await resolveQuoteTarget(sql, req.quoteTargetTaskId, req.quoteTargetInput);
  const ordinaryRefIds = [...new Set(req.refTweetIds)].filter((id) => id !== quoteTarget.tweetId);
  const hasClient = !!req.clientId;
  const hasRefs = ordinaryRefIds.length > 0 && req.mode !== 'off';
  const hasDirection = req.direction.trim().length > 0;
  if (!hasClient && !hasRefs && !quoteTarget.tweetId && !hasDirection) {
    throw new GenerateInputError('클라이언트·레퍼런스·방향성 중 최소 하나는 필요해요');
  }
  if (ordinaryRefIds.length + (quoteTarget.tweetId ? 1 : 0) > MAX_REFS) {
    throw new GenerateInputError(`레퍼런스는 ${MAX_REFS}건까지 고를 수 있어요 — 서로 다른 앵글로 3~5건이 가장 좋아요`);
  }

  // 재료 로드
  const clientData = req.clientId ? await getClientWithProcedures(sql, req.clientId) : null;
  if (req.clientId && !clientData) throw new GenerateInputError(CLIENT_NOT_FOUND_MESSAGE);
  const procedures = (clientData?.procedures ?? []).filter((p) => req.procedureIds.includes(p.id));
  const refRows = hasRefs ? await getReferencesByIds(sql, ordinaryRefIds) : [];
  const ordinaryRefs: RefSnapshot[] = refRows.map((r) => ({
    tweetId: r.tweetId, handle: r.authorHandle, name: r.authorName,
    excerpt: r.text, memos: r.memos,
  }));
  if (hasRefs && ordinaryRefs.length < ordinaryRefIds.length) {
    throw new GenerateInputError(
      `레퍼런스 ${ordinaryRefIds.length - ordinaryRefs.length}건을 보관함에서 찾을 수 없어요 — 목록을 새로고침해 주세요`);
  }
  // 보관함 레퍼런스의 존재를 먼저 검증해, 잘못된 일반 레퍼런스 때문에 비용이 드는 대상 상세 조회를 하지 않는다.
  const target = await loadQuoteTarget(sql, quoteTarget.tweetId, quoteTargetClient);
  const refs = [...(target ? [target] : []), ...ordinaryRefs];

  // 팀이 /prompt에서 편집한 지시문 오버라이드 — 생성 시점의 최신 저장본 1회 로드
  const promptOverrides = await getPromptOverrides(sql);

  // 프롬프트 → LLM (구조화 출력) — count 1이면 기존 posts 스키마·프롬프트 그대로 (스펙 §1)
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: ordinaryRefs, quoteTarget: target, mode: hasRefs ? req.mode : 'off',
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
    return { [draftVersionHash(variants[i].posts)]: g.posts };
  };

  const batchId = count > 1 ? crypto.randomUUID() : null;
  const toContent = (v: { posts: Array<{ text: string }> }): DraftContent =>
    ({ posts: v.posts.map((p) => ({ text: p.text, media: [] })) });
  const insertOne = async (tx: postgres.Sql, i: number): Promise<string> => {
    const id = await insertDraft(tx, {
      clientId: req.clientId, clientName: clientData?.client.name ?? null,
      procedureNames: procedures.map((p) => p.name),
      direction: req.direction, format: req.format,
      referenceMode: hasRefs ? req.mode : 'off', refs,
      content: toContent(variants[i]), model: CONTENT_MODEL(), memberId: req.memberId,
      batchId, variantIndex: batchId ? i : null,
      translation: glossOf(i),
      koTitle: glosses[i]?.title ?? null,
      koTitleHash: glosses[i]?.title ? draftVersionHash(variants[i].posts) : null,
      taskId: i === 0 ? (req.taskId ?? null) : null,
    });
    // 작업에 붙여 만들면 insertDraft→attachDraft가 작업의 핸들을 원고에 채울 수 있다
    // (campaignTaskStore.attachDraft, updateDraft를 거치지 않는 직접 update) — 재조회해 로그를 남긴다.
    if (i === 0 && req.taskId) {
      const created = await getDraft(tx, id);
      if (created?.influencerHandle) {
        await syncInfluencerOnDraftUpdate(tx, {
          before: { ...created, influencerHandle: null },
          influencerHandle: created.influencerHandle,
          status: undefined, actorId: req.memberId,
        });
      }
    }
    return id;
  };
  // 배치는 한 단위 — 중간 실패 시 고아 부분 배치가 남지 않게 트랜잭션. 단일 생성은 기존 경로 그대로 —
  // 단, 작업에 붙여 만들 때는 삽입+붙이기가 한 단위여야 한다(붙이기가 실패하면 주인 없는 원고가 남는다).
  if (!batchId) {
    if (!req.taskId) return [await insertOne(sql, 0)];
    return [await sql.begin(async (tx) => insertOne(tx as unknown as postgres.Sql, 0)) as unknown as string];
  }
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
  const quoteTarget = draft.refs.find((r) => r.role === 'quoteTarget') ?? null;
  const ordinaryRefs = draft.refs.filter((r) => r.role !== 'quoteTarget');
  const user = buildUserPrompt({
    client: clientData ? { name: clientData.client.name, info: clientData.client.info,
                           bannedPhrases: clientData.client.bannedPhrases } : null,
    procedures, references: ordinaryRefs, quoteTarget, mode: ordinaryRefs.length > 0 ? draft.referenceMode : 'off',
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

  // 새 버전의 한국어 대역 — 해시는 텍스트만 본다(draftVersionHash). 같은 텍스트로 되돌아온 버전은
  // 재과금 없이 캐시 재사용, 실패 시 생략(번역 버튼 경로가 커버). 캐시 조회는 시작 시점 스냅샷으로
  // 해도 무해하다 — 어긋나 봐야 재번역 한 번이다.
  const h = draftVersionHash(posts);
  let gloss: Gloss | null = draft.translation?.[h] ? { posts: draft.translation[h], title: null } : null;
  if (!gloss) {
    try { gloss = await withGlossTimeout(translateDraftPosts(posts.map((p) => p.text), client)); }
    catch (e) { console.warn('[draft] 대역 생성 생략', { err: e instanceof Error ? e.message : String(e) }); gloss = null; }
  }

  // 여기까지 LLM·번역으로 수 초~수십 초가 지났다 — 그동안 사용자가 카드에서 이미지를 붙였을 수 있다
  // (첨부는 즉시 저장이라 PATCH가 이미 서버에 반영됐다). 시작 시점 스냅샷(draft)으로 edited·history를
  // 쓰면 그 첨부가 통째로 덮여 사라진다(리뷰 발견). 그래서 쓰기 직전에 다시 읽는다 — 남는 경쟁 창은
  // 이 조회~update 사이 밀리초로, LLM 10초 창과는 자릿수가 다르다.
  const fresh = (await getDraft(sql, draftId)) ?? draft;
  const freshLatest = fresh.edited ?? fresh.content;

  // 미디어는 "지금 최신 버전"에서 위치 기준 이월 — 기준 버전(base)이 아니다. 텍스트는 사용자가 고른
  // 버전에서 다시 쓰지만, 이미지는 초안에 순방향으로 쌓이는 자산이라 옛 버전을 기준으로 삼는 순간
  // 최신 버전에 붙여둔 이미지가 소리 없이 사라진다(리뷰 발견 — §H-1 안내로도 못 잡던 경로).
  // 스레드가 짧아지면 뒤쪽 이미지는 갈 자리가 없어 빠지는데, 여기서 막지 않는다(설계 §H-1) —
  // 사후에 화면이 왜인지와 손잡이를 함께 알린다. 화면 계산의 비교 기준도 같은 이유로 '직전 최신'
  // (응답 history의 마지막)이다. 스토리지 객체는 지우지 않으므로(§확정 판단) 빠진 이미지는
  // 이전 버전에서 그대로 받을 수 있다.
  const edited = { posts: posts.map((p, n) => ({ text: p.text, media: freshLatest.posts[n]?.media ?? [] })) };
  // 직전 표시본(기준 버전이 아니라 최신)을 이력에 보존 — 어떤 버전을 기준으로 썼든 타임라인은 선형
  await updateDraft(sql, draftId, {
    edited, history: [...fresh.history, freshLatest],
    ...(gloss ? { translation: { ...(fresh.translation ?? {}), [h]: gloss.posts } } : {}),
    // 제목이 없으면(캐시 재사용·실패) patch 생략 — 이전 제목을 지우지 않는다: 해시 불일치로 자연 무효화되므로
    ...(gloss?.title ? { koTitle: gloss.title, koTitleHash: h } : {}),
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
  const quoteTarget = draft.refs.find((r) => r.role === 'quoteTarget') ?? null;
  const user = [
    quoteTargetPromptBlock(quoteTarget),
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

  // 텍스트는 시작 시점 base에서 한 트윗만 교체 — 트윗 수가 그대로라 §H-1의 위치 이월 유실은 없다.
  const newTexts = base.posts.map((p, n) => (n === postIndex ? posts[0].text : p.text));
  // 새 버전의 한국어 대역 — 해시는 텍스트만 본다. 캐시 조회는 시작 시점 스냅샷으로 해도 무해(어긋나 봐야 재번역 한 번).
  const h = draftVersionHash(newTexts.map((text) => ({ text })));
  let gloss: Gloss | null = draft.translation?.[h] ? { posts: draft.translation[h], title: null } : null;
  if (!gloss) {
    try { gloss = await withGlossTimeout(translateDraftPosts(newTexts, client)); }
    catch (e) { console.warn('[draft] 대역 생성 생략', { err: e instanceof Error ? e.message : String(e) }); gloss = null; }
  }

  // 쓰기 직전 재조회 — rewriteDraft와 같은 이유(LLM·번역 수 초 사이에 즉시 저장된 첨부를 덮지 않기 위해).
  // 미디어는 지금 최신 버전에서 위치 기준으로 가져온다.
  const fresh = (await getDraft(sql, draftId)) ?? draft;
  const freshLatest = fresh.edited ?? fresh.content;
  const edited = {
    posts: newTexts.map((text, n) => ({ text, media: freshLatest.posts[n]?.media ?? [] })),
  };
  // 직전 표시본을 이력에 보존 — ‹ 1/2 › 페이저로 이전 버전 열람 가능
  await updateDraft(sql, draftId, {
    edited, history: [...fresh.history, freshLatest],
    ...(gloss ? { translation: { ...(fresh.translation ?? {}), [h]: gloss.posts } } : {}),
    // 제목이 없으면(캐시 재사용·실패) patch 생략 — 이전 제목을 지우지 않는다: 해시 불일치로 자연 무효화되므로
    ...(gloss?.title ? { koTitle: gloss.title, koTitleHash: h } : {}),
  });
  return (await getDraft(sql, draftId)) as DraftRow;
}
