import type postgres from 'postgres';
import { getSql } from './db.ts';
import { isUuidLike } from './uuid.ts';
import type { Member } from './types.ts';
import { objectBody, ProductError, productMissing, productOperation, textValue, versionHeader, expectVersion, jsonValue } from './productCommand.ts';
import { extractReservation } from './reservationExtraction.ts';
import { confirmVisitPost, createReservation, saveReservation, visitTaskCommand } from './reservationCommands.ts';
import { readReservation, reservationDetail, reservationChanges, taskFact } from './reservationStore.ts';
import { listClinics, getClinic, clinicCalendar, saveClinicSettings, saveClinicTemplate } from './clinicStore.ts';
import { findInfluencerById, getInfluencerDetail, updateInfluencer, updatePricing } from './influencerStore.ts';
import { parsePricingPatch } from './influencerPricing.ts';
import { classifyTask, toTaskDto } from './extensionTasks.ts';
import { kstToday } from './datetime.ts';
import { agreementUrl, createAgreementUpload, finalizeAgreement, removeAgreement } from './reservationAgreement.ts';
import { registerInfluencer } from './influencerRegistration.ts';
import { toPersonSummary } from './extensionReadStore.ts';
import { deleteTask, hasActiveRequest } from './campaignTaskStore.ts';

export async function productFeatures(sql: postgres.Sql) {
  const [row] = await sql<Array<{ ready: boolean }>>`select to_regclass('visit_reservation') is not null and to_regclass('clinic_settings') is not null
    and to_regclass('reservation_agreement_upload') is not null as ready`;
  // 기본 켜짐(2026-10-12 결정) — 환경변수 없이 배포 즉시 쓴다. EXTENSION_PRODUCT_ENABLED=false 를 넣었을 때만 끈다(비상 스위치).
  // 테이블이 없는 DB(064·070 적용 전)에서는 ready=false 라 여전히 숨긴다.
  const enabled = process.env.EXTENSION_PRODUCT_ENABLED !== 'false';
  return { writes: !!row?.ready && enabled, reservations: !!row?.ready && enabled, consents: !!row?.ready && enabled };
}
type Reply = { data: unknown; status?: number; version?: number };
const uuid = (v: string) => { if (!isUuidLike(v)) throw productMissing(); return v; };
const reply = (data: unknown, status = 200): Reply => {
  const resource = data as { version?: number; revision?: number } | null;
  return { data, status, version: resource?.version ?? resource?.revision };
};
const pageParams = (url: URL) => {
  const cursor = url.searchParams.get('cursor') ?? '0', limit = url.searchParams.get('limit') ?? '3';
  if (!/^\d{1,6}$/.test(cursor) || !/^\d{1,2}$/.test(limit) || +limit < 1 || +limit > 50) throw new ProductError('INVALID_INPUT', '조회 범위를 확인해 주세요.');
  return { offset: +cursor, limit: +limit };
};

// 웹 쿠키와 확장 Bearer의 경계만 다르고 업무 처리는 이 한 곳을 통과한다.
export async function extensionProductDispatch(req: Request, path: string[], actor: Member): Promise<Reply> {
  const sql = getSql(), url = new URL(req.url), method = req.method, origin = url.origin;
  const [root, id, action, sub] = path;
  // 웹 작업 상세가 예약 영역을 열지 정한다 — 설정 적용 전·운영 비활성이면 기존 일정 칸만 보여 준다(오류를 띄우지 않는다).
  if (root === 'features' && !id && method === 'GET') return reply(await productFeatures(sql));
  if (method !== 'GET' && !(await productFeatures(sql)).writes)
    throw new ProductError('SERVER_NOT_READY', '예약 기능의 서버 준비가 아직 끝나지 않았어요. 관리자에게 설정 적용을 요청해 주세요.', 503);
  const body = method === 'GET' || method === 'DELETE' ? {} : await req.json().catch(() => { throw new ProductError('INVALID_INPUT', '저장할 내용을 확인해 주세요.'); });
  if (root === 'reservation-extractions') {
    if (!id && method === 'POST') return reply(await productOperation(sql, actor, req, body, async (tx) => {
      const result = await extractReservation(tx, body);
      const [job] = await tx<Array<{ id: string }>>`insert into reservation_extraction_job (actor_id, result)
        values (${actor.id}, ${tx.json(jsonValue(result))}) returning id`;
      return { id: job.id, status: 'succeeded', result };
    }), 202);
    if (id && method === 'GET') {
      uuid(id); const [job] = await sql<Array<{ id: string; result: unknown }>>`select id, result from reservation_extraction_job
        where id = ${id} and actor_id = ${actor.id} and expires_at > now()`;
      if (!job) throw productMissing(); return reply({ ...job, status: 'succeeded' });
    }
  }
  if (root === 'reservations') {
    if (!id && method === 'POST') return reply(await createReservation(sql, req, actor, body), 201);
    if (id) {
      uuid(id);
      if (!action && method === 'GET') return reply(await reservationDetail(sql, id, origin));
      if (action === 'changes' && method === 'GET') {
        if (!await readReservation(sql, id)) throw productMissing();
        const reason = url.searchParams.get('reason');
        if (reason !== null && reason !== 'customer_request') throw new ProductError('INVALID_INPUT', '조회할 변경 사유를 확인해 주세요.');
        const { offset, limit } = pageParams(url); return reply(await reservationChanges(sql, id, offset, limit, reason === 'customer_request'));
      }
      if (!action && method === 'PATCH') return reply(await saveReservation(sql, req, actor, id, body));
      if (action === 'confirm' && method === 'POST') return reply(await saveReservation(sql, req, actor, id, body, true));
      if (action === 'stop-for-change-limit' && method === 'POST') {
        const reservation = await readReservation(sql, id); if (!reservation) throw productMissing();
        return reply(await visitTaskCommand(sql, req, actor, reservation.taskId, body, action, id));
      }
      if (action === 'consent-url' && method === 'GET') return reply(await agreementUrl(sql, req, id));
      if (action === 'consents' && method === 'POST' && sub === 'uploads') return reply(await productOperation(sql, actor, req, body,
        (tx) => createAgreementUpload(tx, req, id, body, versionHeader(req), actor)), 201);
      if (action === 'consents' && method === 'POST' && sub === 'finalize') {
        const uploadId = uuid(textValue(objectBody(body).uploadId, '파일 요청 번호', 36));
        return reply(await productOperation(sql, actor, req, body, (tx) => finalizeAgreement(tx, req, id, uploadId, versionHeader(req), actor)));
      }
      if (action === 'consent' && method === 'DELETE') return reply(await productOperation(sql, actor, req, body,
        (tx) => removeAgreement(tx, req, id, versionHeader(req), actor)));
    }
  }
  if (root === 'tasks' && id) {
    uuid(id);
    if (method === 'GET' && !action) {
      const { fact, personId } = await taskFact(sql, id), today = kstToday();
      const [reservation] = await sql<Array<{ id: string }>>`select id from visit_reservation where task_id = ${id}`;
      return reply({ ...toTaskDto(fact, classifyTask(fact, today), personId ?? '', today, origin), reservationId: reservation?.id ?? null });
    }
    if (method === 'GET' && action === 'reservation') {
      const [reservation] = await sql<Array<{ id: string }>>`select id from visit_reservation where task_id = ${id}`;
      return reply(reservation ? await reservationDetail(sql, reservation.id, origin) : null);
    }
    if (method === 'POST' && (action === 'end' || action === 'complete-visit'))
      return reply(await visitTaskCommand(sql, req, actor, id, body, action));
    if (method === 'POST' && action === 'confirm-post') return reply(await confirmVisitPost(sql, req, actor, id, body));
    // 작업 삭제 — 웹 삭제와 같은 규칙. 정산 요청 중이거나 예약 기록(예약·종료)이 남은 작업은 지우지 않는다(reservationWriteGuard).
    if (method === 'DELETE' && !action) {
      const expected = versionHeader(req);
      return reply(await productOperation(sql, actor, req, body, async (tx) => {
        const [task] = await tx<Array<{ version: number }>>`select version from campaign_task where id = ${id} for update`;
        if (!task) throw productMissing();
        expectVersion(task.version, expected);
        if (await hasActiveRequest(tx, id)) throw new ProductError('SETTLEMENT_REQUESTED', '정산 요청된 작업이에요. 먼저 웹의 정산에서 요청을 취소해 주세요.', 409);
        return { deleted: await deleteTask(tx, id) };
      }));
    }
  }
  if (root === 'people' && id === 'register' && !action && method === 'POST') {
    return reply(await productOperation(sql, actor, req, body, async (tx) => {
      const input = objectBody(body), result = await registerInfluencer(tx, input.handle, actor.id, input.observedXUserId);
      return { created: result.created, renamed: result.renamed ?? false, person: toPersonSummary(result.influencer) };
    }));
  }
  if (root === 'people' && id) {
    uuid(id);
    if (method === 'GET' && !action) return reply(await getInfluencerDetail(sql, id) ?? (() => { throw productMissing(); })());
    if ((method === 'PATCH' || method === 'GET') && (action === 'note' || action === 'pricing')) {
      const detail = await getInfluencerDetail(sql, id); if (!detail) throw productMissing();
      if (method === 'GET') return reply(action === 'note' ? { note: detail.influencer.note, version: detail.influencer.noteVersion }
        : { pricing: detail.pricing, version: detail.influencer.pricingVersion, logs: detail.logs.filter((l) => l.eventType === 'pricing_changed') });
      return reply(await productOperation(sql, actor, req, body, async (tx) => {
        if (!await findInfluencerById(tx, id)) throw productMissing();
        if (action === 'note') {
          await updateInfluencer(tx, id, { note: textValue(objectBody(body).note, '메모', 10000) }, versionHeader(req));
          const row = await findInfluencerById(tx, id); return { note: row!.note, version: row!.noteVersion };
        }
        const patch = parsePricingPatch(objectBody(body).pricing ?? body);
        if (!patch) throw new ProductError('INVALID_INPUT', '단가와 통화를 확인해 주세요.');
        const result = await updatePricing(tx, id, patch, actor.id, versionHeader(req), true);
        return { ...result, version: (await findInfluencerById(tx, id))!.pricingVersion };
      }));
    }
  }
  if (root === 'campaigns' && method === 'GET') {
    if (!id) {
      const clinics = await listClinics(sql);
      const campaigns = await sql<Array<{ id: string; name: string; clientId: string | null; startsOn: string; endsOn: string; kind: string | null }>>`
        select id, name, client_id as "clientId", to_char(starts_on, 'YYYY-MM-DD') as "startsOn", to_char(ends_on, 'YYYY-MM-DD') as "endsOn", kind
        from campaign where (${url.searchParams.get('includeEnded') === 'true'} or ends_on >= ${kstToday()}::date)
          and (${url.searchParams.get('kind')}::text is null or kind = ${url.searchParams.get('kind')}) order by starts_on desc, id`;
      return reply({ items: campaigns.map((c) => ({ ...c, locationId: clinics.find((l) => l.clientId === c.clientId)?.id ?? null })), total: campaigns.length });
    }
    if (action === 'visit-task-candidates') {
      uuid(id); const person = await findInfluencerById(sql, uuid(url.searchParams.get('personId') ?? '')); if (!person) throw productMissing();
      const rows = await sql<Array<{ id: string; version: number; reservationId: string | null }>>`
        select t.id, t.version, r.id as "reservationId" from campaign_task t left join visit_reservation r on r.task_id = t.id
        where t.campaign_id = ${id} and lower(t.influencer_handle) = lower(${person.handle}) and t.type = 'visit' and t.cancelled_at is null and t.posted_at is null order by t.created_at, t.id`;
      return reply({ items: rows, total: rows.length });
    }
  }
  if (root === 'clinics') {
    if (!id && method === 'GET') { const items = await listClinics(sql); return reply({ items, total: items.length }); }
    if (id) {
      uuid(id);
      if (!action && method === 'GET') return reply(await getClinic(sql, id));
      if (action === 'guidance' && method === 'GET') {
        const language = url.searchParams.get('language') ?? 'JA';
        if (!['KO', 'JA', 'EN'].includes(language)) throw new ProductError('INVALID_INPUT', '안내 언어를 선택해 주세요.');
        const clinic = await getClinic(sql, id);
        return reply({ id, clientId: clinic.clientId, name: clinic.name, naver: clinic.settings.naver, google: clinic.settings.google,
          instruction: clinic.settings.instructions[language as 'KO' | 'JA' | 'EN'], language, form: clinic.templates.form, sheetTemplate: clinic.templates.sheet });
      }
      if (action === 'calendar' && method === 'GET') return reply(await clinicCalendar(sql, id, url.searchParams.get('month') ?? kstToday().slice(0, 7)));
      if (action === 'settings' && method === 'PATCH') return reply(await productOperation(sql, actor, req, body,
        (tx) => saveClinicSettings(tx, id, objectBody(body).settings ?? body, versionHeader(req), actor)));
      if (action === 'templates' && method === 'PATCH' && (sub === 'form' || sub === 'sheet'))
        return reply(await productOperation(sql, actor, req, body, (tx) => saveClinicTemplate(tx, id, sub, body, versionHeader(req), actor)));
    }
  }
  if (root === 'quick-messages') {
    if (!id && method === 'GET') {
      const q = url.searchParams.get('q') ?? '', language = url.searchParams.get('language');
      const items = await sql`select id, title, language, body, position as "order", active, version from quick_message
        where (${url.searchParams.get('includeInactive') === 'true'} or active) and (${language}::text is null or language = ${language})
          and (title ilike ${`%${q}%`} or body ilike ${`%${q}%`}) order by position, id`;
      return reply({ items, total: items.length });
    }
    if (method === 'POST' && !id || method === 'PATCH' && id) {
      if (id) uuid(id);
      const b = objectBody(body), title = textValue(b.title, '제목', 200), text = textValue(b.body, '본문', 10000);
      if (!title.trim() || !['KO', 'JA', 'EN'].includes(String(b.language)) || !Number.isInteger(b.order) || typeof b.active !== 'boolean')
        throw new ProductError('INVALID_INPUT', '제목·언어·순서·사용 여부를 확인해 주세요.');
      return reply(await productOperation(sql, actor, req, body, async (tx) => {
        if (id) { const [row] = await tx<Array<{ version: number }>>`select version from quick_message where id = ${id} for update`;
          if (!row) throw productMissing(); expectVersion(row.version, versionHeader(req)); }
        const [saved] = id ? await tx`update quick_message set title = ${title}, language = ${String(b.language)}, body = ${text},
          position = ${b.order as number}, active = ${b.active as boolean}, version = version + 1, updated_by = ${actor.id}, updated_at = now()
          where id = ${id} returning id, title, language, body, position as "order", active, version`
          : await tx`insert into quick_message (title, language, body, position, active, updated_by)
          values (${title}, ${String(b.language)}, ${text}, ${b.order as number}, ${b.active as boolean}, ${actor.id}) returning id, title, language, body, position as "order", active, version`;
        return saved;
      }), id ? 200 : 201);
    }
    // 삭제 — 되돌릴 수 없고 익스텐션 목록에서도 바로 사라진다. 잠시 빼두기만 하려면 active=false(미사용)를 쓴다.
    if (method === 'DELETE' && id && !action) {
      uuid(id); const expected = versionHeader(req);
      return reply(await productOperation(sql, actor, req, body, async (tx) => {
        const [row] = await tx<Array<{ version: number }>>`select version from quick_message where id = ${id} for update`;
        if (!row) throw productMissing(); expectVersion(row.version, expected);
        await tx`delete from quick_message where id = ${id}`;
        return { deleted: true };
      }));
    }
  }
  if (root === 'operations' && id === 'lookup' && method === 'POST') {
    const b = objectBody(body), operation = textValue(b.operation, '처리 종류', 500), key = textValue(b.key ?? b.idempotencyKey, '저장 요청 번호', 120);
    const [row] = await sql<Array<{ status: string; response: unknown }>>`select status, response from api_idempotency
      where subject = ${actor.id} and operation = ${operation} and key = ${key}`;
    return reply(row ? { status: row.status, result: row.response } : { status: 'not_found' });
  }
  throw productMissing();
}
