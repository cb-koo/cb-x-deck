import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { getTweetsByIds, PAGE_SIZE } from '@/lib/tweetStore';
import { PROMPT_VERSION } from '@/lib/translate';
import { getTranslations, hashSource } from '@/lib/translationStore';
import type { TweetTranslation } from '@/lib/types';
import { requireAllowedUser } from '@/lib/authGuard';

const MAX_IDS = PAGE_SIZE; // /translate와 동일 상한 — 남용 방지

// 읽기 전용 — 캐시에 이미 있는 번역만 반환한다. LLM 호출·과금 없음.
// 번역 캐시(tweet_translation)는 tweet_id 단위 전역이라, 덱에서 번역해둔 트윗을
// 보관함 진입 시 재번역 없이 즉시 꺼내 보여주는 용도. 미번역분은 조용히 빠진다(버튼으로 opt-in).
export async function POST(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;

  const body = (await req.json().catch(() => ({}))) as { tweetIds?: unknown };
  const ids = Array.isArray(body.tweetIds)
    ? body.tweetIds.filter((x): x is string => typeof x === 'string').slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) return NextResponse.json({ translations: {} });

  const sql = getSql();
  const tweets = await getTweetsByIds(sql, ids);
  // 캐시 키(source_hash) 계산은 /translate와 동일 규칙 — 하이드레이트 인용 본문 우선
  const items = tweets.map((t) => {
    const quotedText =
      (t.quoted as { enriched?: { text?: string } | null } | null)?.enriched?.text ?? t.quoted?.text ?? null;
    return { tweetId: t.tweetId, sourceHash: hashSource(t.text, quotedText) };
  });

  const cached = await getTranslations(sql, items, PROMPT_VERSION);
  const translations: Record<string, TweetTranslation> = {};
  for (const [id, tr] of cached) translations[id] = tr;
  return NextResponse.json({ translations });
}
