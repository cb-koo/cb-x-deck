import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { parseXHandle } from '@/lib/xHandle';
import { checkLandingUrl, landingUrlMessage, buildTrackedUrl, checkCampaign, campaignMessage, checkSlug, slugMessage, checkContentLabel, contentLabelMessage, utmContentOf } from '@/lib/trackingLink';
import { isShortioConfigured, makeShortioClient } from '@/lib/shortio';
import { insertLink, listLinks, utmContentExists } from '@/lib/linkStore';

const NOT_CONFIGURED = 'short.io 연결이 아직 설정되지 않았어요 — 관리자에게 SHORTIO_API_KEY·SHORTIO_DOMAIN 설정을 요청해 주세요';
const CREATE_FAILED = '짧은 링크를 만들지 못했어요 — 잠시 후 다시 시도해 주세요';

// configured를 함께 내려보낸다 — 화면이 '만들기'를 거짓 어포던스로 두지 않기 위한 근거(스펙 §short.io 연동).
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const draftId = new URL(req.url).searchParams.get('draftId');
  const rows = await listLinks(getSql(), draftId && isUuidLike(draftId) ? { draftId } : undefined);
  return NextResponse.json({ configured: isShortioConfigured(), rows });
}

// 생성은 원자적: short.io 생성이 성공한 뒤에만 DB에 저장 — 실패 시 반쪽 행이 없다(스펙 §생성 흐름).
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  if (!isShortioConfigured()) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as {
    landingUrl?: unknown; influencerHandle?: unknown; utmCampaign?: unknown; slug?: unknown; contentLabel?: unknown;
    draftId?: unknown; clientId?: unknown;
  };

  // 서버 재검증 — 클라이언트 인라인 검증만 믿지 않는다(같은 함수, parseTweetLink 관례)
  const landing = checkLandingUrl(String(body.landingUrl ?? ''));
  if (!landing.ok) return NextResponse.json({ error: landingUrlMessage(landing.reason) }, { status: 400 });
  const handle = parseXHandle(String(body.influencerHandle ?? ''));
  if (!handle.ok) return NextResponse.json({ error: '인플루언서 핸들을 확인해 주세요 — @핸들 또는 프로필 링크' }, { status: 400 });
  const campaignCheck = checkCampaign(String(body.utmCampaign ?? ''));
  if (!campaignCheck.ok) return NextResponse.json({ error: campaignMessage(campaignCheck.reason) }, { status: 400 });
  const campaign = campaignCheck.campaign; // 정규화(공백→하이픈)된 영문 캠페인 — 클라이언트와 같은 함수
  const slugCheck = checkSlug(String(body.slug ?? ''));
  if (!slugCheck.ok) return NextResponse.json({ error: slugMessage(slugCheck.reason) }, { status: 400 });
  const labelCheck = checkContentLabel(String(body.contentLabel ?? ''));
  if (!labelCheck.ok) return NextResponse.json({ error: contentLabelMessage(labelCheck.reason) }, { status: 400 });

  // 연결 대상은 존재할 때만 잇는다 — 죽은 id로 FK 오류(500)를 내느니 조용히 연결 없이 만든다
  let draftId: string | null = null;
  if (typeof body.draftId === 'string' && isUuidLike(body.draftId)) {
    const d = await sql<Array<{ id: string }>>`select id from draft where id = ${body.draftId}`;
    if (d.length) draftId = body.draftId;
  }
  let clientId: string | null = null;
  let clientName: string | null = null;
  if (typeof body.clientId === 'string' && isUuidLike(body.clientId)) {
    const c = await sql<Array<{ id: string; name: string }>>`select id, name from client where id = ${body.clientId}`;
    if (c.length) { clientId = c[0].id; clientName = c[0].name; } // 이름은 서버가 스냅샷(클라 삭제 대비)
  }

  // utm_content = {핸들}-{콘텐츠 구분}(031) — 같은 값이 이미 있으면 -2, -3(GA에서 두 링크가 한 값으로 뭉치지 않게)
  let utmContent = utmContentOf(handle.handle, labelCheck.label);
  for (let n = 2; await utmContentExists(sql, utmContent) && n < 20; n++) {
    utmContent = `${utmContentOf(handle.handle, labelCheck.label)}-${n}`;
  }

  const shortio = makeShortioClient();
  // 주소 충돌(같은 캠페인·인플에 두 번째 링크 등)은 -2, -3 순번으로 푼다 — 랜덤 없음(koo QA 08-25).
  // DB 선확인은 우리 쪽 재사용을 싸게 거르는 것이고, 최종 판정은 short.io 409(타 링크와의 충돌 포함).
  for (let n = 0; n < 10; n++) {
    const slug = n === 0 ? slugCheck.slug : `${slugCheck.slug}-${n + 1}`;
    const dup = await sql`select 1 from tracking_link where code = ${slug}`;
    if (dup.length) continue;
    const longUrl = buildTrackedUrl({ landingUrl: landing.url, campaign, content: utmContent });
    const created = await shortio.createLink({
      originalUrl: longUrl, path: slug,
      title: `${handle.handle} · ${campaign}`, // short.io 대시보드에서 사람이 알아보는 이름
    });
    if (created.kind === 'conflict') continue;
    if (created.kind === 'error') return NextResponse.json({ error: CREATE_FAILED }, { status: 502 });
    const row = await insertLink(sql, {
      code: slug, landingUrl: landing.url, longUrl, shortUrl: created.shortUrl,
      shortioLinkId: created.linkId, utmCampaign: campaign, influencerHandle: handle.handle, utmContent,
      draftId, clientId, clientName, createdBy: gate.member.id,
    });
    return NextResponse.json({ row });
  }
  // 10개가 전부 차 있다 — 사람이 주소를 바꾸는 게 맞는 상황(같은 이름을 무한정 늘리지 않는다)
  return NextResponse.json({ error: '이미 같은 주소가 여러 번 쓰였어요 — 링크 주소를 바꿔 다시 시도해 주세요' }, { status: 400 });
}
