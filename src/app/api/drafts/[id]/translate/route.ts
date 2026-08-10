import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getDraft, updateDraft, draftVersionHash } from '@/lib/draftStore';
import { translateDraftPosts } from '@/lib/translateDraft';
import { requireMember } from '@/lib/authGuard';

// 지정한 버전(기본 = 최신)을 서버에서 읽어 번역 — 클라이언트가 임의 텍스트를
// 번역기로 쓰지 못하게 하고, 사용량 집계('원고 번역')가 초안 단위로 정확히 남는다.
// 번역은 draft.translation(원문 지문 → 번역 맵)에 버전별로 저장 — 같은 원문이면 재호출 없이 반환.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  try {
    const sql = getSql();
    const draft = await getDraft(sql, id);
    if (!draft) return NextResponse.json({ error: '초안을 찾을 수 없어요' }, { status: 404 });
    const versions = [...draft.history, draft.edited ?? draft.content];
    const body = (await req.json().catch(() => ({}))) as { versionIndex?: unknown };
    let idx = versions.length - 1;
    if (body.versionIndex !== undefined) {
      if (!Number.isInteger(body.versionIndex) || (body.versionIndex as number) < 0
          || (body.versionIndex as number) >= versions.length) {
        return NextResponse.json({ error: '버전을 찾을 수 없어요 — 새로고침해 주세요' }, { status: 400 });
      }
      idx = body.versionIndex as number;
    }
    const texts = versions[idx].posts.map((p) => p.text);
    const hash = draftVersionHash(versions[idx].posts);
    const cache = draft.translation ?? {};
    if (cache[hash]) return NextResponse.json({ posts: cache[hash] });
    const r = await translateDraftPosts(texts);
    if (!r) return NextResponse.json({ error: '번역에 실패했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    // 과거 버전(최신이 아닌 versionIndex) 번역이면 제목을 저장하지 않는다 — 스테일 제목 방지
    const isLatest = hash === draftVersionHash(versions[versions.length - 1].posts);
    await updateDraft(sql, id, {
      translation: { ...cache, [hash]: r.posts },
      ...(r.title && isLatest ? { koTitle: r.title, koTitleHash: hash } : {}),
    });
    return NextResponse.json({ posts: r.posts });
  } catch (e) {
    console.error('[draft] 번역 오류', { id, err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: '번역 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
  }
}
