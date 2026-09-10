// 읽기 전용 — data-work/week2-normalized.json 의 내부 정합성 검산 + 검수표 출력. DB 쓰기 없음.
// 손으로 만든 표라 사람이 세는 대신 기계가 센다. 총계를 맨 앞에 찍는다(09-09 교훈).
// 실행: node --env-file=.env --import tsx scripts/verify-week2.ts [--table]
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { postedOnSeoul } from './tweetDate.ts';

interface Cost { amount: number; currency: string }
interface Task {
  no: number; campaign: string; handle: string; type: string; cost: Cost;
  post_url: string | null; 게시: boolean; 답글일: string; 명부: boolean; note: string;
}
interface Camp {
  key: string; name: string; name_en: string; client_name: string; client_id: string | null;
  starts_on: string; ends_on: string; kind: string; note: string;
  슬랙_비용: { 금주_소진: number | null; 이전주_누적: number | null; 월_예산: number; 원문: string };
  적재_작업수: number; 적재_금액합: number;
}
interface Excluded { no: number; campaign: string; handle: string | null; type: string; amount: number | null; 사유: string; 분류: string }

const DATA = JSON.parse(readFileSync(new URL('../data-work/week2-normalized.json', import.meta.url), 'utf8')) as {
  campaigns: Camp[]; tasks: Task[]; excluded: Excluded[]; clients_to_create: { name: string }[];
};
const man = (n: number) => `${(n / 10000).toLocaleString('ko-KR')}만원`;

async function main(): Promise<void> {
  const { campaigns, tasks, excluded } = DATA;
  const fails: string[] = [];
  const warns: string[] = [];

  const handles = [...new Set(tasks.map((t) => t.handle.toLowerCase()))];
  console.log(`총계 — 캠페인 ${campaigns.length} · 적재 작업 ${tasks.length} · 제외 ${excluded.length} · 번호행 합계 ${tasks.length + excluded.length} · 고유 핸들(적재분) ${handles.length}`);

  // 1) 캠페인별 선언값 vs 실제
  for (const c of campaigns) {
    const mine = tasks.filter((t) => t.campaign === c.key);
    const sum = mine.reduce((a, t) => a + t.cost.amount, 0);
    if (mine.length !== c.적재_작업수) fails.push(`${c.name}: 작업수 선언 ${c.적재_작업수} ≠ 실제 ${mine.length}`);
    if (sum !== c.적재_금액합) fails.push(`${c.name}: 금액합 선언 ${c.적재_금액합} ≠ 실제 ${sum}`);

    // 2) 게시 판정 규칙 검산 — '금주 소진' = 게시 완료분 합
    const posted = mine.filter((t) => t.게시);
    const postedSum = posted.reduce((a, t) => a + t.cost.amount, 0);
    const upTo0909 = posted.filter((t) => t.답글일 <= '2026-09-09').reduce((a, t) => a + t.cost.amount, 0);
    const 금주 = c.슬랙_비용.금주_소진;
    if (금주 === null) {
      warns.push(`${c.name}: 슬랙 금주 소진이 '00만원'(미갱신)인데 게시 완료분이 ${man(postedSum)} 있다 — 부모 메시지가 갱신되지 않았다`);
    } else if (금주 === postedSum) {
      console.log(`  ✓ ${c.name}: 금주 소진 ${man(금주)} = 게시 완료 ${posted.length}건 합`);
    } else if (금주 === upTo0909) {
      console.log(`  ✓ ${c.name}: 금주 소진 ${man(금주)} = 09-09까지 게시분 합 (09-10 추가분 ${man(postedSum - upTo0909)}은 부모 미반영)`);
    } else {
      fails.push(`${c.name}: 금주 소진 ${man(금주)} 이 게시 완료분 ${man(postedSum)}·09-09까지 ${man(upTo0909)} 어느 쪽과도 안 맞는다`);
    }

    // 3) 게시 여부와 post_url 일관성
    for (const t of mine) {
      if (t.게시 !== (t.post_url !== null)) fails.push(`${c.name} ${t.no}.@${t.handle}: 게시=${t.게시} 인데 post_url=${t.post_url ? '있음' : '없음'}`);
      if (!['quoteRt', 'rt', 'post', 'visit'].includes(t.type)) fails.push(`${c.name} ${t.no}.@${t.handle}: 유형 '${t.type}' 이 스키마 화이트리스트에 없다`);
      if (t.cost.amount <= 0 || t.cost.currency !== 'KRW') fails.push(`${c.name} ${t.no}.@${t.handle}: 금액 ${JSON.stringify(t.cost)}`);
      if (t.post_url && !/^https:\/\/x\.com\/[^/]+\/status\/\d+$/.test(t.post_url)) fails.push(`${c.name} ${t.no}.@${t.handle}: post_url 정규형 아님 — ${t.post_url}`);
    }

    // 4) 기간·이름 규칙
    if (c.ends_on < c.starts_on) fails.push(`${c.name}: 종료일이 시작일보다 앞`);
    if (!/^[A-Za-z0-9._-]+$/.test(c.name_en)) fails.push(`${c.name}: 영문 코드 '${c.name_en}' 형식 위반(영어·숫자·._-)`);
    if (c.name.length > 80) fails.push(`${c.name}: 이름 80자 초과`);
    // 실제 게시일(게시물 URL에서 파생)이 캠페인 기간 밖인 작업 — 답글일이 아니다
    const outside = mine.filter((t) => {
      const on = t.post_url ? postedOnSeoul(t.post_url) : null;
      return on !== null && (on < c.starts_on || on > c.ends_on);
    });
    if (outside.length) fails.push(`${c.name}: 실제 게시일이 캠페인 기간(${c.starts_on}~${c.ends_on}) 밖인 작업 ${outside.length}건 — ${outside.map((t) => `${t.no}.@${t.handle}(${postedOnSeoul(t.post_url as string)})`).join(' · ')}`);
    // 답글일과 실제 게시일이 다른 건 — 답글일을 게시일로 쓰면 안 된다는 증거
    const drift = mine.filter((t) => t.post_url && postedOnSeoul(t.post_url) !== t.답글일);
    if (drift.length) console.log(`  · ${c.name}: 답글일 ≠ 실제 게시일 ${drift.length}건 — ${drift.map((t) => `${t.no}.@${t.handle}(답글 ${t.답글일} → 게시 ${postedOnSeoul(t.post_url as string)})`).join(' · ')}`);
  }

  // 5) 명부 대조 — 선언한 '명부' 플래그가 실제 DB와 맞는지
  const sql = getSql();
  const rows = await sql.unsafe(
    `select handle from influencer where lower(handle) = any($1::text[])`, [handles],
  );
  const inDb = new Set(rows.map((r: Record<string, string>) => String(r.handle).toLowerCase()));
  for (const t of tasks) {
    const actual = inDb.has(t.handle.toLowerCase());
    if (actual !== t.명부) fails.push(`${t.campaign} ${t.no}.@${t.handle}: 명부 선언 ${t.명부} ≠ 실제 ${actual}`);
  }
  const missing = handles.filter((h) => !inDb.has(h));
  console.log(`  ✓ 명부 대조: 적재 대상 고유 핸들 ${handles.length} 중 있음 ${inDb.size} · 없음 ${missing.length}`);

  // 6) 클라이언트 존재 확인
  const cl = await sql.unsafe(`select id, name from client`);
  const clNames = new Set(cl.map((r: Record<string, string>) => r.name));
  for (const c of campaigns) {
    if (c.client_id === null) {
      if (clNames.has(c.client_name)) fails.push(`${c.name}: client_id 가 null 인데 '${c.client_name}' 는 이미 DB에 있다 — JSON에 그 id를 채우세요`);
      else console.log(`  ✓ ${c.client_name}: DB에 없음 → 생성 대상(맞음)`);
    } else {
      const hit = cl.find((r: Record<string, string>) => r.id === c.client_id);
      if (!hit) fails.push(`${c.name}: client_id ${c.client_id} 가 DB에 없다`);
      else if (hit.name !== c.client_name) fails.push(`${c.name}: client_id 의 실제 이름 '${hit.name}' ≠ 표기 '${c.client_name}'`);
    }
  }

  // 7) 캠페인이 이미 적재됐는지 — 적재 전이면 '충돌 없음', 적재 후면 DB 작업 수까지 보고한다.
  //    적재 후에 '충돌'로 실패를 내면 거짓 경보가 되므로(09-10) 상태를 구분한다. 이어붙이기는 sync-week2.ts 가 한다.
  const exist = await sql.unsafe(
    `select c.name, (select count(*) from campaign_task t where t.campaign_id = c.id) as tasks
       from campaign c where c.name = any($1::text[]) order by c.name`,
    [campaigns.map((c) => c.name)]);
  if (exist.length === 0) console.log('  ✓ 적재 전 — 캠페인 이름 충돌 없음');
  else if (exist.length === campaigns.length) {
    console.log('  · 이미 적재됨 — ' + exist.map((r: Record<string, string>) => `${r.name} ${r.tasks}건`).join(' · '));
    for (const c of campaigns) {
      const hit = exist.find((r: Record<string, string>) => r.name === c.name);
      if (!hit) continue;
      const want = tasks.filter((t) => t.campaign === c.key).length;
      if (Number(hit.tasks) !== want) console.log(`    → ${c.name}: DB ${hit.tasks}건 ≠ 원천 ${want}건 — sync-week2.ts 로 이어붙이세요`);
    }
  } else fails.push(`캠페인 ${campaigns.length}개 중 ${exist.length}개만 DB에 있다(부분 적재) — ${exist.map((r: Record<string, string>) => r.name).join(', ')}`);

  if (process.argv.includes('--table')) {
    console.log('\n════════════ 검수표 ════════════');
    for (const c of campaigns) {
      const mine = tasks.filter((t) => t.campaign === c.key);
      console.log(`\n━━ ${c.name} (${c.name_en}) · ${c.starts_on}~${c.ends_on} · ${c.client_name}${c.client_id ? '' : ' 🆕생성'}`);
      console.log(`   슬랙 비용 ${c.슬랙_비용.원문} → 금주 ${c.슬랙_비용.금주_소진 === null ? '미갱신' : man(c.슬랙_비용.금주_소진)} · 월예산 ${man(c.슬랙_비용.월_예산)}`);
      console.log(`   번호  핸들                유형     금액      게시  명부  메모`);
      for (const t of mine) {
        console.log(`   ${String(t.no).padStart(2)}.  @${t.handle.padEnd(17)} ${t.type.padEnd(8)} ${man(t.cost.amount).padStart(8)}  ${t.게시 ? '완료' : ' — '}  ${t.명부 ? ' ○ ' : ' ✗ '}  ${t.note}`);
      }
      console.log(`   ─ 적재 ${mine.length}건 · 합 ${man(mine.reduce((a, t) => a + t.cost.amount, 0))}`);
      const ex = excluded.filter((e) => e.campaign === c.key);
      for (const e of ex) console.log(`   ${String(e.no).padStart(2)}.  @${(e.handle ?? '(핸들없음)').padEnd(17)} ${e.type.padEnd(8)} ${(e.amount === null ? '—' : man(e.amount)).padStart(8)}  제외: ${e.사유}`);
    }
  }

  console.log('\n════════════ 결과 ════════════');
  for (const w of warns) console.log(`⚠️  ${w}`);
  if (fails.length === 0) console.log(`✓ 검산 통과 — 실패 0 · 경고 ${warns.length}`);
  else { console.log(`✗ 실패 ${fails.length}건`); for (const f of fails) console.log(`   ✗ ${f}`); }
  await sql.end();
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
