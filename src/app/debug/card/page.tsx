import { readFileSync } from 'node:fs';
import { mapRawTweet } from '@/lib/mappers';
import type { StoredTweet } from '@/lib/types';
import { TweetCard } from '@/components/TweetCard';
import { ToastProvider } from '@/lib/toastContext';

export default function DebugCardPage() {
  const fixture = JSON.parse(readFileSync('fixtures/search-response.json', 'utf8'));
  const tweets: StoredTweet[] = fixture.tweets
    .map(mapRawTweet)
    .filter(Boolean)
    .slice(0, 10)
    .map((t: NonNullable<ReturnType<typeof mapRawTweet>>, i: number) => ({
      ...t,
      firstSeenAt: new Date().toISOString(),
      lastFetchedAt: new Date().toISOString(),
      isNew: i % 3 === 0,
      savedBy: i % 4 === 0 ? [{ id: 'debug', name: '디버그', color: '#1d9bf0' }] : [],
    }));
  return (
    <ToastProvider>
      <main className="mx-auto max-w-[420px] border-x border-x-border">
        {tweets.map((t) => <TweetCard key={t.tweetId} tweet={t} />)}
      </main>
    </ToastProvider>
  );
}
