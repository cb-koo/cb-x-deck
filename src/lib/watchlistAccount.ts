// 인플루언서 컬럼이 저장할 계정(handle + userId)을 확정한다.
// 컬럼 생성(POST)과 수정(PATCH)이 같은 규칙을 써야 해서 여기 한 곳에 둔다.
//
// 라우트가 아니라 이 파일에 두는 이유가 하나 더 있다: 이 저장소엔 API 라우트
// 테스트 하네스가 없어서, 라우트 안에 있는 동안은 "유료 조회를 부르지 않는다"
// 같은 규칙을 코드 리뷰로만 확인할 수 있었다. 조회 함수를 인자로 받으면
// API 키 없이 호출 여부까지 단정할 수 있다.
import { handleParseMessage, parseXHandle } from './xHandle.ts';

/** X 계정 조회. 실서비스에선 `makeClient().getUserInfo`, 테스트에선 스텁이 들어온다. */
export type AccountLookup = (handle: string) => Promise<{ id: string; userName: string }>;

export type WatchlistResolve =
  | { ok: true; handle: string; userId: string }
  | { ok: false; status: 400 | 404 | 502; error: string };

/**
 * @param rawHandle 사용자가 넣은 값 — 핸들·@핸들·프로필 링크·트윗 링크 아무거나
 * @param lookup    계정 조회(비용 유발). 형식이 틀리면 부르지 않는다.
 * @param current   이미 저장돼 있는 계정. 주면 같은 계정일 때 조회를 건너뛴다(수정 경로).
 */
export async function resolveWatchlistAccount(
  rawHandle: string,
  lookup: AccountLookup,
  // 저장된 config를 그대로 넘길 수 있게 느슨한 타입 — 옛 컬럼은 필드가 비어 있을 수 있다.
  current?: { handle?: string | null; userId?: string | null } | null,
): Promise<WatchlistResolve> {
  const parsed = parseXHandle(rawHandle);
  if (!parsed.ok) return { ok: false, status: 400, error: handleParseMessage(parsed.reason) };

  // 같은 계정을 가리키는 대소문자 차이·링크 표기(URL)만으로는 API를 다시 부르지 않는다.
  // 이때 handle과 userId 둘 다 저장된 값을 권위로 돌려준다 — config는 통째로 교체되고
  // 트윗 조회는 userId로 키를 잡으므로, 클라이언트가 실어 보낸 값을 믿으면 제목과
  // 실제 수집 계정이 어긋난다.
  // stored가 비었으면 매칭시키지 않는다 — 빈 값끼리 맞아떨어져 조회를 건너뛰면
  // userId 없는 컬럼이 그대로 저장된다.
  const stored = current?.handle ?? '';
  if (stored && parsed.handle.toLowerCase() === stored.toLowerCase()) {
    return { ok: true, handle: stored, userId: current?.userId ?? '' };
  }

  try {
    const info = await lookup(parsed.handle);
    if (!info.id) return { ok: false, status: 404, error: `계정을 찾을 수 없음: @${parsed.handle}` };
    return { ok: true, handle: info.userName, userId: info.id };
  } catch (e) {
    return { ok: false, status: 502, error: `계정 확인 실패: ${(e as Error).message}` };
  }
}
