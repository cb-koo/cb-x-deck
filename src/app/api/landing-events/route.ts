// src/app/api/landing-events/route.ts
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSql } from '@/lib/db';
import { parseLandingEvents } from '@/lib/landingEvent';
import { insertLandingEvents } from '@/lib/landingEventStore';

// 브릿지 서버 → 우리. 사람이 아니라 서버가 부르므로 세션 게이트(requireMember)가 아니라 공유 시크릿이다.
// 설계: docs/superpowers/specs/2026-08-25-landing-events-design.md §수집 API
function authorized(req: Request): boolean {
  const secret = process.env.LANDING_EVENTS_SECRET;
  if (!secret) return false; // env가 비어 있으면 '열린 API'가 아니라 '닫힌 API'다
  const header = req.headers.get('authorization') ?? '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorized(req)) return new NextResponse(null, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = parseLandingEvents(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error, index: parsed.index, field: parsed.field }, { status: 400 });
  }
  // 저장 실패는 그대로 500 — 브릿지가 재시도하고, event_id 멱등이 중복을 막는다
  const result = await insertLandingEvents(getSql(), parsed.events);
  return NextResponse.json(result, { status: 202 });
}
