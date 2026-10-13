import { getSql } from '@/lib/db';
import { extError, extHandle, extOk, extPreflight, ExtInputError } from '@/lib/extensionApi';
import { requireExtensionMember } from '@/lib/extensionAuth';
import { findInfluencerById } from '@/lib/influencerStore';
import { loadTaskFacts } from '@/lib/extensionReadStore';
import { classifyTask, compareClassified, decodeCursor, pageOf, TASK_BUCKETS, TASK_PAGE_LIMIT, toTaskDto, type TaskBucket } from '@/lib/extensionTasks';
import { kstToday } from '@/lib/datetime';
import { isUuidLike } from '@/lib/uuid';

export const OPTIONS = extPreflight;

export async function GET(req: Request, ctx: { params: Promise<{ personId: string }> }) {
  return extHandle(req, async (requestId) => {
    const gate = await requireExtensionMember(req, requestId);
    if (gate.response) return gate.response;
    const { personId } = await ctx.params;
    const url = new URL(req.url);
    const bucket = url.searchParams.get('bucket') as TaskBucket | null;
    if (!bucket || !TASK_BUCKETS.includes(bucket)) throw new ExtInputError('bucket은 active·completed·ended 중 하나예요.');
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? TASK_PAGE_LIMIT : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > TASK_PAGE_LIMIT) throw new ExtInputError(`limit은 1~${TASK_PAGE_LIMIT} 사이예요.`);
    const offset = decodeCursor(url.searchParams.get('cursor'));
    if (offset === null) throw new ExtInputError('목록 위치 정보가 올바르지 않아요. 처음부터 다시 조회해 주세요.');

    const notFound = () => extError(req, requestId, 'RESOURCE_NOT_FOUND', '인플루언서를 찾을 수 없어요.');
    if (!isUuidLike(personId)) return notFound();
    const sql = getSql();
    const person = await findInfluencerById(sql, personId);
    if (!person) return notFound();

    const today = kstToday();
    const origin = url.origin;
    const rows = (await loadTaskFacts(sql, [person.handle]))
      .map((t) => ({ t, id: t.id, c: classifyTask(t, today) }))
      .filter(({ c }) => c.bucket === bucket)
      .sort(compareClassified);
    const page = pageOf(rows, offset, limit);
    return extOk(req, requestId, {
      items: page.items.map(({ t, c }) => toTaskDto(t, c, person.id, today, origin)),
      total: page.total,
      nextCursor: page.nextCursor,
    });
  });
}
