import { NextResponse } from 'next/server';
import type postgres from 'postgres';
import { getSql } from '@/lib/db';
import { requireMember } from '@/lib/authGuard';
import { getClientWithProcedures } from '@/lib/clientStore';
import { insertDraft, getDraft } from '@/lib/draftStore';
import { formatForPosts } from '@/lib/draftFormat';
import { parseTaskIdPatch, TASK_NOT_FOUND_MESSAGE, TASK_HAS_DRAFT_MESSAGE, DRAFT_ATTACHED_MESSAGE } from '@/lib/campaignTaskInput';
import { getTask, TaskAttachError } from '@/lib/campaignTaskStore';
import { CLIENT_NOT_FOUND_MESSAGE } from '@/lib/campaignInput';

// LLM 없이 초안을 만드는 두 번째 입구(설계 §A) — generate.ts·llm.ts·translateDraft를 일절
// import하지 않는다. model: null이 직접 작성의 표식이고, 대역·자동 제목도 함께 비운다.
export async function POST(req: Request) {
  const gate = await requireMember();
  if (gate.response) return gate.response;
  const sql = getSql();
  const body = (await req.json().catch(() => ({}))) as
    { posts?: unknown; title?: unknown; clientId?: string | null; procedureIds?: unknown; taskId?: unknown };

  // posts: 비어 있지 않은 배열 + 모든 항목이 공백 아닌 문자열. 칸 수 상한 없음(편집 모달 칸 추가와 동일).
  if (!Array.isArray(body.posts) || body.posts.length === 0 ||
      body.posts.some((p) => typeof p !== 'string' || !p.trim())) {
    return NextResponse.json({ error: '본문을 입력해주세요' }, { status: 400 });
  }
  const posts = body.posts as string[];

  // clientId가 있으면 이름·시술명을 스냅샷으로 박제(generate.ts와 동일한 방식) — procedureIds로 필터.
  const clientId = body.clientId ?? null;
  const procedureIds = Array.isArray(body.procedureIds) ? (body.procedureIds as string[]) : [];
  const clientData = clientId ? await getClientWithProcedures(sql, clientId) : null;
  if (clientId && !clientData) {
    return NextResponse.json({ error: CLIENT_NOT_FOUND_MESSAGE }, { status: 400 });
  }
  const procedures = (clientData?.procedures ?? []).filter((p) => procedureIds.includes(p.id));

  // /generate?task= 배너가 켜진 채 직접 쓰면 그 작업에 붙여 저장(스펙 2026-08-28 §5) — 존재·미부착을 여기서 확정한다
  const taskId = parseTaskIdPatch(body.taskId);
  if (!taskId.ok) return NextResponse.json({ error: taskId.message }, { status: 400 });
  if (typeof taskId.value === 'string') {
    const task = await getTask(sql, taskId.value);
    if (!task) return NextResponse.json({ error: TASK_NOT_FOUND_MESSAGE }, { status: 400 });
    if (task.draftId) return NextResponse.json({ error: TASK_HAS_DRAFT_MESSAGE }, { status: 409 });
  }

  // 공백 트림, 빈 문자열이면 null — 자동 제목이 없으므로 사람이 실제로 입력한 값만 저장한다.
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;

  // 삽입 + 붙이기를 한 트랜잭션에 — 위 검사 뒤에도 경합(같은 작업에 동시 저장)으로 붙이기가 실패할 수 있는데,
  // 트랜잭션이 아니면 그때 주인 없는 원고만 남는다.
  let id: string;
  try {
    id = await sql.begin(async (tx0) => insertDraft(tx0 as unknown as postgres.Sql, {
      clientId, clientName: clientData?.client.name ?? null,
      procedureNames: procedures.map((p) => p.name),
      direction: '', format: formatForPosts(posts.length),
      referenceMode: 'off', refs: [],
      content: { posts: posts.map((text) => ({ text, media: [] })) },
      model: null, memberId: gate.member.id, // 클라이언트 body 무시 — 위조 차단(생성 POST와 동일)
      title,
      taskId: taskId.value ?? null,
    })) as unknown as string;
  } catch (e) {
    if (e instanceof TaskAttachError) {
      const message = e.code === 'draft-attached' ? DRAFT_ATTACHED_MESSAGE
        : e.code === 'task-has-draft' ? TASK_HAS_DRAFT_MESSAGE : TASK_NOT_FOUND_MESSAGE;
      return NextResponse.json({ error: message }, { status: e.code === 'no-task' ? 400 : 409 });
    }
    throw e;
  }
  // 응답은 DraftRow 배열 — 생성 POST와 같은 모양(페이지 삽입 배선 재사용, 설계 §A-5)
  return NextResponse.json([await getDraft(sql, id)]);
}
