// 확장 탐색 3 엔드포인트 실계약 확인 (비용 ~$0.003)
// 사용: npx tsx --env-file=.env scripts/smoke-expansion.ts <tweetId>
import { makeClient } from '../src/lib/getxapi.ts';

const tweetId = process.argv[2];
if (!tweetId) {
  console.error('사용법: npx tsx --env-file=.env scripts/smoke-expansion.ts <tweetId>');
  process.exit(1);
}
(async () => {
  const c = makeClient();
  const runs = [
    ['replies', () => c.getTweetReplies(tweetId)],
    ['thread', () => c.getTweetThread(tweetId)],
    ['retweeters', () => c.getTweetRetweeters(tweetId)],
  ] as const;
  for (const [name, fn] of runs) {
    const page = await fn();
    const items = 'tweets' in page ? page.tweets : page.users;
    console.log(`\n== ${name}: ${items.length}건, has_more=${page.has_more}, next_cursor=${page.next_cursor}`);
    console.dir(items[0], { depth: 2 });
  }
})();
