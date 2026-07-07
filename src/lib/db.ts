import postgres from 'postgres';

const g = globalThis as unknown as { __sql?: postgres.Sql };

export function getSql(): postgres.Sql {
  if (!g.__sql) {
    g.__sql = postgres({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT ?? 5432),
      username: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: 'require',
      prepare: false,
      max: 5,
    });
  }
  return g.__sql;
}
