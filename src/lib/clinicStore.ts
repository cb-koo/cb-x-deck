import type postgres from 'postgres';
import { operatingOn, validIntervals, type ClinicDateException, type DayHours, type HolidayPolicy } from './clinicHours.ts';
import { isDateOnlyString } from './campaignJudgment.ts';
import { expectVersion, jsonValue, objectBody, ProductError, productMissing, textValue } from './productCommand.ts';
import type { Member } from './types.ts';
import { locationLabel, representativeLocation, type ClinicSummary } from './clinicLocation.ts';

export interface ClinicSettings {
  week: DayHours[]; holidayPolicy: HolidayPolicy; holidayIntervals: string; exceptions: ClinicDateException[];
  naver: string; google: string; instructions: Record<'KO' | 'JA' | 'EN', string>;
}
export const emptyClinicSettings = (): ClinicSettings => ({ week: Array.from({ length: 7 }, () => ({ closed: false, intervals: '' })),
  holidayPolicy: 'unknown', holidayIntervals: '', exceptions: [], naver: '', google: '', instructions: { KO: '', JA: '', EN: '' } });
export interface ClinicTemplate { id: string; body: string; revision: number; parserCompatible: boolean }
export interface ClinicDetail { id: string; clientId: string; name: string; info: string; bannedPhrases: string[];
  settings: ClinicSettings; version: number; templates: { form: ClinicTemplate | null; sheet: ClinicTemplate | null } }

export type { ClinicSummary };
export { representativeLocation, locationLabel };

export async function listClinics(sql: postgres.Sql) {
  // 본점 식별자만 만든다. 주소·시간·안내·양식은 담당자가 직접 설정한다. 지점(branch)은 담당자가 따로 추가한다.
  await sql`insert into clinic_location (client_id) select id from client
    on conflict (client_id) where kind = 'main' do nothing`;
  return sql<ClinicSummary[]>`
    select l.id, c.id as "clientId", c.name, s.location_id is not null as configured,
      l.name as "branchName", l.kind, l.position, l.active, c.deactivated_at is null as "clientActive"
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id
    order by c.position, c.name, l.position, l.created_at`;
}
// 한 클라이언트의 지점. 본점 자동 생성은 listClinics 몫이라 여기선 읽기만 한다. 기본은 사용 중인 지점만.
export async function listClientLocations(sql: postgres.Sql, clientId: string, opts: { activeOnly?: boolean } = {}) {
  const activeOnly = opts.activeOnly ?? true;
  return sql<ClinicSummary[]>`
    select l.id, c.id as "clientId", c.name, s.location_id is not null as configured,
      l.name as "branchName", l.kind, l.position, l.active, c.deactivated_at is null as "clientActive"
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id
    where l.client_id = ${clientId} and (${!activeOnly} or l.active)
    order by l.position, l.created_at`;
}
// 지점 관리 화면용 — 중지된 지점까지 전부, 지점마다 연결된 예약 수(삭제 가능 여부 판단)를 더한다. 본점 행이 없으면 만든다.
export async function listLocationsForManage(sql: postgres.Sql, clientId: string) {
  await sql`insert into clinic_location (client_id) select id from client where id = ${clientId}
    on conflict (client_id) where kind = 'main' do nothing`;
  return sql<Array<ClinicSummary & { reservations: number }>>`
    select l.id, c.id as "clientId", c.name, s.location_id is not null as configured,
      l.name as "branchName", l.kind, l.position, l.active, c.deactivated_at is null as "clientActive",
      (select count(*)::int from visit_reservation r where r.location_id = l.id) as reservations
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id
    where l.client_id = ${clientId} order by l.position, l.created_at`;
}
// 지점 쓰기. 이름은 클라이언트 안에서 trim·대소문자 무시로 유일해야 한다(사용 중지된 지점 포함 — 되살릴 때 충돌하지 않게).
const dupName = () => new ProductError('DUPLICATE_NAME', '같은 이름의 지점이 이미 있어요.', 409);
// 한 클라이언트의 지점을 잠그고 검사+쓰기를 한 트랜잭션에서 한다 — 동시에 두 지점을 중지해 사용 중 지점이 0개가 되거나 같은 이름이 둘 생기는 걸 막는다.
// 이미 트랜잭션 안이면(begin 없음) 그대로 쓴다.
async function lockedByClient<T>(sql: postgres.Sql, clientId: string, run: (tx: postgres.Sql) => Promise<T>): Promise<T> {
  const body = async (tx: postgres.Sql) => { await tx`select id from clinic_location where client_id = ${clientId} order by id for update`; return run(tx); };
  return typeof sql.begin === 'function' ? (await sql.begin((tx) => body(tx as unknown as postgres.Sql))) as T : body(sql);
}
async function oneLocation(sql: postgres.Sql, id: string) {
  const [row] = await sql<ClinicSummary[]>`
    select l.id, c.id as "clientId", c.name, s.location_id is not null as configured,
      l.name as "branchName", l.kind, l.position, l.active, c.deactivated_at is null as "clientActive"
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id where l.id = ${id}`;
  if (!row) throw productMissing();
  return row;
}
export async function createLocation(sql: postgres.Sql, clientId: string, input: { name: string }): Promise<ClinicSummary> {
  const name = textValue(input.name, '지점명', 100).trim();
  if (!name) throw new ProductError('INVALID_INPUT', '지점명을 입력해 주세요.', 422);
  if (!(await sql`select id from client where id = ${clientId}`).length) throw productMissing();
  // 본점 행이 아직 없으면 먼저 만든다 — 그래야 새 지점이 본점 뒤 순서로 붙는다
  await sql`insert into clinic_location (client_id) values (${clientId}) on conflict (client_id) where kind = 'main' do nothing`;
  const id = await lockedByClient(sql, clientId, async (tx) => {
    if ((await tx`select 1 from clinic_location where client_id = ${clientId} and lower(btrim(name)) = lower(${name})`).length) throw dupName();
    const [row] = await tx<Array<{ id: string }>>`insert into clinic_location (client_id, kind, name, position, active)
      select ${clientId}, 'branch', ${name}, coalesce(max(position), 0) + 1, true from clinic_location where client_id = ${clientId} returning id`;
    return row.id;
  });
  return oneLocation(sql, id);
}
export async function updateLocation(sql: postgres.Sql, id: string, patch: { name?: string; position?: number; active?: boolean }): Promise<ClinicSummary> {
  const first = await oneLocation(sql, id);
  if (patch.name !== undefined) patch = { ...patch, name: textValue(patch.name, '지점명', 100).trim() };
  if (patch.position !== undefined && !Number.isInteger(patch.position)) throw new ProductError('INVALID_INPUT', '순서 값을 확인해 주세요.', 422);
  await lockedByClient(sql, first.clientId, async (tx) => {
    const cur = await oneLocation(tx, id); // 잠근 뒤 다시 읽는다 — 앞선 요청의 결과를 반영
    if (patch.name !== undefined) {
      if (cur.kind === 'branch' && !patch.name) throw new ProductError('INVALID_INPUT', '지점명을 입력해 주세요.', 422);
      if (patch.name && (await tx`select 1 from clinic_location where client_id = ${cur.clientId} and id <> ${id} and lower(btrim(name)) = lower(${patch.name})`).length) throw dupName();
    }
    if (patch.active === false && cur.active
      && !(await tx`select 1 from clinic_location where client_id = ${cur.clientId} and id <> ${id} and active`).length)
      throw new ProductError('LAST_ACTIVE', '사용 중인 지점이 하나는 있어야 해요.', 409);
    await tx`update clinic_location set name = coalesce(${patch.name ?? null}, name), position = coalesce(${patch.position ?? null}, position),
      active = coalesce(${patch.active ?? null}, active) where id = ${id}`;
  });
  return oneLocation(sql, id);
}
export async function deleteLocation(sql: postgres.Sql, id: string): Promise<void> {
  const first = await oneLocation(sql, id);
  if (first.kind === 'main') throw new ProductError('MAIN_LOCATION', '본점 행은 삭제할 수 없어요.', 409);
  // 중지와 같은 잠금·검사 — 사용 중인 마지막 지점을 지우면 웹 예약과 익스텐션 지점이 비어 버린다.
  await lockedByClient(sql, first.clientId, async (tx) => {
    const cur = await oneLocation(tx, id);
    if ((await tx`select 1 from visit_reservation where location_id = ${id} limit 1`).length)
      throw new ProductError('HAS_RESERVATIONS', '예약이 연결된 지점은 삭제할 수 없어요. 대신 사용 중지해 주세요.', 409);
    if (cur.active && !(await tx`select 1 from clinic_location where client_id = ${cur.clientId} and id <> ${id} and active`).length)
      throw new ProductError('LAST_ACTIVE', '사용 중인 지점이 하나는 있어야 해요.', 409);
    await tx`delete from clinic_location where id = ${id}`;
  });
}
export async function getClinic(sql: postgres.Sql, id: string): Promise<ClinicDetail> {
  const [row] = await sql<Array<{ id: string; clientId: string; name: string; info: string; bannedPhrases: string[]; settings: ClinicSettings | null; version: number }>>`
    select l.id, c.id as "clientId", c.name, c.info, c.banned_phrases as "bannedPhrases", s.settings, coalesce(s.version, 1) as version
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id where l.id = ${id}`;
  if (!row) throw productMissing();
  const templates = await sql<Array<ClinicTemplate & { kind: 'form' | 'sheet' }>>`
    select distinct on (kind) id, kind, body, revision, parser_compatible as "parserCompatible"
    from clinic_template_revision where location_id = ${id} order by kind, revision desc`;
  return { ...row, settings: { ...emptyClinicSettings(), ...row.settings },
    templates: { form: templates.find((t) => t.kind === 'form') ?? null, sheet: templates.find((t) => t.kind === 'sheet') ?? null } };
}
export function parseClinicSettings(raw: unknown): ClinicSettings {
  const b = objectBody(raw);
  const day = (v: unknown): DayHours => {
    const d = objectBody(v);
    if (typeof d.closed !== 'boolean' || typeof d.intervals !== 'string' || (d.intervals && !validIntervals(d.intervals)))
      throw new ProductError('HOURS_INVALID', '운영시간과 점심시간을 다시 확인해 주세요.', 422);
    return { closed: d.closed, intervals: d.intervals };
  };
  if (!Array.isArray(b.week) || b.week.length !== 7 || !['unknown', 'special', 'closed'].includes(String(b.holidayPolicy)))
    throw new ProductError('HOURS_INVALID', '매주 운영시간과 공휴일 방침을 확인해 주세요.', 422);
  const holidayIntervals = textValue(b.holidayIntervals, '공휴일 운영시간', 100);
  if (holidayIntervals && !validIntervals(holidayIntervals) || b.holidayPolicy === 'special' && !validIntervals(holidayIntervals))
    throw new ProductError('HOURS_INVALID', '공휴일 운영시간을 확인해 주세요.', 422);
  if (!Array.isArray(b.exceptions) || b.exceptions.length > 1000) throw new ProductError('HOURS_INVALID', '날짜별 운영시간을 확인해 주세요.');
  const dates = new Set<string>();
  const exceptions = b.exceptions.map((v): ClinicDateException => {
    const e = objectBody(v), date = textValue(e.date, '날짜', 10);
    if (!isDateOnlyString(date) || dates.has(date)) throw new ProductError('DATE_INVALID', '날짜별 운영 설정이 겹치거나 날짜가 잘못됐어요.', 422);
    dates.add(date); return { ...day(e), date, note: textValue(e.note ?? '', '메모', 3000) };
  });
  const mapUrl = (v: unknown) => {
    const text = textValue(v, '지도 주소', 2000);
    if (text) { try { if (!['http:', 'https:'].includes(new URL(text).protocol)) throw new Error(); }
      catch { throw new ProductError('MAP_URL_INVALID', '지도는 http 또는 https 주소로 입력해 주세요.', 422); } }
    return text;
  };
  const instructions = objectBody(b.instructions);
  return { week: b.week.map(day), holidayPolicy: b.holidayPolicy as HolidayPolicy, holidayIntervals, exceptions,
    naver: mapUrl(b.naver), google: mapUrl(b.google), instructions: { KO: textValue(instructions.KO, '한국어 안내'),
      JA: textValue(instructions.JA, '일본어 안내'), EN: textValue(instructions.EN, '영어 안내') } };
}
export async function saveClinicSettings(tx: postgres.Sql, id: string, raw: unknown, expected: number, actor: Member) {
  const settings = parseClinicSettings(raw);
  if (!(await tx`select id from clinic_location where id = ${id} for update`).length) throw productMissing();
  const current = await getClinic(tx, id); expectVersion(current.version, expected);
  if (JSON.stringify(settings) !== JSON.stringify(current.settings)) await tx`insert into clinic_settings (location_id, settings, version, updated_by)
    values (${id}, ${tx.json(jsonValue(settings))}, 2, ${actor.id}) on conflict (location_id) do update
    set settings = excluded.settings, version = clinic_settings.version + 1, updated_by = excluded.updated_by, updated_at = now()`;
  return getClinic(tx, id);
}
export async function saveClinicTemplate(tx: postgres.Sql, id: string, kind: 'form' | 'sheet', raw: unknown, expected: number, actor: Member,
  opts: { applyToSiblings?: boolean } = {}) {
  const body = textValue(objectBody(raw).body, '예약 양식');
  // 지점 추가·수정·삭제(lockedByClient)와 같은 순서(id 순)로 잠근다 — 적용 시엔 클라이언트의 모든 지점을 한 번에.
  const [owner] = await tx<Array<{ clientId: string }>>`select client_id as "clientId" from clinic_location where id = ${id}`;
  if (!owner) throw productMissing();
  if (opts.applyToSiblings) await tx`select id from clinic_location where client_id = ${owner.clientId} order by id for update`;
  else await tx`select id from clinic_location where id = ${id} for update`;
  const clinic = await getClinic(tx, id), current = clinic.templates[kind];
  expectVersion(current?.revision ?? 1, expected);
  const saved = await insertTemplateRevision(tx, id, kind, body, current, actor);
  if (opts.applyToSiblings) {
    // 같은 트랜잭션에서 같은 클라이언트의 다른 지점(사용 중지 포함 — 다시 켰을 때 옛 양식이 남지 않게)에 같은 내용을 새 리비전으로 쌓는다.
    // 한 지점이 먼저 바뀌었더라도 버전 충돌로 막지 않도록 각 지점의 현재 버전을 그대로 expected로 쓴다(잠금은 행마다).
    const siblings = await tx<Array<{ id: string }>>`select id from clinic_location where client_id = ${clinic.clientId} and id <> ${id} order by id`;
    for (const s of siblings) {
      const sibling = (await getClinic(tx, s.id)).templates[kind];
      await insertTemplateRevision(tx, s.id, kind, body, sibling, actor);
    }
  }
  return saved;
}
async function insertTemplateRevision(tx: postgres.Sql, id: string, kind: 'form' | 'sheet', body: string, current: ClinicTemplate | null, actor: Member) {
  if (current?.body === body) return current;
  const [saved] = await tx<ClinicTemplate[]>`insert into clinic_template_revision (location_id, kind, body, revision, created_by)
    values (${id}, ${kind}, ${body}, ${(current?.revision ?? 1) + 1}, ${actor.id})
    returning id, body, revision, parser_compatible as "parserCompatible"`;
  return saved;
}
export async function clinicCalendar(sql: postgres.Sql, id: string, month: string) {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new ProductError('DATE_INVALID', '확인할 달을 선택해 주세요.');
  const clinic = await getClinic(sql, id);
  const years = await sql<Array<{ year: number; names: Record<string, string>; source: string; fetched_at: Date }>>`
    select year, names, source, fetched_at from holiday_calendar_year where year = ${Number(month.slice(0, 4))}`;
  const holidays = { names: years[0]?.names ?? {}, coveredYears: years.map((r) => r.year) };
  const total = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return { month, holidays, source: years[0]?.source ?? null, fetchedAt: years[0]?.fetched_at ?? null,
    days: Array.from({ length: total }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`;
      return { date, ...operatingOn(clinic.settings, clinic.settings.exceptions, holidays, date) }; }) };
}
