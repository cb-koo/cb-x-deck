import { getSql } from '@/lib/db';
import { extHandle, extOk, extPreflight, ExtInputError } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { parseBadgePerson, readJson } from '@/lib/extensionInput';
import { findPeopleByHandles, findPeopleByXUserIds, loadTaskFacts } from '@/lib/extensionReadStore';
import { BADGE_BATCH_LIMIT, classifyTask, compareClassified, toTaskDto } from '@/lib/extensionTasks';
import { kstToday } from '@/lib/datetime';

export const OPTIONS = extPreflight;

export async function POST(req: Request) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const body = (await readJson(req)) as { people?: unknown } | null;
    if (!body || !Array.isArray(body.people)) throw new ExtInputError('조회할 상대 목록이 필요해요.');
    if (body.people.length > BADGE_BATCH_LIMIT) throw new ExtInputError(`배지는 한 번에 ${BADGE_BATCH_LIMIT}명까지 조회해 주세요.`);
    const people = body.people.map(parseBadgePerson);

    const sql = getSql();
    const today = kstToday();
    const found = await findPeopleByHandles(sql, people.flatMap((p) => p.handle ? [p.handle] : []));
    const byId = await findPeopleByXUserIds(sql, people.flatMap((p) => !p.handle && p.observedXUserId ? [p.observedXUserId] : []));
    const facts = await loadTaskFacts(sql, [...new Set([...found.values(), ...byId.values()].map((p) => p.handle))]);

    return extOk(req, requestId, people.map((p) => {
      const row = p.handle ? found.get(p.handle.toLowerCase()) : byId.get(p.observedXUserId!);
      const identity = { handle: p.handle ?? row?.handle ?? null, ...(p.observedXUserId ? { observedXUserId: p.observedXUserId } : {}) };
      const empty = { ...identity, personId: null, asOfDate: today, activeCount: 0, activeVisitCount: 0, tasks: [] };
      if (!row) return { ...empty, status: 'unregistered' };
      if (p.observedXUserId && row.xUserId && row.xUserId !== p.observedXUserId) {
        return { ...empty, status: 'identity_mismatch' };
      }
      const active = facts
        .filter((t) => t.influencerHandle?.toLowerCase() === row.handle.toLowerCase())
        .map((t) => ({ t, c: classifyTask(t, today) }))
        .filter(({ c }) => c.bucket === 'active')
        .sort((a, b) => compareClassified({ id: a.t.id, c: a.c }, { id: b.t.id, c: b.c }));
      return {
        ...identity, personId: row.id, asOfDate: today, status: 'matched', activeCount: active.length,
        activeVisitCount: active.filter(({ t }) => t.type === 'visit').length,
        tasks: active.map(({ t, c }) => {
          const task = toTaskDto(t, c, row.id, today, new URL(req.url).origin);
          return { taskId: t.id, createdAt: task.createdAt, kind: task.kind, title: task.title, visitPhase: c.visitPhase, flowStage: c.flowStage, nextSchedule: task.nextSchedule, dDay: c.dDay, visitDday: task.visitDday, uploadDday: task.uploadDday };
        }),
      };
    }));
  });
}
