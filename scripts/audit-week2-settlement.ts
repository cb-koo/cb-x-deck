// 읽기 전용 — 앱의 정산 후보 목록(listCandidates)을 그대로 돌려 요청 가능 여부를 본다.
// 내 추측이 아니라 화면·서버가 쓰는 같은 판정이다(effectiveIssues 는 화면에서 사람이 채우는 값만 더 얹는다).
// 실행: node --env-file=.env --import tsx scripts/audit-week2-settlement.ts
import { getSql } from '../src/lib/db.ts';
import { listCandidates, getSettlementSettings } from '../src/lib/settlementStore.ts';

const KOO = 'f121bdef-997b-48f2-ac1f-124925296313';
const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const sql = getSql();
  const settings = await getSettlementSettings(sql);
  const all = await listCandidates(sql, settings, KOO);
  const c = all.filter((x) => x.campaignName.endsWith('_9월2주차'));

  console.log(`9월2주차 정산 후보 ${c.length}건 (전체 후보 ${all.length}건)\n`);
  const byLevel = { ready: 0, warn: 0, blocked: 0 };
  const codes = new Map<string, number>();

  for (const x of c) {
    byLevel[x.readiness]++;
    for (const i of x.issues) codes.set(i.code, (codes.get(i.code) ?? 0) + 1);
    const mark = x.readiness === 'ready' ? '🟢' : x.readiness === 'warn' ? '🟡' : '🔴';
    const issue = x.issues.map((i) => `${i.level === 'blocked' ? '🔴' : '🟡'}${i.code}`).join(' ');
    console.log(`${mark} ${x.campaignName.replace('_9월2주차','').padEnd(8)} @${x.influencerHandle.padEnd(16)} ${x.taskType.padEnd(8)} ${man(x.cost.amount).padStart(7)} ${x.money ? (x.money.amountGross + ' ' + x.method?.currency).padStart(12) : '(계산불가)'.padStart(12)}  ${issue}`);
  }

  console.log(`\n신호등 — 🟢 요청 가능 ${byLevel.ready} · 🟡 경고만(요청 가능) ${byLevel.warn} · 🔴 막힘 ${byLevel.blocked}`);
  console.log('\n막는 사유별:');
  for (const [k, v] of [...codes].sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}건`);

  const sendable = c.filter((x) => x.readiness !== 'blocked');
  const sum = sendable.reduce((a, x) => a + x.cost.amount, 0);
  console.log(`\n지금 보낼 수 있는 것: ${sendable.length}건 · 원가 합 ${man(sum)}`);
  console.log('※ 화면에서 분류(category)를 고르면 no-category 는 풀린다 — DB에 미리 넣는 값이 아니다.');
  const exCat = c.filter((x) => x.issues.every((i) => i.code === 'no-category' || i.level === 'warn'));
  console.log(`   분류만 채우면 되는 것: ${exCat.length}건 · 원가 합 ${man(exCat.reduce((a, x) => a + x.cost.amount, 0))}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
