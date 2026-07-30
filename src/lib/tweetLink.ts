// 카드에서 복사·전달하는 트윗 링크.
// 상위 API가 주는 tweetUrl을 쓰지 않는다 — null 가능(types.ts)이고 twitter.com 형태가 섞여 들어온다(mappers.ts).
// 핸들+ID는 항상 있으므로 조립형이 언제나 유효한 x.com 정규형이 된다. (설계 2026-07-30 §B)
export function tweetPermalink(authorHandle: string, tweetId: string): string {
  const handle = authorHandle.replace(/^@+/, '');   // 표시용 '@handle'이 그대로 들어와도 안전하게
  return `https://x.com/${handle}/status/${tweetId}`;
}
