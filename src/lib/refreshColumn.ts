import type postgres from 'postgres';
import type { GetxapiClient, RawTweet } from './getxapi.ts';
import { buildSearchQuery, refilterByViews } from './queryBuilder.ts';
import { mapRawTweet } from './mappers.ts';
import { getColumn, touchRefreshed } from './columnStore.ts';
import { linkColumnTweets, upsertTweets } from './tweetStore.ts';
import type { SearchConfig, WatchlistConfig } from './types.ts';

const DEFAULT_MAX_PAGES = 3;

export async function refreshColumn(
  sql: postgres.Sql,
  client: Pick<GetxapiClient, 'searchTweets' | 'getUserTweets'>,
  columnId: string,
  opts?: { maxPagesOverride?: number; searchOverride?: { sinceDate: string; untilDate: string } },
): Promise<{ fetched: number; inserted: number; updated: number }> {
  const col = await getColumn(sql, columnId);
  if (!col) throw new Error(`column not found: ${columnId}`);

  const maxPages = opts?.maxPagesOverride ?? ((col.config.maxPages ?? DEFAULT_MAX_PAGES) as number);
  const raws: RawTweet[] = [];
  let cursor: string | undefined;

  for (let p = 0; p < maxPages; p++) {
    const page = col.kind === 'search'
      ? await client.searchTweets(
          buildSearchQuery({ ...(col.config as SearchConfig), ...opts?.searchOverride }), cursor)
      : await client.getUserTweets((col.config as WatchlistConfig).userId, cursor);
    raws.push(...page.tweets);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  const mapped = raws.map(mapRawTweet).filter((t) => t !== null);
  const kept = col.kind === 'search'
    ? refilterByViews(mapped, (col.config as SearchConfig).minViews)
    : mapped;

  const { inserted, updated } = await upsertTweets(sql, kept);
  await linkColumnTweets(sql, columnId, kept.map((t) => t.tweetId));
  await touchRefreshed(sql, columnId);
  return { fetched: raws.length, inserted, updated };
}
