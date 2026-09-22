// 057 백필 — 명부 자동 반영 전에 받은 정정(2026-09-21의 7건 등)을 인플루언서 명부에 뒤늦게 반영한다.
// 라이브 경로와 같은 규칙(스펙 2026-09-22 §1·§6): 요청마다 "가장 최근 정정"의 patch를 before(정정 전 스냅샷)로 가린 명부 수단에 병합한다(고친 항목만).
// 멱등: roster_applied=true인 정정은 건너뛴다. 요청당 최신 정정 한 건만 처리한다(옛 정정은 이미 최신에 덮였다).
// 실행(운영/스테이징 접속 파일을 골라): node --import tsx --env-file=.env.staging scripts/backfill-057-roster-sync.ts
//   ※ 운영 7건 반영은 운영 접속으로 1회. 다시 돌려도 안전(멱등).
import type postgres from 'postgres';
import { getSql } from '../src/lib/db.ts';
import { overwriteRosterFromCorrectionInTx } from '../src/lib/influencerStore.ts';
import type { PaymentMethodSnapshot } from '../src/lib/settlementCalc.ts';
import type { PaymentInfoCorrection } from '../src/lib/settlementPaymentCorrection.ts';

async function main() {
  const sql = getSql();
  // 요청마다 아직 명부에 반영 안 된 정정 중 "가장 최근" 것만. 그 요청의 인플루언서·정정 전 스냅샷(before)·바뀐 키(patch)를 가져온다.
  const rows = await sql<Array<{ correction_id: string; request_id: string; influencer_id: string; before: PaymentMethodSnapshot; patch: PaymentInfoCorrection['patch'] }>>`
    select distinct on (c.request_id) c.id as correction_id, c.request_id, p.influencer_id, c.before, c.patch
      from payment_request_payment_correction c
      join payment_request p on p.id = c.request_id
     where c.roster_applied = false
     order by c.request_id, c.created_at desc`;
  console.log(`명부에 뒤늦게 반영할 정정 ${rows.length}건(요청당 최신)`);

  let applied = 0; let skipped = 0;
  for (const r of rows) {
    const res = await sql.begin(async (tx0) => {
      const tx = tx0 as unknown as postgres.Sql;
      const out = await overwriteRosterFromCorrectionInTx(tx, r.influencer_id, r.before, r.patch);
      await tx`update payment_request_payment_correction set roster_applied = ${out.applied}, roster_skip_reason = ${out.skipReason} where id = ${r.correction_id}`;
      return out;
    });
    if (res.applied) applied += 1; else skipped += 1;
    console.log(`  ${r.request_id} · ${res.applied ? '명부 반영' : `건너뜀(${res.skipReason})`}`);
  }
  console.log(`완료: 반영 ${applied}건 · 건너뜀 ${skipped}건`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
