import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import type { Member } from './types.ts';

export class ProductError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export const productMissing = () => new ProductError('RESOURCE_NOT_FOUND', '기록을 찾을 수 없어요. 링크를 다시 확인해 주세요.', 404);
export function expectVersion(actual: number, expected: number) {
  if (actual !== expected) throw new ProductError('VERSION_CONFLICT', '다른 곳에서 내용을 수정했어요. 내 입력은 그대로 두고 최신 내용을 확인한 뒤 다시 저장해 주세요.', 409);
}
export function versionHeader(req: Request): number {
  const value = req.headers.get('if-match')?.replace(/^"|"$/g, '');
  if (!value || !/^[1-9]\d{0,8}$/.test(value)) throw new ProductError('VERSION_REQUIRED', '최신 내용을 불러온 뒤 다시 저장해 주세요.', 428);
  return Number(value);
}
export const jsonValue = (v: unknown) => v as postgres.JSONValue;
export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProductError('INVALID_INPUT', '입력 내용을 확인해 주세요.');
  return value as Record<string, unknown>;
}
export function textValue(value: unknown, label: string, max = 50000): string {
  if (typeof value !== 'string' || value.length > max) throw new ProductError('INVALID_INPUT', `${label} 내용을 확인해 주세요.`);
  return value;
}

// 중복 요청을 먼저 잠근 다음 task → reservation 순서로 잠근다. 실패는 전체 롤백한다.
export async function productOperation<T>(sql: postgres.Sql, actor: Member, req: Request, body: unknown,
  run: (tx: postgres.Sql, operationId: string) => Promise<T>): Promise<T> {
  const key = req.headers.get('idempotency-key');
  if (!key || !/^[A-Za-z0-9_-]{8,120}$/.test(key)) throw new ProductError('IDEMPOTENCY_KEY_REQUIRED', '저장 요청 번호가 없어요. 화면을 다시 열어 주세요.');
  const operation = `${req.method}:${new URL(req.url).pathname.replace(/^\/api\/(?:extension\/v1|extension-product)/, '')}`;
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const operationId = createHash('sha256').update(`${actor.id}:${operation}:${key}`).digest('hex');
  return await sql.begin(async (tx0) => {
    const tx = tx0 as unknown as postgres.Sql;
    await tx`insert into api_idempotency (subject, operation, key, request_hash)
      values (${actor.id}, ${operation}, ${key}, ${hash}) on conflict do nothing`;
    const [saved] = await tx<Array<{ request_hash: string; status: string; response: T }>>`
      select request_hash, status, response from api_idempotency
      where subject = ${actor.id} and operation = ${operation} and key = ${key} for update`;
    if (saved.request_hash !== hash) throw new ProductError('IDEMPOTENCY_KEY_REUSED', '같은 저장 요청에 다른 입력이 들어왔어요. 새 저장 요청으로 다시 시도해 주세요.', 409);
    if (saved.status === 'succeeded') return saved.response;
    const result = await run(tx, operationId);
    await tx`update api_idempotency set status = 'succeeded', http_status = 200, response = ${tx.json(jsonValue(result))}
      where subject = ${actor.id} and operation = ${operation} and key = ${key}`;
    return result;
  }) as T;
}
