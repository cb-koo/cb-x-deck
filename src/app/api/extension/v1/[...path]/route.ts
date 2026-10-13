import { extHandle, extOk, extPreflight } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { extensionProductDispatch } from '@/lib/extensionProductApi';

export const OPTIONS = extPreflight;
async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const result = await extensionProductDispatch(req, (await ctx.params).path, gate.member);
    const response = extOk(req, requestId, result.data, result.status);
    if (result.version !== undefined) response.headers.set('ETag', `"${result.version}"`);
    return response;
  });
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
