// 읽기 전용 — 슬랙 `9월2주차` 스레드 4건을 적재하기 전 대조용 감사. 쓰기 없음.
// 실행: node --env-file=.env --import tsx scripts/audit-week2-load.ts
// 총계를 맨 앞에 찍는다(09-09 교훈: 잘린 출력을 세어 오보한 적 있음).
import { getSql } from '../src/lib/db.ts';

// 슬랙 스레드에서 번호 붙은 답글로 나온 핸들 전체(❌ 제외분 포함 — 명부 유무는 따로 판단)
const HANDLES = [
  // 9월2주차 더스퀘어 정보성 (12건)
  'saachan0013', '2024_0406', '_ebipuripuri', 'u_pa_ojou', 'kawachi_x', 'skysky_ca',
  'ginza_zigoku', 'suni__fit', 'toppogi0102', 'rararanll', '17dsy_', 'asyako0520',
  // 9월2주차 미모드림 정보성 (핸들 있는 6건)
  'select_asari', 'nasu_seikei', 'ddb6q6', 'agu2m0', 'taibanchan', 'chingcehansuki',
  // 9월2주차 마인드 정보성 (3건)
  'qni6f', 'mtn4j',
  // 9월2주차 백수약국 정보성 (10건)
  'ykss_2141', '_oeo1', 'coco__ns_5', 'hinachan___', 'eveniffen', 'femmelaide4',
  'alpacachan_dayo', 'mirineinseoul',
];

async function main(): Promise<void> {
  const sql = getSql();

  const clients = await sql.unsafe(`select id, name from client order by name`);
  const camps = await sql.unsafe(`
    select c.name, c.name_en, c.kind, c.client_name,
           to_char(c.starts_on,'YYYY-MM-DD') as starts_on,
           to_char(c.ends_on,'YYYY-MM-DD') as ends_on,
           (select count(*) from campaign_task t where t.campaign_id = c.id) as tasks
      from campaign c order by c.starts_on, c.name
  `);
  const found = await sql.unsafe(
    `select handle, display_name from influencer where lower(handle) = any($1::text[]) order by lower(handle)`,
    [HANDLES.map((h) => h.toLowerCase())],
  );

  const foundSet = new Set(found.map((r: Record<string, string>) => String(r.handle).toLowerCase()));
  const missing = HANDLES.filter((h) => !foundSet.has(h.toLowerCase()));

  console.log(`총계 — 클라이언트 ${clients.length} · 캠페인 ${camps.length} · 조회 핸들 ${HANDLES.length}(고유 ${new Set(HANDLES.map((h) => h.toLowerCase())).size}) · 명부 있음 ${found.length} · 명부 없음 ${missing.length}`);

  console.log('\n══════════ 클라이언트 ══════════');
  for (const c of clients) console.log(`${c.name}\t${c.id}`);

  console.log('\n══════════ 기존 캠페인 ══════════');
  for (const c of camps) {
    console.log(`${c.starts_on}~${c.ends_on}  ${c.name}  (${c.name_en})  kind=${c.kind ?? '없음'}  클라=${c.client_name ?? '없음'}  작업 ${c.tasks}`);
  }

  console.log('\n══════════ 명부에 없는 핸들 ══════════');
  for (const h of missing) console.log(`@${h}`);

  console.log('\n══════════ 명부에 있는 핸들 ══════════');
  for (const r of found) console.log(`@${r.handle}\t${r.display_name ?? ''}`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
