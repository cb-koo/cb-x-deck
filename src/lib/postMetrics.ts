// 추적 게시물의 지표 수집기 — 트윗 ID 하나를 물으면 셋 중 하나로 답한다(ok/unavailable/error).
// 이 파일이 수집 출처(지금은 getxapi)를 격리한다: 나중에 X 공식 API 등으로 갈아끼워도
// 라우트·스토어·화면은 이 규격만 본다. (스펙: docs/superpowers/specs/2026-08-14-contents-tracking-design.md)

// 지표 6종 — 전부 null 허용: 수집 출처가 일부 지표를 안 주는 경우를 흡수한다.
export interface PostMetrics {
  views: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  bookmarks: number | null;
  quotes: number | null;
}
