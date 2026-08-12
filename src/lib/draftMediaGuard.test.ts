import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraftMedia, MAX_MEDIA_PER_POST } from './draftMediaGuard.ts';

// uploadDraftImage가 실제로 만드는 형태의 경로
const path = (n: number, ext = 'jpg') =>
  `draft/2c98fbaa-f96b-4d09-a550-20c2cacda668/e6779c58-d727-4d09-ba85-${String(n).padStart(12, '0')}.${ext}`;
const item = (n: number, ext = 'jpg') => ({ type: 'photo', url: path(n, ext), videoUrl: null });

test('normalizeDraftMedia: 정상 항목(스토리지 경로)은 그대로 통과', () => {
  const media = [item(1), item(2, 'webp'), item(3, 'png'), item(4, 'gif')];
  assert.deepEqual(normalizeDraftMedia(media), media);
});

test('normalizeDraftMedia: media 필드가 없으면(undefined) 빈 배열', () => {
  assert.deepEqual(normalizeDraftMedia(undefined), []);
});

test('normalizeDraftMedia: url이 문자열이 아니면 거절(null)', () => {
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: 123, videoUrl: null }]), null);
});

test('normalizeDraftMedia: type이 없으면 거절(null)', () => {
  assert.equal(normalizeDraftMedia([{ url: path(1), videoUrl: null }]), null);
});

test('normalizeDraftMedia: 항목이 객체가 아니면 거절(null) — 문자열', () => {
  assert.equal(normalizeDraftMedia([path(1)]), null);
});

test('normalizeDraftMedia: 항목이 객체가 아니면 거절(null) — null', () => {
  assert.equal(normalizeDraftMedia([null]), null);
});

test('normalizeDraftMedia: media 자체가 배열이 아니면 거절(null)', () => {
  assert.equal(normalizeDraftMedia('not-an-array'), null);
});

test('normalizeDraftMedia: 5장 이상이면 앞에서 4장만 남긴다', () => {
  const media = Array.from({ length: 6 }, (_, i) => item(i));
  const result = normalizeDraftMedia(media);
  assert.equal(result!.length, MAX_MEDIA_PER_POST);
  assert.deepEqual(result, media.slice(0, 4));
});

// 리뷰에서 잡힌 보안 결함의 회귀 테스트 — url은 uploadDraftImage가 만드는 스토리지 경로만.
// 임의 URL이 저장되면 워크스페이스 전원의 <img src>가 그 주소로 요청을 보낸다(추적 픽셀·IP 유출).
test('normalizeDraftMedia: 외부 절대 URL은 거절 — 임의 호스트로의 <img> 요청을 막는다', () => {
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: 'https://attacker.example/pixel.png', videoUrl: null }]), null);
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: 'http://pbs.twimg.com/a.jpg', videoUrl: null }]), null);
});

test('normalizeDraftMedia: 경로 이탈·형태 불일치 거절 — ../, 다른 버킷 경로, 비이미지 확장자', () => {
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: 'draft/../secret/a.jpg', videoUrl: null }]), null);
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: 'avatars/x.jpg', videoUrl: null }]), null);
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: path(1, 'svg'), videoUrl: null }]), null);
});

test('normalizeDraftMedia: photo 외 type·videoUrl 값은 거절 — 업로드 UI가 만들 수 없는 조합', () => {
  assert.equal(normalizeDraftMedia([{ type: 'video', url: path(1), videoUrl: null }]), null);
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: path(1), videoUrl: 'x' }]), null);
  assert.equal(normalizeDraftMedia([{ type: 'photo', url: path(1), videoUrl: 123 }]), null);
});
