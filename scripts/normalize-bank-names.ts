// 계좌이체 수단의 은행명 표기를 통일한다 — 은행/銀行 접미사를 반드시 포함(koo 결정 09-09).
// 규칙으로 자동 붙이지 않고 명시 매핑만 적용한다 — 농협·카카오뱅크처럼 접미사가 없는 게 정상인 이름을 잘못 고치지 않기 위해.
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/normalize-bank-names.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { parsePaymentMethodInput, type PaymentMethod } from '../src/lib/influencerPayment.ts';

// 고칠 값만 명시한다. 왼쪽이 현재 DB 값, 오른쪽이 통일된 표기.
const MAP: Record<string, string> = {
  '신한': '신한은행',
  '국민': '국민은행',
  '三菱UFJ': '三菱UFJ銀行',
};
// 접미사가 없어도 정상인 이름(고치지 않음) — 새 이름이 나오면 여기에 추가할지 판단한다.
const OK_WITHOUT_SUFFIX = new Set(['농협', '카카오뱅크', '케이뱅크', '토스뱅크', 'JAバンク', 'ゆうちょ']);
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  const rows = await sql<Array<{ id: string; handle: string; payment_methods: PaymentMethod[] }>>`
    select id, handle, payment_methods from influencer
     where payment_methods @> '[{"type":"bank"}]'::jsonb order by handle`;

  const plan: Array<{ id: string; handle: string; m: PaymentMethod; from: string; to: string }> = [];
  const unknown: string[] = [];
  for (const r of rows) {
    for (const m of r.payment_methods) {
      if (m.type !== 'bank' || !m.bank) continue;
      const to = MAP[m.bank];
      if (to) { plan.push({ id: r.id, handle: r.handle, m, from: m.bank, to }); continue; }
      // 매핑에 없는데 접미사도 없으면 사람이 봐야 한다
      if (!/은행$|銀行$/.test(m.bank) && !OK_WITHOUT_SUFFIX.has(m.bank)) unknown.push(`@${r.handle}: "${m.bank}"`);
    }
  }

  console.log('── 통일할 은행명 ──');
  for (const p of plan) console.log(`@${p.handle}: ${p.from} → ${p.to}  (계좌번호·예금주·수수료 그대로)`);
  console.log(`\n대상 ${plan.length}건`);
  if (unknown.length) {
    console.log('\n⚠ 매핑에 없고 접미사도 없는 은행명 — 사람이 확인해야 합니다:');
    for (const u of unknown) console.log(`   ${u}`);
  }
  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면 --apply를 붙여 다시 실행하세요.'); await sql.end(); return; }

  for (const p of plan) {
    const { id: _i, isDefault: _d, updatedAt: _u, ...rest } = p.m as Record<string, unknown> & { id: string; isDefault: boolean; updatedAt: string };
    const input = parsePaymentMethodInput({ ...rest, bank: p.to });
    if (typeof input === 'string') { console.error(`✗ @${p.handle}: 검증 실패 — ${input}`); continue; }
    await updatePaymentMethods(sql, p.id, { kind: 'update', id: p.m.id, input: input as never }, actor.id);
    console.log(`✓ @${p.handle} ${p.from} → ${p.to}`);
  }
  console.log(`\n완료: ${plan.length}건.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
