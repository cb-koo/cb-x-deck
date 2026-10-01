import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { fetchPost } from '@/lib/postMetrics';
import { addTrackedPost, findByTweetId, findTrackedPostById, listTrackedPosts, TrackingLinkError, trackingLinkMessage, TRACKING_LINK_CANCELLED_MESSAGE } from '@/lib/trackingStore';
import { TASK_ID_MESSAGE } from '@/lib/campaignTaskInput';
import { isUuidLike } from '@/lib/uuid';
import { judgeTaskLink, linkTrackedPostGuarded, TaskChangedError, type TaskSeen } from '@/lib/postAttach';
import { authorVerdictMessage } from '@/lib/postAuthor';

// 등록 시점의 '없음'은 삭제·비공개 외에 주소 오타일 수도 있다(QA 08-15 — 주소 일부를 바꿔 넣은 사례).
// 사용자가 가장 먼저 고칠 수 있는 원인(주소)을 앞에 말한다. 이미 추적 중인 행의 배지 문구와는 다르다 —
// 그쪽은 등록이 성공했던 주소라 '주소가 잘못됐다'는 가설이 성립하지 않는다.
const UNAVAILABLE = '게시물을 찾을 수 없어요 — 주소가 잘못됐거나 삭제·비공개일 수 있어요';
const FETCH_FAILED = '지표를 가져오지 못했어요 — 잠시 후 다시 시도해 주세요';

export async function GET() {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  return NextResponse.json(await listTrackedPosts(getSql()));
}

// 등록 = 첫 측정. 링크는 서버에서 재검증한다 — 클라이언트 인라인 검증만 믿지 않는다(같은 파서).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as { url?: unknown; taskId?: unknown };

  // 작업 화면에서 '게시물 연결'로 들어오는 taskId(선택) — 등록/기존행 확보 뒤 아래서 연결한다.
  const taskId = body.taskId;
  if (taskId !== undefined && (typeof taskId !== 'string' || !isUuidLike(taskId))) {
    return NextResponse.json({ error: TASK_ID_MESSAGE }, { status: 400 });
  }

  const parsed = parseTweetLink(String(body.url ?? ''));
  if (!parsed.ok) return NextResponse.json({ error: tweetLinkParseMessage(parsed.reason) }, { status: 400 });

  // 이미 추적 중이면 오류가 아니라 정보 — 기존 행을 돌려주고 API 콜도 아낀다(influencers POST 관례).
  // 이미 다른 작업에 붙어 있어도 그대로 덮는다 — 게시물 1개는 작업 1개에만(§2-4).
  const existing = await findByTweetId(sql, parsed.tweetId);
  let row = existing;
  let created = false;
  // 판정 때 본 작업의 모습 — 연결 트랜잭션이 잠근 행과 비교해 그사이 인플 변경을 막는다(스펙 §9-1)
  let seen: TaskSeen = null;
  if (existing && taskId) {
    // 작업에 붙이기 전 작성자 확인(다른 인플의 게시물 차단 스펙 §3 ②③) — 저장된 작성자로 먼저, 필요하면 조회
    const j = await judgeTaskLink(sql, taskId, { tweetId: existing.tweetId, authorHandle: existing.authorHandle }, { fetchPost });
    if (j.verdict.kind !== 'ok') return NextResponse.json(authorVerdictMessage(j.verdict), { status: 400 });
    seen = j.seen;
  }
  if (!existing) {
    const result = await fetchPost(parsed.tweetId);
    if (result.kind === 'unavailable') return NextResponse.json({ error: UNAVAILABLE }, { status: 404 });
    if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });
    // 작업으로 들어온 등록이면 등록 전에 판정한다 — 남의 게시물이 트래킹 목록에 주인 없이 남지 않게. 방금 조회한 값이라 다시 부르지 않는다.
    if (taskId) {
      const j = await judgeTaskLink(sql, taskId, {
        tweetId: result.post.tweetId, authorHandle: result.post.authorHandle, authorUserId: result.post.authorUserId,
      }, { fetchPost });
      if (j.verdict.kind !== 'ok') return NextResponse.json(authorVerdictMessage(j.verdict), { status: 400 });
      seen = j.seen;
    }

    const added = await addTrackedPost(sql, {
      tweetId: result.post.tweetId, authorHandle: result.post.authorHandle,
      text: result.post.text, postedAt: result.post.postedAt,
      createdBy: gate.member.id, metrics: result.post.metrics, raw: result.post.raw,
    });
    created = added.created;
    row = added.row;
  }

  if (taskId) {
    try {
      // 연결 트랜잭션에서 작업 행을 잠그고 판정 때와 같은지 다시 본 뒤 연결한다(§9-1).
      // 등록(첫 측정)은 따로 끝났으니 그사이 바뀌어 거절돼도 등록은 남는다(RT·취소 거절과 같은 태도).
      await linkTrackedPostGuarded(sql, row!.id, { taskId }, seen);
    } catch (e) {
      if (e instanceof TaskChangedError) return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
      // RT 작업엔 자기 게시물이 없다 — 연결하면 증빙 없이 게시됨이 된다(§5). 등록(첫 측정)은 그대로 두고 연결만 거절한다.
      if (e instanceof TrackingLinkError) return NextResponse.json({ error: trackingLinkMessage(e) }, { status: 400 });
      // 존재하지 않는 작업 id를 연결하려 하면 FK 위반(23503, linkTrackedPost는 직접 같은 code로 던지기도 한다) — 사용자 잘못이니 400으로 알린다.
      // 등록(첫 측정)은 이미 끝난 뒤라 그대로 두고, 연결만 실패한 것으로 처리한다([id] PATCH와 동일 매핑).
      if ((e instanceof postgres.PostgresError && e.code === '23503') || (e as { code?: unknown })?.code === '23503') {
        return NextResponse.json({ error: '연결하려는 원고나 작업을 찾을 수 없어요' }, { status: 400 });
      }
      // 최후 방어 — linkTrackedPost의 for update 직렬화(I2)로 거의 나지 않지만, 다른 경로가 check를
      // 밟아도 500 대신 문구로(취소·게시 확인 상호 배제, ADR 0002).
      if (e instanceof postgres.PostgresError && e.code === '23514') {
        return NextResponse.json({ error: TRACKING_LINK_CANCELLED_MESSAGE }, { status: 400 });
      }
      throw e;
    }
    row = await findTrackedPostById(sql, row!.id);
  }
  return NextResponse.json({ created, row });
}
