// 여러 클라이언트 캠페인 한 번에 만들기(ISSUE-006, koo 11-04) — 매주 월요일 클라이언트마다 같은 기간의 주차 캠페인을 하나씩
// 만들던 반복을 한 번으로. 기간은 [이번 주][다음 주][기간 지정], 클라이언트는 전부 골라진 채로 시작해 필요한 곳만 뺀다.
// 이름·영문 코드는 한 곳 만들기와 같은 제안 함수(suggestCampaignName·suggestCampaignCode)로 서버가 정한다.
// 같은 클라이언트에 같은 기간(시작·종료가 같은) 캠페인이 이미 있으면 만들지 않는다 — 두 번 눌러도 중복이 생기지 않게.
// 화면·서버 공용 — 서버 import를 두지 않는다.
import { addDays, weekStartOf, suggestCampaignName, suggestCampaignCode, isDateOnlyString } from './campaignJudgment.ts';
import type { DateOnly } from './datetime.ts';
import { checkPeriod, CLIENT_MESSAGE } from './campaignInput.ts';
import type { Parsed } from './campaignCost.ts';
import { isUuidLike } from './uuid.ts';

export type PeriodPreset = 'this' | 'next' | 'custom';
export const BULK_MAX = 30;

export function weekRangeOf(date: string): { startsOn: DateOnly; endsOn: DateOnly } {
  const startsOn = weekStartOf(date);
  return { startsOn, endsOn: addDays(startsOn, 6) };
}
/** 기본 기간 — 월요일에 열면 이번 주(그 주 캠페인을 월요일에 만든다, 10/26·11/2 실사용), 그 외 요일엔 다음 주. */
export function defaultPreset(today: string): Exclude<PeriodPreset, 'custom'> {
  return new Date(today + 'T00:00:00Z').getUTCDay() === 1 ? 'this' : 'next';
}
export function presetRange(today: string, preset: Exclude<PeriodPreset, 'custom'>): { startsOn: DateOnly; endsOn: DateOnly } {
  return weekRangeOf(preset === 'this' ? today : addDays(weekStartOf(today), 7));
}

/** 클라이언트 한 곳의 제안 — 한 곳 만들기 창과 같은 규칙. */
export function bulkSuggestion(client: { name: string; nameEn: string }, startsOn: string): { name: string; nameEn: string } {
  return { name: suggestCampaignName(client.name, startsOn), nameEn: suggestCampaignCode(client.nameEn, startsOn) };
}

/** 같은 클라이언트·같은 기간 캠페인이 이미 있는가 — 화면(회색 처리)과 서버(거절)가 같은 판정을 쓴다. */
export function hasSamePeriod(existing: Array<{ clientId: string | null; startsOn: string; endsOn: string }>, clientId: string, startsOn: string, endsOn: string): boolean {
  return existing.some((c) => c.clientId === clientId && c.startsOn === startsOn && c.endsOn === endsOn);
}

export const BULK_EMPTY_MESSAGE = '만들 클라이언트를 하나 이상 골라 주세요';
export const BULK_PERIOD_MESSAGE = '기간을 입력해 주세요';

export function parseBulkCreate(body: unknown): Parsed<{ clientIds: string[]; startsOn: string; endsOn: string }> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const fail = (message: string) => ({ ok: false as const, message });
  if (!Array.isArray(b.clientIds) || b.clientIds.length === 0) return fail(BULK_EMPTY_MESSAGE);
  if (b.clientIds.length > BULK_MAX) return fail(`한 번에 ${BULK_MAX}곳까지 만들 수 있어요`);
  if (!b.clientIds.every((id) => typeof id === 'string' && isUuidLike(id))) return fail(CLIENT_MESSAGE);
  const clientIds = [...new Set(b.clientIds as string[])];
  if (typeof b.startsOn !== 'string' || typeof b.endsOn !== 'string' || !isDateOnlyString(b.startsOn) || !isDateOnlyString(b.endsOn)) return fail(BULK_PERIOD_MESSAGE);
  const period = checkPeriod(b.startsOn, b.endsOn);
  if (period) return fail(period);
  return { ok: true, value: { clientIds, startsOn: b.startsOn, endsOn: b.endsOn } };
}
