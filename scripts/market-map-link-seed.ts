// 클리닉 지도 — 병원 ↔ monthly-report 고객·리드 연결을 처음 한 번 채운다(스펙 2026-10-17 §3-2).
// 프로토타입이 쓰던 이름 규칙 파일(~/orca/projects/clinic-map/config/crm-mapping.json, git 제외)을 그대로 읽는다.
//   규칙: { clinics: { [report.clinic.display_name]: [{ name, sido?, gu?, branch? }] }, leads: { [report.lead.clinic_name]: [...] } }
//   name은 clinic-sales 병원 이름, 지점은 sido·gu로 가린다. 규칙 하나는 병원 한 곳에만 맞아야 한다(아니면 ⚠️로 알리고 건너뛴다).
// monthly-report 테이블(report.*)은 읽기만 한다. 다시 돌려도 안전하다(이미 있는 연결은 그대로).
// 실행: node --import tsx --env-file=.env scripts/market-map-link-seed.ts [규칙 파일] [--dry-run]
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { getSql } from '../src/lib/db.ts';

type Rule = { name: string; sido?: string; gu?: string; branch?: string };
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--')) ?? `${homedir()}/orca/projects/clinic-map/config/crm-mapping.json`;

async function main() {
  const mapping = JSON.parse(readFileSync(file, 'utf8')) as { clinics: Record<string, Rule[]>; leads: Record<string, Rule[]> };
  const sql = getSql();
  console.log(`== 대상 DB: ${process.env.PGHOST}${dry ? ' (미리보기 — 쓰지 않음)' : ''}`);
  const [has] = await sql`select to_regclass('report.clinic') is not null and to_regclass('report.lead') is not null as ok`;
  if (!has.ok) { console.log('monthly-report 테이블이 없는 DB예요 — 할 일 없음'); await sql.end(); return; }

  const market = await sql<Array<{ dept: string; id: string; name: string; sido: string; gu: string }>>`select dept, id, name, sido, gu from market_clinic`;
  const reportClinics = await sql<Array<{ id: string; display_name: string }>>`select id, display_name from report.clinic`;
  const leads = await sql<Array<{ id: string; clinic_name: string }>>`
    select l.id, l.clinic_name from report.lead l
    where l.converted_clinic_id is null and exists (select 1 from report.proposal p where p.lead_id = l.id)`;

  const warn: string[] = [];
  const rows: Array<{ dept: string; clinic_id: string; report_clinic_id: string | null; lead_id: string | null; branch: string | null }> = [];
  const resolve = (rules: Rule[], who: string, put: (dept: string, id: string, branch: string | null) => void) => {
    for (const r of rules) {
      const hit = market.filter((m) => m.name === r.name && (!r.sido || m.sido === r.sido) && (!r.gu || m.gu === r.gu));
      const ids = new Set(hit.map((h) => h.id)); // 같은 병원이 여러 진료과에 오르면 진료과마다 연결
      if (ids.size !== 1) { warn.push(`${who} → ${r.name} ${r.sido ?? ''} ${r.gu ?? ''}: ${ids.size}곳 일치(1곳이어야 해요)`); continue; }
      for (const h of hit) put(h.dept, h.id, r.branch ?? null);
    }
  };
  for (const c of reportClinics) {
    const rules = mapping.clinics[c.display_name];
    if (!rules) { warn.push(`고객 ${c.display_name}: 규칙 없음`); continue; }
    resolve(rules, `고객 ${c.display_name}`, (dept, id, branch) => rows.push({ dept, clinic_id: id, report_clinic_id: c.id, lead_id: null, branch }));
  }
  for (const l of leads) {
    const rules = mapping.leads[l.clinic_name];
    if (!rules) { warn.push(`리드 ${l.clinic_name}: 규칙 없음`); continue; }
    resolve(rules, `리드 ${l.clinic_name}`, (dept, id, branch) => rows.push({ dept, clinic_id: id, report_clinic_id: null, lead_id: l.id, branch }));
  }

  console.log(`연결 ${rows.length}개 (고객 ${rows.filter((r) => r.report_clinic_id).length} · 리드 ${rows.filter((r) => r.lead_id).length})`);
  for (const w of warn) console.warn(`⚠️ ${w}`);
  if (!dry && rows.length) {
    const r = await sql`insert into market_clinic_link ${sql(rows)} on conflict do nothing`;
    console.log(`새로 넣음 ${r.count}개`);
  }
  await sql.end();
}
main();
