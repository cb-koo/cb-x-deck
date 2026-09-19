import type postgres from 'postgres';
import { isUuidLike } from './uuid.ts';
import { listDrafts, type DraftRow } from './draftStore.ts';

// 캠페인 v2 원고 모드의 '있는 원고 고르기'(§5-3) — 두 묶음으로 나눠 준다.
//  · 형제 시안: 이 캠페인의 작업에 붙은 원고와 같은 배치(batch_id)에서 나왔지만 아직 안 붙은 것.
//    = "시안 셋 중 하나를 골랐더니 남은 둘". 사용자가 가장 먼저 찾는 후보라 따로 세운다.
//  · 작업 없는 원고: 같은 클라이언트의 안 붙은 원고 중 형제가 아닌 것.
// 다른 클라이언트 원고는 후보가 아니다(§5-3). 클라이언트가 없는 캠페인은 둘 다 빈 목록.
export async function listDraftCandidates(
  sql: postgres.Sql, campaignId: string,
): Promise<{ siblings: DraftRow[]; others: DraftRow[] }> {
  if (!isUuidLike(campaignId)) return { siblings: [], others: [] };
  const camp = await sql<Array<{ client_id: string | null }>>`
    select client_id from campaign where id = ${campaignId}`;
  const clientId = camp[0]?.client_id ?? null;
  if (!clientId) return { siblings: [], others: [] };

  // 이 캠페인 작업에 붙은 원고들의 배치 — 형제를 찾는 기준
  const batches = await sql<Array<{ batch_id: string }>>`
    select distinct d.batch_id from campaign_task t
      join draft d on d.id = t.draft_id
     where t.campaign_id = ${campaignId} and d.batch_id is not null`;
  const batchIds = batches.map((b) => b.batch_id);

  // 후보 모집단은 기존 목록 함수 하나로 — 정렬(만든 순 역순, variant_index)과 필드 구성이 갈리지 않게 한다
  const unattached = await listDrafts(sql, { clientId, unattached: true, limit: 200 });
  const isSibling = (d: DraftRow) => d.batchId !== null && batchIds.includes(d.batchId);
  return { siblings: unattached.filter(isSibling), others: unattached.filter((d) => !isSibling(d)) };
}
