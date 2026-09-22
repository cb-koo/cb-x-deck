// 빌드 단계에서 DB 마이그레이션을 먼저 적용한다 — ADR 0007.
//
// 왜 빌드인가: Vercel은 빌드를 끝낸 뒤에야 트래픽을 새 배포로 옮긴다. 빌드 중에는 이전 배포가 계속 서비스한다.
// 그래서 여기서 칸을 만들면 "새 칸을 읽는 코드"가 살아나기 전에 칸이 항상 존재한다 — 순서가 구조로 보장된다.
// 실패하면 빌드가 실패하고 배포 자체가 일어나지 않는다(fail closed). 2026-09-21 장애가 이 자리에서 막힌다.
//
// 전제: 마이그레이션은 추가만 한다(AGENTS.md "마이그레이션과 배포 순서").
// 빌드 중에는 새 DB + 옛 코드가 공존하고 롤백하면 다시 그 조합이 되므로, 마이그레이션은 옛 코드와
// 공존해도 안전해야 한다. 칸 추가는 옛 코드가 모르니 무해하지만, 삭제·이름 변경·타입 변경은 옛 코드를
// 깨뜨린다 — 그 변경은 여기서 하지 않고 머지를 나눈다(삭제 2번, 이름·타입 변경 3번). 039가 그 예다.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

// 운영 빌드에서만 돈다. 프리뷰 빌드가 운영 DB를 건드리는 것이 이 방식의 가장 큰 위험이라 첫 관문으로 둔다.
// VERCEL_ENV이 없으면(로컬 npm run build) 건너뛴다 — 로컬 빌드가 운영 DB를 고치면 안 된다.
const VERCEL_ENV = process.env.VERCEL_ENV ?? '(없음: 로컬)';
if (VERCEL_ENV !== 'production') {
  console.log(`[migrate] VERCEL_ENV=${VERCEL_ENV} — 건너뜁니다(운영 빌드에서만 적용).`);
  process.exit(0);
}

// 접속 정보가 없으면 조용히 넘기지 않고 빌드를 멈춘다. 넘기면 2026-09-21과 같은 상태(코드는 나갔는데 칸이 없음)가 된다.
// Vercel 환경변수를 `sensitive`로 등록하면 빌드에서 읽히지 않는다 — 그 실수도 여기서 드러난다.
const missing = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[migrate] 접속 정보가 없어 빌드를 멈춥니다: ${missing.join(', ')}`);
  console.error('[migrate] Vercel 환경변수가 sensitive로 등록되면 빌드에서 읽히지 않습니다 — encrypted로 바꿔 주세요.');
  process.exit(1);
}

let notices = 0;
const LOCK_KEY = 20260921; // 동시 빌드가 같은 DB에 겹쳐 돌지 않게 하는 고정 키(ADR 0007 날짜)

async function main() {
  const dir = path.join(process.cwd(), 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) {
    console.error('[migrate] migrations/*.sql 을 찾지 못해 빌드를 멈춥니다.');
    process.exit(1);
  }

  const sql = postgres({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    username: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: 'require',
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 30,
    // 멱등 문장(`if not exists`)은 이미 있으면 NOTICE를 뱉는다. 57개 파일이면 수백 줄이 되어
    // 빌드 로그에서 정작 중요한 실패 메시지가 묻힌다 — 건수만 세고 본문은 버린다(오류는 throw로 온다).
    onnotice: () => { notices += 1; },
  });

  const started = Date.now();
  try {
    const [{ db }] = await sql`select current_database() as db`;
    console.log(`[migrate] 대상 ${db} (${process.env.PGHOST}:${process.env.PGPORT ?? 5432}) · 파일 ${files.length}개`);

    // 전부 한 트랜잭션에 넣는다 — 하나라도 실패하면 아무것도 적용되지 않는다(Postgres는 DDL도 트랜잭션에 든다).
    // 잠금은 pg_advisory_xact_lock을 쓴다: PGPORT 6543(트랜잭션 모드 풀러)에서는 세션 단위 잠금이
    // 커넥션 멀티플렉싱 때문에 신뢰할 수 없고, 트랜잭션 단위 잠금은 트랜잭션이 커넥션을 붙잡고 있어 안전하다.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${LOCK_KEY})`;
      for (const f of files) {
        const text = await readFile(path.join(dir, f), 'utf8');
        if (!text.trim()) continue;
        await tx.unsafe(text).simple();
        console.log(`[migrate]   적용 ${f}`);
      }
    });
    console.log(`[migrate] 완료 — ${files.length}개 파일, ${((Date.now() - started) / 1000).toFixed(1)}초, 이미 적용돼 건너뛴 문장 ${notices}건`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('[migrate] 실패 — 빌드를 멈춥니다:', e?.message ?? e);
  process.exit(1);
});
