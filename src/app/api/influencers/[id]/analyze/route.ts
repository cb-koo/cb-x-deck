import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import Anthropic from '@anthropic-ai/sdk';
import { makeClient, GetxapiAuthError } from '@/lib/getxapi';
import { LLMRefusalError } from '@/lib/llm';
import { applyProfileSnapshot, findInfluencerById, saveAnalysis } from '@/lib/influencerStore';
import { resolveAccount, type AccountResolution } from '@/lib/influencerAccount';
import { makeGetxapiTweetSource } from '@/lib/tweetSource';
import { analyzeAccount, makeAnthropicChat, AnalysisFormatError } from '@/lib/influencerAnalysis';

// 수집(최대 ~10콜) + LLM 6콜이라 1~2분 걸릴 수 있다 — 코드베이스 첫 maxDuration 사용.
// Vercel 플랜별 상한이 다르므로 배포 전 플랜 확인(스펙 §3 저장).
export const maxDuration = 300;

const notFound = () => NextResponse.json({ error: '인플루언서를 찾을 수 없어요' }, { status: 404 });

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  if (!isUuidLike(id)) return notFound();

  const sql = getSql();
  const inf = await findInfluencerById(sql, id);
  if (!inf) return notFound();
  const client = makeClient();

  // x_user_id가 없으면 여기서 해결하고 진행 — 버튼을 두 번 누르게 하지 않는다(스펙 §3).
  // 판정·문구는 refresh와 동일 규칙(resolveAccount 공유).
  let userId = inf.xUserId;
  if (!userId) {
    let r: AccountResolution;
    try {
      r = await resolveAccount(sql, inf, client);
    } catch (e) {
      console.error('[influencer] 분석 전 계정 확인 실패', {
        handle: inf.handle, err: e instanceof Error ? e.message : String(e),
      });
      return NextResponse.json(
        { error: '프로필 조회에 실패했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
    }
    if (r.status === 'not_found') {
      return NextResponse.json(
        { error: 'X에서 이 핸들을 찾을 수 없어요 — 개명했다면 새 핸들로 추가하면 이 기록에 이어져요' },
        { status: 409 });
    }
    if (r.status === 'handle_taken') {
      return NextResponse.json(
        { error: '이 핸들은 현재 다른 계정이 쓰고 있어요 — 분석하지 않았어요' }, { status: 409 });
    }
    await applyProfileSnapshot(sql, inf.id, r.info);
    userId = r.info.id;
  }

  // 수집·LLM 동안 DB 커넥션을 잡지 않는다(풀 고갈 전례) — 저장은 성공 시 마지막 1회.
  let analysis;
  try {
    analysis = await analyzeAccount(
      { source: makeGetxapiTweetSource(client), chat: makeAnthropicChat() }, userId);
  } catch (e) {
    if (e instanceof LLMRefusalError) {
      return NextResponse.json({ error: '분석 요청이 거절됐어요 — 내용을 바꿔 다시 시도해 주세요' }, { status: 400 });
    }
    if (e instanceof AnalysisFormatError) {
      return NextResponse.json({ error: 'AI가 이번엔 형식을 맞추지 못했어요 — 다시 시도해 주세요' }, { status: 502 });
    }
    // analyzeAccount 안에서 수집·LLM이 이어 붙어 있어 단계를 오류 종류로 가른다(스펙 §7 문구 귀속).
    // 키 문제는 다시 눌러도 그대로다 — 재시도를 권하지 않는다.
    if (e instanceof GetxapiAuthError) {
      console.error('[influencer] 수집 실패(X 인증)', {
        handle: inf.handle, err: e.message,
      });
      return NextResponse.json(
        { error: 'X 연결에 문제가 있어요 — 관리자에게 알려 주세요' }, { status: 502 });
    }
    if (e instanceof Anthropic.APIError) {
      console.error('[influencer] 분석 실패(LLM API)', {
        handle: inf.handle, status: e.status, err: e.message,
      });
      return NextResponse.json(
        { error: '분석 도중 문제가 생겼어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
    }
    console.error('[influencer] 수집 실패(그 외)', {
      handle: inf.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: 'X에서 글을 가져오지 못했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }

  // 저장 실패는 수집·LLM과 구분한다 — 분석은 끝났으니 재시도 시 LLM 비용을 다시 쓰게 만들지 않는다.
  try {
    await saveAnalysis(sql, id, analysis);
  } catch (e) {
    console.error('[influencer] 분석 저장 실패', {
      handle: inf.handle, err: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: '분석은 끝났는데 저장하지 못했어요 — 잠시 후 다시 시도해 주세요' }, { status: 502 });
  }
  return NextResponse.json({ analysis, analyzedAt: new Date().toISOString() });
}
