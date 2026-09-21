// 원고 모드(캠페인 v2 §5)가 누구 밑에서 열렸는지 — 저장된 작업인지, 아직 안 만든 폼인지.
// 세 갈래(DraftGenerate·DraftWrite·DraftPick)는 이 값 하나로 "붙이기"와 "고르기"를 가른다.
// 스펙: docs/superpowers/specs/2026-09-21-task-form-draft-entry-design.md §4-2
export type DraftHost =
  | { kind: 'task'; taskId: string; draftId: string | null; influencerHandle: string | null }
  | { kind: 'form'; influencerHandle: string | null };

// 있는 원고를 고를 때의 주인 불일치(스펙 §4-3). 서버는 작업의 인플루언서를 우선하고(coalesce)
// 원고의 주인을 작업 값으로 덮어쓰므로, 화면이 그 사실을 먼저 말한다. 막지는 않는다.
export function pickedHandleNotice(
  formHandle: string | null, draftHandle: string | null,
): { fill: string | null; notice: string | null } {
  if (!draftHandle) return { fill: null, notice: null };
  if (!formHandle) return { fill: draftHandle, notice: null };
  if (formHandle.toLowerCase() === draftHandle.toLowerCase()) return { fill: null, notice: null };
  return {
    fill: null,
    notice: `이 원고는 @${draftHandle}으로 쓴 글이에요. @${formHandle} 작업에 붙이면 @${formHandle} 것이 돼요.`,
  };
}
