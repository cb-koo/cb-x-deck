// 게시 완료 16건의 게시물 내용을 담는다 — 원고(직접 작성) · 인용 대상 · 게시물 지표.
// 원본은 data-work/week2-posts-raw.json (fetch-week2-posts.ts 가 저장한 X 응답). 재조회하지 않는다.
//
// koo 확인(2026-09-10): "본문은 대부분 우리가 기획해서 전달함. 우리 작성이 맞음" → 원고로 담는 것이 맞다.
//
// 담는 것 3가지, 전부 앱과 같은 함수를 쓴다(규칙이 갈리지 않게):
//   ① 본문 → draft(model:null = 직접 작성) + attachDraft 로 작업에 붙임. status='delivered'(전달됨).
//      insertDraft/attachDraft 를 그대로 쓴다(/api/drafts/manual 과 같은 경로).
//   ② 인용 대상 → 대상이 우리 작업이면 campaign_task.target_task_id, 아니면 target_tweet_url(정규형).
//      스키마 038이 이 두 갈래를 이미 구분해 둔다.
//   ③ 본문·지표 → addTrackedPost(등록+첫 스냅샷 한 트랜잭션) 후 linkTrackedPost 로 작업·원고에 연결.
//
// 🔴 미디어는 담지 않는다(빈 배열). draftMediaGuard 가 X CDN 절대 URL을 명시적으로 금지한다 —
//    임의 URL이 jsonb에 들어가면 워크스페이스 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다
//    (추적 픽셀·IP 유출). "트윗 미디어는 draft가 아니라 tweet 테이블 소관"이 그 파일의 규칙이다.
//    이 스크립트는 라우트를 우회하므로 그 규칙을 여기서 직접 지킨다. 이미지 개수는 원고 메모에 적는다.
//
// 기본은 드라이런. 실제 반영은 --apply --expect 16. 멱등: 이미 원고가 붙은 작업은 건너뛴다.
// 실행: node --env-file=.env --import tsx scripts/load-week2-posts.ts [--apply --expect 16]
import { readFileSync } from 'node:fs';
import type postgres from 'postgres';
import { getSql } from '../src/lib/db.ts';
import { insertDraft, getDraft } from '../src/lib/draftStore.ts';
import { syncInfluencerOnDraftUpdate } from '../src/lib/influencerSync.ts';
import { addTrackedPost, linkTrackedPost, findByTweetId } from '../src/lib/trackingStore.ts';
import { formatForPosts } from '../src/lib/draftFormat.ts';
import { tweetPermalink } from '../src/lib/tweetLink.ts';
import { tweetId } from './tweetDate.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313'; // 박구건

interface Task { no: number; campaign: string; handle: string; type: string; post_url: string | null }
interface Camp { key: string; name: string; client_name: string; client_id: string | null }
type Raw = Record<string, unknown>;

const D = JSON.parse(readFileSync(new URL('../data-work/week2-normalized.json', import.meta.url), 'utf8')) as
  { campaigns: Camp[]; tasks: Task[] };
const RAWS = JSON.parse(readFileSync(new URL('../data-work/week2-posts-raw.json', import.meta.url), 'utf8')) as
  Record<string, Raw | null>;

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

interface Plan {
  camp: Camp; task: Task; taskId: string; tweetId: string; raw: Raw;
  text: string; mediaCount: number; postedAtIso: string; authorHandle: string;
  quoted: { id: string; handle: string; ourTaskId: string | null; url: string } | null;
  hasDraft: boolean; hasTracked: boolean;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const ei = argv.indexOf('--expect');
  const expect = ei >= 0 ? Number(argv[ei + 1]) : null;
  const sql = getSql();

  // 작업 id · post_url 색인 — 인용 대상이 우리 작업인지 판별하는 데 쓴다
  const dbTasks = await sql`
    select t.id, t.influencer_handle as handle, t.type, t.post_url, t.draft_id,
           t.target_task_id, t.target_tweet_url, c.name as camp
      from campaign_task t join campaign c on c.id = t.campaign_id
     where c.name like '%_9월2주차'`;
  const byTweet = new Map<string, string>();       // 트윗 ID → 우리 작업 id
  for (const r of dbTasks) { const i = r.post_url ? tweetId(String(r.post_url)) : null; if (i) byTweet.set(i, r.id as string); }

  const plans: Plan[] = [];
  const skipped: string[] = [];

  for (const t of D.tasks) {
    if (!t.post_url) continue;
    const id = tweetId(t.post_url);
    if (!id) { skipped.push(`@${t.handle}: URL에서 ID 못 뽑음`); continue; }
    const raw = RAWS[id];
    if (!raw) { skipped.push(`@${t.handle}: 조회 결과 없음(삭제·비공개)`); continue; }
    const camp = D.campaigns.find((c) => c.key === t.campaign);
    if (!camp) { skipped.push(`@${t.handle}: 캠페인 못 찾음`); continue; }
    const dbRow = dbTasks.find((r) => r.camp === camp.name && String(r.handle).toLowerCase() === t.handle.toLowerCase() && r.type === t.type);
    if (!dbRow) { skipped.push(`@${t.handle}: DB에 작업 없음`); continue; }

    // 🔴 RT 유형에는 원고를 붙이지 않는다 — 정상 화면으로 만들 수 없는 상태다(campaignTaskStore 주석).
    if (t.type === 'rt') { skipped.push(`@${t.handle}: RT 유형은 원고를 붙이지 않는다`); continue; }

    const q = (raw.quoted_tweet ?? null) as Raw | null;
    const qUser = (q?.user ?? {}) as Raw;
    const qid = s(q?.id);
    const qHandle = s(qUser.screen_name);
    const media = Array.isArray(raw.media) ? raw.media : [];
    const tracked = await findByTweetId(sql, id);

    plans.push({
      camp, task: t, taskId: dbRow.id as string, tweetId: id, raw,
      text: s(raw.text), mediaCount: media.length,
      postedAtIso: s(raw.createdAt), authorHandle: s((raw.author as Raw)?.userName) || t.handle,
      quoted: q ? { id: qid, handle: qHandle, ourTaskId: byTweet.get(qid) ?? null, url: tweetPermalink(qHandle, qid) } : null,
      hasDraft: dbRow.draft_id !== null, hasTracked: tracked !== null,
    });
  }

  const todoDraft = plans.filter((p) => !p.hasDraft);
  const todoTracked = plans.filter((p) => !p.hasTracked);
  const asTask = plans.filter((p) => p.quoted?.ourTaskId);
  const asUrl = plans.filter((p) => p.quoted && !p.quoted.ourTaskId);

  console.log(`총계 — 대상 ${plans.length}건 · 원고 만들 것 ${todoDraft.length} · 게시물 등록할 것 ${todoTracked.length}`);
  console.log(`인용 대상 — 우리 작업(target_task_id) ${asTask.length}건 · 외부 게시물(target_tweet_url) ${asUrl.length}건`);
  if (skipped.length) { console.log('\n건너뜀:'); for (const x of skipped) console.log(`   · ${x}`); }

  // 사전 검사 — DB 제약(campaign_task_not_self)에 걸리기 전에 드라이런에서 잡는다
  const fails: string[] = [];
  for (const p of plans) {
    if (p.quoted?.ourTaskId === p.taskId) fails.push(`@${p.task.handle}: 자기 작업을 인용 대상으로 가리킨다(제약 위반)`);
    if (p.task.type === 'rt') fails.push(`@${p.task.handle}: RT 유형이 대상에 남아 있다`);
    if (!p.text.trim()) fails.push(`@${p.task.handle}: 본문이 비어 원고를 만들 수 없다`);
    if (!p.postedAtIso) fails.push(`@${p.task.handle}: API 게시 시각이 없다`);
    if (p.quoted && !p.quoted.ourTaskId && !/^https:\/\/x\.com\/[^/]+\/status\/\d+$/.test(p.quoted.url)) {
      fails.push(`@${p.task.handle}: 인용 대상 URL이 정규형 아님 — ${p.quoted.url}`);
    }
  }
  if (fails.length) {
    console.log(`\n✗ 사전 검사 실패 ${fails.length}건`);
    for (const f of fails) console.log(`   ✗ ${f}`);
    await sql.end(); process.exit(1);
  }
  console.log('✓ 사전 검사 통과 — 자기참조·RT·빈 본문·게시시각·URL 정규형');

  console.log('\n══ 원고(직접 작성 · model=null · status=delivered) ══');
  for (const p of plans) {
    const mark = p.hasDraft ? '(이미 있음)' : '';
    console.log(`   [${p.camp.name}] ${p.task.no}. @${p.task.handle} ${mark}`);
    console.log(`      클라 ${p.camp.client_name} · ${p.text.length}자 · 이미지 ${p.mediaCount}개(담지 않음)`);
    console.log(`      ${p.text.split('\n')[0].slice(0, 70)}…`);
  }

  console.log('\n══ 인용 대상 ══');
  for (const p of plans) {
    if (!p.quoted) { console.log(`   ${p.task.no}. @${p.task.handle}: 인용 대상 없음`); continue; }
    const how = p.quoted.ourTaskId ? `target_task_id → 우리 작업 @${dbTasks.find((r) => r.id === p.quoted?.ourTaskId)?.handle}` : `target_tweet_url → ${p.quoted.url}`;
    console.log(`   ${p.task.no}. @${p.task.handle}  ${how}`);
  }

  console.log('\n══ 게시물 등록(tracked_post + 첫 지표 스냅샷) ══');
  for (const p of plans) {
    const m = p.raw;
    console.log(`   @${p.authorHandle.padEnd(16)} 조회 ${String(num(m.viewCount) ?? '-').padStart(7)} · 좋아요 ${String(num(m.likeCount) ?? '-').padStart(5)} · RT ${String(num(m.retweetCount) ?? '-').padStart(4)}${p.hasTracked ? '  (이미 등록됨)' : ''}`);
  }

  console.log('\n══ 담지 않는 것 ══');
  console.log('· 트윗 이미지 — draftMediaGuard 가 X CDN URL을 금지한다(추적 픽셀·IP 유출 방어). 개수만 메모에 남긴다');
  console.log('· 인용 대상의 본문 — quoted_tweet 캐시는 덱이 조회할 때 채운다(우리가 미리 넣을 값이 아니다)');
  console.log('· 정산 요청 — 만들지 않는다');

  if (!apply) { console.log(`\n드라이런입니다 — 실제로 넣으려면: --apply --expect ${plans.length}`); await sql.end(); return; }
  if (expect !== plans.length) { console.error(`\n✗ 대상 수가 예상과 다릅니다 (예상 ${expect} · 실제 ${plans.length}) — 중단합니다.`); await sql.end(); process.exit(2); }

  for (const p of plans) {
    await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;

      // ① 원고 — 없을 때만
      if (!p.hasDraft) {
        const draftId = await insertDraft(tx, {
          clientId: p.camp.client_id, clientName: p.camp.client_name,
          procedureNames: [], direction: '', format: formatForPosts(1),
          referenceMode: 'off', refs: [],
          content: { posts: [{ text: p.text, media: [] }] },
          model: null, memberId: KOO,
          title: null,
          taskId: p.taskId,   // insertDraft 안에서 attachDraft — 같은 트랜잭션
        });
        // attachDraft 가 작업의 핸들을 원고에 채운 뒤 상태를 읽는다 — 로그의 before 가 되어야 한다.
        const created = await getDraft(tx, draftId);
        if (!created) throw new Error(`원고 ${draftId} 재조회 실패`);

        // 기본값 'draft'(초안)가 아니다 — 기획해 전달하고 게시까지 끝난 건이라 'delivered'(전달됨).
        // insertDraft 가 status 를 받지 않으므로 같은 트랜잭션에서 바로 갱신한다.
        await tx`update draft set status = 'delivered' where id = ${draftId}`;

        // 🔴 라우트가 하는 일을 스크립트도 해야 한다 — 이걸 빼면 인플루언서 활동 로그에 아무것도 안 남아
        // 인플 상세 화면에서 "원고 배정·전달" 이력이 사라진다(influencerSync 주석: "로그만 누락되는 어긋남을
        // 만들지 않는다"). before.influencerHandle=null 로 두어 배정 로그가 나게 하는 방식은 /api/drafts/manual 과 같다.
        // status='delivered' 를 함께 넘겨 draft_assigned + draft_delivered 두 건이 남는다.
        if (created.influencerHandle) {
          await syncInfluencerOnDraftUpdate(tx, {
            before: { ...created, influencerHandle: null },
            influencerHandle: created.influencerHandle,
            status: 'delivered',
            actorId: KOO,
          });
        }
        console.log(`✓ 원고 ${p.camp.name} @${p.task.handle} → ${draftId} (배정·전달 로그 기록)`);
      }

      // ② 인용 대상
      if (p.quoted) {
        if (p.quoted.ourTaskId) {
          await tx`update campaign_task set target_task_id = ${p.quoted.ourTaskId}, target_tweet_url = null, updated_at = now() where id = ${p.taskId}`;
        } else {
          await tx`update campaign_task set target_tweet_url = ${p.quoted.url}, target_task_id = null, updated_at = now() where id = ${p.taskId}`;
        }
      }
    });

    // ③ 게시물 등록 + 연결 — addTrackedPost 가 자체 트랜잭션이라 밖에서 호출한다
    if (!p.hasTracked) {
      const m = p.raw;
      const { row } = await addTrackedPost(sql, {
        tweetId: p.tweetId, authorHandle: p.authorHandle, text: p.text,
        postedAt: p.postedAtIso || null, createdBy: KOO,
        metrics: {
          views: num(m.viewCount), likes: num(m.likeCount), retweets: num(m.retweetCount),
          replies: num(m.replyCount), bookmarks: num(m.bookmarkCount), quotes: num(m.quoteCount),
        },
        raw: m,
      });
      await linkTrackedPost(sql, row.id, { taskId: p.taskId });
      console.log(`✓ 게시물 @${p.authorHandle} → ${row.id}`);
    }
  }

  const [after] = await sql.unsafe(`select
    (select count(*) from draft where model is null) as manual_drafts,
    (select count(*) from campaign_task where draft_id is not null) as tasks_with_draft,
    (select count(*) from campaign_task where target_task_id is not null) as target_task,
    (select count(*) from campaign_task where target_tweet_url is not null) as target_url,
    (select count(*) from tracked_post where task_id is not null) as tracked_linked,
    (select count(*) from post_metric_snapshot) as snapshots,
    (select count(*) from payment_request) as req`);
  console.log(`\n확인 — 직접작성 원고 ${after.manual_drafts} · 원고 붙은 작업 ${after.tasks_with_draft} · 인용대상(작업) ${after.target_task} · 인용대상(URL) ${after.target_url} · 연결된 게시물 ${after.tracked_linked} · 지표 스냅샷 ${after.snapshots} · 정산요청 ${after.req}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
