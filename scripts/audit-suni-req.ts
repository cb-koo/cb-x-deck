import { getSql } from '../src/lib/db.ts';
async function main(): Promise<void> {
  const sql = getSql();
  const rows = await sql`
    select r.external_id,
           to_char(r.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as created,
           to_char(r.cancelled_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as cancelled,
           r.status, r.cancel_reason, r.external_status, r.external_note,
           r.payment_method->>'bank' as bank_snapshot, r.amount_gross, r.payout_currency
      from payment_request r where lower(r.influencer_handle) = 'suni__fit'
     order by r.created_at`;
  for (const r of rows) {
    console.log(`[${r.created}] ${r.external_id ?? '(미전송)'} | ${r.amount_gross}${r.payout_currency} | 은행 스냅샷: ${r.bank_snapshot}`);
    console.log(`    우리:${r.status}${r.cancelled ? ` (${r.cancelled}, 이유: ${r.cancel_reason ?? '-'})` : ''} | 그쪽:${r.external_status ?? '(미확인)'}${r.external_note ? ` · ${r.external_note}` : ''}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
