// scripts/smoke-external-api.ts — 사용: node --import tsx scripts/smoke-external-api.ts <BASE_URL> <API_KEY>
// 스테이징에서 외부 API 계약을 처음부터 끝까지 한 번 돈다(스펙 §9). 마지막 표에서 ✗가 하나라도 있으면 exit 1.
const [base, key] = process.argv.slice(2);
if (!base || !key) { console.error('사용: smoke-external-api.ts <BASE_URL> <API_KEY>'); process.exit(2); }
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
type Row = { step: string; expect: string; got: string; ok: boolean };
const rows: Row[] = [];
const check = (step: string, expect: number, got: number, extra = '') => rows.push({ step, expect: String(expect), got: `${got}${extra ? ' ' + extra : ''}`, ok: expect === got });

// 이 프로젝트는 package.json에 "type":"module"이 없어 최상위 await를 tsx/esbuild가 cjs로 트랜스폼하지 못한다 — 다른 scripts/*.ts와 동일하게 async IIFE로 감싼다
(async () => {
  const r0 = await fetch(`${base}/api/external/settlement/requests?limit=2`);
  check('키 없음 → 401', 401, r0.status);
  const r1 = await fetch(`${base}/api/external/settlement/requests?limit=2`, { headers: H });
  const j1 = await r1.json();
  check('목록 1페이지', 200, r1.status, `items=${j1.items?.length} has_more=${j1.has_more}`);
  const r2 = await fetch(`${base}/api/external/settlement/requests?limit=2&cursor=${encodeURIComponent(j1.next_cursor)}`, { headers: H });
  const j2 = await r2.json();
  check('커서 이어받기', 200, r2.status, `items=${j2.items?.length}`);
  const target = j1.items?.find((it: { status: string; settlement: { status: string | null } }) => it.status === 'requested' && !it.settlement.status) ?? j1.items?.[0];
  if (!target) { console.error('요청이 없어요 — 먼저 npm run seed:staging'); process.exit(1); return; }
  const id = target.request_id;
  const r3 = await fetch(`${base}/api/external/settlement/requests/${id}`, { headers: H });
  check('단건', 200, r3.status);
  const now = new Date().toISOString();
  const post = (body: unknown) => fetch(`${base}/api/external/settlement/requests/${id}/status`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const r4 = await post({ status: 'received', updated_at: now, external_id: 'SMOKE-1' });
  check('received 적용', 200, r4.status, `applied=${(await r4.json()).applied}`);
  const r5 = await post({ status: 'received', updated_at: now, external_id: 'SMOKE-1' });
  check('같은 본문 재전송 → applied:false', 200, r5.status, `applied=${(await r5.json()).applied}`);
  const r6 = await post({ status: 'paid', updated_at: new Date(Date.now() + 1000).toISOString(), paid_at: now });
  check('paid인데 금액 없음 → 400', 400, r6.status, `field=${(await r6.json()).field}`);
  const r7 = await post({ status: 'paid', updated_at: new Date(Date.now() + 2000).toISOString(), paid_amount_krw: target.amount_krw - 300, paid_at: now, note: '스모크 — 환율 차이' });
  check('paid 적용', 200, r7.status);
  const r8 = await post({ status: 'scheduled', updated_at: new Date(Date.now() + 3000).toISOString() });
  check('paid 이후 다른 상태 → 409', 409, r8.status, `code=${(await r8.json()).code}`);
  const r9 = await fetch(`${base}/api/external/settlement/requests/00000000-0000-0000-0000-000000000000`, { headers: H });
  check('없는 id → 404', 404, r9.status);

  console.table(rows.map((r) => ({ 단계: r.step, 기대: r.expect, 결과: r.got, 판정: r.ok ? '✓' : '✗' })));
  console.log(`대상 요청: ${id} — 스테이징 요청 내역에서 '지급 완료' 배지·실지급 차이(−300)를 확인하세요.`);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
})();
