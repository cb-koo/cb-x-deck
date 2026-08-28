// scripts/seed-staging.ts — 가짜 데이터(스펙 §3-3). 전부 seed_ 접두어, 재실행 시 지우고 다시. 요청은 실제 createRequests로.
import { getSql } from '../src/lib/db.ts';
import { assertStaging } from './stagingGuard.ts';
import { createClient } from '../src/lib/clientStore.ts';
import { createCampaign } from '../src/lib/campaignStore.ts';
import { createTasks, updateTask } from '../src/lib/campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import { SETTLEMENT_DEFAULTS } from '../src/lib/settlementSettings.ts';
import { listCandidates, createRequests, cancelRequest, type CreateItemInput } from '../src/lib/settlementStore.ts';
import type { PaymentMethodInput } from '../src/lib/influencerPayment.ts';

assertStaging(); // DB 연결(getSql) 전에 먼저 — 이 파일 아래는 이 프로젝트 관례대로 async IIFE(package.json에 "type":"module"이 없어 최상위 await를 tsx/esbuild가 cjs로 트랜스폼하지 못한다)

const METHODS: Array<{ handle: string; pm: PaymentMethodInput }> = [
  { handle: 'seed_' + 'sakura_p', pm: { type: 'paypal', holder: 'SAKURA TEST', currency: 'JPY', email: 'seed_sakura@example.com', fee: { mode: 'grossUp', percent: 5 } } },
  { handle: 'seed_' + 'yuki_pp', pm: { type: 'paypay', holder: 'YUKI TEST', currency: 'JPY', identifier: 'seed-paypay-0000' } },
  { handle: 'seed_' + 'hana_jp', pm: { type: 'bank', holder: 'HANA TEST', currency: 'JPY', bank: 'テスト銀行', branch: '000', account: '0000000', fee: { mode: 'fixed', amount: 165 } } },
  { handle: 'seed_' + 'minji_kr', pm: { type: 'bank', holder: '민지 테스트', currency: 'KRW', bank: '테스트은행', account: '000-0000-0000' } },
  { handle: 'seed_' + 'rin_p', pm: { type: 'paypal', holder: 'RIN TEST', currency: 'JPY', paypalId: 'seedrin' } },
  { handle: 'seed_' + 'aoi_kr', pm: { type: 'bank', holder: '아오이 테스트', currency: 'KRW', bank: '테스트은행', account: '111-1111-1111' } },
];
// PaymentMethodType 값('paypal'|'paypay'|'bank' 등)은 src/lib/influencerPayment.ts의 실제 타입에 맞춘다.

(async () => {
  const sql = getSql();
  const S = 'seed_';

  async function wipe() {
    await sql`delete from payment_request where influencer_handle like ${S + '%'}`;
    await sql`delete from campaign_task where campaign_id in (select id from campaign where name like ${S + '%'})`;
    await sql`delete from campaign where name like ${S + '%'}`;
    await sql`delete from client where name like ${S + '%'}`;
    await sql`delete from influencer_log where influencer_id in (select id from influencer where handle like ${S + '%'})`;
    await sql`delete from influencer where handle like ${S + '%'}`;
    await sql`delete from member where email like ${S + '%'}`;
  }

  await wipe();
  const [m1] = await sql<Array<{ id: string; name: string }>>`insert into member (name, color, email) values ('시드 모에카', '#1d9bf0', ${S + 'moeka@example.com'}) returning id, name`;
  await sql`insert into member (name, color, email, slack_id) values ('시드 권오윤', '#f91880', ${S + 'oyun@example.com'}, 'U000SEED')`;
  const clients = await Promise.all(['seed_마인드피부과', 'seed_라온성형외과', 'seed_봄빛의원'].map((n) => createClient(sql, n)));
  for (const { handle, pm } of METHODS) {
    const { row } = await createInfluencer(sql, { handle, createdBy: null });
    await updatePaymentMethods(sql, row.id, { kind: 'add', input: pm, makeDefault: true }, null);
  }
  const camp1 = await createCampaign(sql, { clientId: clients[0].id, clientName: clients[0].name, name: S + '8월 방문협찬', nameEn: 'seed-visit-aug', startsOn: '2026-08-24', endsOn: '2026-08-30', kind: 'visit', note: '', createdBy: null });
  const camp2 = await createCampaign(sql, { clientId: clients[1].id, clientName: clients[1].name, name: S + '여름 프로모션', nameEn: 'seed-summer-promo', startsOn: '2026-08-24', endsOn: '2026-09-06', kind: 'content', note: '', createdBy: null });
  const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };
  const posts = await createTasks(sql, camp1.id, { ...tin, type: 'post', items: METHODS.slice(0, 4).map((m, i) => ({ handle: m.handle, cost: { amount: 200000 + i * 10000, currency: 'KRW' } })) });
  const rts = await createTasks(sql, camp2.id, { ...tin, type: 'rt', items: METHODS.map((m, i) => ({ handle: m.handle, cost: { amount: 30000 + i * 1000, currency: 'KRW' } })) });
  for (const [i, t] of [...posts, ...rts].entries()) {
    await updateTask(sql, t.id, { postedAt: '2026-08-27', postedSource: 'manual', postUrl: `https://x.com/${S}${i}/status/${1000 + i}` });
  }
  const cands = await listCandidates(sql, SETTLEMENT_DEFAULTS, m1.id, '2026-08-28');
  const fee = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'fee')!;
  const promo = SETTLEMENT_DEFAULTS.categories.find((k) => k.id === 'promo-rt')!;
  const pick = cands.filter((c) => c.influencerHandle.startsWith(S) && c.money && c.method).slice(0, 6);
  const items: CreateItemInput[] = pick.map((c) => ({
    taskId: c.taskId, category: c.taskType === 'rt' ? promo.sendAs : fee.sendAs, deadlineOn: c.deadlineDefault, referenceUrl: c.referenceDefault,
    expected: { amountGross: c.money!.amountGross, payoutCurrency: c.money!.payoutCurrency, paymentMethodId: c.method!.id },
  }));
  const created = await createRequests(sql, items, { id: m1.id, name: m1.name }, '2026-08-28');
  await cancelRequest(sql, created[4].id, '금액 착오 — 다시 요청 예정', { id: m1.id, name: m1.name });
  await cancelRequest(sql, created[5].id, '인플루언서 요청으로 취소', { id: m1.id, name: m1.name });
  console.log(`시드 완료 — 클라 ${clients.length} · 인플 ${METHODS.length} · 작업 ${posts.length + rts.length} · 요청 ${created.length}(취소 2)`);
  await sql.end();
})();
