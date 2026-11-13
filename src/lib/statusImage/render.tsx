// 캠페인 현황 이미지를 PNG로(스펙 2026-11-13 §5) — next/og ImageResponse. 한글 글꼴은 묶음 한도(약 500KB)보다 커서
// 실행 시점에 디스크에서 읽는다(next.config.ts outputFileTracingIncludes가 함수에 같이 담는다). 모듈 수준에서 한 번만 읽는다.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import type { Overview } from '../campaignOverview.ts';
import { StatusImage, LAYOUT_W, X, imageHeight } from './StatusImage.tsx';

const FONT_DIR = path.join(process.cwd(), 'src/lib/statusImage/fonts');
let fonts: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }>> | null = null;
const toAb = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
function loadFonts() {
  fonts ??= Promise.all([
    readFile(path.join(FONT_DIR, 'Pretendard-Regular.otf')),
    readFile(path.join(FONT_DIR, 'Pretendard-Bold.otf')),
  ]).then(([r, b]) => [
    { name: 'Pretendard', data: toAb(r), weight: 400 as const, style: 'normal' as const },
    { name: 'Pretendard', data: toAb(b), weight: 700 as const, style: 'normal' as const },
  ]).catch((e) => { fonts = null; throw e; });   // 실패를 굳혀 두지 않는다 — 다음 요청이 다시 읽는다
  return fonts;
}

export function statusImageResponse(o: Overview, sentAt: Date, fontList: Awaited<ReturnType<typeof loadFonts>>): ImageResponse {
  return new ImageResponse(<StatusImage o={o} sentAt={sentAt} />, {
    width: LAYOUT_W * X, height: imageHeight(o.cards.length), fonts: fontList,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function renderStatusPng(o: Overview, sentAt: Date): Promise<ArrayBuffer> {
  const res = statusImageResponse(o, sentAt, await loadFonts());
  return res.arrayBuffer();
}

export async function renderStatusResponse(o: Overview, sentAt: Date): Promise<ImageResponse> {
  return statusImageResponse(o, sentAt, await loadFonts());
}
