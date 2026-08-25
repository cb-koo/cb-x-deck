// refresh·analyze가 같은 3분기 규칙을 쓴다(스펙 §3) — 같은 사실을 두 문구로 말하지 않기.
import type postgres from 'postgres';
import type { GetxapiClient, UserInfo } from './getxapi.ts';
import { findDuplicateByXUserId, type InfluencerRow } from './influencerStore.ts';

export type AccountResolution =
  | { status: 'ok'; info: UserInfo; duplicateOf: string | null }
  | { status: 'not_found' }
  | { status: 'handle_taken' };

export async function resolveAccount(
  sql: postgres.Sql, inf: InfluencerRow, client: Pick<GetxapiClient, 'getUserInfo'>,
): Promise<AccountResolution> {
  const info = await client.getUserInfo(inf.handle);   // 실패(throw)는 호출자가 502로
  // v1은 x_user_id로 새 핸들을 되찾지 않는다(스펙 §5-3 후자). 등록 화면에서 새 핸들을 추가하면
  // 개명 플로우가 같은 x_user_id를 보고 알아서 잡는다.
  if (!info.id) return { status: 'not_found' };
  // 핸들은 그대로인데 계정이 바뀌었다 = 남이 그 핸들을 가져간 것. 스냅샷으로 덮어쓰지 않는다.
  if (inf.xUserId && info.id !== inf.xUserId) return { status: 'handle_taken' };
  // §7: 같은 사람이 두 행으로 들어와 있으면 경고만 띄운다(자동 병합하지 않는다).
  const duplicateOf = await findDuplicateByXUserId(sql, info.id, inf.id);
  return { status: 'ok', info, duplicateOf };
}
