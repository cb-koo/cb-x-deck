'use client';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { TweetPreview } from '@/lib/tweetPreview';

// 인용·RT 대상 게시물 미리보기(설계 §7-1) — usePaymentView와 같은 모양. 같은 url은 모듈 캐시로 세션 동안 한 번만 부른다.
// ok가 아닌 결과(unavailable·repost·badLink 등)도 캐시에 넣는다 — 삭제·비공개 게시물은 서버 캐시에 안 남아
// 열 때마다 X를 다시 부르게 되므로 화면이 기억한다. X 조회 실패(502)·네트워크 실패만 캐시하지 않는다(다시 열면 재시도).
const cache = new Map<string, TweetPreview>();

export function useTweetPreview(url: string | null) {
  const key = url ?? '';
  const [state, setState] = useState<{ key: string; preview: TweetPreview | null; failed: boolean }>(
    () => ({ key, preview: key ? cache.get(key) ?? null : null, failed: false }));
  useEffect(() => {
    if (!key || cache.has(key)) return;
    let alive = true;
    (async () => {
      const r = await apiFetch(`/api/tweets/by-link?url=${encodeURIComponent(key)}`).catch(() => null);
      const p = r && r.ok ? ((await r.json().catch(() => null)) as TweetPreview | null) : null;
      if (p) cache.set(key, p);
      // await 뒤에서만 setState한다(이펙트 본문 동기 setState 금지) — 키가 바뀐 뒤 늦게 온 응답은 버린다
      if (alive) setState({ key, preview: p, failed: !p });
    })();
    return () => { alive = false; };
  }, [key]);
  // 키가 바뀐 첫 렌더는 state가 아직 옛 키다 — 캐시에 있으면 그걸, 없으면 불러오는 중으로 본다
  const current = state.key === key ? state : { key, preview: key ? cache.get(key) ?? null : null, failed: false };
  return { preview: current.preview, loading: !!key && !current.preview && !current.failed, failed: current.failed };
}
