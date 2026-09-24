// 작업·원고에 사람을 넣을 때의 서버 관문(설계 §9·§8-2) — 라우트 5곳과 campaignTaskStore.attachDraft가 같이 쓴다.
// 잎 모듈이다: campaignTaskStore가 값으로 import하므로 여기서 influencerStore·draftStore를 import하면
// campaignTaskStore ↔ draftStore 순환이 생긴다(campaignTaskStore.ts 머리 주석). 명부는 SQL 한 줄로 직접 본다.
import type postgres from 'postgres';

// 라우트가 400으로 돌려주는 문구 — 무엇을 하면 되는지까지 말한다(옛 /campaigns 화면도 이 문구를 그대로 띄운다)
export const ROSTER_REQUIRED_MESSAGE = '명부에 없는 인플이에요 — 명부에 먼저 등록해 주세요';

// 명부 표기 핸들(대소문자 무관 비교, 지금 관례) 또는 null. 저장은 이 표기로 맞춘다(§9 "저장 표기는 명부 표기로").
export async function rosterHandleOf(sql: postgres.Sql, handle: string): Promise<string | null> {
  const rows = await sql<Array<{ handle: string }>>`
    select handle from influencer where lower(handle) = lower(${handle}) limit 1`;
  return rows[0]?.handle ?? null;
}
