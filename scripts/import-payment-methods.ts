// 정산 결제 수단 초기 데이터 가져오기 (스펙 §4) — koo가 제공한 CSV를 인플루언서 프로필에 반영.
// 기본은 드라이런(무엇이 일어날지만 출력) — 실제로 쓰려면 --apply.
// 실행: node --env-file-if-exists=.env --import tsx scripts/import-payment-methods.ts <csv> [--apply]
import { readFile } from 'node:fs/promises';
import { getSql } from '../src/lib/db.ts';
import { findByHandle, updatePaymentMethods } from '../src/lib/influencerStore.ts';
import {
  applyPaymentOp,
  describeMethod,
  parsePaymentMethodInput,
  type PaymentMethod,
  type PaymentMethodInput,
} from '../src/lib/influencerPayment.ts';

const EXAMPLE_PREFIX = '예시_삭제하세요';

// 표준 CSV 파싱(의존성 없이 직접) — 따옴표로 감싼 값의 쉼표·줄바꿈·이스케이프된 "" 를 처리하고,
// 앞의 BOM과 CRLF/LF 혼용 줄바꿈을 흡수한다.
function parseCsvText(raw: string): string[][] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue; // CRLF의 CR은 버리고 다음 \n에서 줄을 끊는다
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === '')); // 끝의 빈 줄 제거
}

// 재실행 안전 — 같은 type이고 스펙이 지정한 식별 필드가 같으면 같은 수단으로 본다.
function isDuplicate(existing: PaymentMethod, input: PaymentMethodInput): boolean {
  if (existing.type !== input.type) return false;
  if (input.type === 'bank') return existing.account === input.account;
  if (input.type === 'paypal') return existing.email === input.email;
  return existing.holder === input.holder; // paypay
}

function buildFeeCandidate(mode: string, value: string): unknown {
  const m = mode.trim();
  if (!m) return undefined; // 빈칸 → 수수료 없음
  const v = value.trim();
  if (m === 'grossUp') return { mode: 'grossUp', percent: Number(v) };
  if (m === 'fixed') return { mode: 'fixed', amount: Number(v) };
  return { mode: m }; // 알 수 없는 모드 — parsePaymentMethodInput이 검증 문구로 거른다
}

interface PlanRow {
  message: string;
  outcome: 'add' | 'skip' | 'error';
  influencerId?: string;
  input?: PaymentMethodInput;
  makeDefault?: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const csvPath = args.find((a) => !a.startsWith('--'));
  if (!csvPath) {
    console.error('사용법: import-payment-methods.ts <csv> [--apply]');
    process.exit(1);
  }

  const sql = getSql();
  const raw = await readFile(csvPath, 'utf8');
  const rows = parseCsvText(raw);
  if (rows.length === 0) {
    console.error('CSV가 비어 있어요');
    await sql.end();
    process.exit(1);
  }

  const header = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  // 핸들(대소문자 무시) 단위로 묶어 인플당 is_default 검사·중복 판정을 순서대로 한다.
  const groups = new Map<string, { displayHandle: string; rows: Array<{ line: number; rec: Record<string, string> }> }>();
  let exampleSkipped = 0;

  dataRows.forEach((row, idx) => {
    const line = idx + 2; // 1행은 헤더
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = row[i] ?? ''; });

    const rawHandle = (rec.handle ?? '').trim();
    if (rawHandle.startsWith(EXAMPLE_PREFIX)) {
      console.log(`(${line}번째 줄) 예시 행 건너뜀: ${rawHandle}`);
      exampleSkipped++;
      return;
    }

    const handle = rawHandle.replace(/^@/, '').trim();
    const key = handle.toLowerCase();
    if (!groups.has(key)) groups.set(key, { displayHandle: handle, rows: [] });
    groups.get(key)!.rows.push({ line, rec });
  });

  const plan: PlanRow[] = [];
  let addCount = 0, skipCount = 0, errorCount = 0;

  for (const { displayHandle: handle, rows: groupRows } of groups.values()) {
    if (!handle) {
      for (const { line } of groupRows) {
        plan.push({ message: `(${line}번째 줄) [오류: 핸들 없음]`, outcome: 'error' });
        errorCount++;
      }
      continue;
    }

    const influencer = await findByHandle(sql, handle);
    if (!influencer) {
      for (const { line } of groupRows) {
        plan.push({ message: `(${line}번째 줄) @${handle} → [오류: 핸들 없음]`, outcome: 'error' });
        errorCount++;
      }
      continue;
    }

    const yRows = groupRows.filter(({ rec }) => (rec.is_default ?? '').trim().toUpperCase() === 'Y');
    if (yRows.length >= 2) {
      for (const { line } of groupRows) {
        plan.push({ message: `(${line}번째 줄) @${handle} → [오류: 기본 표시(is_default=Y)가 2개 이상이에요]`, outcome: 'error' });
        errorCount++;
      }
      continue;
    }

    const existingRows = await sql<Array<{ payment_methods: PaymentMethod[] }>>`
      select payment_methods from influencer where id = ${influencer.id}`;
    let simulated: PaymentMethod[] = existingRows[0]?.payment_methods ?? [];
    let simCounter = 0;
    const newId = () => `sim-${influencer.id}-${simCounter++}`;

    for (const { line, rec } of groupRows) {
      const candidate = {
        type: (rec.type ?? '').trim(),
        holder: rec.holder ?? '',
        currency: (rec.currency ?? '').trim(),
        email: rec.email ?? '',
        identifier: rec.identifier ?? '',
        bank: rec.bank ?? '',
        branch: rec.branch ?? '',
        account: rec.account ?? '',
        fee: buildFeeCandidate(rec.fee_mode ?? '', rec.fee_value ?? ''),
        memo: rec.memo ?? '',
      };
      const parsed = parsePaymentMethodInput(candidate);
      if (typeof parsed === 'string') {
        plan.push({ message: `(${line}번째 줄) @${handle} → [오류: ${parsed}]`, outcome: 'error' });
        errorCount++;
        continue;
      }

      const dup = simulated.find((m) => isDuplicate(m, parsed));
      if (dup) {
        plan.push({ message: `(${line}번째 줄) @${handle} → ${describeMethod(parsed)}  [건너뜀: 같은 수단 있음]`, outcome: 'skip' });
        skipCount++;
        continue;
      }

      const makeDefault = (rec.is_default ?? '').trim().toUpperCase() === 'Y';
      // 실제 저장과 같은 순수 연산으로 시뮬레이션 — 첫 수단 자동 기본·makeDefault 처리가 lib과 정확히 일치한다.
      const { list } = applyPaymentOp(simulated, { kind: 'add', input: parsed, makeDefault }, new Date().toISOString(), newId);
      const added = list[list.length - 1];
      simulated = list;
      const tag = added.isDefault ? '  [추가] [기본]' : '  [추가]';
      plan.push({
        message: `(${line}번째 줄) @${handle} → ${describeMethod(added)}${tag}`,
        outcome: 'add',
        influencerId: influencer.id,
        input: parsed,
        makeDefault,
      });
      addCount++;
    }
  }

  for (const p of plan) console.log(p.message);
  if (exampleSkipped > 0) console.log(`예시 행 ${exampleSkipped}건 건너뜀(위 경고 참고)`);
  console.log(`\n요약: 추가 ${addCount} · 건너뜀 ${skipCount} · 오류 ${errorCount}`);

  if (errorCount > 0) {
    console.error('\n오류가 있어 아무것도 반영하지 않았어요 — 위 오류를 CSV에서 고친 뒤 다시 실행해 주세요.');
    await sql.end();
    process.exit(1);
  }

  if (!apply) {
    console.log('\n드라이런입니다 — 실제로 반영하려면 --apply를 붙여 다시 실행하세요.');
    await sql.end();
    return;
  }

  for (const p of plan) {
    if (p.outcome !== 'add' || !p.input || !p.influencerId) continue;
    await updatePaymentMethods(sql, p.influencerId, { kind: 'add', input: p.input, makeDefault: p.makeDefault }, null);
  }
  console.log(`\n적용 완료: ${addCount}건 추가됨.`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
