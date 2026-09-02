import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSql } from '@/lib/db';
import { bearerAuthorized } from '@/lib/externalAuth';
import { getForExport } from '@/lib/settlementStore';
import { TASK_PROOF_BUCKET } from '@/lib/taskProof';
import { recordExternalCallSafe } from '@/lib/externalApiLogAfter';

// 증빙 이미지를 그쪽(정산 프로덕트)에 흘려보낸다. 스펙 2026-09-01-proof-to-partner-design.md §4.
// 302 리다이렉트가 아니라 바이트를 직접 준다 — 그쪽 HTTP 클라이언트가 리다이렉트를 안 따라가면
// 우리가 볼 수 없는 실패가 된다(스펙 §4 "왜 302가 아닌가").
//
// 어느 요청의 증빙인지는 이미 getForExport(part A, settlementStore.ts)가 판정해 뒀다 — task_id가 있으면
// campaign_task.proof(현재값), 없으면 payment_request.proof(스냅샷)로 폴백. 여기서 다시 판정하지 않는다.
// 경로 파라미터는 요청 id 하나뿐이고 스토리지 경로는 그 판정 결과에서만 나온다(본문·쿼리로 경로를 받지
// 않는다) — 그쪽이 임의 경로를 요청해 남의 파일을 받아갈 수 없다.

const NO_STORE = { 'Cache-Control': 'no-store' };
const ENV = 'SETTLEMENT_API_KEY';
const MIME_BY_EXT: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function common(req: Request) {
  const url = new URL(req.url);
  return {
    method: 'GET' as const,
    path: url.pathname,
    ip: req.headers.get('x-forwarded-for'),
    userAgent: req.headers.get('user-agent'),
  };
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}

// task-proof 버킷의 RLS는 로그인한 우리 사용자(authenticated)만 select를 허용한다(마이그레이션 044) —
// 화면은 전부 브라우저에서 로그인 세션으로 서명받는다(useSignedTaskProofUrls). 그쪽 호출은 그 세션이
// 아니라 SETTLEMENT_API_KEY 베어러라 RLS를 통과하지 못하므로, 서비스 롤 키로 우회해서 내려받는다.
// 이 저장소에 서버 전용 Storage 클라이언트가 아직 없어(스크립트 쪽만 있다, scripts/setup-staging.ts와
// 같은 env·같은 패턴) 호출마다 즉석으로 만든다 — 전역 인스턴스를 두지 않는다.
// Blob을 그대로 응답 본문으로 넘긴다 — Buffer는 응답 본문 타입(BodyInit)이 아니고, 굳이 메모리로
// 복사할 이유도 없다(증빙은 최대 10MB).
async function downloadTaskProof(path: string): Promise<{ body: Blob; contentType: string } | null> {
  const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await admin.storage.from(TASK_PROOF_BUCKET).download(path);
  if (error || !data) return null;
  const contentType = MIME_BY_EXT[extOf(path)] ?? (data.type || 'application/octet-stream');
  return { body: data, contentType };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const c = common(req);
  if (!bearerAuthorized(req, ENV)) {
    recordExternalCallSafe({ ...c, statusCode: 401, outcome: 'unauthorized' });
    return new NextResponse(null, { status: 401, headers: NO_STORE });
  }
  const { id } = await ctx.params;
  const row = await getForExport(getSql(), id);
  if (!row) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found' });
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  if (!row.proof) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', detail: 'no-proof' });
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  const img = await downloadTaskProof(row.proof.url);
  if (!img) {
    recordExternalCallSafe({ ...c, requestId: id, statusCode: 404, outcome: 'not-found', detail: 'storage-miss' });
    return new NextResponse(null, { status: 404, headers: NO_STORE });
  }
  recordExternalCallSafe({ ...c, requestId: id, statusCode: 200, outcome: 'ok' });
  return new NextResponse(img.body, { status: 200, headers: { ...NO_STORE, 'Content-Type': img.contentType } });
}
