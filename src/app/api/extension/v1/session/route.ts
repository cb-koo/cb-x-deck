import { extHandle, extOk, extPreflight, EXTENSION_API_VERSION } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { productFeatures } from '@/lib/extensionProductApi';
import { getSql } from '@/lib/db';

// 쓰기·예약·동의서는 API 3·4 전까지 꺼 둔다 — 확장은 이 flag를 보고 해당 UI를 열지 않는다.
const SUPPORTED_CLIENT_VERSIONS = ['0.1.0'];

export const OPTIONS = extPreflight;

export async function GET(req: Request) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    return extOk(req, requestId, {
      user: { id: gate.user.id, email: gate.user.email },
      member: { id: gate.member.id, name: gate.member.name },
      apiVersion: EXTENSION_API_VERSION,
      supportedClientVersions: SUPPORTED_CLIENT_VERSIONS,
      featureFlags: await productFeatures(getSql()),
      serverNow: new Date().toISOString(),
    });
  });
}
