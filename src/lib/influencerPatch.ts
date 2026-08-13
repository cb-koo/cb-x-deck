import { parseXHandle, handleParseMessage } from './xHandle.ts';

// undefined = 건드리지 않음 · null·공백뿐인 문자열 = 배정 해제 · 그 외 = parseXHandle 정규화.
// 빈 값을 파서에 넣지 않는다 — 'empty' 오류가 배정 해제 요청에 잘못 붙는 것을 막는다.
// 단건/컬렉션 두 라우트가 같은 규칙을 써야 한다 — 복사해 두면 한쪽만 고쳐지는 드리프트가 난다(설계 §B).
export function normalizeInfluencerPatch(v: string | null | undefined):
  { ok: true; value: string | null | undefined } | { ok: false; message: string } {
  if (v === undefined) return { ok: true, value: undefined };
  const trimmed = v == null ? null : v.trim();
  if (!trimmed) return { ok: true, value: null };
  const parsed = parseXHandle(trimmed);
  if (!parsed.ok) return { ok: false, message: handleParseMessage(parsed.reason) };
  return { ok: true, value: parsed.handle };
}
