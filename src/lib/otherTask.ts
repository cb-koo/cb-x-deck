// 기타 협찬(other, 088 — ISSUE-002·015, koo 11-06)의 순수 규칙 — 화면·서버 공용(서버 import 없음).
// X 게시물이 아닌 협찬(구글맵 리뷰, 상담회 참석 등). 완료일은 posted_at, 확인 링크(아무 사이트)는 post_url을 그대로 쓴다 —
// 정산 후보·자동 전송·같은 주 함께 보내기·마케팅 비용 귀속일이 고칠 것 없이 따라온다.
//   other_kind: 무엇을 했는지 한 줄(만들 때는 비워도 되고, 완료 확인 때 필수 — 나중에 별도 유형으로 옮길 때의 기준)
//   done_note : 링크 없이 완료한 건의 확인 메모(필수) — 정산 요청 note에 '[링크 없음] …'으로 실려 링크를 대신한다
import { DONE_NOTE_MAX, OTHER_KIND_MAX, type TaskType } from './campaignJudgment.ts';

export const OTHER_KIND_REQUIRED_MESSAGE = '무엇을 했는지 먼저 적어 주세요 — 완료 확인에 필요해요';
export const OTHER_KIND_TOO_LONG_MESSAGE = `무엇을 했는지는 ${OTHER_KIND_MAX}자 안으로 적어 주세요`;
export const DONE_NOTE_TOO_LONG_MESSAGE = `확인 메모는 ${DONE_NOTE_MAX}자 안으로 적어 주세요`;
export const DONE_NOTE_REQUIRED_MESSAGE = '링크가 없으면 확인 메모를 적어 주세요 — 정산 때 링크 대신 정산팀에 전달돼요';
export const OTHER_ONLY_MESSAGE = '무엇을 했는지와 확인 메모는 기타 협찬 작업에만 있어요';
export const DONE_DATE_FUTURE_MESSAGE = '완료한 날은 오늘보다 뒤일 수 없어요';
export const LINK_MESSAGE = '확인 링크는 http(s)로 시작하는 주소여야 해요';

/** 앞뒤 공백 정리 + 가운데 공백 하나로. 글자 수 검사는 호출자가(길면 거절 — 몰래 자르지 않는다). */
export const normalizeOtherKind = (s: string): string => s.trim().replace(/\s+/g, ' ');
const looseKey = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * 전에 쓴 말과 띄어쓰기·대소문자만 다른 입력이면 그 말을 돌려준다('구글맵리뷰' → '구글맵 리뷰').
 * 이름이 흩어지지 않게 하는 장치 — 나중에 별도 유형으로 옮길 때 이 이름이 기준이 된다. 같은 글자면 null(바꿀 것 없음).
 */
export function canonicalOtherKind(input: string, known: readonly string[]): string | null {
  const v = normalizeOtherKind(input);
  if (!v) return null;
  const hit = known.find((k) => looseKey(k) === looseKey(v));
  return hit && hit !== v ? hit : null;
}

/** 추천 목록 거르기 — 입력 글자가 들어 있는 말(띄어쓰기·대소문자 무시), 많이 쓴 순서 그대로. 입력이 비면 전부. */
export function filterOtherKinds(input: string, known: ReadonlyArray<{ kind: string; count: number }>): Array<{ kind: string; count: number }> {
  const q = looseKey(input);
  return q ? known.filter((k) => looseKey(k.kind).includes(q)) : [...known];
}

// 정산 참고 링크 검사(settlementStore의 /^https?:\/\/\S+$/)를 늘 통과하는 값만 받는다 — 공백 없음 + URL로 읽힘
export function isHttpUrl(v: string): boolean {
  if (/\s/.test(v) || v.length > 2000) return false;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}

type OtherLike = { type: TaskType; postedAt: string | null; postUrl: string | null; otherKind?: string; doneNote?: string };
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** 링크 없이 완료한 기타 협찬인가 */
export const isOtherLinklessDone = (t: OtherLike): boolean =>
  t.type === 'other' && !!t.postedAt && !t.postUrl && !!(t.doneNote ?? '').trim();

/** 정산 요청 메모 — 링크 대신 정산팀이 읽는 한 줄. 링크 없는 완료가 아니면 null. 009의 '[게시물 삭제] …'와 같은 틀. */
export function otherLinklessNote(t: OtherLike): string | null {
  if (!isOtherLinklessDone(t)) return null;
  const kind = normalizeOtherKind(t.otherKind ?? '') || '기타 협찬';
  return `[링크 없음] ${kind} — ${(t.doneNote ?? '').trim()} (완료 ${md(t.postedAt!)})`;
}

/**
 * 기타 협찬 전용 칸·완료 확인의 판정(라우트용 순수 함수) — "패치 후 상태"로 본다(proofGateError와 같은 이유).
 *  ① other_kind·done_note는 기타 협찬에만(키가 오기만 해도 거절 — 화면은 다른 유형에 이 칸을 그리지 않는다)
 *  ② 완료 확인(새 postedAt): 무엇을 했는지 필수, 링크 또는 확인 메모 필수, 날짜는 오늘 이하
 *  ③ 완료된 뒤: 무엇을 했는지를 비울 수 없고, 링크 없는 완료면 확인 메모도 비울 수 없다(정산 확인 자료라서)
 */
export function otherGateError(
  cur: OtherLike,
  patch: { postedAt?: string; postUrl?: string | null; otherKind?: string; doneNote?: string },
  today: string,
): string | null {
  if (cur.type !== 'other') {
    if (patch.otherKind !== undefined || patch.doneNote !== undefined) return OTHER_ONLY_MESSAGE;
    return null;
  }
  const after = {
    postedAt: patch.postedAt !== undefined ? patch.postedAt : cur.postedAt,
    postUrl: patch.postUrl !== undefined ? patch.postUrl : cur.postUrl,
    otherKind: patch.otherKind !== undefined ? patch.otherKind : (cur.otherKind ?? ''),
    doneNote: patch.doneNote !== undefined ? patch.doneNote : (cur.doneNote ?? ''),
  };
  if (!after.postedAt) return null;   // 완료 전 — 무엇이든 자유롭게 고친다
  if (patch.postedAt !== undefined && !cur.postedAt && patch.postedAt > today) return DONE_DATE_FUTURE_MESSAGE;
  if (!after.otherKind.trim()) return OTHER_KIND_REQUIRED_MESSAGE;
  if (!after.postUrl && !after.doneNote.trim()) return DONE_NOTE_REQUIRED_MESSAGE;
  return null;
}
