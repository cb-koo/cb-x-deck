import { getSql } from '@/lib/db';
import { extHandle, extOk, extPreflight, ExtInputError } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { parseObservedPerson, readJson } from '@/lib/extensionInput';
import { findPeopleByHandles, loadTaskFacts } from '@/lib/extensionReadStore';
import { BADGE_BATCH_LIMIT, classifyTask } from '@/lib/extensionTasks';
import { kstToday } from '@/lib/datetime';

export const OPTIONS = extPreflight;

export async function POST(req: Request) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const body = (await readJson(req)) as { people?: unknown } | null;
    if (!body || !Array.isArray(body.people)) throw new ExtInputError('조회할 상대 목록이 필요해요.');
    if (body.people.length > BADGE_BATCH_LIMIT) throw new ExtInputError(`배지는 한 번에 ${BADGE_BATCH_LIMIT}명까지 조회해 주세요.`);
    const people = body.people.map(parseObservedPerson);

    const sql = getSql();
    const today = kstToday();
    const found = await findPeopleByHandles(sql, people.map((p) => p.handle));
    const facts = await loadTaskFacts(sql, [...found.values()].map((p) => p.handle));

    return extOk(req, requestId, people.map((p) => {
      const row = found.get(p.handle.toLowerCase());
      if (!row) return { handle: p.handle, status: 'unregistered', activeCount: 0, tasks: [] };
      if (p.observedXUserId && row.xUserId && row.xUserId !== p.observedXUserId) {
        return { handle: p.handle, status: 'identity_mismatch', activeCount: 0, tasks: [] };
      }
      const active = facts
        .filter((t) => t.influencerHandle?.toLowerCase() === row.handle.toLowerCase())
        .map((t) => ({ t, c: classifyTask(t, today) }))
        .filter(({ c }) => c.bucket === 'active');
      return {
        handle: p.handle, status: 'matched', activeCount: active.length,
        tasks: active.map(({ t, c }) => ({ taskId: t.id, visitPhase: c.visitPhase, flowStage: c.flowStage, dDay: c.dDay })),
      };
    }));
  });
}
