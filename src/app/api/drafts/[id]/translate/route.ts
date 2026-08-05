import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getDraft, updateDraft } from '@/lib/draftStore';
import { translateDraftPosts } from '@/lib/translateDraft';
import { hashSource } from '@/lib/translationStore';
import { requireMember } from '@/lib/authGuard';

// 표시 중인 버전(edited ?? content)을 서버에서 읽어 번역 — 클라이언트가 임의 텍스트를
// 번역기로 쓰지 못하게 하고, 사용량 집계('원고 번역')가 초안 단위로 정확히 남는다.
// 번역은 draft.translation에 저장 — 같은 원문이면 재호출 없이 반환, 편집/재생성으로
// 원문이 바뀌면 sourceHash가 어긋나 자동 재번역된다.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  try {
    const sql = getSql();
    const draft = await getDraft(sql, id);
    if (!draft) return NextResponse.json({ error: '초안을 찾을 수 없어요' }, { status: 404 });
    const texts = (draft.edited ?? draft.content).posts.map((p) => p.text);
    const hash = hashSource(JSON.stringify(texts), null);
    if (draft.translation?.sourceHash === hash) {
      return NextResponse.json({ posts: draft.translation.posts });
    }
    const posts = await translateDraftPosts(texts);
    if (!posts) return NextResponse.json({ error: '번역에 실패했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    await updateDraft(sql, id, { translation: { sourceHash: hash, posts } });
    return NextResponse.json({ posts });
  } catch (e) {
    console.error('[draft] 번역 오류', { id, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '번역 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
