// 캠페인 라우트 입력 검증 — 순수(DB 없음). 생성·수정이 같은 규칙을 쓴다: 이름 필수·영문 코드는 트래킹 링크의
// checkCampaign(공백→하이픈, 영어·숫자·._-)·기간은 달력일 문자열·유형은 화이트리스트. 서버가 최종 근거이고,
// 생성 모달·헤더 인라인 수정(Task 10·11)은 같은 함수로 즉시 피드백을 만든다 — 문구가 두 벌이 되지 않게.
import { checkCampaign, campaignMessage } from './trackingLink.ts';
import { isCampaignKind, isDateOnlyString, type CampaignKind } from './campaignJudgment.ts';
import { isUuidLike } from './uuid.ts';
import type { Parsed } from './campaignCost.ts';

export interface CampaignCreateInput {
  clientId: string; name: string; nameEn: string; startsOn: string; endsOn: string;
  kind: CampaignKind | null; note: string;
}
export interface CampaignPatchInput {
  name?: string; nameEn?: string; startsOn?: string; endsOn?: string; kind?: CampaignKind | null; note?: string;
}

export const NAME_MAX = 80;    // 원고 제목과 같은 상한(drafts/[id] 라우트) — 목록 한 줄에 들어가는 길이
export const NOTE_MAX = 2000;
export const PERIOD_MESSAGE = '종료일이 시작일보다 앞이에요';
export const NAME_MESSAGE = '캠페인 이름을 입력해 주세요';
export const CLIENT_MESSAGE = '클라이언트를 골라 주세요';
export const DATE_MESSAGE = '기간은 YYYY-MM-DD 날짜로 입력해 주세요';
export const KIND_MESSAGE = '유형 값이 올바르지 않아요';
export const NOTE_MESSAGE = '메모 형식이 올바르지 않아요';

function fail<T>(message: string): Parsed<T> { return { ok: false, message }; }

// 같은 날(하루짜리)은 허용 — DB check(ends_on >= starts_on)와 같은 경계. 위반이면 문구, 아니면 null.
export function checkPeriod(startsOn: string, endsOn: string): string | null {
  return endsOn < startsOn ? PERIOD_MESSAGE : null;
}

function parseName(v: unknown): Parsed<string> {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) return fail(NAME_MESSAGE);
  if (name.length > NAME_MAX) return fail(`캠페인 이름은 ${NAME_MAX}자까지 쓸 수 있어요`);
  return { ok: true, value: name };
}
// 영문 코드 = 트래킹 링크 utm_campaign 기본값이 되므로 그쪽 규칙 그대로(문구도 campaignMessage 재사용)
function parseNameEn(v: unknown): Parsed<string> {
  const c = checkCampaign(typeof v === 'string' ? v : '');
  return c.ok ? { ok: true, value: c.campaign } : fail(campaignMessage(c.reason));
}
function parseDate(v: unknown): Parsed<string> {
  return isDateOnlyString(v) ? { ok: true, value: v } : fail(DATE_MESSAGE);
}
// ''와 null은 둘 다 '유형 없음' — select의 빈 option 값이 ''라서 모달이 그대로 보낸다
function parseKind(v: unknown): Parsed<CampaignKind | null> {
  if (v === null || v === '') return { ok: true, value: null };
  return isCampaignKind(v) ? { ok: true, value: v } : fail(KIND_MESSAGE);
}
function parseNote(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return fail(NOTE_MESSAGE);
  const note = v.trim();
  return note.length > NOTE_MAX ? fail(`메모는 ${NOTE_MAX}자까지 쓸 수 있어요`) : { ok: true, value: note };
}

export function parseCampaignCreate(body: unknown): Parsed<CampaignCreateInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.clientId !== 'string' || !isUuidLike(b.clientId)) return fail(CLIENT_MESSAGE);
  const name = parseName(b.name);          if (!name.ok) return fail(name.message);
  const nameEn = parseNameEn(b.nameEn);    if (!nameEn.ok) return fail(nameEn.message);
  const startsOn = parseDate(b.startsOn);  if (!startsOn.ok) return fail(startsOn.message);
  const endsOn = parseDate(b.endsOn);      if (!endsOn.ok) return fail(endsOn.message);
  const period = checkPeriod(startsOn.value, endsOn.value); if (period) return fail(period);
  const kind = parseKind(b.kind ?? null);  if (!kind.ok) return fail(kind.message);
  const note = parseNote(b.note ?? '');    if (!note.ok) return fail(note.message);
  return { ok: true, value: {
    clientId: b.clientId, name: name.value, nameEn: nameEn.value,
    startsOn: startsOn.value, endsOn: endsOn.value, kind: kind.value, note: note.value,
  } };
}

// undefined = 건드리지 않음. 모르는 키(clientId 등)는 무시 — 클라이언트 변경은 범위 밖(스펙 §3-3 수정 항목: 이름·기간·유형·코드·메모).
export function parseCampaignPatch(body: unknown): Parsed<CampaignPatchInput> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const out: CampaignPatchInput = {};
  if (b.name !== undefined)     { const p = parseName(b.name);       if (!p.ok) return fail(p.message); out.name = p.value; }
  if (b.nameEn !== undefined)   { const p = parseNameEn(b.nameEn);   if (!p.ok) return fail(p.message); out.nameEn = p.value; }
  if (b.startsOn !== undefined) { const p = parseDate(b.startsOn);   if (!p.ok) return fail(p.message); out.startsOn = p.value; }
  if (b.endsOn !== undefined)   { const p = parseDate(b.endsOn);     if (!p.ok) return fail(p.message); out.endsOn = p.value; }
  if (b.kind !== undefined)     { const p = parseKind(b.kind);       if (!p.ok) return fail(p.message); out.kind = p.value; }
  if (b.note !== undefined)     { const p = parseNote(b.note);       if (!p.ok) return fail(p.message); out.note = p.value; }
  // 양쪽이 다 왔을 때만 여기서 순서를 본다 — 한쪽만 오면 라우트가 기존 값과 합쳐 checkPeriod를 부른다
  if (out.startsOn !== undefined && out.endsOn !== undefined) {
    const period = checkPeriod(out.startsOn, out.endsOn);
    if (period) return fail(period);
  }
  return { ok: true, value: out };
}
