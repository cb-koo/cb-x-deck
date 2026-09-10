// 테스트로 바꾼 은행명을 원래 값으로 되돌린다.
// koo 확인(09-09): @suni__fit의 은행은 '국민'이 맞고, 09-07 12:49의 '하나' 변경은 수정 테스트였음.
// 기본은 드라이런 — 실제로 되돌리려면 --apply.
// 실행: node --env-file=.env --import tsx scripts/revert-test-bank.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { findByHandle, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { describeMethod, parsePaymentMethodInput, type PaymentMethod } from '../src/lib/influencerPayment.ts';

const HANDLE = 'suni__fit';
const FIELD = 'bank';
const FROM = '하나';
const TO = '국민';
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  const inf = await findByHandle(sql, HANDLE);
  if (!inf) { console.error(`@${HANDLE}: 명부에 없어요`); await sql.end(); process.exit(1); }
  const [pmRow] = await sql<Array<{ payment_methods: PaymentMethod[] }>>`
    select payment_methods from influencer where id = ${inf.id}`;
  const list = pmRow?.payment_methods ?? [];

  const target = list.find((m) => (m as unknown as Record<string, unknown>)[FIELD] === FROM);
  if (!target) {
    const cur = list.map((m) => `${m.type}:${(m as unknown as Record<string, unknown>)[FIELD] ?? '-'}`).join(', ');
    console.error(`✗ @${HANDLE}: ${FIELD}='${FROM}'인 수단이 없어요 (현재: ${cur || '수단 없음'}) — 이미 되돌려졌거나 값이 달라요.`);
    await sql.end(); process.exit(1);
  }

  const { id: _i, isDefault: _d, updatedAt: _u, ...rest } = target as Record<string, unknown> & { id: string; isDefault: boolean; updatedAt: string };
  const parsed = parsePaymentMethodInput({ ...rest, [FIELD]: TO });
  if (typeof parsed === 'string') { console.error(`✗ 입력 검증 실패 — ${parsed}`); await sql.end(); process.exit(1); }

  console.log(`변경 기록 주체: ${actor.name ?? ACTOR_EMAIL}\n`);
  console.log('── 되돌릴 내용 ──');
  console.log(`@${inf.handle} | ${describeMethod(target)}`);
  console.log(`   ${FIELD}: ${FROM} → ${TO}  (계좌번호·수취인은 그대로)`);

  if (!apply) { console.log('\n드라이런입니다 — 실제로 되돌리려면 --apply를 붙여 다시 실행하세요.'); await sql.end(); return; }

  await updatePaymentMethods(sql, inf.id, { kind: 'update', id: target.id, input: parsed as never }, actor.id);
  console.log(`\n✓ 완료 — 타임라인에 '${FIELD}: ${FROM} → ${TO}' 기록이 남았습니다.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
