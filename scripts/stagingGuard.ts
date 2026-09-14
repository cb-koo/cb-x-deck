// 스테이징 전용 스크립트의 첫 줄 — 대상 DB가 스테이징 프로젝트가 아니면 즉시 종료. 프로덕션에는 돌 수 없다(스펙 §3-3).
export function assertStaging(): void {
  const ref = process.env.STAGING_DB_REF ?? '';
  const host = process.env.PGHOST ?? '';
  const url = process.env.SUPABASE_URL ?? '';
  if (!ref || (!host.includes(ref) && !url.includes(ref))) {
    console.error(`스테이징이 아니에요 — STAGING_DB_REF(${ref || '없음'})가 PGHOST/SUPABASE_URL에 없어요. .env.staging으로 실행하세요.`);
    process.exit(2);
  }
  if (host.includes('xdwtehjlxsnntsuizxba') || url.includes('xdwtehjlxsnntsuizxba')) {   // 프로덕션 ref — 이중 벽
    console.error('프로덕션 DB예요 — 중단합니다.');
    process.exit(2);
  }
}
