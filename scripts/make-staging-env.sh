#!/usr/bin/env bash
# .env.staging.fill 의 비밀번호로 .env.staging 을 만든다. 만든 뒤 fill 파일은 지운다.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.staging.fill ] || { echo ".env.staging.fill 이 없어요"; exit 1; }
set -a; source .env.staging.fill; set +a
[ -n "${STAGING_DB_PASSWORD:-}" ] || { echo "비밀번호가 비어 있어요 — .env.staging.fill 을 채워 주세요"; exit 1; }
cat > .env.staging <<INNER
PGHOST=aws-0-ap-southeast-1.pooler.supabase.com
PGPORT=6543
PGUSER=postgres.zatrinmwpqarjhkarubj
PGDATABASE=postgres
PGPASSWORD=${STAGING_DB_PASSWORD}
STAGING_DB_REF=zatrinmwpqarjhkarubj
SUPABASE_URL=https://zatrinmwpqarjhkarubj.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphdHJpbm13cHFhcmpoa2FydWJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDg5MjEsImV4cCI6MjEwMzUyNDkyMX0.a8gmzLF5c0YOTlKaBvBz0eYVxvB1YaswzHp1g8UbH6U
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphdHJpbm13cHFhcmpoa2FydWJqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzk0ODkyMSwiZXhwIjoyMTAzNTI0OTIxfQ.7uo6fj-04HuS9I2LLGQIqe6utBQqnzgHhHF1baZYfXQ
NEXT_PUBLIC_SUPABASE_URL=https://zatrinmwpqarjhkarubj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphdHJpbm13cHFhcmpoa2FydWJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NDg5MjEsImV4cCI6MjEwMzUyNDkyMX0.a8gmzLF5c0YOTlKaBvBz0eYVxvB1YaswzHp1g8UbH6U
INNER
chmod 600 .env.staging
rm -f .env.staging.fill
echo "== .env.staging 생성 완료 (비밀번호 파일은 삭제했어요)"
echo "== 접속 확인:"
set -a; source .env.staging; set +a
psql -X -At -c "select 'ok ' || current_database() || ' / 테이블 ' || (select count(*) from information_schema.tables where table_schema='public');"
