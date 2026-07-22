import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getTweetsByIds, PAGE_SIZE } from '@/lib/tweetStore';
import { translateTweets, PROMPT_VERSION, type TranslateInput } from '@/lib/translate';
import { getTranslations, upsertTranslations, hashSource } from '@/lib/translationStore';
import { MODEL } from '@/lib/suggest';
import type { TweetTranslation } from '@/lib/types';
import { requireAllowedUser } from '@/lib/authGuard';

const MAX_IDS = PAGE_SIZE; // 컬럼 한 페이지와 동일 — 남용 방지 상한

export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;

  const body = (await req.json().catch(() => ({}))) as { tweetIds?: unknown };
  const ids = Array.isArray(body.tweetIds)
    ? body.tweetIds.filter((x): x is string => typeof x === 'string').slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: 'tweetIds 필수' }, { status: 400 });

  const sql = getSql();
  const tweets = await getTweetsByIds(sql, ids);
  // 인용 본문: 하이드레이트된 원본(enriched.text)이 있으면 그걸, 없으면 quoted.text
  const srcOf = (t: (typeof tweets)[number]) => ({
    text: t.text,
    quotedText: (t.quoted as { enriched?: { text?: string } | null } | null)?.enriched?.text ?? t.quoted?.text ?? null,
  });
  const items = tweets.map((t) => {
    const s = srcOf(t);
    return { tweetId: t.tweetId, text: s.text, quotedText: s.quotedText, sourceHash: hashSource(s.text, s.quotedText) };
  });

  // 1) 캐시 히트 분리
  const cached = await getTranslations(sql, items.map((i) => ({ tweetId: i.tweetId, sourceHash: i.sourceHash })), PROMPT_VERSION);
  const misses = items.filter((i) => !cached.has(i.tweetId));

  // 2) 미스만 번역
  let fresh = new Map<string, TweetTranslation>();
  if (misses.length > 0) {
    const inputs: TranslateInput[] = misses.map((m) => ({ tweetId: m.tweetId, text: m.text, quotedText: m.quotedText }));
    try {
      fresh = await translateTweets(inputs);
    } catch (e) {
      console.error('[translate] 번역 중 오류', { count: inputs.length, err: e instanceof Error ? e.message : String(e) });
      return NextResponse.json({ error: '번역 중 오류가 났어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    }
    // 청크 실패는 배치를 죽이지 않고 삼켜지므로(부분 성공 설계), 돌려줄 게 하나도 없을 때만
    // (캐시 히트도 0, 신규 번역도 0) 502로 표면화한다. 캐시 히트가 있으면 그건 반환하고
    // 미번역 카드는 번역 버튼이 남아 재시도 가능(정상 감쇠 — 캐시된 번역을 버리지 않는다).
    if (cached.size === 0 && fresh.size === 0) {
      console.error('[translate] 전면 실패 — 캐시·신규 모두 0', { count: inputs.length });
      return NextResponse.json({ error: '번역에 실패했어요 — 잠시 후 다시 시도해주세요' }, { status: 502 });
    }
    // 3) 캐시 저장(성공분만)
    const model = MODEL();
    const rows = misses
      .filter((m) => fresh.has(m.tweetId))
      .map((m) => ({
        tweetId: m.tweetId, sourceHash: m.sourceHash, promptVersion: PROMPT_VERSION,
        content: fresh.get(m.tweetId)!.content, quotedContent: fresh.get(m.tweetId)!.quotedContent, model,
      }));
    if (rows.length > 0) await upsertTranslations(sql, rows);
  }

  // 4) 캐시 + 신규 병합
  const translations: Record<string, TweetTranslation> = {};
  for (const [id, tr] of cached) translations[id] = tr;
  for (const [id, tr] of fresh) translations[id] = tr;
  return NextResponse.json({ translations });
}
