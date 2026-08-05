'use client';
import { apiFetch } from '@/lib/apiFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TweetTranslation } from '@/lib/types';

// 5건씩: 작은 목록도 여러 청크로 나뉘어 점진 표시가 보이고, 긴 트윗의 출력 잘림(청크 유실)도 방지.
const CHUNK = 5;
// 캐시 조회는 과금이 없어 크게 묶어도 되지만, /translations 상한(PAGE_SIZE=200)에 맞춤.
const CACHE_CHUNK = 200;

// 덱(Column)과 보관함이 공유하는 번역 상태·동작. 캐시(tweet_translation)는 tweet_id 단위 전역이라
// 어느 화면에서 번역했든 서로 재사용된다.
export function useTranslations() {
  const [translations, setTranslations] = useState<Record<string, TweetTranslation>>({});
  const [showTranslations, setShowTranslations] = useState(false);
  const [translatingAll, setTranslatingAll] = useState(false);
  // 배치 진행률 — 미번역분이 많으면 오래 걸리는데, 화면에 보이는 것부터 끝나서 "다 됐는데 번역 중?"
  // 오해가 생긴다. 남은 작업량을 보여줘 오해를 없앤다. 배치가 없으면 null.
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number } | null>(null);
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translateErr, setTranslateErr] = useState(''); // 번역 전용 오류(목록 새로고침 오류와 분리)

  // 콜백 안에서 최신 값을 읽기 위한 미러(스테일 클로저 방지). 렌더 중 쓰지 않고 커밋 후 동기화 —
  // translateAll은 이벤트 핸들러에서만 호출되므로 커밋 이후 시점의 최신값을 읽는다.
  const translationsRef = useRef(translations);
  const showRef = useRef(showTranslations);
  useEffect(() => { translationsRef.current = translations; }, [translations]);
  useEffect(() => { showRef.current = showTranslations; }, [showTranslations]);

  // 캐시에 이미 있는 번역만 조용히 불러온다(LLM 호출·과금 없음). 진행 중 세션 번역은 덮지 않음.
  const loadCached = useCallback(async (ids: string[]) => {
    const merged: Record<string, TweetTranslation> = {};
    for (let i = 0; i < ids.length; i += CACHE_CHUNK) {
      const r = await apiFetch('/api/tweets/translations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tweetIds: ids.slice(i, i + CACHE_CHUNK) }),
      });
      if (!r.ok) continue;
      const res = (await r.json()) as { translations: Record<string, TweetTranslation> };
      Object.assign(merged, res.translations);
    }
    if (Object.keys(merged).length > 0) setTranslations((prev) => ({ ...merged, ...prev }));
  }, []);

  // 성공 시 true. 실패는 translateErr에 담아 반환(호출자가 표시 전환을 성공에 게이팅).
  const translateIds = useCallback(async (ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return true;
    const r = await apiFetch('/api/tweets/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweetIds: ids }),
    });
    if (!r.ok) {
      setTranslateErr((await r.json().catch(() => ({})) as { error?: string }).error ?? '번역에 실패했어요');
      return false;
    }
    const res = (await r.json()) as { translations: Record<string, TweetTranslation> };
    setTranslations((prev) => ({ ...prev, ...res.translations }));
    setTranslateErr('');
    return true;
  }, []);

  // ids = 표시 순서대로의 전체 트윗 id. 켜져 있으면 토글 오프(캐시는 유지).
  const translateAll = useCallback(async (ids: string[]) => {
    if (showRef.current) { setShowTranslations(false); return; }
    setTranslatingAll(true); setTranslateErr('');
    const alreadyShown = ids.some((id) => translationsRef.current[id]); // 캐시로 이미 보여줄 게 있나
    setShowTranslations(true); // 표시 모드 먼저 켬 — 청크가 도착하는 대로 그 카드가 바로 뜬다
    try {
      const need = ids.filter((id) => !translationsRef.current[id]);
      if (need.length > 0) setTranslateProgress({ done: 0, total: need.length });
      let anyOk = false;
      for (let i = 0; i < need.length; i += CHUNK) {
        if (await translateIds(need.slice(i, i + CHUNK))) anyOk = true;
        setTranslateProgress({ done: Math.min(i + CHUNK, need.length), total: need.length });
      }
      // 보여줄 게 전무(캐시도 없고 전부 실패)면 표시 모드 원복 — '번역 숨기기' 오인 방지
      if (need.length > 0 && !anyOk && !alreadyShown) setShowTranslations(false);
    } finally {
      setTranslatingAll(false); // 네트워크 예외에도 '번역 중…' 고착 방지
      setTranslateProgress(null);
    }
  }, [translateIds]);

  const translateOne = useCallback(async (tweetId: string) => {
    setTranslatingIds((s) => new Set(s).add(tweetId));
    try { await translateIds([tweetId]); }
    finally { setTranslatingIds((s) => { const n = new Set(s); n.delete(tweetId); return n; }); }
  }, [translateIds]);

  return {
    translations, showTranslations, translatingAll, translateProgress, translatingIds, translateErr,
    loadCached, translateAll, translateOne,
  };
}
