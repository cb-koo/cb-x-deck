import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_CHIP, TYPE_CHIP, FLOW_STEPS } from './flowChips.ts';
import { FLOW_STAGES, TASK_TYPES } from './campaignJudgment.ts';

test('1) 모든 단계·유형에 색이 있다', () => {
  for (const s of FLOW_STAGES) assert.ok(STAGE_CHIP[s], s);
  for (const t of TASK_TYPES) assert.ok(TYPE_CHIP[t], t);
});

test('2) 흐름 줄은 취소를 뺀 5단계, 판정 순서 그대로', () => {
  assert.deepEqual([...FLOW_STEPS], ['prep', 'handed', 'posted', 'settle', 'done']);
});
