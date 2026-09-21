// 표시·제출에서 같은 목록을 사용한다. 대상이 바뀌어 상한을 넘으면 사용자가 빼도록 남겨 둔다.
export function ordinaryQuoteReferences<T extends { tweetId: string }>(rows: T[], targetTweetId: string | null): T[] {
  const seen = new Set<string>(targetTweetId ? [targetTweetId] : []);
  return rows.filter((row) => {
    if (seen.has(row.tweetId)) return false;
    seen.add(row.tweetId);
    return true;
  });
}
