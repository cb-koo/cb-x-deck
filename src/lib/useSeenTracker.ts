'use client';
import { useEffect, useRef } from 'react';

// 뷰포트 자동 봤음: 50% 이상 노출(긴 카드는 뷰포트 60% 이상 점유)로 1초 체류 → 큐 적재 → 3초마다 배치 전송.
// 이미 봤음(seenByMe)인 카드는 호출부에서 observe하지 않는다.
export function useSeenTracker(memberId: string | null): { observe: (el: HTMLElement | null) => void } {
  const queue = useRef<Set<string>>(new Set());
  const timers = useRef<Map<Element, ReturnType<typeof setTimeout>>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const memberRef = useRef(memberId);
  memberRef.current = memberId;

  useEffect(() => {
    if (!memberId) return; // 멤버 미선택 시 추적 없음
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.tweetId;
        if (!id) continue;
        const visibleEnough = e.intersectionRatio >= 0.5
          || (e.isIntersecting && e.intersectionRect.height >= window.innerHeight * 0.6);
        if (visibleEnough) {
          if (!timers.current.has(e.target)) {
            timers.current.set(e.target, setTimeout(() => {
              queue.current.add(id);
              observer.unobserve(e.target); // 한 번 봤으면 더 관찰 안 함
              timers.current.delete(e.target);
            }, 1000));
          }
        } else {
          const t = timers.current.get(e.target);
          if (t) { clearTimeout(t); timers.current.delete(e.target); }
        }
      }
    }, { threshold: [0, 0.5] });
    observerRef.current = observer;

    const flush = () => {
      if (queue.current.size === 0 || !memberRef.current) return;
      const tweetIds = [...queue.current];
      queue.current.clear();
      fetch('/api/tweets/seen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: memberRef.current, tweetIds }),
        keepalive: true, // 페이지 이탈 직전 전송도 최대한 보장
      }).catch(() => { tweetIds.forEach((i) => queue.current.add(i)); }); // 실패 시 재큐
    };
    const interval = setInterval(flush, 3000);
    window.addEventListener('beforeunload', flush);

    return () => {
      flush();
      clearInterval(interval);
      window.removeEventListener('beforeunload', flush);
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
      observer.disconnect();
      observerRef.current = null;
    };
  }, [memberId]);

  return {
    observe: (el: HTMLElement | null) => { if (el && observerRef.current) observerRef.current.observe(el); },
  };
}
