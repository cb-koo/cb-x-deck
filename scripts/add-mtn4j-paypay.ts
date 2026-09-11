// @mtn4j 의 PayPay 결제 수단 등록 (koo 제공 2026-09-11).
//
// 근거: koo가 모에카님의 PayPay 송금 화면 캡처를 공유했다. 화면 상단의 수취인 ID가 **@emaema0925** 다
// (이 사람의 예전 X 핸들과 같다 — 09-10에 X 핸들을 @mtn4j 로 개명했지만 PayPay 표기는 예전 것으로 남았다).
// 캡처의 ¥3,000 송금은 **예전 작업에 대한 정산 결과**이고 이번 9월2주차 건과 무관하다(koo 확인).
//
// 이 계정은 09-10 13:23에 koo가 모에카님께 결제 정보 확인을 요청한 11개 계정 중 하나다
// (슬랙·PayPay 계정 자료로는 확인이 안 됐던 계정들). 그 답으로 받은 값이다.
//
// 값 배정 — 기존 PayPay 18건의 관례를 따른다:
//   identifier = PayPay ID (송금을 라우팅하는 값. 예: barbie_y · momoka6060 · myuta · mxt024)
//   holder     = 수취인 표시명 (본명이 아닌 예도 있다. 예: @lisblanc_15 는 ♡♡♡)
// 🟡 holder 는 캡처 상단에 보이는 표시 문자열을 그대로 쓴다 — 본명은 확인되지 않았다. 메모에 출처를 남겨
//    나중에 바로잡을 수 있게 한다. 송금을 가르는 값은 identifier 이므로 holder 오기로 돈이 새지는 않는다.
//
// PayPay 는 수수료가 없다(4채널 159건 중 157건이 딱 떨어짐) → fee 를 넣지 않는다. 통화는 JPY 고정.
// 앱과 같은 updatePaymentMethods 경로를 쓴다 — payment_method_changed 로그가 남는다.
//
// 기본은 드라이런. 실제 반영은 --apply.
// 실행: node --env-file=.env --import tsx scripts/add-mtn4j-paypay.ts [--apply]
import { getSql } from '../src/lib/db.ts';
import { findByHandle, updatePaymentMethods, getInfluencerDetail } from '../src/lib/influencerStore.ts';
import { parsePaymentMethodInput, describeMethod, type PaymentMethodInput } from '../src/lib/influencerPayment.ts';

const HANDLE = 'mtn4j';
const ACTOR_EMAIL = 'gugeon.park@clinicbridge.co.kr';

const RAW = {
  type: 'paypay',
  holder: 'emaema0925🤍',          // 캡처 상단 표시 문자열 — 본명 미확인(메모 참조)
  identifier: 'emaema0925',        // ⭐ PayPay ID — koo가 캡처에서 지목한 값
  currency: 'JPY',                 // paypay 는 무엇을 보내도 JPY 고정
  memo: 'PayPay ID는 모에카님 송금 화면 캡처 상단의 수취인 ID(@emaema0925) — koo 제공 2026-09-11. X 핸들은 09-10에 @mtn4j 로 개명했으나 PayPay 표기는 예전 핸들로 남아 있다. 수취인명은 캡처에 보이는 표시 문자열이고 본명은 미확인 — 확인되면 고칠 것.',
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = getSql();

  const [actor] = await sql<Array<{ id: string }>>`
    select id from member where lower(email) = ${ACTOR_EMAIL.toLowerCase()} limit 1`;
  if (!actor) { console.error(`멤버를 못 찾았어요: ${ACTOR_EMAIL}`); await sql.end(); process.exit(2); }

  const inf = await findByHandle(sql, HANDLE);
  if (!inf) { console.error(`✗ @${HANDLE}: 명부에 없어요`); await sql.end(); process.exit(1); }

  // 앱과 같은 검증을 통과하는지 먼저 본다 — 문자열이면 통과하는 구조가 아니다
  const parsed = parsePaymentMethodInput(RAW);
  if (typeof parsed === 'string') { console.error(`✗ 입력 검증 실패: ${parsed}`); await sql.end(); process.exit(1); }
  const input = parsed as PaymentMethodInput;

  const detail = await getInfluencerDetail(sql, inf.id);
  const existing = detail?.paymentMethods ?? [];
  const dupe = existing.find((m) => m.type === 'paypay');
  if (dupe) {
    console.error(`✗ @${inf.handle}: PayPay 수단이 이미 있어요(${describeMethod(dupe)}) — 추가가 아니라 수정이어야 합니다.`);
    await sql.end(); process.exit(1);
  }

  console.log(`@${inf.handle} (${inf.displayName ?? '표시이름 없음'} · 팔로워 ${inf.followersCount ?? '-'})`);
  console.log(`현재 결제수단 ${existing.length}개${existing.length ? ' — ' + existing.map(describeMethod).join(' · ') : ' (없음)'}\n`);
  console.log('넣을 값');
  console.log(`   유형        PayPay`);
  console.log(`   수취인명    ${input.holder}   🟡 캡처의 표시 문자열(본명 미확인)`);
  console.log(`   식별값      ${input.identifier}   ⭐ 송금을 가르는 값`);
  console.log(`   통화        ${input.currency} (고정)`);
  console.log(`   수수료      없음 (PayPay 관례)`);
  console.log(`   라벨        ${describeMethod({ ...input, id: 'x', isDefault: true, updatedAt: new Date().toISOString() })}`);
  console.log(`   메모        ${input.memo}`);
  console.log(`\n첫 수단이라 기본 수단이 됩니다.`);
  console.log('반영되면 이 계정의 작업 2건(마인드스킨 인용RT 3만원 · 미모드림 RT 2만원)이 정산 요청 가능해집니다.');

  if (!apply) { console.log('\n드라이런입니다 — 실제로 반영하려면 --apply'); await sql.end(); return; }

  const res = await updatePaymentMethods(sql, inf.id, { kind: 'add', input, makeDefault: true }, actor.id);
  console.log(`\n✓ 등록 완료 — 수단 ${res.paymentMethods.length}개 · 로그 ${res.logs.length}건`);
  for (const m of res.paymentMethods) {
    console.log(`   ${describeMethod(m)}${m.isDefault ? ' (기본)' : ''} · 식별값 ${m.type === 'paypay' ? m.identifier ?? '(없음)' : '-'}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
