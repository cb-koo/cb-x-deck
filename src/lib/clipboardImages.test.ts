import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageFilesFromClipboard } from './clipboardImages.ts';

const file = (name: string, type: string) => new File(['x'], name, { type });

test('imageFilesFromClipboard — 이미지 파일만, 없으면 빈 배열(글자는 기본 붙여넣기로)', () => {
  const png = file('image.png', 'image/png');
  assert.deepEqual(imageFilesFromClipboard({ files: [png, file('a.pdf', 'application/pdf')] }), [png]);
  assert.deepEqual(imageFilesFromClipboard({ files: [] }), []);            // 글자만 복사
  assert.deepEqual(imageFilesFromClipboard(null), []);
  // files가 비고 items에만 실린 경우
  const jpg = file('c.jpg', 'image/jpeg');
  const items = [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, { kind: 'file', type: 'image/jpeg', getAsFile: () => jpg }];
  assert.deepEqual(imageFilesFromClipboard({ files: [], items }), [jpg]);
});
