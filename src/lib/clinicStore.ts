import type postgres from 'postgres';
import { operatingOn, validIntervals, type ClinicDateException, type DayHours, type HolidayPolicy } from './clinicHours.ts';
import { isDateOnlyString } from './campaignJudgment.ts';
import { expectVersion, jsonValue, objectBody, ProductError, productMissing, textValue } from './productCommand.ts';
import type { Member } from './types.ts';

export interface ClinicSettings {
  week: DayHours[]; holidayPolicy: HolidayPolicy; holidayIntervals: string; exceptions: ClinicDateException[];
  naver: string; google: string; instructions: Record<'KO' | 'JA' | 'EN', string>;
}
export const emptyClinicSettings = (): ClinicSettings => ({ week: Array.from({ length: 7 }, () => ({ closed: false, intervals: '' })),
  holidayPolicy: 'unknown', holidayIntervals: '', exceptions: [], naver: '', google: '', instructions: { KO: '', JA: '', EN: '' } });
export interface ClinicTemplate { id: string; body: string; revision: number; parserCompatible: boolean }
export interface ClinicDetail { id: string; clientId: string; name: string; info: string; bannedPhrases: string[];
  settings: ClinicSettings; version: number; templates: { form: ClinicTemplate | null; sheet: ClinicTemplate | null } }

export type ClinicSummary = { id: string; clientId: string; name: string; configured: boolean;
  branchName: string; kind: 'main' | 'branch'; position: number; active: boolean };

export async function listClinics(sql: postgres.Sql) {
  // 본점 식별자만 만든다. 주소·시간·안내·양식은 담당자가 직접 설정한다. 지점(branch)은 담당자가 따로 추가한다.
  await sql`insert into clinic_location (client_id) select id from client
    on conflict (client_id) where kind = 'main' do nothing`;
  return sql<ClinicSummary[]>`
    select l.id, c.id as "clientId", c.name, s.location_id is not null as configured,
      l.name as "branchName", l.kind, l.position, l.active
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id
    order by c.position, c.name, l.position, l.created_at`;
}
// 한 클라이언트의 지점. 본점 자동 생성은 listClinics 몫이라 여기선 읽기만 한다. 기본은 사용 중인 지점만.
export async function listClientLocations(sql: postgres.Sql, clientId: string, opts: { activeOnly?: boolean } = {}) {
  const activeOnly = opts.activeOnly ?? true;
  return sql<ClinicSummary[]>`
    select l.id, c.id as "clientId", c.name, s.location_id is not null as configured,
      l.name as "branchName", l.kind, l.position, l.active
    from clinic_location l join client c on c.id = l.client_id left join clinic_settings s on s.location_id = l.id
    where l.client_id = ${clientId} and (${!activeOnly} or l.active)
    order by l.position, l.created_at`;
}
// 대표 지점 = 사용 중인 지점 가운데 순서가 가장 앞. 순서가 같으면 목록에서 앞선 것.
export function representativeLocation(list: ClinicSummary[]): ClinicSummary | null {
  let best: ClinicSummary | null = null;
  for (const l of list) if (l.active && (!best || l.position < best.position)) best = l;
  return best;
}
// 지점이 하나뿐이라 지점명이 비면 '본점'으로 읽는다. 순수 함수라 클라이언트 컴포넌트에서도 쓴다.
export function locationLabel(l: Pick<ClinicSummary, 'name' | 'branchName'>) { return `${l.name} · ${l.branchName || '본점'}`; }
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
export async function saveClinicTemplate(tx: postgres.Sql, id: string, kind: 'form' | 'sheet', raw: unknown, expected: number, actor: Member) {
  const body = textValue(objectBody(raw).body, '예약 양식');
  if (!(await tx`select id from clinic_location where id = ${id} for update`).length) throw productMissing();
  const current = (await getClinic(tx, id)).templates[kind];
  expectVersion(current?.revision ?? 1, expected);
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
