// 슬랙 스레드 덤프 ↔ 원천 JSON 대조 — **차이만 보고한다. DB에 쓰지 않는다.**
//
// 왜 필요한가(2026-09-11): 이 스레드는 새 답글만 붙는 게 아니라 **기존 답글이 수정된다**.
// 답글 수가 그대로여도 내용이 바뀌므로 목록만 봐서는 못 잡는다. 실제로 두 번 놓칠 뻔했다:
//   · 09-10 미모드림 07~09 — 빈 플레이스홀더가 핸들·금액·RT 증빙으로 채워짐
//   · 09-11 더스퀘어 01·08·10·13 — 게시물 링크가 뒤늦게 붙음(koo가 "2건 맞아?"라고 물어 발견)
// sync-week2.ts 는 원천 JSON 과 DB 만 비교하므로 이 변화를 볼 수 없다. 그 앞 단계가 이 스크립트다.
//
// 슬랙을 직접 읽지 않는다 — 워크스페이스 토큰이 없다. 사람(또는 대화 중의 Claude)이 스레드를 읽어
// data-work/week2-slack-dump.json 에 떨구면, 이 스크립트가 형식을 해석해 원천과 맞춰 본다.
// 눈으로 35줄을 비교하는 부분만 기계가 맡는 것이고, 반영은 여전히 사람이 sync-week2.ts 로 한다.
//
// 덤프 형식:
//   { "collected_at": "2026-09-11T…", "threads": [
//       { "key": "square", "name": "9월2주차 더스퀘어 정보성", "ts": "1788753858.823779",
//         "parent": "…부모 메시지 본문…",
//         "replies": ["01.@saachan0013\n인용: 5만원\nhttps://x.com/…", …] } ] }
//
// 실행: node --import tsx scripts/diff-week2-slack.ts
import { readFileSync, existsSync } from 'node:fs';
import { parseReply, parseParentCost, normalizePostUrl } from './slackThreadParse.ts';

interface Task {
  no: number; campaign: string; handle: string; type: string;
  cost: { amount: number }; post_url: string | null; note: string;
  // 슬랙에 적힌 표기(개명으로 handle 과 달라진 경우에만 있다) — 대조는 이 값과 한다.
  // 없으면 handle 로 본다. 이게 없으면 개명 건이 매번 '핸들 바뀜'으로 떠서 진짜 변화가 묻힌다.
  slack_handle?: string;
}
interface Excluded { no: number; campaign: string; handle: string | null; 사유: string }
interface Camp { key: string; name: string; 슬랙_비용: { 금주_소진: number | null; 이전주_누적: number | null; 월_예산: number } }
interface Dump { collected_at: string; threads: Array<{ key: string; name: string; ts: string; parent: string; replies: string[] }> }

const SRC = new URL('../data-work/week2-normalized.json', import.meta.url);
const DUMP = new URL('../data-work/week2-slack-dump.json', import.meta.url);
const man = (n: number | null) => (n === null ? '미정' : `${(n / 10000).toLocaleString('ko-KR')}만원`);

function main(): void {
  if (!existsSync(DUMP)) {
    console.error('✗ 덤프가 없습니다: data-work/week2-slack-dump.json');
    console.error('  슬랙 4개 스레드를 읽어 덤프를 만든 뒤 다시 실행하세요(형식은 이 파일 머리말 참조).');
    process.exit(1);
  }
  const D = JSON.parse(readFileSync(SRC, 'utf8')) as { campaigns: Camp[]; tasks: Task[]; excluded: Excluded[] };
  const dump = JSON.parse(readFileSync(DUMP, 'utf8')) as Dump;
  console.log(`덤프 수집 ${dump.collected_at} · 스레드 ${dump.threads.length}개\n`);

  let diffs = 0;
  const line = (mark: string, s: string) => { console.log(`${mark} ${s}`); diffs += 1; };

  for (const th of dump.threads) {
    const camp = D.campaigns.find((c) => c.key === th.key);
    if (!camp) { line('🔴', `${th.key}: 원천에 없는 캠페인 키`); continue; }

    const mine = D.tasks.filter((t) => t.campaign === th.key);
    const ex = D.excluded.filter((e) => e.campaign === th.key);
    const known = new Map<number, Task>(mine.map((t) => [t.no, t]));
    const knownEx = new Map<number, Excluded>(ex.map((e) => [e.no, e]));
    const head: string[] = [];

    // ── 부모 비용 ──
    const p = parseParentCost(th.parent);
    const c = camp.슬랙_비용;
    if (p.thisWeek !== c.금주_소진) head.push(`금주 소진 ${man(c.금주_소진)} → ${man(p.thisWeek)}`);
    if (p.carried !== c.이전주_누적) head.push(`이전 주 누적 ${man(c.이전주_누적)} → ${man(p.carried)}`);
    if (p.monthly !== c.월_예산) head.push(`월 예산 ${man(c.월_예산)} → ${man(p.monthly)}`);

    const rows: string[] = [];
    const seen = new Set<number>();
    for (const raw of th.replies) {
      const r = parseReply(raw);
      if (r.no === null) continue;                 // 대화·구분선
      seen.add(r.no);
      const t = known.get(r.no);
      const e = knownEx.get(r.no);

      if (!t && !e) {
        rows.push(`🆕 ${r.no}. ${r.handle ? '@' + r.handle : '(핸들 없음)'} ${r.type ?? '?'} ${man(r.amountKrw)}${r.postUrl ? ' · 게시 링크 있음' : ''}${r.memo ? ' · ' + r.memo : ''}`);
        continue;
      }
      if (!t && e) {
        // 제외했던 행이 채워졌나
        if (r.handle && !e.handle) rows.push(`🆕 ${r.no}. 플레이스홀더가 채워짐 → @${r.handle} ${r.type ?? '?'} ${man(r.amountKrw)}`);
        continue;
      }
      if (!t) continue;

      const expectHandle = (t.slack_handle ?? t.handle).toLowerCase();
      if (r.handle && r.handle.toLowerCase() !== expectHandle) {
        rows.push(`✏️ ${r.no}. 핸들 @${t.slack_handle ?? t.handle} → @${r.handle}`);
      }
      if (r.amountKrw !== null && r.amountKrw !== t.cost.amount) {
        rows.push(`✏️ ${r.no}. @${t.handle} 금액 ${man(t.cost.amount)} → ${man(r.amountKrw)}`);
      }
      const url = r.postUrl;
      const mineUrl = t.post_url ? normalizePostUrl(t.post_url) : null;
      if (url && !mineUrl) rows.push(`🆕 ${r.no}. @${t.handle} 게시 링크가 붙음 → ${url}`);
      else if (url && mineUrl && url !== mineUrl) rows.push(`✏️ ${r.no}. @${t.handle} 게시 링크 변경 ${mineUrl} → ${url}`);
      else if (!url && mineUrl) rows.push(`⚠️ ${r.no}. @${t.handle} 슬랙에서 게시 링크가 사라짐(원천엔 있음) — 확인 필요`);
      // 메모는 원천 note 에 그대로 옮기지 않는 경우가 많다(판단 근거를 덧붙여 쓴다).
      // 핵심 낱말이 없을 때만 알린다 — 표현 차이로 매번 뜨면 진짜 변화가 묻힌다.
      const memoKey = r.memo.replace(/\s+/g, '');
      if (memoKey && !t.note.replace(/\s+/g, '').includes(memoKey)) {
        rows.push(`✏️ ${r.no}. @${t.handle} 슬랙 메모: ${r.memo}`);
      }
    }

    for (const t of mine) if (!seen.has(t.no)) rows.push(`⚠️ ${t.no}. @${t.handle} — 원천에 있는데 슬랙 덤프에 없음`);

    if (head.length || rows.length) {
      console.log(`━━ ${th.name} (${camp.name})`);
      for (const h of head) { console.log(`   📊 부모: ${h}`); diffs += 1; }
      for (const r of rows) { console.log(`   ${r}`); diffs += 1; }
      console.log('');
    }
  }

  console.log('════════════');
  if (!diffs) console.log('✓ 슬랙과 원천이 같습니다 — 할 일 없음.');
  else {
    console.log(`차이 ${diffs}건 — data-work/week2-normalized.json 을 고친 뒤 sync-week2.ts 로 반영하세요.`);
    console.log('(이 스크립트는 DB에 아무것도 쓰지 않습니다)');
  }
}
main();
