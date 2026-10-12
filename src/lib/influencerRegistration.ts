import type postgres from 'postgres';
import { parseXHandle, handleParseMessage } from './xHandle.ts';
import { makeClient } from './getxapi.ts';
import { applyProfileSnapshot, createInfluencer, findByHandle, findInfluencerById, renameInfluencer } from './influencerStore.ts';
import { ProductError, productMissing } from './productCommand.ts';

// 웹·확장이 같은 등록·개명 처리를 쓴다. 외부 프로필 조회는 등록 버튼을 누를 때만 한다.
export async function registerInfluencer(sql: postgres.Sql, rawHandle: unknown, actorId: string, observedId?: unknown) {
  const parsed = parseXHandle(typeof rawHandle === 'string' ? rawHandle.trim() : '');
  if (!parsed.ok) throw new ProductError('INVALID_INPUT', handleParseMessage(parsed.reason));
  if (observedId !== undefined && (typeof observedId !== 'string' || !/^\d{1,30}$/.test(observedId)))
    throw new ProductError('INVALID_INPUT', '대화 상대 정보를 다시 불러와 주세요.');
  await sql`select pg_advisory_xact_lock(hashtextextended(${`influencer-handle:${parsed.handle.toLowerCase()}`}, 0))`;
  const checkIdentity = (id: string | null) => {
    if (observedId && id && observedId !== id) throw new ProductError('IDENTITY_MISMATCH', '같은 핸들로 등록된 계정과 현재 대화 상대가 달라요. 계정을 확인해 주세요.', 409);
  };
  const existing = await findByHandle(sql, parsed.handle);
  if (existing) { checkIdentity(existing.xUserId); return { created: false, influencer: existing }; }
  const info = await makeClient().getUserInfo(parsed.handle).catch(() => {
    throw new ProductError('PROFILE_LOOKUP_FAILED', '프로필을 불러오지 못했어요. 잠시 후 다시 등록해 주세요.', 502);
  });
  if (!info.id) throw new ProductError('RESOURCE_NOT_FOUND', 'X에서 이 핸들을 찾을 수 없어요.', 404);
  checkIdentity(info.id);
  await sql`select pg_advisory_xact_lock(hashtextextended(${`influencer-x-id:${info.id}`}, 0))`;
  const [twin] = await sql<Array<{ id: string }>>`select id from influencer where x_user_id = ${info.id} limit 1`;
  if (twin) {
    const [current] = await sql<Array<{ handle: string }>>`select handle from influencer where id = ${twin.id} for update`;
    if (!current) throw productMissing();
    const renamed = current.handle.toLowerCase() !== parsed.handle.toLowerCase();
    if (renamed) await renameInfluencer(sql, { influencerId: twin.id, from: current.handle, to: parsed.handle, actorId });
    await applyProfileSnapshot(sql, twin.id, info);
    return { created: false, renamed, influencer: (await findInfluencerById(sql, twin.id))! };
  }
  const { row, created } = await createInfluencer(sql, { handle: parsed.handle, createdBy: actorId, snapshot: info });
  checkIdentity(row.xUserId);
  return { created, influencer: row };
}
