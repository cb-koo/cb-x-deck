import type { DeckTweet, SearchConfig } from './types.ts';

export function buildSearchQuery(c: SearchConfig): string {
  const kws = c.keywords.map((k) => k.trim()).filter(Boolean);
  const kw = kws.length > 1 ? `(${kws.join(' OR ')})` : (kws[0] ?? '');
  const parts = [kw];
  if (c.imagesOnly !== false) parts.push('filter:images');
  if (c.minFaves) parts.push(`min_faves:${c.minFaves}`);
  if (c.lang) parts.push(`lang:${c.lang}`);
  if (c.sinceDate) parts.push(`since:${c.sinceDate}`);
  if (c.untilDate) parts.push(`until:${c.untilDate}`);
  return parts.filter(Boolean).join(' ');
}

export function refilterByViews(tweets: DeckTweet[], minViews?: number | null): DeckTweet[] {
  if (!minViews) return tweets;
  return tweets.filter((t) => (t.metrics.views ?? -1) >= minViews);
}
