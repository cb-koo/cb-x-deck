'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { DraftPost } from '@/lib/draftTypes';

const BUCKET = 'draft-media';
const EXPIRES_IN = 86400; // 24시간 — 설계 §D. 탭을 켜둔 채 다음 날 열면 넘길 수 있어 resign()으로 재서명 수단을 둔다.

// http로 시작하면 X 스크래핑 CDN 절대 URL, 아니면 draft-media 버킷의 스토리지 경로 (설계 §B의 판별 규칙).
function isStoragePath(url: string): boolean {
  return url.length > 0 && !url.startsWith('http');
}

export interface SignedMediaResult {
  posts: DraftPost[];
  // <img onError>에서 호출 — 만료(또는 최초 서명 실패)된 항목을 다시 서명한다.
  // path에는 서명 전 "원본" 스토리지 경로를 넘긴다 — 호출부(DraftCard)는 이 훅에 넘긴 원본 posts를
  // 여전히 클로저로 들고 있으므로 같은 인덱스의 원본 media.url을 그대로 넘기면 된다. 서명된(만료된)
  // URL이 아니라 원본 경로가 캐시 키이기 때문이다.
  resign: (path: string) => void;
}

// 이 훅은 카드에서 "포스트 배열 전체"에 대해 딱 한 번 호출돼야 한다 — 포스트 하나씩 부르는 설계는
// 안 된다. 이유: MediaGrid는 DraftCard.tsx의 shown.posts.map(...) 안에서 렌더되고, shown은 버전
// 페이저가 고르는 값이라(스레드 5개 버전 ↔ 3개 버전을 오가면) 렌더마다 포스트 개수가 바뀐다. 포스트
// 마다 이 훅을 불렀다면 그 개수 변화가 곧 훅 호출 횟수 변화였을 것이고, 그 순간 React가
// "Rendered fewer hooks than expected"로 죽는다. 그래서 이 훅 내부에서도 posts.length에 비례해
// useState/useEffect/useMemo를 부르지 않는다 — 모든 포스트의 경로를 한 배열로 모아 입력 크기와
// 무관하게 고정된 개수의 상태·이펙트로만 처리한다.
export function useSignedMedia(posts: DraftPost[]): SignedMediaResult {
  const [signed, setSigned] = useState<Record<string, string>>({}); // 경로 → 서명 URL (같은 경로 재서명 방지용 캐시)
  const [failed, setFailed] = useState<Set<string>>(new Set());     // 서명이 끝내 실패한 경로

  // 이미 요청을 보낸 경로(성공·실패 무관) — 배치 이펙트가 다시 돌 때(버전 전환 등) 같은 경로를
  // 중복 서명하지 않기 위한 dedup 표시다. signed/failed 상태 자체는 아래 클로저에서 직접 읽는다.
  const requestedRef = useRef<Set<string>>(new Set());

  // 모든 포스트의 스토리지 경로만 추려 중복 제거한다. posts 참조가 안 바뀌면(같은 버전을 보고 있으면)
  // 이 배열도 새로 안 만들어져 아래 이펙트가 불필요하게 다시 돌지 않는다.
  const paths = useMemo(() => {
    const set = new Set<string>();
    for (const post of posts) for (const m of post.media) if (isStoragePath(m.url)) set.add(m.url);
    return Array.from(set);
  }, [posts]);

  useEffect(() => {
    const need = paths.filter((p) => !requestedRef.current.has(p));
    if (need.length === 0) return;
    need.forEach((p) => requestedRef.current.add(p));
    (async () => {
      const supabase = createClient();
      // 모은 경로 전체를 단 한 번의 배치 호출로 서명한다 — 포스트 수만큼 왕복하지 않는다(설계 §D).
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(need, EXPIRES_IN);
      if (error || !data) {
        setFailed((prev) => new Set([...prev, ...need]));
        return;
      }
      const nextSigned: Record<string, string> = {};
      const nextFailed: string[] = [];
      for (const row of data) {
        if (row.path && row.signedUrl) nextSigned[row.path] = row.signedUrl;
        else if (row.path) nextFailed.push(row.path);
      }
      if (Object.keys(nextSigned).length > 0) setSigned((prev) => ({ ...prev, ...nextSigned }));
      if (nextFailed.length > 0) setFailed((prev) => new Set([...prev, ...nextFailed]));
    })();
    // cleanup에서 취소하지 않는다 — Column.tsx:153과 같은 함정이다. StrictMode가 이펙트를 두 번
    // 돌리면 1회차는 requestedRef에 경로를 적고 요청을 띄운 뒤 cleanup에서 취소되고, 2회차는 그
    // 가드에 막혀 요청을 아예 안 한다. 결과적으로 서명이 영영 도착하지 않아 이미지가 빈칸으로 남는다
    // (2026-08-12 실제로 그렇게 났다). 결과는 경로→URL 캐시일 뿐이라 늦게 와도 틀리지 않고,
    // 언마운트 후 setState는 React 18+에서 무해하게 무시된다.
  }, [paths]);

  // 만료 대응 — 렌더 때 받은 서명 URL이 하루 뒤 깨지면 <img onError>가 원본 경로로 이 함수를 부른다.
  // 위 배치 이펙트와 달리 여기는 개별 경로 하나만 즉시 재서명한다 — 지금 화면에서 깨진 그 이미지부터 고친다.
  const resign = useCallback((path: string) => {
    if (!isStoragePath(path)) return;
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls([path], EXPIRES_IN);
      const row = data?.[0];
      if (error || !row?.path || !row.signedUrl) {
        setFailed((prev) => new Set([...prev, path]));
        return;
      }
      const signedPath = row.path;
      const signedUrl = row.signedUrl;
      setSigned((prev) => ({ ...prev, [signedPath]: signedUrl }));
      setFailed((prev) => { if (!prev.has(path)) return prev; const next = new Set(prev); next.delete(path); return next; });
    })();
  }, []);

  const signedPosts = useMemo<DraftPost[]>(() => posts.map((post) => ({
    ...post,
    media: post.media.map((m) => {
      if (!isStoragePath(m.url)) return m; // 절대 URL(X CDN)은 그대로 통과 — 설계 §B
      const url = signed[m.url];
      if (url) return { ...m, url };
      // 서명 실패 — 원본 경로를 그대로 둬 <img>가 자연스럽게 깨지게 한다. 이 카드는 "이대로 나간다"를
      // 판단하는 자리라(설계 원칙) 이미지를 조용히 지우면(빈 배열) 사고 자체를 못 알아챈다. 대신 눈에
      // 보이게 실패시키고, 그 실패(onError)가 resign()을 불러 스스로 회복을 시도하게 한다.
      if (failed.has(m.url)) return m;
      // 서명 대기 중(아직 요청 응답이 안 옴) — 원본 스토리지 경로를 그대로 두면 <img>가 즉시 404를
      // 내며 onError가 헛돌아 resign을 불필요하게 반복 호출한다. 빈 문자열은 HTML 스펙상 <img>가
      // 요청 자체를 보내지 않으므로 그 오탐을 막는다. media 항목 자체는 그대로 남겨 그리드 칸 수가
      // 서명 완료 전후로 바뀌지 않게 한다 — 레이아웃이 튀지 않는다.
      return { ...m, url: '' };
    }),
  })), [posts, signed, failed]);

  return { posts: signedPosts, resign };
}
