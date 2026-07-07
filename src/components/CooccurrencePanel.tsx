'use client';
import { useEffect, useMemo, useState } from 'react';
import type { StoredTweet } from '@/lib/types';
import { hashtagCooccurrence } from '@/lib/cooccurrence';

const CACHE_KEY = 'cbxdeck-tag-ko';

function loadCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}'); } catch { return {}; }
}
function saveCache(c: Record<string, string>) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota 초과 시 무시 */ }
}

export function CooccurrencePanel({ tweets, excludeKeywords, onPick }: {
  tweets: StoredTweet[]; excludeKeywords: string[]; onPick: (tag: string) => void;
}) {
  const tags = useMemo(
    () => hashtagCooccurrence(tweets, excludeKeywords).slice(0, 12),
    [tweets, excludeKeywords],
  );
  const [ko, setKo] = useState<Record<string, string>>({});

  // 새 태그만 골라 1회 배치 번역, localStorage에 영구 캐시 (재호출 없음)
  useEffect(() => {
    if (tags.length === 0) return;
    const cache = loadCache();
    const missing = tags.map((t) => t.tag).filter((t) => !(t in cache));
    if (missing.length === 0) { setKo(cache); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/translate-tags', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: missing }),
        });
        if (!r.ok) { if (!cancelled) setKo(cache); return; }
        const { translations } = (await r.json()) as { translations: Record<string, string> };
        const next = { ...loadCache(), ...translations };
        saveCache(next);
        if (!cancelled) setKo(next);
      } catch { if (!cancelled) setKo(cache); }
    })();
    return () => { cancelled = true; };
  }, [tags]);

  if (tags.length === 0) return null;
  return (
    <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-800">
      <p className="mb-1 text-xs text-gray-500">함께 나온 해시태그 (클릭 → 새 컬럼)</p>
      <div className="flex flex-wrap gap-1">
        {tags.map(({ tag, count }) => (
          <button key={tag} onClick={() => onPick(tag)}
                  className="rounded-full border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800">
            #{tag}{ko[tag] ? ` (${ko[tag]})` : ''} <span className="text-gray-400">{count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
