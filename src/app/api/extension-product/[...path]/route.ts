import { requireMember } from '@/lib/authGuard';
import { extHandle, extOk } from '@/lib/extensionApi';
import { extensionProductDispatch } from '@/lib/extensionProductApi';
import { NextResponse } from 'next/server';

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const origin = req.headers.get('origin');
  if (req.method !== 'GET' && origin && origin !== new URL(req.url).origin)
    return NextResponse.json({ error: { code: 'RESOURCE_FORBIDDEN', message: '서비스 화면에서 다시 저장해 주세요.' } }, { status: 403 });
  return extHandle(req, async (requestId) => {
    const gate = await requireMember(); if (gate.response) return gate.response;
    const result = await extensionProductDispatch(req, (await ctx.params).path, gate.member);
    const response = extOk(req, requestId, result.data, result.status);
    if (result.version !== undefined) response.headers.set('ETag', `"${result.version}"`);
    return response;
  });
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
