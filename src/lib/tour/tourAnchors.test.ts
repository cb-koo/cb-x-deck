// 앵커 회귀 방지 — 스텝이 가리키는 data-tour 키가 실제 컴포넌트에 남아 있는지 검사한다.
// tourSteps.test.ts는 스텝 '정의'만 보므로, 컴포넌트에서 data-tour가 사라져도 통과한다.
// 그 경우 런타임에는 skipMissingElement가 스텝을 조용히 건너뛰어 아무 신호도 남지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deckSteps, BRIEFING_STEPS, type TourStep } from './tourSteps.ts';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    if (!/\.tsx?$/.test(name) || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return [];
    // 스텝 정의 파일 자신은 제외 — 셀렉터 문자열이 앵커로 오인되면 검사가 무의미해진다
    if (p.endsWith(join('lib', 'tour', 'tourSteps.ts'))) return [];
    return [p];
  });
}

// data-tour="key" (정적) 과 data-tour={cond ? 'key' : undefined} (조건부) 두 형태를 모두 걷는다
function anchorsInSource(): Set<string> {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/data-tour=(?:"([\w-]+)"|\{[^}]*?'([\w-]+)'[^}]*?\})/g)) {
      found.add(m[1] ?? m[2]);
    }
  }
  return found;
}

function anchorKeys(steps: TourStep[]): string[] {
  return steps.flatMap((s) => {
    const m = s.element?.match(/^\[data-tour="([\w-]+)"\]$/);
    if (s.element) assert.ok(m, `셀렉터는 [data-tour="…"] 형태여야 함: ${s.element}`);
    return m ? [m[1]] : [];
  });
}

const inSource = anchorsInSource();

test('컴포넌트 소스에서 data-tour 앵커를 실제로 걷어온다 (정규식 자체 검증)', () => {
  // 이 검사가 0건을 걷어오면 아래 두 테스트가 무의미하게 통과한다 — 하한선을 박아둔다
  assert.ok(inSource.size >= 10, `앵커를 너무 적게 찾음(${inSource.size}) — 수집 정규식을 확인하세요`);
  assert.ok(inSource.has('help-button'), 'help-button 앵커를 찾지 못함 — 수집 로직 점검');
});

test('덱 스텝의 앵커가 모두 컴포넌트에 존재', () => {
  for (const key of anchorKeys(deckSteps())) {
    assert.ok(inSource.has(key), `data-tour="${key}" 를 쓰는 컴포넌트가 없음 — 스텝이 조용히 건너뛰어집니다`);
  }
});

test('브리핑 스텝의 앵커가 모두 컴포넌트에 존재', () => {
  for (const key of anchorKeys(BRIEFING_STEPS)) {
    assert.ok(inSource.has(key), `data-tour="${key}" 를 쓰는 컴포넌트가 없음 — 스텝이 조용히 건너뛰어집니다`);
  }
});

test('쓰이지 않는 앵커가 컴포넌트에 남아 있지 않다 (nav-deck·nav-briefing은 향후용으로 허용)', () => {
  const used = new Set([...anchorKeys(deckSteps()), ...anchorKeys(BRIEFING_STEPS)]);
  const reserved = new Set(['nav-deck', 'nav-briefing']);
  const orphans = [...inSource].filter((k) => !used.has(k) && !reserved.has(k));
  assert.deepEqual(orphans, [], `투어가 가리키지 않는 앵커: ${orphans.join(', ')}`);
});
