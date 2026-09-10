// 테스트용으로 넣은 결제수단 수수료를 원래 상태(수수료 없음 = 인플 부담)로 되돌린다.
// koo 확인(09-09): @aik_ooooo·@yuichan___27·@Qni6F의 grossUp 5%는 테스트 목적이었음. 1번(@cie7le PayPay 식별값)은 맞는 값이라 건드리지 않는다.
// 기본은 드라이런 — 실제로 되돌리려면 --apply.
// 실행: node --env-file=.env --import tsx scripts/revert-test-fees.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { findByHandle, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { describeMethod, parsePaymentMethodInput, type PaymentMethod } from '../src/lib/influencerPayment.ts';

const TARGETS = ['aik_ooooo', 'yuichan___27', 'Qni6F'];
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }
  console.log(`변경 기록 주체: ${actor.name ?? ACTOR_EMAIL}\n`);

  const plan: Array<{ id: string; handle: string; methodId: string; input: ReturnType<typeof parsePaymentMethodInput>; label: string; fee: unknown }> = [];
  let errors = 0;

  for (const handle of TARGETS) {
    const inf = await findByHandle(sql, handle);
    if (!inf) { console.error(`✗ @${handle}: 명부에 없어요`); errors++; continue; }
    // InfluencerRow는 개인정보 경계상 결제수단 전체를 싣지 않는다 — import-payment-methods.ts와 같이 직접 읽는다.
    const [pmRow] = await sql<Array<{ payment_methods: PaymentMethod[] }>>`
      select payment_methods from influencer where id = ${inf.id}`;
    const withFee = (pmRow?.payment_methods ?? []).filter((m) => m.fee);
    if (withFee.length === 0) { console.log(`— @${handle}: 수수료가 이미 없어요 (건너뜀)`); continue; }
    for (const m of withFee) {
      const { id: _i, isDefault: _d, updatedAt: _u, fee: _f, ...rest } = m as Record<string, unknown> & { id: string; isDefault: boolean; updatedAt: string; fee: unknown };
      const parsed = parsePaymentMethodInput(rest);
      if (typeof parsed === 'string') { console.error(`✗ @${handle}: 입력 검증 실패 — ${parsed}`); errors++; continue; }
      plan.push({ id: inf.id, handle: inf.handle, methodId: m.id, input: parsed, label: describeMethod(m), fee: m.fee });
    }
  }

  console.log('\n── 되돌릴 내용 ──');
  for (const p of plan) {
    console.log(`@${p.handle} | ${p.label}`);
    console.log(`   수수료 ${JSON.stringify(p.fee)} → (없음 = 인플 부담)`);
  }
  console.log(`\n대상 ${plan.length}건 / 오류 ${errors}건`);

  if (errors > 0) { console.error('\n오류가 있어 아무것도 반영하지 않았어요.'); await sql.end(); process.exit(1); }
  if (!apply) { console.log('\n드라이런입니다 — 실제로 되돌리려면 --apply를 붙여 다시 실행하세요.'); await sql.end(); return; }

  for (const p of plan) {
    await updatePaymentMethods(sql, p.id, { kind: 'update', id: p.methodId, input: p.input as never }, actor.id);
    console.log(`✓ @${p.handle} 되돌림`);
  }
  console.log(`\n완료: ${plan.length}건. 각 계정 타임라인에 'fee: 5% → 빈값' 기록이 남았습니다.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
