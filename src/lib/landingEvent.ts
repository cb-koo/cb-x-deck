// 브릿지(x-line-link-bridge) ↔ cb-x-deck 계약. 필드명은 브릿지 lib/deck.ts와 맞춰져 있다 — 바꾸면 브릿지에 알릴 것.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §수집 API
export type LandingKind = 'arrival' | 'view' | 'tap';
const KINDS: readonly LandingKind[] = ['arrival', 'view', 'tap'];

export interface LandingEventInput {
  eventId: string; visitId: string; kind: LandingKind;
  clinic: string; hostname: string; path: string;
  utmSource: string | null; utmMedium: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null;
  refererHost: string | null; ua: string; isBotUa: boolean; secFetchOk: boolean;
  ipHash: string | null; country: string | null;
  occurredAt: string; // ISO — 브릿지 시각(ts)
}

export const MAX_EVENTS = 100;   // 브릿지는 1건씩 보내지만 배치 여지를 남긴다. 그 이상은 잘못된 호출
const MAX_STR = 2000;            // 필드 하나가 이 길이를 넘으면 계약 밖의 값이다

export type ParseResult =
  | { ok: true; events: LandingEventInput[] }
  | { ok: false; index: number | null; field: string; error: string };

type Fail = { field: string; reason: string };
const fail = (field: string, reason: string): Fail => ({ field, reason });

function str(o: Record<string, unknown>, k: string, required: boolean): string | null | Fail {
  const v = o[k];
  if (v === undefined || v === null) return required ? fail(k, '필수 값이 없어요') : null;
  if (typeof v !== 'string') return fail(k, '문자열이어야 해요');
  if (required && v.length === 0) return fail(k, '빈 문자열이에요');
  if (v.length > MAX_STR) return fail(k, `${MAX_STR}자를 넘어요`);
  return v;
}
function bool(o: Record<string, unknown>, k: string): boolean | Fail {
  return typeof o[k] === 'boolean' ? (o[k] as boolean) : fail(k, 'true/false여야 해요');
}
const isFail = (v: unknown): v is Fail => typeof v === 'object' && v !== null && 'reason' in (v as Fail);

function parseOne(raw: unknown): LandingEventInput | Fail {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('event', '객체여야 해요');
  const o = raw as Record<string, unknown>;
  const req = ['event_id', 'visit_id', 'clinic', 'hostname', 'path', 'ua'] as const;
  const got: Record<string, string> = {};
  for (const k of req) { const v = str(o, k, true); if (isFail(v)) return v; got[k] = v as string; }
  const kind = o.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as LandingKind)) return fail('kind', 'arrival·view·tap 중 하나여야 해요');
  const opt: Record<string, string | null> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referer_host', 'ip_hash', 'country']) {
    const v = str(o, k, false); if (isFail(v)) return v; opt[k] = v;
  }
  const isBotUa = bool(o, 'is_bot_ua'); if (isFail(isBotUa)) return isBotUa;
  const secFetchOk = bool(o, 'sec_fetch_ok'); if (isFail(secFetchOk)) return secFetchOk;
  const ts = str(o, 'ts', true); if (isFail(ts)) return ts;
  const ms = Date.parse(ts as string);
  if (Number.isNaN(ms)) return fail('ts', 'ISO 8601 시각이어야 해요');
  return {
    eventId: got.event_id, visitId: got.visit_id, kind: kind as LandingKind,
    clinic: got.clinic, hostname: got.hostname, path: got.path,
    utmSource: opt.utm_source, utmMedium: opt.utm_medium, utmCampaign: opt.utm_campaign,
    utmContent: opt.utm_content, utmTerm: opt.utm_term, refererHost: opt.referer_host,
    ua: got.ua, isBotUa, secFetchOk, ipHash: opt.ip_hash, country: opt.country,
    occurredAt: new Date(ms).toISOString(),
  };
}

// 본문 전체 → 이벤트 배열. 첫 오류에서 멈추고 어느 건(index)의 어느 필드(field)인지 알려준다 —
// 브릿지 쪽에서 계약 어긋남을 바로 짚을 수 있게(400 응답 본문이 이 값을 그대로 싣는다).
export function parseLandingEvents(body: unknown): ParseResult {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, index: null, field: 'events', error: 'events는 1건 이상의 배열이어야 해요' };
  }
  if (events.length > MAX_EVENTS) {
    return { ok: false, index: null, field: 'events', error: `한 번에 ${MAX_EVENTS}건까지만 받아요` };
  }
  const out: LandingEventInput[] = [];
  for (let i = 0; i < events.length; i++) {
    const r = parseOne(events[i]);
    if (isFail(r)) return { ok: false, index: i, field: r.field, error: `events[${i}].${r.field}: ${r.reason}` };
    out.push(r);
  }
  return { ok: true, events: out };
}
