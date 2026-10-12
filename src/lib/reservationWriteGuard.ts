import type postgres from 'postgres';
import { ProductError } from './productCommand.ts';

export async function reservationWriteGuard(sql: postgres.Sql, taskId: string, operation: 'patch' | 'cancel' | 'restore' | 'replace' | 'delete', patch: Record<string, unknown> = {}) {
  const [schema] = await sql<Array<{ ready: boolean }>>`select to_regclass('visit_reservation') is not null as ready`;
  if (!schema.ready) return;
  const [state] = await sql<Array<{ reserved: boolean; ended: boolean }>>`select
    exists(select 1 from visit_reservation where task_id = ${taskId}) as reserved,
    exists(select 1 from reservation_end where task_id = ${taskId} and revoked_at is null) as ended`;
  if (!state.reserved && !state.ended) return;
  if (operation === 'patch' && !state.ended && !['visitOn', 'scheduledOn', 'visitTime', 'scheduledTime', 'influencerHandle'].some((key) => key in patch)) return;
  throw new ProductError('RESERVATION_COMMAND_REQUIRED', operation === 'delete'
    ? '예약 기록이 남아 있는 작업은 삭제할 수 없어요. 예약 상세에서 종료해 주세요.'
    : state.ended ? '종료된 예약의 기록은 읽기 전용이에요. 예약 상세에서 확인해 주세요.'
    : '예약이 연결된 작업이에요. 예약 상세에서 일정 변경이나 종료를 처리해 주세요.', 409);
}
