// 명부 전용 입력칸의 판정(설계 §9) — 작업 패널·교체 창·원고 카드 칩·일괄 배정 바가 같은 규칙을 쓴다.
// 서버 쪽 같은 규칙은 taskAssignGate.ts(lower 비교 + 명부 표기 저장). DB 없음 — 화면이 값으로 import한다.
import type { InfluencerOption } from './draftTypes.ts';
import { parseXHandle, handleParseMessage } from './xHandle.ts';

export type RosterStatus = 'loading' | 'ok' | 'failed';
export type RegisterResult = { ok: true; handle: string } | { ok: false; error: string };
// 입력칸이 받는 명부 관문 — 목록은 따로(options prop) 받고, 여기는 상태와 '등록하고 배정'의 등록 단계만.
export interface RosterGate { status: RosterStatus; register: (handle: string) => Promise<RegisterResult> }

export const ROSTER_FAILED_MESSAGE = '명부를 불러오지 못했어요 — 새로고침해 주세요';
export const ROSTER_LOADING_MESSAGE = '명부 불러오는 중…';
// 저장 버튼(칩)을 눌렀는데 명부 밖일 때 — 등록 줄이 바로 아래에 있으니 그걸 가리킨다
export const ROSTER_OUTSIDE_MESSAGE = '명부에 없는 인플이에요 — 아래 줄을 눌러 등록하고 배정해요';

export type RosterResolve =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'roster'; handle: string; option: InfluencerOption }
  | { kind: 'outside'; handle: string };

export function findRosterOption(options: InfluencerOption[], handle: string): InfluencerOption | undefined {
  const k = handle.toLowerCase();
  return options.find((o) => o.handle.toLowerCase() === k);
}

export function resolveRosterInput(raw: string, options: InfluencerOption[], status: RosterStatus): RosterResolve {
  const v = raw.trim();
  if (!v) return { kind: 'empty' };
  const p = parseXHandle(v);
  // 형식 오류는 명부 상태와 무관하게 지금 말할 수 있다 — 먼저
  if (!p.ok) return { kind: 'invalid', message: handleParseMessage(p.reason) };
  // 명부를 못 읽었으면(실패 시 빈 배열) 모든 핸들이 명부 밖으로 보인다 — 그때는 판정 자체를 하지 않는다(§9)
  if (status === 'loading') return { kind: 'unavailable', message: ROSTER_LOADING_MESSAGE };
  if (status === 'failed') return { kind: 'unavailable', message: ROSTER_FAILED_MESSAGE };
  const option = findRosterOption(options, p.handle);
  return option ? { kind: 'roster', handle: option.handle, option } : { kind: 'outside', handle: p.handle };
}

// 입력 중 후보(사진·이름·핸들·단가 행) — 핸들·표시 이름 부분 일치. 한 번에 6개까지(도구 화면 밀도 기준).
export function rosterSuggestions(options: InfluencerOption[], raw: string, limit = 6): InfluencerOption[] {
  const v = raw.trim();
  if (!v) return [];
  const p = parseXHandle(v);
  const q = (p.ok ? p.handle : v.replace(/^@/, '')).toLowerCase();
  const rank = (o: InfluencerOption): number => {
    const h = o.handle.toLowerCase();
    if (h === q) return 0;
    if (h.startsWith(q)) return 1;
    if (h.includes(q) || (o.name ?? '').toLowerCase().includes(q)) return 2;
    return 9;
  };
  return options
    .map((o) => ({ o, r: rank(o) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.o.handle.localeCompare(b.o.handle))
    .slice(0, limit)
    .map((x) => x.o);
}
