import type postgres from 'postgres';
import { loadTaskFacts } from './extensionReadStore.ts';
import { classifyTask, toTaskDto } from './extensionTasks.ts';
import { readClientSheetInputs, splitReservationName } from './reservationSheet.ts';
import { seoulIso } from './extensionTasks.ts';
import { kstToday } from './datetime.ts';
import { productMissing } from './productCommand.ts';
import type { DeadlineMode } from './reservationPolicy.ts';

export interface ReservationRecord {
  id: string; taskId: string; locationId: string; sourceText: string; sheetText: string;
  confirmed: boolean; confirmedAt: string | null; deadlineMode: DeadlineMode; version: number; templateRevisionId: string | null;
}
type ReservationRow = { id: string; task_id: string; location_id: string; source_text: string; sheet_text: string;
  confirmed_at: Date | null; deadline_mode: DeadlineMode; version: number; template_revision_id: string | null };
export const reservationRecord = (r: ReservationRow): ReservationRecord => ({
  id: r.id, taskId: r.task_id, locationId: r.location_id, sourceText: r.source_text, sheetText: r.sheet_text,
  confirmed: !!r.confirmed_at, confirmedAt: r.confirmed_at ? new Date(r.confirmed_at).toISOString() : null,
  deadlineMode: r.deadline_mode, version: r.version, templateRevisionId: r.template_revision_id,
});
export async function readReservation(sql: postgres.Sql, id: string, lock = false) {
  const rows = await sql<ReservationRow[]>`select * from visit_reservation where id = ${id} ${lock ? sql`for update` : sql``}`;
  return rows[0] ? reservationRecord(rows[0]) : null;
}
export async function taskFact(sql: postgres.Sql, id: string) {
  const [owner] = await sql<Array<{ influencer_handle: string | null; person_id: string | null }>>`
    select t.influencer_handle, i.id as person_id from campaign_task t
    left join influencer i on lower(i.handle) = lower(t.influencer_handle) where t.id = ${id}`;
  if (!owner?.influencer_handle) throw productMissing();
  const fact = (await loadTaskFacts(sql, [owner.influencer_handle])).find((t) => t.id === id);
  if (!fact) throw productMissing();
  return { fact, personId: owner.person_id };
}
export async function reservationDetail(sql: postgres.Sql, id: string, origin: string) {
  const reservation = await readReservation(sql, id);
  if (!reservation) throw productMissing();
  const { fact, personId } = await taskFact(sql, reservation.taskId);
  const today = kstToday();
  const task = toTaskDto(fact, classifyTask(fact, today), personId ?? '', today, origin);
  const [file] = await sql<Array<{ agreement: unknown }>>`select agreement from campaign_task where id = ${reservation.taskId}`;
  const sheetFields = readClientSheetInputs(reservation.sheetText), names = splitReservationName(sheetFields.name);
  return { ...reservation, sheetFields, fields: { ...sheetFields, visitAt: seoulIso(sheetFields.preferred),
    name: names.korean || null, romanizedName: names.roman || null, preferred2: seoulIso(sheetFields.preferred2) }, phase: task.visitPhase,
    uploadDeadline: task.uploadDeadline, customerRequestCount: fact.requestCount,
    requestCount: fact.requestCount, allowedActions: task.allowedActions, task, consent: file?.agreement ?? null };
}
export async function reservationChanges(sql: postgres.Sql, id: string, offset = 0, limit = 3, customerRequestsOnly = false) {
  const [{ total }] = await sql<Array<{ total: number }>>`select count(*)::int as total from reservation_change
    where reservation_id = ${id} and (${!customerRequestsOnly} or reason = 'customer_request')`;
  const items = await sql`select id, event, reason, request_no as "requestNo", differences,
    sheet_before as "sheetBefore", sheet_after as "sheetAfter", actor_name as "actorName", created_at as "createdAt"
    from reservation_change where reservation_id = ${id} and (${!customerRequestsOnly} or reason = 'customer_request')
    order by created_at desc, id desc limit ${limit} offset ${offset}`;
  return { items, total, nextCursor: offset + limit < total ? String(offset + limit) : null };
}
