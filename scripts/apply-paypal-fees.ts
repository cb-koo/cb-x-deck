// PayPal 채널 대조 결과 반영 (koo 기준: 최근 거래건 기준).
// 판정은 '완료 리액션(💰/✅/🤑)이 붙은 요청'만 근거로 삼는다 — ❌·❗가 붙은 건은 반려된 요청이라 금액이 실제 지급이 아니다.
//  · @Qni6F      수수료 없음 → 5%   (완료 8건 전부 5%, 마지막 완료 08-27 = 5%. 오늘 테스트로 오판해 되돌린 것을 복원)
//  · @ykss_2141  수수료 없음 → 5%   (6월엔 없음 → 07-30부터 완료 8건 전부 5%, 마지막 완료 08-11 = 5%)
//  · @8_rivi     5% → 수수료 없음   (완료 4건 전부 없음, 마지막 완료 08-12 = 없음. 노션 값이 실제와 불일치)
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/apply-paypal-fees.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { findByHandle, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { parsePaymentMethodInput, describeMethod, type PaymentMethod, type PaymentFee } from '../src/lib/influencerPayment.ts';

const FEE5: PaymentFee = { mode: 'grossUp', percent: 5 } as PaymentFee;
const TARGETS: Array<{ handle: string; to: PaymentFee | null; why: string }> = [
  { handle: 'Qni6F',      to: FEE5, why: '완료 8건 전부 5% · 마지막 완료 08-27 = 5% (seq 508)' },
  { handle: 'ykss_2141',  to: FEE5, why: '07-30부터 완료 8건 전부 5% · 마지막 완료 08-11 = 5% (seq 434)' },
  { handle: '8_rivi',     to: null, why: '완료 4건 전부 수수료 없음 · 마지막 완료 08-12 = 없음 (seq 443)' },
];
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

const label = (f: PaymentFee | null | undefined) =>
  !f ? '없음(인플 부담)' : (f as { mode: string; percent?: number; amount?: number }).mode === 'grossUp'
    ? `${(f as { percent: number }).percent}% 그로스업` : `고정 ${(f as { amount: number }).amount}`;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }
  console.log(`변경 기록 주체: ${actor.name ?? ACTOR_EMAIL}\n`);

  const plan: Array<{ id: string; handle: string; m: PaymentMethod; to: PaymentFee | null }> = [];
  let errors = 0;
  for (const t of TARGETS) {
    const inf = await findByHandle(sql, t.handle);
    if (!inf) { console.error(`✗ @${t.handle}: 명부에 없어요`); errors++; continue; }
    const [row] = await sql<Array<{ payment_methods: PaymentMethod[] }>>`
      select payment_methods from influencer where id = ${inf.id}`;
    const pp = (row?.payment_methods ?? []).filter((m) => m.type === 'paypal');
    if (pp.length !== 1) { console.error(`✗ @${t.handle}: PayPal 수단이 ${pp.length}개 — 사람이 확인해야 해요`); errors++; continue; }
    const m = pp[0];
    if (JSON.stringify(m.fee ?? null) === JSON.stringify(t.to)) {
      console.log(`— @${inf.handle}: 이미 ${label(t.to)} (변화 없음)`); continue;
    }
    console.log(`@${inf.handle} | ${describeMethod(m)}`);
    console.log(`   수수료 ${label(m.fee)} → ${label(t.to)}`);
    console.log(`   근거: ${t.why}`);
    plan.push({ id: inf.id, handle: inf.handle, m, to: t.to });
  }

  console.log(`\n대상 ${plan.length}건 / 오류 ${errors}건`);
  if (errors > 0) { console.error('\n오류가 있어 아무것도 반영하지 않았어요.'); await sql.end(); process.exit(1); }
  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면 --apply를 붙여 다시 실행하세요.'); await sql.end(); return; }

  for (const p of plan) {
    const { id: _i, isDefault: _d, updatedAt: _u, fee: _f, ...rest } = p.m as Record<string, unknown> & { id: string; isDefault: boolean; updatedAt: string; fee: unknown };
    const input = parsePaymentMethodInput(p.to ? { ...rest, fee: p.to } : rest);
    if (typeof input === 'string') { console.error(`✗ @${p.handle}: 검증 실패 — ${input}`); continue; }
    await updatePaymentMethods(sql, p.id, { kind: 'update', id: p.m.id, input: input as never }, actor.id);
    console.log(`✓ @${p.handle} → ${label(p.to)}`);
  }
  console.log(`\n완료: ${plan.length}건.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
