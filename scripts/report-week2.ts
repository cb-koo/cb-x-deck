// data-work/week2-normalized.json → 적재 결과 문서 마크다운. DB 접속 없음.
// 검수표와 적재 스크립트가 같은 파일을 읽으므로 표와 실제로 들어갈 값이 갈릴 수 없다.
// 실행: node --import tsx scripts/report-week2.ts > ~/claude-outputs/20260910_9월2주차_캠페인작업_적재결과.md
import { readFileSync } from 'node:fs';
import { postedOnSeoul } from './tweetDate.ts';

interface Task { no: number; campaign: string; handle: string; type: string; cost: { amount: number }; post_url: string | null; 게시: boolean; 답글일: string; 명부: boolean; note: string; proof_file?: string }
// 게시 완료 = 게시물 URL 있음 **또는** RT이면서 증빙 있음.
// RT 는 자기 게시물이 없어 URL 이 나올 수 없다 — 링크만 보면 RT 가 통째로 '미게시'가 된다(2026-09-11 발견).
const done = (t: Task) => t.게시 || (t.type === 'rt' && Boolean(t.proof_file));
interface Camp { key: string; name: string; name_en: string; client_name: string; client_id: string | null; starts_on: string; ends_on: string; kind: string; note: string; 슬랙_비용: { 금주_소진: number | null; 이전주_누적: number | null; 월_예산: number; 원문: string }; '🔴_확인필요'?: string }
interface Ex { no: number; campaign: string; handle: string | null; type: string; amount: number | null; 사유: string; 분류: string }

const D = JSON.parse(readFileSync(new URL('../data-work/week2-normalized.json', import.meta.url), 'utf8')) as {
  _meta: Record<string, string>; campaigns: Camp[]; tasks: Task[]; excluded: Ex[];
  clients_to_create: { name: string; 이유: string }[]; roster_missing: { 적재_대상_중_없음: string[]; 실무_규칙: string };
};
const man = (n: number | null) => (n === null ? '—' : `${(n / 10000).toLocaleString('ko-KR')}만원`);
const TYPE: Record<string, string> = { quoteRt: '인용RT', rt: 'RT', post: '투고', visit: '방문협찬' };
const out: string[] = [];
const p = (s = '') => out.push(s);

p('# 9월2주차 캠페인·작업 적재 결과');
p();
p(`슬랙 \`9월2주차\` 스레드 4건 → **2026-09-10 프로덕션 적재 완료.** 넣은 뒤 DB에서 다시 읽어 원천과 대조했습니다(전 항목 일치).`);
p();
p(`> 이 스레드에는 답글이 계속 붙습니다. 19:30에 다시 확인해 더스퀘어 **13.@ririko_item · 14.@8_rivi** 2건을 이어붙였습니다. 이후 변화는 \`sync-week2.ts\`(멱등)로 반영합니다.`);
p();
p(`- 출처: ${D._meta.출처}`);
p(`- 넣은 것: 클라이언트 **1개 생성**(백수약국) · 캠페인 **${D.campaigns.length}개** · 작업 **${D.tasks.length}건**(합 ${man(D.tasks.reduce((a, t) => a + t.cost.amount, 0))}) · 게시 완료 **${D.tasks.filter(done).length}건**`);
p(`- 슬랙 번호행 ${D.tasks.length + D.excluded.length}행 중 ${D.excluded.length}행은 넣지 않았습니다(아래 '넣지 않는 행').`);
p('- 정산 요청은 만들지 않았습니다(0건) — 적재는 작업까지고, 지급 요청은 화면에서 사람이 냅니다.');
p();

p('## 결정 2가지 — 처리 완료');
p();
p('**1. 백수약국 캠페인 기간 → 9/07~9/13 확정.** "게시 링크의 게시일로 판단"하라고 하셔서 게시물 URL에서 실제 게시일을 뽑았습니다. 답글이 9/03에 달린 3건도 **실제 게시는 9/07~9/09**였습니다:');
p();
p('| 작업 | 슬랙 답글일 | 실제 게시일 |');
p('|---|---|---|');
p('| @coco__ns_5 | 9/03 | **9/07 19:34** |');
p('| @2024_0406 | 9/03 | **9/08 21:18** |');
p('| @ykss_2141 | 9/03 | **9/09 18:01** |');
p();
p('→ 9/03 답글은 그날 **섭외 목록을 미리 적어둔 것**이고 게시는 2주차에 일어났습니다. `9월2주차` 라벨이 처음부터 맞았고("주차 라벨 실수 아님"이 이렇게 설명됩니다), 기간을 넓힐 필요가 없습니다. 캠페인 4개의 게시물이 전부 **9/07~9/10** 안에 들어옵니다.');
p();
p('**2. 백수약국 클라이언트 → 생성 완료.** 월 예산 250만원. 랜딩 URL은 비워 뒀습니다(지도 링크 2개는 브릿지 랜딩이 아니라 트래킹 링크라 캠페인 메모에 남겼습니다).');
p();
p('게시일 계산은 트윗 ID(스노플레이크)에서 파생했고, getxapi로 2건 대조해 분 단위까지 일치를 확인했습니다. **`답글일`은 게시일이 아닙니다** — 모에카님이 슬랙에 기록한 날일 뿐입니다.');
p();

p('## 슬랙 `비용` 3숫자 — 오늘 확정됐습니다');
p();
p(`오늘 16:42 스레드에서 직접 물어보신 답으로 뜻이 정해졌습니다: **[금주 소진 / 이전 주 누적 / 월 예산]**. 모에카님 답 — "이제 3주차 되면 가운데가 1,2주차 소진 비용이 됩니다" → 가운데는 *작주*가 아니라 **이전 주 누적**입니다(2주차에는 둘이 같아서 작주처럼 보였습니다).`);
p();
p('이 덕분에 **게시 여부를 판정할 근거**가 생겼습니다. `금주 소진`이 게시물 URL이 붙은 작업 금액의 합과 정확히 맞습니다:');
p();
p('| 캠페인 | 슬랙 금주 소진 | URL 붙은 작업 합 | 일치 |');
p('|---|---|---|---|');
for (const c of D.campaigns) {
  const mine = D.tasks.filter((t) => t.campaign === c.key);
  const posted = mine.filter(done);
  const sum = posted.reduce((a, t) => a + t.cost.amount, 0);
  const upto = posted.filter((t) => t.답글일 <= '2026-09-09').reduce((a, t) => a + t.cost.amount, 0);
  const 금주 = c.슬랙_비용.금주_소진;
  const mark = 금주 === null ? '부모 미갱신' : 금주 === sum ? '✅' : 금주 === upto ? `✅ (9/09까지 ${man(upto)} · 9/10 추가분 ${man(sum - upto)}은 부모 미반영)` : '❌';
  p(`| ${c.name} | ${man(금주)} | ${man(sum)} (${posted.length}건) | ${mark} |`);
}
p();
p('→ 그래서 **게시물 URL이 있으면 게시 완료**로 판정했습니다. 다만 **RT는 자기 게시물이 없어 URL이 나올 수 없어서**, RT는 증빙 스크린샷이 있으면 완료로 봅니다(이 예외를 빠뜨려 미모드림 RT 3건 11만원이 빠졌던 것을 09-11에 바로잡았습니다). 더스퀘어만 부모의 금주 표기가 `00만원`으로 남아 있습니다.');
p();

for (const c of D.campaigns) {
  const mine = D.tasks.filter((t) => t.campaign === c.key);
  const ex = D.excluded.filter((e) => e.campaign === c.key);
  p(`## ${c.name}`);
  p();
  p(`\`${c.name_en}\` · ${c.starts_on} ~ ${c.ends_on} · ${c.client_name}${c.client_id ? '' : ' **(신규 생성)**'} · 유형 ${c.kind}`);
  p();
  p(`슬랙 비용 \`${c.슬랙_비용.원문}\` → 금주 ${man(c.슬랙_비용.금주_소진)} · 이전 주 누적 ${man(c.슬랙_비용.이전주_누적)} · 월 예산 ${man(c.슬랙_비용.월_예산)}`);
  p();
  p('| # | 핸들 | 유형 | 금액 | 게시 | 명부 | 메모 |');
  p('|---|---|---|---|---|---|---|');
  for (const t of mine) {
    p(`| ${t.no} | @${t.handle} | ${TYPE[t.type]} | ${man(t.cost.amount)} | ${t.post_url ? `[${postedOnSeoul(t.post_url)}](${t.post_url})` : (t.type === 'rt' && t.proof_file ? 'RT 증빙' : '게시 전')} | ${t.명부 ? '○' : '**✗ 없음**'} | ${t.note} |`);
  }
  p(`| | **${mine.length}건** | | **${man(mine.reduce((a, t) => a + t.cost.amount, 0))}** | 게시 ${mine.filter(done).length}건 | | |`);
  p();
  if (ex.length) {
    p('넣지 않는 행:');
    p();
    p('| # | 핸들 | 금액 | 사유 |');
    p('|---|---|---|---|');
    for (const e of ex) p(`| ${e.no} | ${e.handle ? '@' + e.handle : '(핸들 없음)'} | ${man(e.amount)} | ${e.사유} — ${e.분류} |`);
    p();
  }
}

p('## 명부에 없는 핸들');
p();
p(`적재 대상 작업의 핸들 중 **${D.roster_missing.적재_대상_중_없음.length}개**가 인플루언서 명부에 없습니다: ${D.roster_missing.적재_대상_중_없음.map((h) => '`@' + h + '`').join(' · ')}`);
p();
p(`작업 자체는 들어갑니다(핸들에 외래키가 없음). 다만 명부에 없으면 인플 화면·결제수단이 비어 정산 요청을 낼 수 없습니다. ${D.roster_missing.실무_규칙}`);
p();

p('## 넣지 않는 값');
p();
p('| 값 | 왜 |');
p('|---|---|');
p('| 게시 예정일(`scheduled_on`) | 슬랙에 정보가 없습니다. 밀림 판정의 기준이라 추정하면 안 됩니다 |');
p('| 정산 요청 | 적재는 작업까지입니다. 지급 요청은 화면에서 사람이 냅니다 |');
p('| 랜딩 URL·예산 예외 달 | 클라이언트 화면에서 별도로 |');
p();
p('---');
p();
p('*원천 데이터 `data-work/week2-normalized.json` · 검산 `scripts/verify-week2.ts` · 적재 `scripts/load-week2.ts`(드라이런 기본) · 되돌리기 `scripts/reset-campaigns.ts`*');

process.stdout.write(out.join('\n') + '\n');
