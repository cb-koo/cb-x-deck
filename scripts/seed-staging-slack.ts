// scripts/seed-staging-slack.ts — 슬랙 3채널 결제 요청 CSV(claude-outputs/20260827_결제요청_슬랙3채널_전건_756건.csv)를
// 스테이징에 실데이터로 넣는다(koo 08-29 결정: 내부 담당자 대상이라 원본 그대로, 최근 1주).
// 사용: node --import tsx --env-file=.env.staging scripts/seed-staging-slack.ts <csv> [--since 2026-08-22] [--dry-run]
//   --dry-run : DB를 건드리지 않고 파싱 결과 요약(건수·유형·수단·통화·건너뜀 이유)만 출력. 개인정보(계좌·이메일·이름)는 출력하지 않는다.
// 동작: 스테이징 데이터를 전부 비우고(로그인 멤버는 유지) → CSV 행마다 클라이언트·인플루언서(+결제수단)·이관 캠페인·게시 완료 작업을 만든 뒤
//       payment_request를 CSV 값 그대로 스냅샷으로 insert(created_at·updated_at = 슬랙 시각 → 폴링 커서·날짜가 실제처럼 보인다).
// 되돌리기: npm run seed:staging (가짜 데이터로 교체).
import { readFileSync } from 'node:fs';
import { getSql } from '../src/lib/db.ts';
import { assertStaging } from './stagingGuard.ts';
import { createClient } from '../src/lib/clientStore.ts';
import { createCampaign } from '../src/lib/campaignStore.ts';
import { createTasks, updateTask } from '../src/lib/campaignTaskStore.ts';
import { createInfluencer, updatePaymentMethods, getInfluencerDetail } from '../src/lib/influencerStore.ts';
import { SETTLEMENT_DEFAULTS } from '../src/lib/settlementSettings.ts';
import type { TaskType } from '../src/lib/campaignJudgment.ts';
import type { PaymentMethodInput, PaymentMethodType } from '../src/lib/influencerPayment.ts';

assertStaging();

const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : '2026-08-22';
if (!csvPath) { console.error('사용: seed-staging-slack.ts <csv> [--since YYYY-MM-DD] [--dry-run]'); process.exit(2); }

// ── CSV 파서(RFC4180: 따옴표·쉼표·줄바꿈 포함 필드) ──
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

type Row = Record<string, string>;
const raw = parseCsv(readFileSync(csvPath, 'utf8'));
const header = raw[0].map((h) => h.trim());
const all: Row[] = raw.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
const isTest = (v: string) => /^(1|true|y|yes|o|테스트)$/i.test(v.trim());
const rows = all.filter((r) => (r.ts ?? '').slice(0, 10) >= since && !isTest(r.test ?? ''));

// ── 정규화 ──
const digits = (s: string) => { const m = (s ?? '').replace(/[^\d]/g, ''); return m ? Number(m) : NaN; };
const dateOf = (s: string) => { const m = (s ?? '').match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null; };
function fridayOf(ymd: string): string { const d = new Date(ymd + 'T00:00:00+09:00'); const add = (5 - d.getUTCDay() + 7) % 7; d.setUTCDate(d.getUTCDate() + add); return d.toISOString().slice(0, 10); }
function typeOf(r: Row): TaskType {
  const t = `${r.유형 ?? ''} ${r.항목 ?? ''}`;
  if (/인용/.test(t)) return 'quoteRt';
  if (/\bRT\b|리트윗|RT\s*\d/i.test(t)) return 'rt';
  if (/방문/.test(`${r.유형 ?? ''} ${r.목적 ?? ''}`) && /방문/.test(r.유형 ?? '')) return 'visit';
  return 'post';
}
function handleOf(r: Row): string | null {
  const m = `${r.항목 ?? ''} ${r.목적 ?? ''} ${r.메모 ?? ''}`.match(/@([A-Za-z0-9_]{1,15})/);
  return m ? m[1] : null;
}
function currencyOf(r: Row): 'KRW' | 'JPY' | null {
  const s = `${r.통화 ?? ''} ${r.액수 ?? ''}`;
  if (/¥|JPY|엔|円/i.test(s)) return 'JPY';
  if (/₩|KRW|원/i.test(s)) return 'KRW';
  return null;
}
function methodTypeOf(r: Row): PaymentMethodType | null {
  const s = `${r.수단 ?? ''} ${r.결제수단 ?? ''} ${r.ch ?? ''}`.toLowerCase();
  if (s.includes('paypal')) return 'paypal';
  if (s.includes('paypay')) return 'paypay';
  if (/계좌|bank|이체/.test(s)) return 'bank';
  return null;
}
const CATS = SETTLEMENT_DEFAULTS.categories;
function categoryOf(r: Row, type: TaskType): { id: string; sendAs: string } {
  const exact = CATS.find((c) => c.sendAs === (r.분류s ?? '').trim());
  if (exact) return { id: exact.id, sendAs: exact.sendAs };
  const s = r.분류s ?? '';
  const byText = CATS.find((c) => (/프로모션|RT/.test(s) && c.id === 'promo-rt') || (/원고료/.test(s) && c.id === 'fee') || (/정보성/.test(s) && c.id === 'info-post'));
  if (byText) return { id: byText.id, sendAs: byText.sendAs };
  const fallback = CATS.find((c) => c.id === (type === 'rt' || type === 'quoteRt' ? 'promo-rt' : 'fee'))!;
  return { id: fallback.id, sendAs: fallback.sendAs };
}
// '수단 | 수취인 | 식별정보' → 스냅샷. 은행은 '은행 / 지점 / 계좌번호'.
function snapshotOf(r: Row, type: PaymentMethodType, currency: 'KRW' | 'JPY'): Record<string, string> {
  const parts = (r.결제수단 ?? '').split('|').map((p) => p.trim());
  const holder = parts[1] || '(수취인 미기재)';
  const ident = parts.slice(2).join('|').trim();
  const s: Record<string, string> = { type, holder, currency };
  if (type === 'paypal') { if (ident.includes('@')) s.email = ident; else if (ident) s.paypalId = ident.replace(/^paypal\.me\//i, ''); }
  else if (type === 'paypay') { if (ident) s.identifier = ident; }
  else { const b = ident.split('/').map((x) => x.trim()); s.bank = b[0] || '(은행 미기재)'; if (b.length >= 3) { if (b[1]) s.branch = b[1]; s.account = b[2]; } else if (b[1]) s.account = b[1]; }
  return s;
}

type Prepared = {
  ts: string; day: string; requester: string; clinic: string; type: TaskType; handle: string; currency: 'KRW' | 'JPY';
  gross: number; fee: number; net: number; amountKrw: number; deadline: string; method: PaymentMethodType; snapshot: Record<string, string>;
  category: { id: string; sendAs: string }; item: string; purpose: string; reference: string | null; note: string;
};
const prepared: Prepared[] = []; const skipped: Array<{ line: number; reason: string }> = [];
rows.forEach((r, i) => {
  const line = i + 2;
  const day = dateOf(r.ts) ?? r.ts.slice(0, 10);
  const handle = handleOf(r); if (!handle) return skipped.push({ line, reason: '항목·목적에 @핸들 없음' });
  const currency = currencyOf(r); if (!currency) return skipped.push({ line, reason: '통화 판별 불가' });
  const gross = digits(r.액수); if (!Number.isFinite(gross) || gross <= 0) return skipped.push({ line, reason: '액수 없음' });
  const fee = Number.isFinite(digits(r.수수료)) ? digits(r.수수료) : 0;
  if (fee >= gross) return skipped.push({ line, reason: '수수료가 금액 이상' });
  const method = methodTypeOf(r); if (!method) return skipped.push({ line, reason: '결제 수단 판별 불가' });
  const clinic = (r.클리닉 ?? '').trim() || '(클리닉 미기재)';
  const type = typeOf(r);
  const net = gross - fee;
  prepared.push({
    ts: r.ts, day, requester: (r.요청자 ?? '').trim() || '(요청자 미기재)', clinic, type, handle, currency, gross, fee, net,
    amountKrw: currency === 'JPY' ? net * 10 : net, deadline: dateOf(r.데드라인) ?? fridayOf(day), method,
    snapshot: snapshotOf(r, method, currency), category: categoryOf(r, type),
    item: r.항목 || `@${handle} 1건 정산`, purpose: r.목적 || '', reference: /^https?:\/\//.test(r.참고자료 ?? '') ? r.참고자료 : null, note: r.메모 ?? '',
  });
});

const count = <T,>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log(`CSV ${all.length}행 → ${since} 이후·테스트 제외 ${rows.length}행 → 이관 가능 ${prepared.length}건, 건너뜀 ${skipped.length}건`);
console.log('유형:', count(prepared, (p) => p.type), '| 수단:', count(prepared, (p) => p.method), '| 통화:', count(prepared, (p) => p.currency));
console.log('분류:', count(prepared, (p) => p.category.id), '| 클리닉 수:', new Set(prepared.map((p) => p.clinic)).size, '| 인플 수:', new Set(prepared.map((p) => p.handle.toLowerCase())).size, '| 요청자 수:', new Set(prepared.map((p) => p.requester)).size);
if (skipped.length) console.log('건너뜀(행번호: 이유):', skipped.map((s) => `${s.line}: ${s.reason}`).join(' · '));
if (dryRun) { console.log('--dry-run — DB 변경 없음'); process.exit(0); }

(async () => {
  const sql = getSql();
  // 스테이징 전부 비우기 — 로그인 멤버(이메일 있는 실제 계정)만 남긴다
  await sql`delete from payment_request`;
  await sql`delete from campaign_task`;
  await sql`delete from campaign`;
  await sql`delete from client`;
  await sql`delete from influencer_log`;
  await sql`delete from influencer`;
  await sql`delete from member where email is null or email like 'seed_%'`;

  const members = new Map<string, string>();
  async function memberId(name: string): Promise<string> {
    if (members.has(name)) return members.get(name)!;
    const found = await sql<Array<{ id: string }>>`select id from member where name = ${name} limit 1`;
    const id = found[0]?.id ?? (await sql<Array<{ id: string }>>`insert into member (name, color) values (${name}, '#536471') returning id`)[0].id;
    members.set(name, id); return id;
  }
  const clients = new Map<string, { id: string; name: string }>();
  const campaigns = new Map<string, { id: string; name: string }>();
  async function campaignFor(clinic: string) {
    if (campaigns.has(clinic)) return { client: clients.get(clinic)!, campaign: campaigns.get(clinic)! };
    const client = await createClient(sql, clinic);
    const slug = 'slack-' + Buffer.from(clinic).toString('hex').slice(0, 12);
    const campaign = await createCampaign(sql, { clientId: client.id, clientName: client.name, name: `슬랙 이관 · ${clinic}`, nameEn: slug, startsOn: since, endsOn: '2026-08-31', kind: 'content', note: '슬랙 결제 요청 채널 이관(스테이징)', createdBy: null });
    clients.set(clinic, { id: client.id, name: client.name }); campaigns.set(clinic, { id: campaign.id, name: campaign.name });
    return { client: clients.get(clinic)!, campaign: campaigns.get(clinic)! };
  }
  const influencers = new Map<string, string>();
  async function influencerId(p: Prepared): Promise<string> {
    const key = p.handle.toLowerCase();
    if (influencers.has(key)) return influencers.get(key)!;
    const { row } = await createInfluencer(sql, { handle: p.handle, createdBy: null });
    const cur = await getInfluencerDetail(sql, row.id);
    if (!cur || cur.paymentMethods.length === 0) {
      const input: PaymentMethodInput = { type: p.method, holder: p.snapshot.holder, currency: p.currency, ...(p.snapshot.email && { email: p.snapshot.email }), ...(p.snapshot.paypalId && { paypalId: p.snapshot.paypalId }), ...(p.snapshot.identifier && { identifier: p.snapshot.identifier }), ...(p.snapshot.bank && { bank: p.snapshot.bank }), ...(p.snapshot.branch && { branch: p.snapshot.branch }), ...(p.snapshot.account && { account: p.snapshot.account }), ...(p.fee > 0 && { fee: { mode: 'fixed' as const, amount: p.fee } }) };
      await updatePaymentMethods(sql, row.id, { kind: 'add', input, makeDefault: true }, null);
    }
    influencers.set(key, row.id); return row.id;
  }
  const tin = { targetTaskId: null, targetTweetUrl: null, draftId: null, scheduledOn: null, visitOn: null, note: '', createdBy: null };

  let inserted = 0;
  for (const p of prepared) {
    const { client, campaign } = await campaignFor(p.clinic);
    const infId = await influencerId(p);
    const reqId = await memberId(p.requester);
    const [task] = await createTasks(sql, campaign.id, { ...tin, type: p.type, items: [{ handle: p.handle, cost: { amount: p.amountKrw, currency: 'KRW' } }] });
    await updateTask(sql, task.id, { postedAt: p.day, postedSource: 'manual', postUrl: p.reference ?? `https://x.com/${p.handle}` });
    const fee = p.fee > 0 ? sql.json({ mode: 'fixed', amount: p.fee }) : null;
    await sql`
      insert into payment_request (task_id, campaign_id, campaign_name, client_id, client_name, influencer_handle, influencer_id, task_type,
        category, category_option_id, category_default, item_text, purpose_text, amount_krw, cost_currency, payout_currency, rate_krw_per_jpy,
        amount_net, fee, fee_amount, amount_gross, deadline_on, reference_url, payment_method, requester_member_id, requester_name, note, created_at, updated_at)
      values (${task.id}, ${campaign.id}, ${campaign.name}, ${client.id}, ${client.name}, ${p.handle}, ${infId}, ${p.type},
        ${p.category.sendAs}, ${p.category.id}, ${p.category.sendAs}, ${p.item}, ${p.purpose}, ${p.amountKrw}, 'KRW', ${p.currency}, 10,
        ${p.net}, ${fee}, ${p.fee}, ${p.gross}, ${p.deadline}, ${p.reference}, ${sql.json(p.snapshot)}, ${reqId}, ${p.requester}, ${p.note},
        ${p.ts}::timestamptz, ${p.ts}::timestamptz)`;
    inserted++;
  }
  console.log(`이관 완료 — 요청 ${inserted}건 · 클라이언트 ${clients.size} · 캠페인 ${campaigns.size} · 인플루언서 ${influencers.size} · 요청자 ${members.size}`);
  await sql.end();
})().catch((e) => { console.error(e); process.exit(1); });
