import type { DeckTweet } from './types.ts';

const HASHTAG_RE = /[#＃]([^\s#＃…、。,.!?！？()（）「」]+)/g;

export function hashtagCooccurrence(
  tweets: DeckTweet[],
  excludeKeywords: string[],
): Array<{ tag: string; count: number }> {
  const exclude = new Set(excludeKeywords.map((k) => k.toLowerCase()));
  const counts = new Map<string, number>();
  for (const t of tweets) {
    const seen = new Set<string>(); // 한 트윗 내 중복은 1회
    for (const m of t.text.matchAll(HASHTAG_RE)) {
      const tag = m[1];
      if (exclude.has(tag.toLowerCase()) || seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .filter((e) => e.count >= 2)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
