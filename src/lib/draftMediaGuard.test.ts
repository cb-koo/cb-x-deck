import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraftMedia, MAX_MEDIA_PER_POST } from './draftMediaGuard.ts';

test('normalizeDraftMedia: 정상 항목은 그대로 통과', () => {
  const media = [{ type: 'photo', url: 'draft/d1/a.jpg', videoUrl: null }];
  assert.deepEqual(normalizeDraftMedia(media), media);
});

test('normalizeDraftMedia: media 필드가 없으면(undefined) 빈 배열', () => {
  assert.deepEqual(normalizeDraftMedia(undefined), []);
});

test('normalizeDraftMedia: url이 문자열이 아니면 거절(null)', () => {
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: 123, videoUrl: null }]), null);
});

test('normalizeDraftMedia: type이 없으면 거절(null)', () => {
  assert.equal(normalizeDraftMedia([{ url: 'draft/d1/a.jpg', videoUrl: null }]), null);
});

test('normalizeDraftMedia: 항목이 객체가 아니면 거절(null) — 문자열', () => {
  assert.equal(normalizeDraftMedia(['draft/d1/a.jpg']), null);
});

test('normalizeDraftMedia: 항목이 객체가 아니면 거절(null) — null', () => {
  assert.equal(normalizeDraftMedia([null]), null);
});

test('normalizeDraftMedia: media 자체가 배열이 아니면 거절(null)', () => {
  assert.equal(normalizeDraftMedia('not-an-array'), null);
});

test('normalizeDraftMedia: 5장 이상이면 앞에서 4장만 남긴다', () => {
  const media = Array.from({ length: 6 }, (_, i) => ({ type: 'photo', url: `draft/d1/${i}.jpg`, videoUrl: null }));
  const result = normalizeDraftMedia(media);
  assert.equal(result!.length, MAX_MEDIA_PER_POST);
  assert.deepEqual(result, media.slice(0, 4));
});

test('normalizeDraftMedia: videoUrl은 null 또는 문자열만 허용', () => {
  assert.equal(normalizeDraftMedia([{ type: 'video', url: 'draft/d1/a.mp4', videoUrl: 123 }]), null);
  assert.deepEqual(
    normalizeDraftMedia([{ type: 'video', url: 'draft/d1/a.mp4', videoUrl: 'draft/d1/a.mp4' }]),
    [{ type: 'video', url: 'draft/d1/a.mp4', videoUrl: 'draft/d1/a.mp4' }],
  );
});
