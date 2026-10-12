import { createClient as createStorageClient } from '@supabase/supabase-js';
import { createClient as createWebClient } from './supabase/server.ts';
import { bearerToken } from './extensionClaims.ts';
import { readReservation, reservationDetail } from './reservationStore.ts';
import { lockReservationTask } from './reservationCommands.ts';
import { expectVersion, jsonValue, objectBody, ProductError, productMissing, textValue } from './productCommand.ts';
import type postgres from 'postgres';
import type { Member } from './types.ts';

const BUCKET = 'task-agreement';
const MIME: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
async function storage(req: Request) {
  const token = bearerToken(req.headers.get('authorization'));
  return token ? createStorageClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }) : createWebClient();
}
async function editable(tx: postgres.Sql, id: string, expected: number) {
  const reference = await readReservation(tx, id);
  if (!reference) throw productMissing();
  await lockReservationTask(tx, reference.taskId);
  const reservation = await readReservation(tx, id, true);
  if (!reservation) throw productMissing();
  expectVersion(reservation.version, expected);
  const detail = await reservationDetail(tx, id, '');
  if (!detail.allowedActions.includes('manage_consent')) throw new ProductError('STATE_CHANGED', '확정 후 진행 중인 예약에서 동의서를 변경할 수 있어요.', 409);
  return reservation;
}
export async function createAgreementUpload(tx: postgres.Sql, req: Request, id: string, raw: unknown, expected: number, actor: Member) {
  const reservation = await editable(tx, id, expected), b = objectBody(raw);
  const name = textValue(b.name ?? b.fileName, '파일 이름', 200), mime = textValue(b.mime ?? b.mimeType, '파일 형식', 100);
  const size = b.size;
  if (!MIME[mime]) throw new ProductError('UNSUPPORTED_FILE', 'PDF·JPG·PNG 파일을 선택해 주세요.', 422);
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > 10485760) throw new ProductError('FILE_TOO_LARGE', '빈 파일은 사용할 수 없고, 최대 10MB까지 첨부할 수 있어요.', 422);
  const path = `task/${reservation.taskId}/${crypto.randomUUID()}.${MIME[mime]}`;
  const provider = await storage(req), { data, error } = await provider.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new ProductError('PROVIDER_UNAVAILABLE', '파일을 올릴 준비를 하지 못했어요. 기존 동의서는 유지했어요.', 503);
  const [upload] = await tx<Array<{ id: string }>>`insert into reservation_agreement_upload (reservation_id, path, name, mime, size, actor_id)
    values (${id}, ${path}, ${name}, ${mime}, ${size}, ${actor.id}) returning id`;
  return { uploadId: upload.id, path, signedUrl: data.signedUrl, token: data.token, mime, size };
}
export async function finalizeAgreement(tx: postgres.Sql, req: Request, id: string, uploadId: string, expected: number, actor: Member) {
  const reservation = await editable(tx, id, expected);
  const [upload] = await tx<Array<{ id: string; path: string; name: string; mime: string; size: number; created_at: Date }>>`
    select * from reservation_agreement_upload where id = ${uploadId} and reservation_id = ${id} and actor_id = ${actor.id}
      and finalized_at is null and created_at > now() - interval '1 hour' for update`;
  if (!upload) throw productMissing();
  const provider = await storage(req), { data, error } = await provider.storage.from(BUCKET).download(upload.path);
  if (error || !data) throw new ProductError('UPLOAD_INCOMPLETE', '파일 업로드가 끝나지 않았어요. 기존 동의서는 유지했으니 다시 시도해 주세요.', 422);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const signature = upload.mime === 'application/pdf' ? new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
    : upload.mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (bytes.length !== upload.size || !signature) throw new ProductError('UNSUPPORTED_FILE', '파일 크기나 실제 형식이 선택한 파일과 달라요. 다시 첨부해 주세요.', 422);
  const agreement = { url: upload.path, name: upload.name, size: upload.size, mime: upload.mime,
    by: actor.id, byName: actor.name, at: new Date().toISOString() };
  await tx`update campaign_task set agreement = ${tx.json(jsonValue(agreement))}, updated_at = now() where id = ${reservation.taskId}`;
  await tx`update visit_reservation set version = version + 1, updated_at = now(), updated_by = ${actor.id} where id = ${id}`;
  await tx`update reservation_agreement_upload set finalized_at = now() where id = ${upload.id}`;
  return reservationDetail(tx, id, new URL(req.url).origin);
}
export async function removeAgreement(tx: postgres.Sql, req: Request, id: string, expected: number, actor: Member) {
  const reservation = await editable(tx, id, expected);
  await tx`update campaign_task set agreement = null, updated_at = now() where id = ${reservation.taskId}`;
  await tx`update visit_reservation set version = version + 1, updated_at = now(), updated_by = ${actor.id} where id = ${id}`;
  return reservationDetail(tx, id, new URL(req.url).origin);
}
export async function agreementUrl(sql: postgres.Sql, req: Request, id: string) {
  const reservation = await readReservation(sql, id);
  if (!reservation) throw productMissing();
  const [task] = await sql<Array<{ agreement: { url?: string } | null }>>`select agreement from campaign_task where id = ${reservation.taskId}`;
  if (!task?.agreement?.url) throw productMissing();
  const provider = await storage(req), { data, error } = await provider.storage.from(BUCKET).createSignedUrl(task.agreement.url, 300);
  if (error || !data) throw new ProductError('PROVIDER_UNAVAILABLE', '파일을 열지 못했어요. 잠시 후 다시 시도해 주세요.', 503);
  return { url: data.signedUrl, expiresIn: 300 };
}
