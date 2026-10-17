// 클리닉 지도 수집을 손으로 한 번 돌린다(처음 채우기·확인용). 평소에는 DB 예약 실행이 /api/market-map/collect를 부른다.
// 실행: CLINIC_SALES_API_KEY=… node --import tsx --env-file=.env.staging scripts/market-map-collect.ts
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { collectMarket, clinicSalesFromEnv, makeDongLocator } from '../src/lib/marketClinicStore.ts';

async function main() {
const sql = getSql();
console.log(`== 대상 DB: ${process.env.PGHOST}`);
const geo = JSON.parse(readFileSync(`${process.cwd()}/public/market-map/dong.geojson`, 'utf8'));
const t0 = Date.now();
const r = await collectMarket(sql, clinicSalesFromEnv(), makeDongLocator(geo));
console.log(JSON.stringify(r, null, 2));
console.log(`== ${Math.round((Date.now() - t0) / 1000)}초`);
await sql.end();
}
main();
