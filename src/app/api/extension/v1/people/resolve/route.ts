import { getSql } from '@/lib/db';
import { extHandle, extOk, extPreflight } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { parseObservedPerson, readJson } from '@/lib/extensionInput';
import { resolvePerson } from '@/lib/extensionReadStore';

export const OPTIONS = extPreflight;

// DB 조회만 — 등록·유료 프로필 호출을 하지 않는다(계획 §6).
export async function POST(req: Request) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const { handle, observedXUserId } = parseObservedPerson(await readJson(req));
    return extOk(req, requestId, await resolvePerson(getSql(), handle, observedXUserId));
  });
}
