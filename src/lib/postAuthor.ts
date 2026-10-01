// 게시물 작성자 = 배정 인플 판정(순수 함수) — 스펙 2026-09-30-post-author-guard-design.md §2·§4.
// 09-30 운영 사고(더스퀘어치과 @Rinnabiyou417 작업에 @Qni6F의 게시물이 붙음)의 재발 방지.
//
// 작성자는 링크 주소 속 핸들이 아니라 X에서 받아 온 실제 작성자(fetchPost)를 쓴다 — 주소 속 핸들은
// 핸들을 바꾼 인플의 옛 링크에 옛 핸들이 남아 있어도 X가 열어 준다(coco_______5 사례).

export type AuthorVerdict =
  | { kind: 'ok' }
  | { kind: 'mismatch'; authorHandle: string; assignedHandle: string }
  | { kind: 'unverified' }
  | { kind: 'unassigned' };

export type AuthorCode = 'author-mismatch' | 'author-unverified' | 'task-unassigned';

// 메시지에 심을 때 앞의 @를 한 번만 붙이기 위해 벗긴다(brief: "no double @").
function stripAt(handle: string): string {
  return handle.startsWith('@') ? handle.slice(1) : handle;
}

// 핸들 비교는 대소문자·앞의 @ 무시(명부 밖 핸들·고유번호 미저장 계정을 위한 폴백 경로).
function sameHandle(a: string, b: string): boolean {
  return stripAt(a).toLowerCase() === stripAt(b).toLowerCase();
}

export function judgePostAuthor(input: {
  author: { handle: string | null; userId: string | null } | null; // null = 조회 실패
  assigned: { handle: string | null; xUserId: string | null }; // handle null = 미배정
}): AuthorVerdict {
  const { author, assigned } = input;

  // 미배정이 최우선 — 누구의 게시물인지 비교할 대상 자체가 없다.
  if (assigned.handle === null) return { kind: 'unassigned' };

  // X 조회 실패(연동 오류·삭제·비공개·기형 응답) — koo 결정: 확인 안 된 링크는 막는다.
  if (author === null) return { kind: 'unverified' };

  // 둘 다 고유번호가 있으면 고유번호로(핸들 변경에 안전 — coco 사례).
  if (author.userId !== null && assigned.xUserId !== null) {
    if (author.userId === assigned.xUserId) return { kind: 'ok' };
    return {
      kind: 'mismatch',
      authorHandle: author.handle ?? author.userId,
      assignedHandle: assigned.handle,
    };
  }

  // 고유번호 비교가 안 되면 핸들로(명부 밖 핸들·고유번호 미저장 계정) — 작성자 핸들이 없으면 비교 불가.
  if (author.handle === null) return { kind: 'unverified' };

  if (sameHandle(author.handle, assigned.handle)) return { kind: 'ok' };
  return { kind: 'mismatch', authorHandle: author.handle, assignedHandle: assigned.handle };
}

// ── 거절 문구 (사용자 말, AGENTS 원칙 1·3 / spec §4) ──

export function authorVerdictMessage(v: Exclude<AuthorVerdict, { kind: 'ok' }>): { error: string; code: AuthorCode } {
  switch (v.kind) {
    case 'mismatch':
      return {
        error: `이 게시물은 @${stripAt(v.authorHandle)}의 글이에요. 이 작업의 인플은 @${stripAt(v.assignedHandle)}이에요 — 링크를 확인해 주세요`,
        code: 'author-mismatch',
      };
    case 'unverified':
      return {
        error: '게시물 작성자를 확인하지 못했어요 — 링크가 맞는지 보고 잠시 후 다시 시도해 주세요',
        code: 'author-unverified',
      };
    case 'unassigned':
      return {
        error: '인플을 먼저 배정해 주세요 — 누구의 게시물인지 확인할 수 없어요',
        code: 'task-unassigned',
      };
  }
}

// 게시물이 붙은 미배정 작업의 최초 배정 거절(spec §3 ⑤ 예외 경로 전용) — mismatch와 같은 모양이지만
// "이 작업에 붙은 게시물은"으로 시작해 이미 링크가 붙어 있는 맥락임을 알린다.
export function firstAssignMismatchMessage(authorHandle: string): string {
  return `이 작업에 붙은 게시물은 @${stripAt(authorHandle)}의 글이에요 — 그 인플로 배정해 주세요`;
}

// ── 저장된 작성자 + (미리) 받아 온 실제 작성자로 판정 — 네트워크 없이(트랜잭션 안에서 쓸 수 있게) ──
// 조회는 호출자가 트랜잭션 밖에서 한다(postAttach). 여기는 그 결과로 판정만.

export type LiveAuthor = { handle: string | null; userId: string | null };

// live: 받아 온 실제 작성자 / 'failed' 조회 실패 / undefined 조회 안 함(둘은 같게 다룬다).
// 실제 작성자가 있으면 그걸로. 없으면 명부 고유번호가 없을 때만 저장된 핸들로 본다 — 고유번호가 있으면
// 저장값(핸들)으로는 번호를 비교할 수 없어 확인 불가(unverified, koo 결정: 막는다).
export function judgeStoredAuthor(
  assigned: { handle: string | null; xUserId: string | null },
  storedHandle: string | null,
  live: LiveAuthor | 'failed' | undefined,
): AuthorVerdict {
  if (assigned.handle === null) return { kind: 'unassigned' };
  if (live !== undefined && live !== 'failed') return judgePostAuthor({ author: live, assigned });
  if (assigned.xUserId === null && storedHandle) return judgePostAuthor({ author: { handle: storedHandle, userId: null }, assigned });
  return { kind: 'unverified' };
}

// 저장값만으로 통과하지 못하면 실제 작성자를 받아 와야 한다(명부 고유번호 비교·옛 핸들 구제).
export function needsLiveAuthor(assigned: { handle: string | null; xUserId: string | null }, storedHandle: string | null): boolean {
  return assigned.handle !== null && judgeStoredAuthor(assigned, storedHandle, undefined).kind !== 'ok';
}
