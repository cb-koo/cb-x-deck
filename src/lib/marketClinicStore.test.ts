import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSql } from './db.ts';
import { collectMarket, rebuildView, readView, readCrm, makeDongLocator, type ClinicSalesFetch, type ClinicSalesRow } from './marketClinicStore.ts';
import { decodeViewDoc } from './marketClinic.ts';

const sql = getSql();
const P = 'test-mc-';

// 가로세로 1도짜리 행정동 하나(127~128, 37~38)
const geo = { features: [{ properties: { adm_cd2: '9999999999', adm_nm: '테스트시 테스트구 시험동', sgg: '99999' },
  geometry: { type: 'Polygon' as const, coordinates: [[[127, 37], [128, 37], [128, 38], [127, 38], [127, 37]]] } }] };

const row = (id: string, o: Partial<ClinicSalesRow> = {}): ClinicSalesRow => ({
  id: P + id, name: `시험의원${id}`, address: '테스트구 1 (시험동)', region: { sido: '테스트시', gu: '테스트구' },
  location: { lat: 37.5, lng: 127.5 }, areaM2: 100, openedAt: '2020-01-01', doctors: { total: 1, specialist: 1 }, departments: null,
  network: { brand: `시험의원${id}`, branchCount: 1, isChain: false }, attraction: { registered: true, targetCountries: '일본/중국' }, ...o,
});
const sale = (sales: number, foreignSharePct: number) => ({ sales, salesDomestic: null, salesForeign: null, foreignSharePct, visits: null,
  visitsForeign: null, foreignArpu: null, salesPerDoctor: null, salesPerArea: 10, estimateType: '정확값' });

// 피부과만 병원 2곳, 나머지 진료과는 비어 있는 가짜 clinic-sales
const months = ['2026-08', '2026-09'];
const api: ClinicSalesFetch = async (department, month) => {
  // 같은 병원(a)이 성형외과 목록에도 오른다 — 진료과마다 따로 저장해야 한다
  if (department === '성형외과') return { data: [row('a', { latestMonth: month ? sale(70, 30) : null })], months, pagination: { totalPages: 1 } };
  if (department !== '피부과') return { data: [], months, pagination: { totalPages: 1 } };
  const s = (a: number, b: number) => (month === '2026-08' ? sale(a, 5) : month === '2026-09' ? sale(b, 5) : null);
  return { data: [row('a', { latestMonth: s(100, 150) }), row('b', { location: { lat: 10, lng: 10 }, latestMonth: s(50, 40) })], months, pagination: { totalPages: 1 } };
};

after(async () => {
  await sql`delete from market_clinic where id like ${P + '%'}`;
  // 진짜 수집 데이터가 없는 DB(연습용)면 테스트가 만든 완성본도 지운다
  const [{ n }] = await sql`select count(*)::int as n from market_clinic`;
  if (n === 0) await sql`delete from market_map_view`;
  await sql.end();
});

test('수집 — 저장·행정동 찾기·파생 지표·완성본', async () => {
  const r = await collectMarket(sql, api, makeDongLocator(geo), new Date('2026-10-17'));
  assert.deepEqual(r.months, months);
  assert.equal(r.departments['피부과'].clinics, 2);
  assert.equal(r.departments['피부과'].unlocated, 1);  // b는 경계 밖

  const [a] = await sql`select dong, sgg_code, latest_month, derived from market_clinic where dept = '피부과' and id = ${P + 'a'}`;
  assert.equal(a.dong, '시험동');
  assert.equal(a.sgg_code, '99999');
  assert.equal(a.latest_month, '2026-09');
  assert.equal(a.derived.growth, 50);
  const [{ n }] = await sql`select count(*)::int as n from market_clinic_month where dept = '피부과' and clinic_id like ${P + '%'}`;
  assert.equal(n, 4);
  // 여러 진료과에 오른 병원은 진료과마다 한 줄 — 뒤에 받은 진료과가 앞의 것을 덮어쓰지 않는다
  const both = await sql`select dept from market_clinic where id = ${P + 'a'} order by dept`;
  assert.deepEqual(both.map((x) => x.dept), ['성형외과', '피부과']);

  const view = await readView(sql, '피부과');
  const clinics = decodeViewDoc(view!.doc).filter((c) => c.id.startsWith(P));
  assert.equal(clinics.length, 2);
  const ca = clinics.find((c) => c.id === P + 'a')!;
  assert.equal(ca.sales, 150);
  assert.equal(ca.address, '테스트구 1');
  assert.deepEqual(ca.countries, ['일본', '중국']);
});

test('다시 수집해도 같은 줄을 덮어쓴다(중복 없음)', async () => {
  await collectMarket(sql, api, makeDongLocator(geo), new Date('2026-10-17'));
  const [{ n }] = await sql`select count(*)::int as n from market_clinic where id like ${P + '%'}`;
  assert.equal(n, 3); // 피부과 2 + 성형외과 1
  const doc = await rebuildView(sql, '피부과', months);
  assert.equal(doc.rows.filter((r) => String(r[0]).startsWith(P)).length, 2);
});

test('영업 상태 — monthly-report 스키마가 없는 환경이면 빈 결과', async () => {
  const [{ has }] = await sql`select to_regclass('report.clinic') is not null as has`;
  if (has) return; // 그 스키마가 있는 DB에서는 이 확인을 건너뛴다
  assert.deepEqual(await readCrm(sql, '피부과'), {});
});
