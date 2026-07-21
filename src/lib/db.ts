import postgres from 'postgres';

const g = globalThis as unknown as { __sql?: postgres.Sql; __usageSql?: postgres.Sql };

function connectOpts(overrides: postgres.Options<Record<string, never>>): postgres.Options<Record<string, never>> {
  return {
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    username: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: 'require',
    prepare: false,
    ...overrides,
  };
}

// 앱 실제 쿼리(라우트·페이지 렌더)용 공용 풀.
// 트랜잭션 모드 풀러(PGPORT=6543) 전제 — 커넥션은 쿼리 후 즉시 반납되어 멀티플렉싱된다.
// idle_timeout: 유휴 커넥션을 반납해, 웜 서버리스 인스턴스가 커넥션을 무한정 붙잡아
// 풀러 클라이언트 한도를 소진하는 것을 방지한다(2026-07-21 세션모드 풀 고갈 원인).
export function getSql(): postgres.Sql {
  if (!g.__sql) g.__sql = postgres(connectOpts({ max: 5, idle_timeout: 20 }));
  return g.__sql;
}

// 사용량 기록 전용 풀 — 앱 풀(getSql)과 격리한다.
// recordUsageSafe가 외부 API 호출마다 fire-and-forget insert를 던지는데, 같은 풀을 쓰면
// 그 insert들이 앱 쿼리의 커넥션(max:5)을 뺏어 응답이 느려진다(2026-07-20 프로덕션 저하 원인).
// 배경 작업이므로 max는 작게(2) 잡고, 유휴 커넥션은 빨리 반납한다.
export function getUsageSql(): postgres.Sql {
  if (!g.__usageSql) g.__usageSql = postgres(connectOpts({ max: 2, idle_timeout: 20 }));
  return g.__usageSql;
}
