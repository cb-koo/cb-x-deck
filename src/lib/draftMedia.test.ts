import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftMediaFilename, selectDraftImages, draftImageValidationError,
  draftMediaExtension, isGifDraftMedia, MAX_MEDIA_PER_POST,
} from './draftMedia.ts';
import type { DraftMediaFilenameInput } from './draftMedia.ts';

// 2026-08-12T05:00:00Z = 한국 14:00 8/12 — 날짜 경계에 안 걸리게 낮 시각을 쓴다.
const CREATED_AT = '2026-08-12T05:00:00.000Z';

function baseInput(overrides: Partial<DraftMediaFilenameInput> = {}): DraftMediaFilenameInput {
  return {
    createdAt: CREATED_AT,
    influencerHandle: 'hadakan',
    clientName: null,
    batchId: null,
    variantIndex: null,
    postIndex: 0,
    mediaIndex: 0,
    storageUrl: 'draft/d1/uuid.jpg',
    ...overrides,
  };
}

test('draftMediaFilename — 단문도 1-1로 통일(스펙 예시 그대로)', () => {
  assert.equal(draftMediaFilename(baseInput()), '20260812_hadakan_1-1.jpg');
});

test('draftMediaFilename — 스레드: 트윗번호-이미지순번이 postIndex/mediaIndex+1', () => {
  // 2번 트윗의 첫 이미지 — 스펙 예시 '20260812_hadakan_2-1.jpg'
  assert.equal(draftMediaFilename(baseInput({ postIndex: 1, mediaIndex: 0 })), '20260812_hadakan_2-1.jpg');
  // 같은 트윗의 두 번째 이미지
  assert.equal(draftMediaFilename(baseInput({ postIndex: 1, mediaIndex: 1 })), '20260812_hadakan_2-2.jpg');
});

test('draftMediaFilename — 미배정이면 클라이언트명이 그 자리에 들어간다', () => {
  assert.equal(
    draftMediaFilename(baseInput({ influencerHandle: null, clientName: '강남OO의원' })),
    '20260812_강남OO의원_1-1.jpg',
  );
});

test('draftMediaFilename — 미배정이고 클라이언트도 없으면 "미배정"으로 대체(빈 세그먼트 방지)', () => {
  assert.equal(
    draftMediaFilename(baseInput({ influencerHandle: null, clientName: null })),
    '20260812_미배정_1-1.jpg',
  );
});

test('draftMediaFilename — 다중 시안이면 시안 라벨 삽입(스펙 예시)', () => {
  assert.equal(
    draftMediaFilename(baseInput({ batchId: 'b1', variantIndex: 0 })),
    '20260812_hadakan_A_1-1.jpg',
  );
  assert.equal(
    draftMediaFilename(baseInput({ batchId: 'b1', variantIndex: 1 })),
    '20260812_hadakan_B_1-1.jpg',
  );
});

test('draftMediaFilename — 시안이 아니면(batchId null) 라벨을 넣지 않는다', () => {
  assert.equal(
    draftMediaFilename(baseInput({ batchId: null, variantIndex: 2 })), // variantIndex가 있어도 batchId 없으면 무시
    '20260812_hadakan_1-1.jpg',
  );
});

test('draftMediaFilename — 시안이지만 variantIndex가 없으면 A로 대체', () => {
  assert.equal(
    draftMediaFilename(baseInput({ batchId: 'b1', variantIndex: null })),
    '20260812_hadakan_A_1-1.jpg',
  );
});

test('draftMediaFilename — 핸들의 @는 제거', () => {
  assert.equal(
    draftMediaFilename(baseInput({ influencerHandle: '@hadakan' })),
    '20260812_hadakan_1-1.jpg',
  );
});

test('draftMediaFilename — 금지문자(/ \\ : * ? " < > |)는 밑줄로', () => {
  // 클라이언트명에 금지문자 9종(/ : * " < > | \ ?)을 모두 심어 각각 _로 바뀌는지 확인.
  // 끝의 '?'도 _가 되므로 뒤따르는 구분자 '_'와 이어져 '__1-1'이 된다 — 실제 동작이지 버그가 아니다.
  assert.equal(
    draftMediaFilename(baseInput({ influencerHandle: null, clientName: '강남/OO:의원*"<>|\\병원?' })),
    '20260812_강남_OO_의원______병원__1-1.jpg',
  );
});

test('draftMediaFilename — 확장자는 스토리지 경로에서 추출(대문자는 소문자로)', () => {
  assert.equal(
    draftMediaFilename(baseInput({ storageUrl: 'draft/d1/uuid.PNG' })),
    '20260812_hadakan_1-1.png',
  );
  assert.equal(
    draftMediaFilename(baseInput({ storageUrl: 'draft/d1/uuid.webp' })),
    '20260812_hadakan_1-1.webp',
  );
});

test('draftMediaFilename — 확장자를 못 찾으면 jpg로 대체', () => {
  assert.equal(
    draftMediaFilename(baseInput({ storageUrl: 'draft/d1/uuid' })),
    '20260812_hadakan_1-1.jpg',
  );
});

test('draftMediaExtension — 경로 끝의 확장자만 소문자로 뽑는다', () => {
  assert.equal(draftMediaExtension('draft/d1/x.jpg'), 'jpg');
  assert.equal(draftMediaExtension('draft/d1/x.GIF'), 'gif');
  assert.equal(draftMediaExtension('draft/d1/noext'), '');
  assert.equal(draftMediaExtension('draft/d1/trailing.'), '');
});

test('isGifDraftMedia — gif만 true', () => {
  assert.equal(isGifDraftMedia('draft/d1/x.gif'), true);
  assert.equal(isGifDraftMedia('draft/d1/x.GIF'), true);
  assert.equal(isGifDraftMedia('draft/d1/x.jpg'), false);
});

test('draftImageValidationError — 지원 형식은 통과', () => {
  const jpg = new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' });
  assert.equal(draftImageValidationError(jpg), null);
});

test('draftImageValidationError — 지원하지 않는 형식은 거절', () => {
  const pdf = new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' });
  assert.match(draftImageValidationError(pdf)!, /형식을 지원하지 않아요/);
});

test('draftImageValidationError — 5MB 초과는 거절', () => {
  const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
  assert.match(draftImageValidationError(big)!, /5MB를 넘어요/);
});

test('draftImageValidationError — 정확히 5MB는 통과(경계)', () => {
  const exact = new File([new Uint8Array(5 * 1024 * 1024)], 'exact.jpg', { type: 'image/jpeg' });
  assert.equal(draftImageValidationError(exact), null);
});

function makeFile(name: string, type = 'image/jpeg', size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

test('selectDraftImages — 자리 안에 다 들어가면 전부 accepted, slotMessage는 null', () => {
  const files = [makeFile('a.jpg'), makeFile('b.jpg')];
  const r = selectDraftImages(files, 4);
  assert.equal(r.accepted.length, 2);
  assert.equal(r.rejected.length, 0);
  assert.equal(r.slotMessage, null);
});

test('selectDraftImages — 스펙 예시: 2장 있는 포스트에 6장 드롭 → 2장만 받고 사유 안내', () => {
  const files = Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.jpg`));
  const remaining = MAX_MEDIA_PER_POST - 2; // 이미 2장 있음
  const r = selectDraftImages(files, remaining);
  assert.equal(r.accepted.length, 2);
  assert.equal(r.accepted[0].name, 'f0.jpg'); // 앞에서부터 채운다
  assert.equal(r.accepted[1].name, 'f1.jpg');
  assert.equal(r.slotMessage, '2장만 넣었어요 — 트윗당 4장까지예요');
  // 못 들어간 4장은 자리 부족 사유로 rejected에 남는다
  const overflowReasons = r.rejected.map((x) => x.reason);
  assert.equal(overflowReasons.length, 4);
  assert.ok(overflowReasons.every((reason) => reason === '트윗당 4장까지예요'));
});

test('selectDraftImages — 남은 자리가 0이면 전부 거절되고 slotMessage는 0장 기준', () => {
  const files = [makeFile('a.jpg'), makeFile('b.jpg')];
  const r = selectDraftImages(files, 0);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.slotMessage, '0장만 넣었어요 — 트윗당 4장까지예요');
});

test('selectDraftImages — 형식/용량 불량 파일은 자리를 차지하지 않고 각자 사유로 거절', () => {
  const good = makeFile('good.jpg');
  const badType = makeFile('bad.pdf', 'application/pdf');
  const badSize = makeFile('huge.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1);
  const r = selectDraftImages([badType, good, badSize], 4);
  assert.deepEqual(r.accepted.map((f) => f.name), ['good.jpg']); // 불량은 안 세고 good만 자리를 씀
  assert.equal(r.rejected.length, 2);
  assert.equal(r.slotMessage, null); // 자리가 모자란 게 아니라 형식/용량 문제라 사후 통보 문구는 안 띈다
  const byName = new Map(r.rejected.map((x) => [x.file.name, x.reason]));
  assert.match(byName.get('bad.pdf')!, /형식을 지원하지 않아요/);
  assert.match(byName.get('huge.jpg')!, /5MB를 넘어요/);
});

test('selectDraftImages — 음수 remainingSlots도 0으로 취급', () => {
  const r = selectDraftImages([makeFile('a.jpg')], -1);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.slotMessage, '0장만 넣었어요 — 트윗당 4장까지예요');
});
