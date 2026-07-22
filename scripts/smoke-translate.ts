// 실 Anthropic API 스모크(Haiku): DB의 실제 일본어 트윗 몇 건을 한국어로 번역해 품질을 눈으로 확인.
// 실 트윗 본문 + 인용(있으면)으로 프롬프트·용어집·JSON 파싱 전 구간을 검증한다. (~$0.001)
import { getSql } from '../src/lib/db.ts';
import { translateTweets, type TranslateInput } from '../src/lib/translate.ts';

(async () => {
  const sql = getSql();
  // 본문이 어느 정도 있는 최근 트윗 6건(인용 있는 건 우선 섞이도록 정렬 무관 샘플)
  const rows = await sql<Array<{ tweet_id: string; text: string; quoted_text: string | null }>>`
    select tweet_id, text, quoted->>'text' as quoted_text
      from tweet
     where length(text) >= 20
     order by first_seen_at desc
     limit 6`;

  if (rows.length === 0) {
    console.error('DB에 번역할 트윗이 없음 — 컬럼을 먼저 새로고침하세요');
    await sql.end();
    process.exit(1);
  }

  const inputs: TranslateInput[] = rows.map((r) => ({ tweetId: r.tweet_id, text: r.text, quotedText: r.quoted_text }));
  console.log(`번역 대상 ${inputs.length}건, 실 Haiku 호출…\n`);
  const out = await translateTweets(inputs);

  for (const i of inputs) {
    const t = out.get(i.tweetId);
    console.log('─'.repeat(60));
    console.log('JA: ' + i.text.replace(/\s+/g, ' '));
    console.log('KO: ' + (t?.content ?? '❌ 번역 실패'));
    if (i.quotedText) console.log('  인용 JA: ' + i.quotedText.replace(/\s+/g, ' '));
    if (t?.quotedContent) console.log('  인용 KO: ' + t.quotedContent);
  }
  console.log('─'.repeat(60));
  console.log(`\n결과: ${out.size}/${inputs.length}건 번역됨`);

  await sql.end();
  if (out.size === 0) {
    console.error('전부 실패 — 프롬프트/모델/키 확인 필요');
    process.exit(1);
  }
  process.exit(0);
})();
