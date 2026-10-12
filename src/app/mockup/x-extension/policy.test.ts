import test from 'node:test';
import assert from 'node:assert/strict';
import { campaigns, seedData } from './data';
import {
  applyAutomaticVisit,
  bucket,
  canCompleteVisit,
  canEndReservation,
  completed,
  commonFlow,
  differences,
  endReservation,
  fillTemplate,
  koreanDay,
  nextKoreanMidnight,
  operating,
  participatingCampaigns,
  preferredAt,
  requestCount,
  reservationActions,
  saveReservation,
  settlementCandidate,
  stopForLimit,
  taskStatus,
  timeGuidance,
  uploadWindow,
  updateReservationInput,
  reservationScheduleSheet,
  validIntervals,
} from './policy';
import {
  formatReservationName,
  readClientSheetInputs,
  splitReservationName,
  updateClientSheetInput,
} from './sheet';
const sample = (id = 'visit-waiting') => seedData().tasks.find((t) => t.id === id)!;
test('참여 캠페인은 선택한 인플루언서의 작업만 묶고 최신 기간순으로 표시한다', () => {
  const rows = participatingCampaigns(campaigns, seedData().tasks, 'hana');
  assert.deepEqual(
    rows.map((r) => r.campaign.id),
    ['winter', 'autumn', 'skin'],
  );
  const autumn = rows.find((r) => r.campaign.id === 'autumn')!;
  assert.equal(autumn.tasks.length, 4);
  assert.equal(autumn.taskCount, 3);
  assert.equal(autumn.endedCount, 1);
  assert.equal(autumn.typeSummary, '방문협찬 3');
  assert.equal(autumn.subtotal, '90,000 엔');
  assert.deepEqual(participatingCampaigns(campaigns, seedData().tasks, 'mika'), []);
});
test('참여 캠페인의 비용은 통화별로 더하고 비용 없음·미등록·취소를 구분한다', () => {
  const t = sample();
  const summarize = (tasks: (typeof t)[]) => participatingCampaigns(campaigns, tasks, t.personId)[0];
  assert.equal(
    summarize([t, { ...t, id: 'krw', currency: 'KRW', amount: '40000' }]).subtotal,
    '30,000 엔 · 40,000 원',
  );
  assert.equal(summarize([{ ...t, noCost: true }]).subtotal, '비용 없음');
  assert.equal(summarize([{ ...t, amount: '' }]).subtotal, '금액 미등록 1건');
  assert.equal(summarize([t, { ...t, id: 'missing', amount: '' }]).subtotal, '30,000 엔 · 금액 미등록 1건');
  assert.equal(summarize([{ ...t, amount: '0' }]).subtotal, '0 엔');
  const ended = summarize([{ ...t, end: { kind: '취소', reason: '일정 취소', at: '' } }]);
  assert.equal(ended.subtotal, '—');
  assert.equal(ended.taskCount, 0);
  assert.equal(ended.endedCount, 1);
});
test('one save changing visit and treatment also updates default deadline as one request', () => {
  const waiting = sample();
  const t = saveReservation(waiting, waiting.reservation!.sheet, 'correction', true);
  const text = updateClientSheetInput(
    updateClientSheetInput(t.reservation!.sheet, 'preferred', '2026-10-31T17:00'),
    'treatment',
    '리쥬란',
  );
  const next = saveReservation(t, text, 'customer_request');
  assert.equal(requestCount(next), 1);
  assert.equal(next.reservation!.history[0].differences!.length, 3);
  assert.equal(next.id, t.id);
  assert.match(next.reservation!.sheet, /전달 메모: 동반자 1명/);
  assert.equal(next.reservation!.phase, 'confirmed');
  assert.equal(next.visitOn, '2026-10-31');
  assert.equal(requestCount(saveReservation(next, next.reservation!.sheet, 'customer_request')), 1);
});
test('format-only changes are not a request', () => {
  const t = sample();
  const text = t
    .reservation!.sheet.split('\n')
    .map((s) => `  ${s}  `)
    .join('\r\n\r\n')
    .replace('2026-10-28 16:00', '2026-10-28T16:00');
  assert.deepEqual(differences(t.reservation!.sheet, text), []);
  assert.equal(requestCount(saveReservation(t, text, 'customer_request')), 0);
});
test('확정 전 수정과 첫 확정은 요청 횟수에 포함하지 않는다', () => {
  const t = sample();
  const first = saveReservation(t, t.reservation!.sheet, 'customer_request', true);
  assert.equal(first.reservation!.phase, 'confirmed');
  assert.equal(preferredAt(first), '2026-10-28T16:00');
  assert.equal(requestCount(first), 0);
  const changed = saveReservation(
    t,
    updateClientSheetInput(t.reservation!.sheet, 'treatment', '포텐자'),
    'customer_request',
    true,
  );
  assert.equal(requestCount(changed), 0);
  assert.equal(changed.reservation!.history[0].reason, 'waiting_edit');
  assert.equal(changed.reservation!.history[0].differences![0].before, '울쎄라');
});
test('대기는 사유 없이 수정 이력만 남기고 확정 후에는 사유를 요구한다', () => {
  const t = sample();
  const sheet = updateClientSheetInput(t.reservation!.sheet, 'treatment', '쥬베룩');
  const next = saveReservation(t, sheet, 'waiting_edit');
  assert.equal(next.reservation!.phase, 'waiting');
  assert.equal(next.reservation!.history[0].reason, 'waiting_edit');
  assert.equal(requestCount(next), 0);
  assert.equal(next.scheduledOn, t.scheduledOn);
  const confirmed = saveReservation(next, sheet, 'waiting_edit', true);
  assert.throws(() => saveReservation(confirmed, sheet, 'waiting_edit'), /수정 사유/);
  const requested = saveReservation(
    confirmed,
    updateClientSheetInput(sheet, 'treatment', '포텐자'),
    'customer_request',
  );
  assert.equal(requestCount(requested), 1);
});
test('confirmed visit modification synchronizes the default deadline across year boundaries', () => {
  const t = sample('visit-confirmed');
  const next = saveReservation(
    t,
    updateClientSheetInput(t.reservation!.sheet, 'preferred', '2026-12-31T17:30'),
    'correction',
  );
  assert.equal(preferredAt(next), '2026-12-31T17:30');
  assert.equal(next.visitOn, '2026-12-31');
  assert.equal(next.scheduledOn, '2027-01-14');
  assert.equal(readClientSheetInputs(next.reservation!.sheet).uploadDeadline, next.scheduledOn);
  assert.equal(requestCount(next), 2);
});
test('3 request limit blocks save but allows corrections; stop is explicit and idempotent', () => {
  const t = sample('visit-limit'),
    text = updateClientSheetInput(t.reservation!.sheet, 'treatment', '다른 시술');
  assert.throws(() => saveReservation(t, text, 'customer_request'));
  const correction = saveReservation(t, text, 'correction');
  assert.equal(requestCount(correction), 3);
  const stopped = stopForLimit(t);
  assert.equal(requestCount(stopped), 4);
  assert.equal(stopped.end?.kind, '취소');
  assert.equal(stopped.reservation!.sheet, t.reservation!.sheet);
  assert.equal(bucket(stopped), 'ended');
  assert.deepEqual(stopForLimit(stopped), stopped);
  assert.throws(() => saveReservation(stopped, text, 'correction'));
});
test('ended and completed tasks cannot be edited', () => {
  const t = sample('visit-noshow');
  assert.throws(() => saveReservation(t, t.reservation!.sheet, 'correction', true));
  const done = { ...sample(), noCost: true, posted: true };
  assert.throws(() => saveReservation(done, done.reservation!.sheet, 'correction'));
});
test('invalid or missing datetime cannot confirm; waiting can be saved manually', () => {
  const t = sample();
  const text = updateClientSheetInput(t.reservation!.sheet, 'preferred', '2026-02-30T16:00');
  assert.throws(() => saveReservation(t, text, 'correction', true));
  assert.equal(saveReservation(t, text, 'correction').reservation!.phase, 'waiting');
});
test('upload calendar spans month/year and leap boundaries without excluding weekends', () => {
  assert.deepEqual(uploadWindow('2026-10-08T16:00'), { start: '2026-10-09', end: '2026-10-22' });
  assert.deepEqual(uploadWindow('2026-12-28T15:00'), { start: '2026-12-29', end: '2027-01-11' });
  assert.deepEqual(uploadWindow('2028-02-28T15:00'), { start: '2028-02-29', end: '2028-03-13' });
  assert.equal(uploadWindow('2026-02-30'), null);
  assert.equal(uploadWindow(''), null);
});
test('updating one field preserves CRLF, labels, free notes, and historical template', () => {
  const raw =
    '@hana_mozu\r\nhttps://x.com/hana_mozu\r\n\r\n  1. 희망 일시： 2026-10-28 16:00  \r\n7. 희망 시술 내용: 울쎄라\r\n\r\n추가 문구  \r\n';
  const changed = updateClientSheetInput(raw, 'preferred', '2026-11-01T15:00');
  assert.equal(changed, raw.replace('2026-10-28 16:00', '2026-11-01 15:00'));
  assert.equal(readClientSheetInputs(changed).preferred, '2026-11-01T15:00');
});
test('unstructured notes produce exact before/after snapshot', () => {
  const t = sample(),
    a = t.reservation!.sheet,
    b = `${a}\n추가 안내`;
  assert.deepEqual(differences(a, b), [
    { field: 'sheet', label: '기재 시트 추가 문구', before: a, after: b },
  ]);
});
test('explicit free sponsorship completes on posting; zero and absent amounts are not free', () => {
  const t = { ...sample(), posted: true, amount: '0' };
  assert.equal(completed(t), false);
  assert.equal(settlementCandidate(t), true);
  assert.equal(completed({ ...t, amount: '' }), false);
  const free = { ...t, noCost: true };
  assert.equal(completed(free), true);
  assert.equal(bucket(free), 'done');
  assert.equal(settlementCandidate(free), false);
  assert.equal(bucket({ ...t, paid: true }), 'done');
});
test('calendar date exceptions override holiday and unknown data', () => {
  const b = seedData().branches[0];
  assert.equal(operating(b, '2026-10-09').state, '운영');
  assert.equal(operating(b, '2026-10-09', false).state, '운영');
  assert.equal(operating(b, '2026-10-14').state, '휴무');
  assert.equal(operating(b, '2026-10-05').state, '휴무');
  assert.equal(operating({ ...b, holiday: 'special' }, '2026-10-05').hours, b.holidayHours);
  assert.equal(operating({ ...b, holiday: 'unknown' }, '2026-10-05').state, '확인 필요');
  assert.equal(operating(b, '2026-11-02').state, '확인 필요');
  assert.equal(operating(b, '2026-10-07', false).state, '확인 필요');
  assert.match(timeGuidance(b, '2026-10-07T13:30'), /점심 또는 운영시간 밖/);
  assert.match(timeGuidance(b, '2026-10-07T14:00'), /운영시간 내/);
});
test('operating intervals reject overlapping and impossible times', () => {
  assert.equal(validIntervals('10:00-13:00, 14:00-19:00'), true);
  for (const text of ['25:00-26:00', '14:00-10:00', '10:00-14:00, 13:00-17:00'])
    assert.equal(validIntervals(text), false);
});
test('template substitution preserves lines and unknown placeholders, missing values remain explicit', () => {
  assert.equal(
    fillTemplate('{{handle}}\n{{name}}\n{{other}}', { handle: '@hana', name: '' }),
    '@hana\n-\n{{other}}',
  );
});
test('manual visit completion is available only during the preferred Korean date', () => {
  const t = sample('visit-confirmed'); // October 8 at 16:00 in Korea
  assert.equal(canCompleteVisit(t, Date.parse('2026-10-07T14:59:59.999Z')), false);
  assert.equal(canCompleteVisit(t, Date.parse('2026-10-07T15:00:00Z')), true);
  assert.equal(canCompleteVisit(t, Date.parse('2026-10-08T14:59:59.999Z')), true);
  assert.equal(canCompleteVisit(t, Date.parse('2026-10-08T15:00:00Z')), false);
  assert.equal(canCompleteVisit({ ...t, visited: true }, Date.parse('2026-10-08T01:00:00Z')), false);
  assert.equal(canCompleteVisit(sample(), Date.parse('2026-10-28T01:00:00Z')), false);
});
test('confirmed visits advance exactly at next midnight and preserve reservation records', () => {
  const t = sample('visit-confirmed');
  assert.equal(applyAutomaticVisit(t, Date.parse('2026-10-08T14:59:59.999Z')), t);
  const next = applyAutomaticVisit(t, Date.parse('2026-10-08T15:00:00Z'));
  assert.equal(taskStatus(next), '방문');
  assert.equal(next.reservation, t.reservation);
  assert.equal(requestCount(next), requestCount(t));
  assert.equal(applyAutomaticVisit(next, Date.parse('2026-10-09T15:00:00Z')), next);
  assert.equal(taskStatus(applyAutomaticVisit(t, Date.parse('2026-10-20T00:00:00Z'))), '방문');
});
test('automatic visits do not modify waiting, ended, uploaded, or legacy-only tasks', () => {
  const t = sample('visit-confirmed');
  for (const task of [
    sample(),
    sample('visit-cancelled'),
    sample('visit-noshow'),
    sample('visit-legacy'),
    { ...t, posted: true },
    { ...t, type: 'post' as const },
    { ...t, reservation: { ...t.reservation!, sheet: '1. 희망 일시: 2026-02-30 16:00' } },
    { ...t, reservation: { ...t.reservation!, sheet: '' } },
  ]) {
    assert.equal(applyAutomaticVisit(task, Date.parse('2027-01-01T00:00:00Z')), task);
    assert.equal(canCompleteVisit(task, Date.parse('2026-10-08T01:00:00Z')), false);
  }
});
test('rescheduling before the visit uses the newly saved preferred date', () => {
  const t = sample('visit-confirmed');
  const next = saveReservation(
    t,
    updateClientSheetInput(t.reservation!.sheet, 'preferred', '2026-11-02T11:00'),
    'correction',
  );
  assert.equal(applyAutomaticVisit(next, Date.parse('2026-10-08T15:00:00Z')), next);
  assert.equal(canCompleteVisit(next, Date.parse('2026-11-02T01:00:00Z')), true);
  assert.equal(taskStatus(applyAutomaticVisit(next, Date.parse('2026-11-02T15:00:00Z'))), '방문');
});
test('automatic visit calendar handles month, year, and leap-day boundaries in Korean time', () => {
  const t = sample('visit-confirmed');
  for (const [preferred, boundary] of [
    ['2026-10-31T16:00', '2026-10-31T15:00:00Z'],
    ['2026-12-31T16:00', '2026-12-31T15:00:00Z'],
    ['2028-02-29T16:00', '2028-02-29T15:00:00Z'],
  ]) {
    const task = saveReservation(
      t,
      updateClientSheetInput(t.reservation!.sheet, 'preferred', preferred),
      'correction',
    );
    const midnight = Date.parse(boundary);
    assert.equal(applyAutomaticVisit(task, midnight - 1), task);
    assert.equal(canCompleteVisit(task, midnight - 1), true);
    assert.equal(applyAutomaticVisit(task, midnight).visited, true);
    assert.equal(nextKoreanMidnight(midnight - 1), midnight);
  }
  assert.equal(koreanDay(Date.parse('2026-12-31T15:00:00Z')), '2027-01-01');
});
test('visit badges follow reservation stages and keep cancellation separate from no-show', () => {
  const t = sample('visit-confirmed');
  assert.equal(taskStatus(sample()), '대기');
  assert.equal(taskStatus(t), '확정');
  assert.equal(taskStatus({ ...t, visited: true }), '방문');
  assert.equal(taskStatus({ ...t, posted: true }), '업로드');
  assert.equal(taskStatus({ ...t, posted: true, settlementActive: true }), '정산');
  assert.equal(taskStatus({ ...t, posted: true, noCost: true }), '완료');
  assert.equal(taskStatus(sample('visit-cancelled')), '취소');
  assert.equal(taskStatus(sample('visit-noshow')), '노쇼');
  assert.equal(taskStatus({ ...t, type: 'post', flow: 'prep' }), '준비');
});
test('reservation actions distinguish waiting, before visit, visit day, and visited states', () => {
  const t = sample('visit-confirmed');
  const before = Date.parse('2026-10-07T14:59:59.999Z');
  const visitDay = Date.parse('2026-10-07T15:00:00Z');
  assert.deepEqual(reservationActions(sample(), before), {
    confirm: true,
    cancel: true,
    completeVisit: false,
    noShow: null,
  });
  assert.deepEqual(reservationActions(t, before), {
    confirm: false,
    cancel: true,
    completeVisit: false,
    noShow: null,
  });
  assert.deepEqual(reservationActions(t, visitDay), {
    confirm: false,
    cancel: true,
    completeVisit: true,
    noShow: '노쇼',
  });
  const afterVisit = { confirm: false, cancel: false, completeVisit: false, noShow: '업로드 노쇼' };
  assert.deepEqual(reservationActions({ ...t, visited: true }, visitDay), afterVisit);
  assert.deepEqual(reservationActions(t, Date.parse('2026-10-08T15:00:00Z')), afterVisit);
  assert.deepEqual(reservationActions(sample('visit-legacy'), before), afterVisit);
});
test('uploaded, settled, completed and ended tasks have no reservation status actions', () => {
  const t = sample('visit-confirmed');
  for (const task of [
    { ...t, visited: true, posted: true },
    { ...t, settlementActive: true },
    { ...t, posted: true, noCost: true },
    sample('visit-cancelled'),
    sample('visit-noshow'),
    sample('content-free'),
  ]) {
    assert.deepEqual(reservationActions(task, Date.parse('2026-10-08T01:00:00Z')), {
      confirm: false,
      cancel: false,
      completeVisit: false,
      noShow: null,
    });
  }
});
test('예약을 연결하기 전인 방문 작업도 진행 안 됨에서 취소하고 작업 내용을 보존한다', () => {
  const task = { ...sample(), reservation: undefined, visited: false, note: '방문 협의 중' };
  const now = Date.parse('2026-10-04T01:00:00Z');
  assert.equal(reservationActions(task, now).cancel, true);
  const ended = endReservation(task, '취소', '협찬 일정 취소', now);
  assert.equal(ended.end?.kind, '취소');
  assert.equal(ended.note, task.note);
  assert.equal(ended.amount, task.amount);
  assert.equal(ended.reservation, undefined);
  assert.equal(canEndReservation(ended, '취소', now), false);
  assert.equal(canEndReservation({ ...task, posted: true }, '취소', now), false);
  assert.equal(canEndReservation({ ...task, visited: true }, '취소', now), false);
});
test('visit no-show and upload no-show remain distinct while preserving records', () => {
  const task = sample('visit-confirmed'),
    now = Date.parse('2026-10-08T01:00:00Z');
  const absent = endReservation(task, '노쇼', '연락 없이 미방문', now);
  assert.equal(taskStatus(absent), '노쇼');
  assert.equal(absent.visited, false);
  const visited = { ...task, visited: true };
  const noUpload = endReservation(visited, '업로드 노쇼', '  콘텐츠 미업로드  ', now);
  assert.equal(taskStatus(noUpload), '업로드 노쇼');
  assert.equal(noUpload.visited, true);
  assert.equal(noUpload.end?.reason, '콘텐츠 미업로드');
  assert.equal(bucket(noUpload), 'ended');
  assert.equal(noUpload.reservation, visited.reservation);
  assert.equal(requestCount(noUpload), requestCount(visited));
  assert.equal(canEndReservation(visited, '취소', now), false);
  assert.equal(canEndReservation(visited, '노쇼', now), false);
  assert.throws(() => endReservation(visited, '업로드 노쇼', ' ', now));
});
test('an open cancellation or visit no-show dialog cannot commit after the midnight transition', () => {
  const t = sample('visit-confirmed'),
    midnight = Date.parse('2026-10-08T15:00:00Z');
  for (const kind of ['취소', '노쇼'] as const) {
    assert.equal(canEndReservation(t, kind, midnight - 1), true);
    assert.throws(() => endReservation(t, kind, '이전 상태에서 작성한 사유', midnight));
  }
  const next = endReservation(t, '업로드 노쇼', '콘텐츠 미업로드', midnight);
  assert.equal(next.visited, true);
  assert.equal(next.end?.kind, '업로드 노쇼');
});
test('name editing understands both name orders and retains single-language names', () => {
  for (const name of ['곤도 사에(kondo sae)', 'kondo sae（곤도 사에）', '곤도 사에 ( kondo sae )'])
    assert.deepEqual(splitReservationName(name), { korean: '곤도 사에', roman: 'kondo sae' });
  assert.deepEqual(splitReservationName('곤도 사에'), { korean: '곤도 사에', roman: '' });
  assert.deepEqual(splitReservationName('kondo sae'), { korean: '', roman: 'kondo sae' });
  assert.equal(formatReservationName({ korean: '', roman: ' kondo sae ' }), 'kondo sae');
  assert.equal(formatReservationName({ korean: ' 곤도 사에 ', roman: '' }), '곤도 사에');
  assert.equal(formatReservationName({ korean: '', roman: '' }), '');
});
test('editing both name parts saves one name change and preserves the rest of the sheet', () => {
  const task = sample();
  const original = task.reservation!.sheet.replace(/\n/g, '\r\n');
  const base = { ...task, reservation: { ...task.reservation!, sheet: original } };
  const combined = formatReservationName({ korean: '곤도 사에코', roman: 'Kondo Saeko' });
  const edited = updateClientSheetInput(original, 'name', combined);
  assert.equal(edited, original.replace('곤도 사에(kondo sae)', '곤도 사에코(Kondo Saeko)'));
  const saved = saveReservation(base, edited, 'customer_request');
  assert.equal(requestCount(saved), 0);
  assert.equal(saved.reservation!.history[0].reason, 'waiting_edit');
  assert.deepEqual(saved.reservation!.history[0].differences, [
    {
      field: 'name',
      label: '이름',
      before: '곤도 사에(kondo sae)',
      after: '곤도 사에코(Kondo Saeko)',
    },
  ]);
});

test('방문 예약 확정·방문은 기존 공통 작업 단계를 바꾸지 않는다', () => {
  const waiting = sample();
  const confirmed = saveReservation(waiting, waiting.reservation!.sheet, 'correction', true);
  const visited = applyAutomaticVisit(confirmed, Date.parse('2026-10-29T00:00:00+09:00'));
  for (const task of [waiting, confirmed, visited]) assert.equal(commonFlow(task), 'prep');
  assert.equal(taskStatus(confirmed), '확정');
  assert.equal(taskStatus(visited), '방문');
  assert.equal(visited.scheduledOn, waiting.scheduledOn);
  assert.equal(commonFlow({ ...visited, posted: true }), 'posted');
  assert.equal(commonFlow({ ...visited, posted: true, settlementActive: true }), 'settle');
  assert.equal(commonFlow({ ...visited, posted: true, paid: true }), 'done');
  assert.equal(commonFlow({ ...visited, end: { kind: '업로드 노쇼', reason: '미업로드', at: '' } }), 'canc');
});

test('calendar edits synchronize the reservation form and sheet without altering customer source', () => {
  const t = sample();
  const sheet = updateReservationInput(t.reservation!.sheet, 'preferred', '2026-10-30T15:30');
  assert.equal(readClientSheetInputs(sheet).uploadDeadline, '2026-11-13');
  const next = saveReservation(t, sheet, 'waiting_edit');
  assert.equal(next.scheduledOn, '2026-11-13');
  assert.equal(preferredAt(next), '2026-10-30T15:30');
  assert.equal(next.reservation!.source, t.reservation!.source);
  assert.match(next.reservation!.sheet, /전달 메모: 동반자 1명/);
  assert.equal(requestCount(next), 0);
  const deadline = saveReservation(
    next,
    updateReservationInput(next.reservation!.sheet, 'uploadDeadline', '2026-11-20'),
    'waiting_edit',
  );
  assert.equal(deadline.scheduledOn, '2026-11-20');
  assert.equal(deadline.reservation!.history.at(-1)!.differences![0].field, 'uploadDeadline');
  const moved = saveReservation(
    deadline,
    updateReservationInput(deadline.reservation!.sheet, 'preferred', '2026-11-01T11:00'),
    'waiting_edit',
  );
  assert.equal(moved.scheduledOn, '2026-11-20');
  assert.equal(readClientSheetInputs(moved.reservation!.sheet).uploadDeadline, '2026-11-20');
});
test('deadline validation preserves the existing booking, source and request count on rejection', () => {
  const t = sample('visit-confirmed');
  const snapshot = structuredClone(t);
  for (const date of ['2026-02-30', '2026-10-07', '2026-11-09 invalid']) {
    assert.throws(
      () =>
        saveReservation(
          t,
          updateReservationInput(t.reservation!.sheet, 'uploadDeadline', date),
          'correction',
        ),
      /업로드 기한/,
    );
    assert.deepEqual(t, snapshot);
  }
  const limited = sample('visit-limit');
  const sheet = updateReservationInput(limited.reservation!.sheet, 'uploadDeadline', '2026-11-20');
  assert.throws(() => saveReservation(limited, sheet, 'customer_request'), /3회/);
  assert.equal(requestCount(saveReservation(limited, sheet, 'correction')), 3);
});
test('a new reservation gets a default deadline while an explicit one is preserved', () => {
  const raw = '1. 희망 일시: 2026-12-28 15:00\n전달 메모: 그대로';
  const generated = reservationScheduleSheet(raw);
  assert.equal(readClientSheetInputs(generated).uploadDeadline, '2027-01-11');
  assert.equal(reservationScheduleSheet(generated), generated);
  assert.match(generated, /전달 메모: 그대로/);
  const custom = updateReservationInput(generated, 'uploadDeadline', '2027-01-05');
  assert.equal(reservationScheduleSheet(custom), custom);
});
