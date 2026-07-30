// 카드에서 복사·전달하는 트윗 링크.
// 상위 API가 주는 tweetUrl을 쓰지 않는다 — null 가능(types.ts)이고 twitter.com 형태가 섞여 들어온다(mappers.ts).
// 핸들+ID는 항상 있으므로 조립형이 언제나 유효한 x.com 정규형이 된다. (설계 2026-07-30 §B)
// 예외로 핸들이 없을 수 있다 — 브리핑 인용은 트윗 스냅샷이 옵셔널이라(briefingTypes.ts) 핸들이 남아 있지 않다.
// 이때는 ID만으로 된 형식으로 떨어진다. X가 해석해 주는 형식이고, 브리핑의 기존 '원문 ↗' 링크가
// 이미 정확히 이 형식이라(api/briefings/route.ts:39) 앱 전체가 규칙 하나로 통일된다. (설계 §F)
export function tweetPermalink(authorHandle: string | null | undefined, tweetId: string): string {
  const handle = (authorHandle ?? '').replace(/^@+/, '');   // 표시용 '@handle'이 그대로 들어와도 안전하게
  if (!handle) return `https://x.com/i/status/${tweetId}`;
  return `https://x.com/${handle}/status/${tweetId}`;
}
