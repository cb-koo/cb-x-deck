import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser, requireMember } from '@/lib/authGuard';
import { isUuidLike } from '@/lib/uuid';
import { parseXHandle } from '@/lib/xHandle';
import { generateLinkCode, checkLandingUrl, landingUrlMessage, buildTrackedUrl } from '@/lib/trackingLink';
import { isShortioConfigured, makeShortioClient } from '@/lib/shortio';
import { insertLink, listLinks } from '@/lib/linkStore';

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
    landingUrl?: unknown; influencerHandle?: unknown; utmCampaign?: unknown;
    draftId?: unknown; clientId?: unknown;
  };

  // 서버 재검증 — 클라이언트 인라인 검증만 믿지 않는다(같은 함수, parseTweetLink 관례)
  const landing = checkLandingUrl(String(body.landingUrl ?? ''));
  if (!landing.ok) return NextResponse.json({ error: landingUrlMessage(landing.reason) }, { status: 400 });
  const handle = parseXHandle(String(body.influencerHandle ?? ''));
  if (!handle.ok) return NextResponse.json({ error: '인플루언서 핸들을 확인해 주세요 — @핸들 또는 프로필 링크' }, { status: 400 });
  const campaign = String(body.utmCampaign ?? '').trim();
  if (!campaign) return NextResponse.json({ error: '캠페인명을 입력해 주세요' }, { status: 400 });

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

  const shortio = makeShortioClient();
  // 코드 충돌(short.io 409)이면 다시 뽑는다 — 21억 조합이라 3회면 충분(스펙 §데이터 모델)
  for (let i = 0; i < 3; i++) {
    const code = generateLinkCode();
    const longUrl = buildTrackedUrl({ landingUrl: landing.url, campaign, handle: handle.handle, code });
    const created = await shortio.createLink({
      originalUrl: longUrl, path: code,
      title: `${handle.handle} · ${campaign}`, // short.io 대시보드에서 사람이 알아보는 이름
    });
    if (created.kind === 'conflict') continue;
    if (created.kind === 'error') return NextResponse.json({ error: CREATE_FAILED }, { status: 502 });
    const row = await insertLink(sql, {
      code, landingUrl: landing.url, longUrl, shortUrl: created.shortUrl,
      shortioLinkId: created.linkId, utmCampaign: campaign, influencerHandle: handle.handle,
      draftId, clientId, clientName, createdBy: gate.member.id,
    });
    return NextResponse.json({ row });
  }
  return NextResponse.json({ error: CREATE_FAILED }, { status: 502 });
}
