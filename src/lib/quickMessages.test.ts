// 실제 저장 경로를 연습용 DB에서 검사한다. 생성·수정·삭제와 요청 기록은 마지막에 모두 롤백한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { getSql } from './db.ts';
import { extensionProductDispatch } from './extensionProductApi.ts';
import { ProductError } from './productCommand.ts';
import { testDbTarget } from './testDbGuard.ts';
import type { Member } from './types.ts';

test('빠른 메시지 삭제: 버전·중복 요청 보호와 실제 목록 반영', async (t) => {
  assert.equal(testDbTarget({ ...process.env, ALLOW_PROD_TESTS: undefined }).kind, 'ok', '연습용 DB에서만 실행합니다.');
  const sql = getSql();
  const globals = globalThis as unknown as { __sql?: postgres.Sql };
  const rollback = new Error('검수 데이터 롤백');
  const title = `qa-quick-message-${randomUUID()}`;
  try {
    await assert.rejects(sql.begin(async (tx) => {
      // 업무 처리의 개별 트랜잭션을 savepoint로 실행해 최상위 롤백에 포함한다.
      globals.__sql = new Proxy(tx, {
        get(target, property) {
          return property === 'begin' ? (run: (inner: unknown) => unknown) => target.savepoint(run) : Reflect.get(target, property);
        },
      }) as unknown as postgres.Sql;
      const [actor] = await tx<Member[]>`insert into member (name, color) values (${title}, '#1d9bf0') returning *`;
      async function call(method: string, id = '', options: { body?: unknown; version?: number; key?: string; omitKey?: boolean } = {}) {
        const headers = new Headers({ 'content-type': 'application/json' });
        if (!options.omitKey) headers.set('idempotency-key', options.key ?? randomUUID());
        if (options.version !== undefined) headers.set('if-match', `"${options.version}"`);
        const path = `quick-messages${id ? `/${id}` : ''}`;
        return extensionProductDispatch(new Request(`http://localhost:3000/api/extension-product/${path}`, {
          method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        }), path.split('/'), actor);
      }
      const input = { title, language: 'JA', body: '검수용 메시지', order: 0, active: true };
      const created = await call('POST', '', { body: input });
      assert.equal(created.status, 201);
      const item = created.data as { id: string; version: number };
      const rejects = (code: string, status: number) => (error: unknown) => error instanceof ProductError && error.code === code && error.status === status;
      await t.test('버전이 없으면 삭제하지 않는다', async () => {
        await assert.rejects(call('DELETE', item.id), rejects('VERSION_REQUIRED', 428));
      });
      await t.test('요청 번호가 없으면 삭제하지 않는다', async () => {
        await assert.rejects(call('DELETE', item.id, { version: item.version, omitKey: true }), rejects('IDEMPOTENCY_KEY_REQUIRED', 400));
      });
      const updated = await call('PATCH', item.id, { body: { ...input, body: '다른 담당자가 수정한 내용' }, version: item.version });
      const current = updated.data as { version: number };
      await t.test('수정 전 버전으로는 삭제하지 않는다', async () => {
        await assert.rejects(call('DELETE', item.id, { version: item.version }), rejects('VERSION_CONFLICT', 409));
        const [saved] = await tx`select body from quick_message where id = ${item.id}`;
        assert.equal(saved.body, '다른 담당자가 수정한 내용');
      });
      const deleteKey = randomUUID();
      await t.test('최신 버전으로 삭제하면 조회 목록에서도 사라진다', async () => {
        assert.deepEqual((await call('DELETE', item.id, { version: current.version, key: deleteKey })).data, { deleted: true });
        const list = (await call('GET')).data as { items: Array<{ id: string }> };
        assert.equal(list.items.some((entry) => entry.id === item.id), false);
        assert.equal((await tx`select id from quick_message where id = ${item.id}`).length, 0);
      });
      await t.test('동일 삭제 요청 재시도는 같은 성공 결과다', async () => {
        assert.deepEqual((await call('DELETE', item.id, { version: current.version, key: deleteKey })).data, { deleted: true });
      });
      await t.test('새 요청으로 삭제된 기록을 다시 지우면 찾을 수 없다고 알린다', async () => {
        await assert.rejects(call('DELETE', item.id, { version: current.version }), rejects('RESOURCE_NOT_FOUND', 404));
      });
      throw rollback;
    }), (error) => error === rollback);
    assert.equal((await sql`select id from member where name = ${title}`).length, 0);
    assert.equal((await sql`select id from quick_message where title = ${title}`).length, 0);
  } finally {
    globals.__sql = sql;
    await sql.end();
    delete globals.__sql;
  }
});
