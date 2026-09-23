import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQrDataUri } from './paymentQrInput.ts';

test('parseQrDataUri — 허용 형식만 통과하고 바이트를 돌려준다', () => {
  // 1x1 png
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const ok = parseQrDataUri(png);
  assert.ok(!('error' in ok));
  assert.equal(ok.contentType, 'image/png');
  assert.ok(ok.bytes.length > 0);
});

test('parseQrDataUri — 허용 밖 형식은 거절', () => {
  const gif = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  const r = parseQrDataUri(gif);
  assert.ok('error' in r);
  assert.match(r.error, /JPG|PNG|WebP/);
});

test('parseQrDataUri — data URI 형식이 아니면 거절', () => {
  const r = parseQrDataUri('https://example.com/qr.png');
  assert.ok('error' in r);
});

test('parseQrDataUri — base64가 깨졌으면 거절', () => {
  const r = parseQrDataUri('data:image/png;base64,!!!not-base64!!!');
  assert.ok('error' in r);
});

test('parseQrDataUri — 5MB를 넘으면 거절', () => {
  const big = 'data:image/png;base64,' + 'A'.repeat(8 * 1024 * 1024);
  const r = parseQrDataUri(big);
  assert.ok('error' in r);
  assert.match(r.error, /5MB|크기/);
});
