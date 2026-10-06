// 깨진 글자(U+FFFD, �)로 저장된 추적 게시물 본문을 다시 조회해 고친다(스펙 2026-10-06-self-replies-design.md §10).
// 기본은 미리보기(dry-run) — 무엇을 고칠지 세기만 하고 DB는 건드리지 않는다. --apply를 붙여야 고친다.
// 다시 조회한 본문이 정상(� 없음)일 때만 tracked_post.text를 바꾸고, 같은 게시물의 덱 캐시(tweet) 본문도 깨져 있으면 함께 바꾼다
// (작업 패널의 본 게시물 카드는 캐시 본문을 보여준다). 지표·스냅샷은 건드리지 않는다. 게시물당 X 상세 조회 1~2회.
// 실행: node --import tsx --env-file=.env.staging scripts/repair-garbled-tracked-posts.ts [--apply]
//   .env.staging엔 GETXAPI_KEY가 없다 — 연습용 DB로 돌릴 땐 키만 앞에 붙여 넘긴다(GETXAPI_KEY=… node …).
// 운영 데이터 수정은 koo 확인 후에만(스펙 §10).
import { getSql } from '../src/lib/db.ts';
import { fetchPost } from '../src/lib/postMetrics.ts';
import { makeClient } from '../src/lib/getxapi.ts';
import { hasReplacementChar } from '../src/lib/garbledText.ts';

// 깨진 자리 앞뒤 몇 글자 — 무엇이 어떻게 바뀌는지 눈으로 확인하게
const around = (t: string, at: number) => JSON.stringify(t.slice(Math.max(0, at - 12), at + 12));

async function main() {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const rows = await sql<Array<{ id: string; tweet_id: string; text: string }>>`
    select id, tweet_id, text from tracked_post where position(chr(65533) in text) > 0 order by created_at asc`;
  const [{ total }] = await sql<Array<{ total: string }>>`select count(*)::text as total from tracked_post`;
  console.log(`${apply ? '[고치기]' : '[미리보기 — DB는 안 바뀜, 고치려면 --apply]'} 추적 게시물 ${total}개 중 깨진 본문 ${rows.length}개`);

  const client = rows.length > 0 ? makeClient() : null;
  const count = { fixed: 0, stillGarbled: 0, unavailable: 0, error: 0, cacheFixed: 0 };
  for (const r of rows) {
    const res = await fetchPost(r.tweet_id, client!);
    if (res.kind === 'unavailable') { count.unavailable++; console.log(`  ${r.tweet_id}: 없음(삭제·비공개) — 건너뜀`); continue; }
    if (res.kind === 'error' || res.post.tweetId !== r.tweet_id) { count.error++; console.log(`  ${r.tweet_id}: 조회 실패 — 건너뜀`); continue; }
    const next = res.post.text;
    if (!next.trim() || hasReplacementChar(next)) { count.stillGarbled++; console.log(`  ${r.tweet_id}: 다시 조회해도 깨짐 — 그대로 둠`); continue; }
    count.fixed++;
    const at = r.text.indexOf('\uFFFD');
    console.log(`  ${r.tweet_id}: 고칠 수 있음 — ${around(r.text, at)} → ${around(next, at)}`);
    if (!apply) continue;
    // 조회하는 사이 다른 경로가 이미 고쳤으면 덮어쓰지 않는다(깨진 본문일 때만)
    await sql`update tracked_post set text = ${next} where id = ${r.id} and position(chr(65533) in text) > 0`;
    const c = await sql`update tweet set text = ${next} where tweet_id = ${r.tweet_id} and position(chr(65533) in text) > 0 returning tweet_id`;
    count.cacheFixed += c.length;
  }
  console.log(`결과: ${apply ? '고침' : '고칠 수 있음'} ${count.fixed} · 다시 조회해도 깨짐 ${count.stillGarbled} · 없음 ${count.unavailable} · 조회 실패 ${count.error}`
    + (apply ? ` · 덱 캐시 본문도 고침 ${count.cacheFixed}` : ''));
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
