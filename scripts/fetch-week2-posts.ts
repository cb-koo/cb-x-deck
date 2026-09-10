// 읽기 전용(DB 쓰기 없음) — 9월2주차 게시 완료 작업의 게시물을 X에서 조회해 무엇을 담을 수 있는지 본다.
// 앱과 같은 클라이언트(src/lib/getxapi GetxapiClient.getTweetDetail)를 쓴다 — 사용량도 'getxapi.tweetDetail'로 기록된다.
// 비용: 트윗당 약 $0.001 → 16건 ≈ $0.02.
//
// 원본 응답은 data-work/week2-posts-raw.json 에 저장한다(재조회 방지 · 저장 단계에서 그대로 재사용).
// 확인하려는 것:
//   ① 본문(text) — 원고 '직접 작성'(model:null)으로 담을 수 있나
//   ② 인용 대상(quoted_tweet) — 인용RT의 대상 게시물 링크를 담을 수 있나
//   ③ 작성자 핸들 — 게시물 URL의 핸들과 다르면 개명(@coco__ns_5 → @coco_______5 사례)
//   ④ 게시 시각 — 내가 스노플레이크로 계산한 값과 API createdAt 대조(16건 전량)
//   ⑤ 지표 — tracked_post + post_metric_snapshot 에 담을 수 있나
// 실행: node --env-file=.env --import tsx scripts/fetch-week2-posts.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { makeClient, GetxapiAuthError, type RawTweet } from '../src/lib/getxapi.ts';
import { tweetId, postedOnSeoul } from './tweetDate.ts';

interface Task { no: number; campaign: string; handle: string; type: string; post_url: string | null; cost: { amount: number } }
const SRC = new URL('../data-work/week2-normalized.json', import.meta.url);
const OUT = new URL('../data-work/week2-posts-raw.json', import.meta.url);
const D = JSON.parse(readFileSync(SRC, 'utf8')) as { tasks: Task[] };

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
const seoul = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '(파싱 실패)' : new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(t));
};

async function main(): Promise<void> {
  const posted = D.tasks.filter((t) => t.post_url);
  console.log(`조회 대상 ${posted.length}건 (게시 완료분만) · 예상 비용 약 $${(posted.length * 0.001).toFixed(3)}\n`);

  const client = makeClient();
  const raws: Record<string, RawTweet | null> = {};
  const rows: Array<Record<string, unknown>> = [];

  for (const t of posted) {
    const id = tweetId(t.post_url as string);
    if (!id) { console.log(`✗ ${t.campaign} @${t.handle}: URL에서 ID를 못 뽑음`); continue; }
    let raw: RawTweet | null;
    try {
      raw = await client.getTweetDetail(id);
    } catch (e) {
      if (e instanceof GetxapiAuthError) { console.error('✗ GetXAPI 인증 실패 — GETXAPI_KEY 또는 잔액 확인'); process.exit(1); }
      console.log(`✗ ${t.campaign} @${t.handle}: ${(e as Error).message}`);
      raws[id] = null; continue;
    }
    raws[id] = raw;
    if (!raw) { console.log(`⚠️ ${t.campaign} @${t.handle} (${id}): 조회 불가 — 삭제·비공개·정지`); continue; }

    const author = (raw.author ?? {}) as Record<string, unknown>;
    const urlHandle = (t.post_url as string).split('/')[3];
    const nowHandle = s(author.userName);
    const q = (raw.quoted_tweet ?? null) as Record<string, unknown> | null;
    const qUser = (q?.user ?? {}) as Record<string, unknown>;
    const media = Array.isArray(raw.media) ? raw.media : [];

    rows.push({
      campaign: t.campaign, no: t.no, handle: t.handle,
      type: t.type,
      계산_게시일: postedOnSeoul(t.post_url as string),
      api_게시시각: seoul(s(raw.createdAt)),
      게시일_일치: postedOnSeoul(t.post_url as string) === seoul(s(raw.createdAt)).slice(0, 10),
      url_핸들: urlHandle, 현재_핸들: nowHandle,
      개명: nowHandle !== '' && nowHandle.toLowerCase() !== urlHandle.toLowerCase(),
      본문_길이: s(raw.text).length,
      본문: s(raw.text),
      미디어: media.length,
      인용_대상_있음: q !== null,
      인용_대상_id: s(q?.id),
      인용_대상_핸들: s(qUser.screen_name),
      인용_대상_본문: s(q?.text).slice(0, 60),
      isReply: raw.isReply === true,
      views: n(raw.viewCount), likes: n(raw.likeCount), rts: n(raw.retweetCount),
      replies: n(raw.replyCount), quotes: n(raw.quoteCount), bookmarks: n(raw.bookmarkCount),
      lang: s(raw.lang),
    });
  }

  writeFileSync(OUT, JSON.stringify(raws, null, 2) + '\n');

  const ok = rows.length;
  const 개명 = rows.filter((r) => r.개명);
  const 인용있음 = rows.filter((r) => r.인용_대상_있음);
  const 날짜불일치 = rows.filter((r) => !r.게시일_일치);
  const 본문있음 = rows.filter((r) => (r.본문_길이 as number) > 0);
  const quoteRt = rows.filter((r) => r.type === 'quoteRt');

  console.log(`총계 — 조회 성공 ${ok}/${posted.length} · 본문 있음 ${본문있음.length} · 인용 대상 있음 ${인용있음.length} · 개명 ${개명.length} · 게시일 불일치 ${날짜불일치.length}`);
  console.log(`인용RT 유형 ${quoteRt.length}건 중 인용 대상이 실제로 있는 것 ${quoteRt.filter((r) => r.인용_대상_있음).length}건\n`);

  console.log('══════ 게시일 대조 (내 계산 vs API) ══════');
  for (const r of rows) console.log(`${r.게시일_일치 ? '✓' : '✗'} @${String(r.handle).padEnd(16)} 계산 ${r.계산_게시일} | API ${r.api_게시시각}`);

  console.log('\n══════ 핸들 개명 ══════');
  if (!개명.length) console.log('없음 — URL 핸들과 현재 핸들이 모두 같다');
  for (const r of 개명) console.log(`🔴 @${r.url_핸들} → @${r.현재_핸들}  (${r.campaign} ${r.no}번)`);

  console.log('\n══════ 본문 (원고 직접 작성으로 담을 후보) ══════');
  for (const r of rows) {
    console.log(`\n[${r.campaign} ${r.no}] @${r.handle} · ${r.본문_길이}자 · 미디어 ${r.미디어}개 · ${r.lang}`);
    console.log(`  ${String(r.본문).replace(/\n/g, '\n  ')}`);
  }

  console.log('\n══════ 인용 대상 (인용RT의 대상 게시물) ══════');
  for (const r of rows) {
    if (!r.인용_대상_있음) { console.log(`— [${r.campaign} ${r.no}] @${r.handle} ${r.type}: 인용 대상 없음`); continue; }
    console.log(`✓ [${r.campaign} ${r.no}] @${r.handle} → https://x.com/${r.인용_대상_핸들}/status/${r.인용_대상_id}`);
    console.log(`    @${r.인용_대상_핸들}: ${r.인용_대상_본문}…`);
  }

  console.log('\n══════ 지표 ══════');
  console.log('핸들'.padEnd(18) + '조회'.padStart(9) + '좋아요'.padStart(8) + 'RT'.padStart(6) + '답글'.padStart(6) + '인용'.padStart(6) + '북마크'.padStart(8));
  for (const r of rows) {
    console.log(`@${String(r.handle).padEnd(17)}${String(r.views).padStart(9)}${String(r.likes).padStart(8)}${String(r.rts).padStart(6)}${String(r.replies).padStart(6)}${String(r.quotes).padStart(6)}${String(r.bookmarks).padStart(8)}`);
  }

  console.log(`\n원본 응답 저장: data-work/week2-posts-raw.json (${ok}건)`);
  console.log('DB에는 아무것도 쓰지 않았습니다.');
}
main().catch((e) => { console.error(e); process.exit(1); });
