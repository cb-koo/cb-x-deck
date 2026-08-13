import type postgres from 'postgres';
import type { DraftRow } from './draftStore.ts';
import { ensureInfluencer, findByHandle, insertAutoLog } from './influencerStore.ts';

// 원고 제목 스냅샷 — ko_title 우선, 없으면 최신 본문 첫 줄 60자 (스펙 §2)
export function draftLogTitle(d: Pick<DraftRow, 'koTitle' | 'edited' | 'content'>): string {
  if (d.koTitle) return d.koTitle;
  const line = ((d.edited ?? d.content).posts[0]?.text ?? '').split('\n')[0].trim();
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

const norm = (h: string | null | undefined) => (h ? h.toLowerCase() : null);

// updateDraft와 같은 트랜잭션에서 호출 — 로그만 누락되는 어긋남을 만들지 않는다 (스펙 §5).
// 등록은 배정에서만 일어난다: 명부에 없는 핸들의 해제·전달은 행을 만들면서까지 기록하지 않는다.
export async function syncInfluencerOnDraftUpdate(tx: postgres.Sql, args: {
  before: DraftRow;                              // PATCH 이전 상태 — 라우트가 미리 읽어 전달
  influencerHandle: string | null | undefined;   // undefined = 이번 PATCH가 배정을 건드리지 않음
  status: string | undefined;
  actorId: string | null;
}): Promise<void> {
  const { before, influencerHandle, status, actorId } = args;
  const title = draftLogTitle(before);
  const changed = influencerHandle !== undefined && norm(influencerHandle) !== norm(before.influencerHandle);
  if (changed) {
    if (before.influencerHandle) {
      const prev = await findByHandle(tx, before.influencerHandle);
      if (prev) await insertAutoLog(tx, { influencerId: prev.id, eventType: 'draft_unassigned', draftId: before.id, draftTitle: title, authorId: actorId });
    }
    if (influencerHandle) {
      const id = await ensureInfluencer(tx, influencerHandle, actorId);
      await insertAutoLog(tx, { influencerId: id, eventType: 'draft_assigned', draftId: before.id, draftTitle: title, authorId: actorId });
    }
  }
  // 배정과 전달이 한 PATCH에 오면 배정 블록이 먼저 실행돼 delivered가 새 행을 찾는다 — 순서 불변 유지
  const effective = influencerHandle !== undefined ? influencerHandle : before.influencerHandle;
  if (status === 'delivered' && before.status !== 'delivered' && effective) {
    const row = await findByHandle(tx, effective);
    if (row) await insertAutoLog(tx, { influencerId: row.id, eventType: 'draft_delivered', draftId: before.id, draftTitle: title, authorId: actorId });
  }
}
