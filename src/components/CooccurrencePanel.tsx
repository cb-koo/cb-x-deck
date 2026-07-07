'use client';
import type { StoredTweet } from '@/lib/types';
import { hashtagCooccurrence } from '@/lib/cooccurrence';

export function CooccurrencePanel({ tweets, excludeKeywords, onPick }: {
  tweets: StoredTweet[]; excludeKeywords: string[]; onPick: (tag: string) => void;
}) {
  const tags = hashtagCooccurrence(tweets, excludeKeywords).slice(0, 12);
  if (tags.length === 0) return null;
  return (
    <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-800">
      <p className="mb-1 text-xs text-gray-500">함께 나온 해시태그 (클릭 → 새 컬럼)</p>
      <div className="flex flex-wrap gap-1">
        {tags.map(({ tag, count }) => (
          <button key={tag} onClick={() => onPick(tag)}
                  className="rounded-full border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800">
            #{tag} <span className="text-gray-400">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
