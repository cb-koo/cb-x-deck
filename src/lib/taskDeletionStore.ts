import type postgres from 'postgres';

// 작업 삭제 기록(073) + 예약이 연결된 방문 작업의 "함께 지우기"(koo 10-13).
// 예약 기록은 restrict FK라 작업만 지울 수 없다 — 사용자가 확인하면 예약·변경 내역·종료·동의서 업로드 행을
// 먼저 지우고, 지운 내용은 전부 삭제 기록의 snapshot에 남긴다. 이 모듈은 campaignTaskStore를 import하지 않는다(순환 없음).

export interface ReservationRecords {
  reservations: Array<{ id: string; row: unknown }>;
  changes: unknown[];
  ends: unknown[];
  uploads: unknown[];
}

// 화면의 확인 창이 보여줄 요약 — 무엇이 함께 지워지는지
export interface ReservationDeleteSummary {
  confirmed: boolean;        // 확정된 예약인가(대기면 false)
  visitOn: string | null;    // 작업에 적힌 방문일(대기 중엔 비어 있을 수 있다)
  visitTime: string | null;  // 'HH:MM'
  changes: number;           // 일정 변경 내역 건수
  ended: boolean;            // 종료(취소·노쇼) 기록이 있는가
  uploads: number;           // 예약에 올린 동의서 파일 수
}

export interface TaskDeletionRow {
  id: string;
  taskId: string;
  influencerHandle: string | null;
  taskType: string | null;
  withReservation: boolean;
  deletedByName: string;
  deletedAt: string;
}

// 예약 기록 묶음 — 예약 테이블이 아직 없는 DB(064 이전)면 null
export async function reservationRecordsOf(sql: postgres.Sql, taskId: string): Promise<ReservationRecords | null> {
  const [schema] = await sql<Array<{ ready: boolean; uploads: boolean }>>`select
    to_regclass('visit_reservation') is not null as ready, to_regclass('reservation_agreement_upload') is not null as uploads`;
  if (!schema.ready) return null;
  const reservations = await sql<Array<{ id: string; row: unknown }>>`
    select id, to_jsonb(r) as row from visit_reservation r where task_id = ${taskId}`;
  const ids = reservations.map((r) => r.id);
  const changes = ids.length
    ? (await sql<Array<{ row: unknown }>>`select to_jsonb(c) as row from reservation_change c where reservation_id in ${sql(ids)} order by created_at`).map((r) => r.row)
    : [];
  const ends = (await sql<Array<{ row: unknown }>>`select to_jsonb(e) as row from reservation_end e
    where task_id = ${taskId} ${ids.length ? sql`or reservation_id in ${sql(ids)}` : sql``}`).map((r) => r.row);
  const uploads = ids.length && schema.uploads
    ? (await sql<Array<{ row: unknown }>>`select to_jsonb(u) as row from reservation_agreement_upload u where reservation_id in ${sql(ids)}`).map((r) => r.row)
    : [];
  return { reservations, changes, ends, uploads };
}

export const hasReservationRecords = (r: ReservationRecords | null): r is ReservationRecords =>
  !!r && (r.reservations.length > 0 || r.ends.length > 0);

export async function reservationDeleteSummary(sql: postgres.Sql, taskId: string): Promise<ReservationDeleteSummary | null> {
  const records = await reservationRecordsOf(sql, taskId);
  if (!hasReservationRecords(records)) return null;
  const [task] = await sql<Array<{ visit_on: string | null; visit_time: string | null }>>`
    select to_char(visit_on, 'YYYY-MM-DD') as visit_on, to_char(visit_time, 'HH24:MI') as visit_time from campaign_task where id = ${taskId}`;
  return {
    confirmed: records.reservations.some((r) => (r.row as { confirmed_at?: string | null }).confirmed_at),
    visitOn: task?.visit_on ?? null,
    visitTime: task?.visit_time ?? null,
    changes: records.changes.length,
    ended: records.ends.length > 0,
    uploads: records.uploads.length,
  };
}

// 예약 기록을 FK 순서대로 지운다(업로드·변경 내역·종료 → 예약). 호출자가 트랜잭션과 작업 행 잠금을 쥔다.
export async function deleteReservationRecords(tx: postgres.Sql, taskId: string, records: ReservationRecords): Promise<void> {
  const ids = records.reservations.map((r) => r.id);
  if (ids.length) {
    if (records.uploads.length) await tx`delete from reservation_agreement_upload where reservation_id in ${tx(ids)}`;
    await tx`delete from reservation_change where reservation_id in ${tx(ids)}`;
    await tx`delete from reservation_end where reservation_id in ${tx(ids)}`;
  }
  await tx`delete from reservation_end where task_id = ${taskId}`;
  if (ids.length) await tx`delete from visit_reservation where id in ${tx(ids)}`;
}

export async function insertTaskDeletion(tx: postgres.Sql, input: {
  task: { id: string; campaign_id: string; influencer_handle: string | null; type: string | null };
  taskRow: unknown;
  records: ReservationRecords | null;
  actor: { id: string; name: string } | null;
}): Promise<void> {
  const withReservation = hasReservationRecords(input.records);
  const snapshot = {
    task: input.taskRow,
    ...(withReservation ? {
      reservations: input.records!.reservations.map((r) => r.row),
      reservationChanges: input.records!.changes,
      reservationEnds: input.records!.ends,
      reservationUploads: input.records!.uploads,
    } : {}),
  };
  await tx`insert into campaign_task_deletion
      (task_id, campaign_id, influencer_handle, task_type, with_reservation, snapshot, deleted_by, deleted_by_name)
    values (${input.task.id}, ${input.task.campaign_id}, ${input.task.influencer_handle}, ${input.task.type}, ${withReservation},
            ${tx.json(snapshot as postgres.JSONValue)}, ${input.actor?.id ?? null}, ${input.actor?.name ?? ''})`;
}

export async function listTaskDeletions(sql: postgres.Sql, campaignId: string): Promise<TaskDeletionRow[]> {
  const rows = await sql<Array<{ id: string; task_id: string; influencer_handle: string | null; task_type: string | null;
    with_reservation: boolean; deleted_by_name: string; deleted_at: Date }>>`
    select id, task_id, influencer_handle, task_type, with_reservation, deleted_by_name, deleted_at
    from campaign_task_deletion where campaign_id = ${campaignId} order by deleted_at desc limit 100`;
  return rows.map((r) => ({
    id: r.id, taskId: r.task_id, influencerHandle: r.influencer_handle, taskType: r.task_type,
    withReservation: r.with_reservation, deletedByName: r.deleted_by_name, deletedAt: r.deleted_at.toISOString(),
  }));
}
