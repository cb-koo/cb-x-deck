import type postgres from 'postgres';
import type { GetxapiClient } from './getxapi.ts';
import { mapRawTweet } from './mappers.ts';
import { missingQuotedIds, upsertQuoted } from './quotedStore.ts';

// 인용 트윗 보강 — 캐시에 없는 ID만 tweet/detail($0.001/콜)로 조회해 저장.
// refresh의 후처리(베스트 에포트): 개별 실패는 삼키고, 실패분은 캐시 미기록으로 다음 새로고침에 재시도.
export interface EnrichResult { fetched: number; missing: number }

export async function enrichQuoted(
  sql: postgres.Sql,
  client: Pick<GetxapiClient, 'getTweetDetail'>,
  quotedIds: string[],
  opts: { cap?: number; concurrency?: number } = {},
): Promise<EnrichResult> {
  const cap = opts.cap ?? 40;             // 새로고침당 비용·지연 상한
  const concurrency = opts.concurrency ?? 4;
  const targets = (await missingQuotedIds(sql, quotedIds)).slice(0, cap);

  let fetched = 0;
  let missing = 0;
  for (let i = 0; i < targets.length; i += concurrency) {
    await Promise.all(targets.slice(i, i + concurrency).map(async (id) => {
      try {
        const raw = await client.getTweetDetail(id);
        const mapped = raw ? mapRawTweet(raw) : null;
        await upsertQuoted(sql, id, mapped);
        if (mapped) fetched++; else missing++;
      } catch {
        // 네트워크 등 일시 오류: 캐시 미기록 → 다음 라운드에 자연 재시도
      }
    }));
  }
  return { fetched, missing };
}
