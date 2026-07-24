'use client';
import { apiFetch } from '@/lib/apiFetch';
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
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED = 3; // 접었을 때 노출할 태그 수 (≈1줄)

  // 새 태그만 골라 1회 배치 번역, localStorage에 영구 캐시 (재호출 없음)
  useEffect(() => {
    if (tags.length === 0) return;
    const cache = loadCache();
    const missing = tags.map((t) => t.tag).filter((t) => !(t in cache));
    if (missing.length === 0) { setKo(cache); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch('/api/translate-tags', {
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
  const visible = expanded ? tags : tags.slice(0, COLLAPSED);
  const hiddenCount = tags.length - COLLAPSED;
  return (
    <div className="border-b border-x-border bg-x-surface px-3 py-2">
      <p className="mb-1 text-caption text-x-muted">함께 나온 해시태그 — 클릭하면 새 컬럼을 만들어요</p>
      <div className="flex flex-wrap gap-1">
        {visible.map(({ tag, count }) => (
          <button key={tag} onClick={() => onPick(tag)}
                  className="rounded-full border border-x-border-strong bg-white px-2 py-0.5 text-ui hover:bg-x-hover">
            #{tag}{ko[tag] ? ` (${ko[tag]})` : ''} <span className="text-x-muted">{count}</span>
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button onClick={() => setExpanded((v) => !v)}
                className="mt-1 rounded py-0.5 text-caption text-x-blue-text hover:underline">
          {expanded ? '접기' : `더보기 (+${hiddenCount})`}
        </button>
      )}
    </div>
  );
}
