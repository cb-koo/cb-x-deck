// npm test가 어느 DB에 붙는지 판정한다. 테스트는 연습용(스테이징)에서만 돌아야 한다.
//
// 왜: 테스트는 자기 데이터를 만들었다 지우는데, 중단되면 운영 DB에 남는다. 2026-08에 그렇게 남은
// 가짜 팀원 15개가 보관함의 멤버 필터에 실제로 노출됐고, 2026-09-09에는 테스트가 만든 정산 요청이
// 그쪽(정산 프로덕트) 폴링에 잡혀 유령 건 10건이 생겼다. 사람이 둘 이상이면 이 사고가 더 자주 난다.
//
// 판정은 순수 함수로 두고(테스트 가능), 프로세스를 끄는 것은 scripts/testGuard.ts가 한다.
const PROD_REF = 'xdwtehjlxsnntsuizxba';   // 운영 Supabase 프로젝트 ref — PGUSER(postgres.<ref>)와 SUPABASE_URL에 나타난다

export type TestDbTarget = { kind: 'ok' } | { kind: 'blocked'; message: string };

export function testDbTarget(env: Record<string, string | undefined>): TestDbTarget {
  if (env.ALLOW_PROD_TESTS === 'on') return { kind: 'ok' };   // 알고 하는 예외 — 운영 데이터 상태를 직접 확인해야 할 때만
  const joined = `${env.PGUSER ?? ''} ${env.PGHOST ?? ''} ${env.SUPABASE_URL ?? ''}`;
  if (joined.includes(PROD_REF)) {
    return { kind: 'blocked', message: '운영 DB를 가리키고 있어요 — 테스트는 연습용(.env.staging)에서 돌려야 해요. 정말 운영에서 돌려야 하면 ALLOW_PROD_TESTS=on 을 붙이세요.' };
  }
  if (!env.PGUSER) {
    return { kind: 'blocked', message: 'DB 접속 정보가 없어요 — 연습용 접속 파일(.env.staging)이 필요해요. 만드는 법은 README의 테스트 항목을 보세요.' };
  }
  return { kind: 'ok' };
}
