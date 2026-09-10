// 슬랙 #f-결제요청-paypal 기준으로 PayPal 결제수단을 명부에 등록한다 (koo 확인 09-09: 노션은 신뢰도 낮고 슬랙이 기준).
// 대상은 아래 5개 검사를 모두 통과한 핸들만 — paypal-register.json에 담았다.
//   ① 지급 완료(💰/✅/🤑) 건이 있다  ② 이메일이 하나로 일관  ③ 수취인 표기가 하나로 일관
//   ④ 명부에 이미 있고 결제수단이 없다  ⑤ 그 이메일을 다른 계정이 쓰지 않는다(DB + 이번 등록 대상 모두)
// 수수료는 '5% 완료 건이 한 번이라도 있으면 부담 대상'으로 본다 — 요청서에서 수수료를 빼먹는 일이 흔해
// '없음'은 누락과 구분되지 않는다(이은석 08-12: 기본은 수수료 없음, 빅 인플·고관여 인플은 자사 부담).
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/import-paypal-methods.ts [--apply]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { findByHandle, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { parsePaymentMethodInput, type PaymentMethod } from '../src/lib/influencerPayment.ts';

interface Row { handle: string; email: string; holder: string; fee: string | null; n: number; seqs: number[]; note?: string }
const ROWS: Row[] = JSON.parse(readFileSync(new URL('../data-work/paypal-register.json', import.meta.url), 'utf8'));
const FEE5 = { mode: 'grossUp', percent: 5 };
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();
  const [actor] = await sql<Array<{ id: string; name: string | null }>>`
    select id, name from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  // 총계를 먼저 찍는다 — 목록이 길어 화면이 잘려도 규모를 오해하지 않도록.
  console.log(`대상 ${ROWS.length}개 (수수료 5% ${ROWS.filter((r) => r.fee).length}개) · 기록 주체 ${actor.name ?? ACTOR_EMAIL}\n`);

  // 이 이메일을 이미 쓰는 계정을 미리 모아 둔다(같은 수취처 감지 — 시스템에 경고가 없어서 여기서 막는다)
  const used = new Map<string, string[]>();
  for (const r of await sql<Array<{ email: string; handle: string }>>`
    select lower(m->>'email') as email, i.handle from influencer i, jsonb_array_elements(i.payment_methods) m
     where m->>'type' = 'paypal' and m->>'email' is not null`)
    used.set(r.email, [...(used.get(r.email) ?? []), r.handle]);

  const plan: Array<{ id: string; row: Row; input: unknown }> = [];
  let errors = 0, skipped = 0;
  const batchMail = new Map<string, string[]>();
  for (const row of ROWS) batchMail.set(row.email.toLowerCase(), [...(batchMail.get(row.email.toLowerCase()) ?? []), row.handle]);

  for (const row of ROWS) {
    const inf = await findByHandle(sql, row.handle);
    if (!inf) { console.error(`✗ @${row.handle}: 명부에 없어요`); errors++; continue; }
    const [cur] = await sql<Array<{ payment_methods: PaymentMethod[] }>>`
      select payment_methods from influencer where id = ${inf.id}`;
    const list = cur?.payment_methods ?? [];
    if (list.some((m) => m.type === 'paypal')) { console.log(`— @${inf.handle}: PayPal이 이미 있어요 (건너뜀)`); skipped++; continue; }
    if (list.length) { console.error(`✗ @${inf.handle}: 다른 수단 ${list.map((m) => m.type).join(',')}이 있어 기본 수단 판단이 필요해요 — 건너뜀`); errors++; continue; }

    const input = parsePaymentMethodInput({
      type: 'paypal', holder: row.holder, currency: 'JPY', email: row.email,
      ...(row.fee ? { fee: FEE5 } : {}),
    });
    if (typeof input === 'string') { console.error(`✗ @${inf.handle}: 검증 실패 — ${input}`); errors++; continue; }

    const share = [...(used.get(row.email.toLowerCase()) ?? []), ...(batchMail.get(row.email.toLowerCase()) ?? []).filter((h) => h !== row.handle)];
    console.log(`@${inf.handle}  ${row.email}  ${row.holder}  수수료 ${row.fee ? '5% 그로스업' : '없음'}`);
    console.log(`   근거: 지급 완료 ${row.n}건 (seq ${row.seqs.join('·')})${row.note ? ' · ' + row.note : ''}`);
    if (share.length) console.log(`   ⚠ 같은 이메일을 쓰는 계정: ${share.map((h) => '@' + h).join(', ')} — 같은 곳으로 송금됩니다`);
    plan.push({ id: inf.id, row, input });
  }

  console.log(`\n── 등록 ${plan.length}건 · 건너뜀 ${skipped}건 · 오류 ${errors}건 ──`);
  if (errors > 0) { console.error('\n오류가 있어 아무것도 반영하지 않았어요.'); await sql.end(); process.exit(1); }
  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면 --apply를 붙여 다시 실행하세요.'); await sql.end(); return; }

  for (const p of plan) {
    await updatePaymentMethods(sql, p.id, { kind: 'add', input: p.input as never, makeDefault: true }, actor.id);
    console.log(`✓ @${p.row.handle}`);
  }
  console.log(`\n완료: ${plan.length}건.`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
