import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import { fetchPost } from '@/lib/postMetrics';
import { addTrackedPost, findByTweetId, findTrackedPostById, linkTrackedPost, listTrackedPosts, TrackingLinkError, TRACKING_LINK_RT_MESSAGE } from '@/lib/trackingStore';
import { TASK_ID_MESSAGE } from '@/lib/campaignTaskInput';
import { isUuidLike } from '@/lib/uuid';

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
  if (!existing) {
    const result = await fetchPost(parsed.tweetId);
    if (result.kind === 'unavailable') return NextResponse.json({ error: UNAVAILABLE }, { status: 404 });
    if (result.kind === 'error') return NextResponse.json({ error: FETCH_FAILED }, { status: 502 });

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
      await sql.begin(async (tx0) => linkTrackedPost(tx0 as unknown as postgres.Sql, row!.id, { taskId }));
    } catch (e) {
      // RT 작업엔 자기 게시물이 없다 — 연결하면 증빙 없이 게시됨이 된다(§5). 등록(첫 측정)은 그대로 두고 연결만 거절한다.
      if (e instanceof TrackingLinkError) return NextResponse.json({ error: TRACKING_LINK_RT_MESSAGE }, { status: 400 });
      // 존재하지 않는 작업 id를 연결하려 하면 FK 위반(23503, linkTrackedPost는 직접 같은 code로 던지기도 한다) — 사용자 잘못이니 400으로 알린다.
      // 등록(첫 측정)은 이미 끝난 뒤라 그대로 두고, 연결만 실패한 것으로 처리한다([id] PATCH와 동일 매핑).
      if ((e instanceof postgres.PostgresError && e.code === '23503') || (e as { code?: unknown })?.code === '23503') {
        return NextResponse.json({ error: '연결하려는 원고나 작업을 찾을 수 없어요' }, { status: 400 });
      }
      throw e;
    }
    row = await findTrackedPostById(sql, row!.id);
  }
  return NextResponse.json({ created, row });
}
