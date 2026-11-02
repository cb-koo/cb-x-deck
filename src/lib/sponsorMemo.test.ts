// 협찬 메모: 웹 저장(updateClient)·조회(getClientWithProcedures)와 익스텐션 읽기 전용 경로(GET만) 검사. 끝에 롤백한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { getSql } from './db.ts';
import { extensionProductDispatch } from './extensionProductApi.ts';
import { ProductError } from './productCommand.ts';
import { createClient, updateClient, getClientWithProcedures } from './clientStore.ts';
import { testDbTarget } from './testDbGuard.ts';
import type { Member } from './types.ts';

test('협찬 메모는 GET만 있고 PATCH는 404, 저장은 웹 updateClient만', async () => {
  assert.equal(testDbTarget({ ...process.env, ALLOW_PROD_TESTS: undefined }).kind, 'ok', '연습용 DB에서만 실행합니다.');
  const sql = getSql();
  const globals = globalThis as unknown as { __sql?: postgres.Sql };
  const rollback = new Error('검수 데이터 롤백');
  const name = `qa-sponsor-${randomUUID()}`;
  try {
    await assert.rejects(sql.begin(async (tx) => {
      globals.__sql = new Proxy(tx, {
        get(target, property) {
          return property === 'begin' ? (run: (inner: unknown) => unknown) => target.savepoint(run) : Reflect.get(target, property);
        },
      }) as unknown as postgres.Sql;
      const [actor] = await tx<Member[]>`insert into member (name, color) values (${name}, '#1d9bf0') returning *`;
      const client = await createClient(tx as unknown as postgres.Sql, name);
      const call = (method: string, id: string) => {
        const path = `clients/${id}/sponsor-memo`;
        const headers = new Headers({ 'content-type': 'application/json', 'idempotency-key': randomUUID() });
        return extensionProductDispatch(new Request(`http://localhost:3000/api/extension-product/${path}`, {
          method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify({ memo: '덮어쓰기 시도' }) }),
        }), path.split('/'), actor);
      };
      const notFound = (e: unknown) => e instanceof ProductError && e.status === 404;

      // 새 클라이언트는 빈 메모
      assert.deepEqual((await call('GET', client.id)).data, { memo: '' });
      // 웹 저장 — 줄바꿈·앞뒤 공백을 그대로 보존
      const memo = '• 리쥬란 2cc — 15만\n\n  • 보톡스 — 무료\n';
      await updateClient(tx as unknown as postgres.Sql, client.id, { sponsorMemo: memo });
      assert.equal((await getClientWithProcedures(tx as unknown as postgres.Sql, client.id))?.client.sponsorMemo, memo);
      assert.deepEqual((await call('GET', client.id)).data, { memo });
      // 다른 필드만 고치면 메모는 그대로, 빈 문자열은 비우기
      await updateClient(tx as unknown as postgres.Sql, client.id, { info: '소개' });
      assert.equal((await getClientWithProcedures(tx as unknown as postgres.Sql, client.id))?.client.sponsorMemo, memo);
      await updateClient(tx as unknown as postgres.Sql, client.id, { sponsorMemo: '' });
      assert.deepEqual((await call('GET', client.id)).data, { memo: '' });
      // 익스텐션 경로에는 쓰기가 없다
      for (const method of ['PATCH', 'PUT', 'POST', 'DELETE']) await assert.rejects(call(method, client.id), notFound, method);
      // 없는 클라이언트 / uuid 아님
      await assert.rejects(call('GET', randomUUID()), notFound);
      await assert.rejects(call('GET', 'nope'), notFound);
      throw rollback;
    }), (error) => error === rollback);
  } finally {
    globals.__sql = sql;
    await sql.end();
    delete globals.__sql;
  }
});
