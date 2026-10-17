import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { requireAllowedUser } from '@/lib/authGuard';
import { readView, readCrm, lastRun } from '@/lib/marketClinicStore';
import { DEPARTMENTS } from '@/lib/marketClinic';

// 클리닉 지도 화면 데이터 — 수집 때 만들어 둔 진료과별 완성본 + 영업 상태(요청 때 monthly-report에서 읽기만).
// 매출 추정 데이터라 팀원만(스펙 2026-10-17 §3). 피부과 약 2.3MB(압축하면 0.7MB)라 진료과 하나씩 준다.
export async function GET(req: Request) {
  const gate = await requireAllowedUser();
  if (gate.response) return gate.response;
  const dept = new URL(req.url).searchParams.get('dept') ?? '피부과';
  if (!(DEPARTMENTS as readonly string[]).includes(dept)) return NextResponse.json({ error: '없는 진료과예요' }, { status: 400 });
  const sql = getSql();
  const [view, crm, run] = await Promise.all([readView(sql, dept), readCrm(sql, dept), lastRun(sql)]);
  if (!view) return NextResponse.json({ error: '아직 수집된 데이터가 없어요' }, { status: 404 });
  return NextResponse.json({ builtAt: view.builtAt, departments: DEPARTMENTS, doc: view.doc, crm, lastRun: run });
}
