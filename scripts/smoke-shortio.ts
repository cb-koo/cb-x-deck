// short.io 실계약 스모크 — 생성→중복 생성(409 확인)→통계 조회 1왕복.
// 만든 테스트 링크는 자동 삭제하지 않는다(삭제 API를 앱이 안 쓰므로) — 마지막에 지울 링크를 안내한다.
import { ShortioClient } from '../src/lib/shortio.ts';

(async () => {
  const apiKey = process.env.SHORTIO_API_KEY;
  const domain = process.env.SHORTIO_DOMAIN;
  if (!apiKey || !domain) {
    console.log('SHORTIO_API_KEY / SHORTIO_DOMAIN 미설정 — .env에 넣고 다시 실행하세요');
    process.exit(0);
  }
  const client = new ShortioClient({ apiKey, domain });
  const path = 'smoke-' + Date.now().toString(36);

  const created = await client.createLink({
    originalUrl: 'https://example.com/?utm_source=x&utm_medium=influencer&utm_campaign=smoke&utm_content=smoke-' + path,
    path, title: 'smoke test — 지워도 됩니다',
  });
  console.log('createLink:', JSON.stringify(created, null, 2));
  if (created.kind !== 'ok') process.exit(1);

  const dup = await client.createLink({ originalUrl: 'https://example.com/', path });
  console.log('중복 경로 생성(409 → conflict 기대):', dup.kind);

  const stats = await client.getLinkStats(created.linkId);
  console.log('getLinkStats:', JSON.stringify(stats, null, 2));

  const missing = await client.getLinkStats('lnk_missing_0000');
  console.log('없는 링크 통계(unavailable 기대):', missing.kind);

  console.log(`\n확인 후 short.io 대시보드에서 테스트 링크(${domain}/${path})를 지워주세요.`);
})();
