import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { DraftContent, InfluencerOption } from './draftTypes.ts';
import type { DraftStatus } from './draftStatus.ts';
import type { UserInfo } from './getxapi.ts';
import { draftVersionHash } from './draftStore.ts';
import { diffPricing, mergePricing, type Currency, type Pricing, type PricingChange } from './influencerPricing.ts';
import { applyPaymentOp, type PaymentFee, type PaymentMethod, type PaymentMethodChange, type PaymentOp } from './influencerPayment.ts';
import type { Activity, ContentType, TopicStat } from './analysisStats.ts';
import { listInfluencerCampaigns, type InfluencerCampaignItem } from './campaignStore.ts';
import type { TaskType } from './campaignJudgment.ts';

// 기록 채널 — 수동 한 줄 기록이 "어디서 오간 이야기인지" (스펙 §2)
export type InfluencerChannel = 'dm' | 'line' | 'email' | 'other';
// 앱이 스스로 남기는 이벤트 — 표시 문구는 UI가 만든다(로그에는 사실만 저장)
export type InfluencerAutoEvent =
  'draft_assigned' | 'draft_unassigned' | 'draft_delivered' | 'handle_changed' | 'pricing_changed'
  | 'payment_method_changed' | 'payment_requested' | 'payment_cancelled' | 'payment_paid' | 'payment_revised';

// 정산 요청/취소/지급 한 줄 — 타임라인은 금액·통화·유형만 보인다(요청 상세는 정산 페이지)
export interface PaymentLogPayload { requestId: string; amountGross: number; currency: Currency; taskType: TaskType; reason?: string; paidAmountKrw?: number;
  revision?: number; before?: { amountGross: number; currency: Currency } }   // payment_revised: 고친 뒤 판·고치기 전 송금액(048)
// 로그 payload는 이벤트마다 모양이 다르다 — 읽는 쪽이 eventType으로 좁힌다.
export type LogPayload = { from?: string; to?: string } | PricingChange | PaymentMethodChange | PaymentLogPayload;

// 계정 분석 저장 형태 (계정 분석 v2 스펙 §3) — 분석 실행이 만들고 프로필 화면이 읽는다.
// jsonb라 마이그레이션이 없다: v1로 저장된 행이 그대로 남아 있으므로 v1 필드는 전부 옵셔널이고,
// UI는 `activity` 유무로 v1/v2를 가른다(v1 경로는 "다시 분석하세요" 한 줄만 그린다).
export interface InfluencerAnalysis {
  sample: {
    // v2 — 활동(28일 창)과 내용(직접 글 60건)이 서로 다른 표본이라 둘을 따로 적는다.
    collected?: number;          // 수집 총건수(RT 포함)
    direct?: number;             // 직접 글 표본 건수(최대 60)
    directClassified?: number; rtClassified?: number;
    directSince?: string | null; // 직접 글 표본의 최고령 — 캡션의 기간 시작
    directComplete?: boolean;    // 60건을 채웠나(false면 "6개월 안 전부")
    pagesUsed?: number;
    rtSince?: string | null;     // RT 표본의 최고령 — 퍼나르는 주제 캡션용
    until: string;
    // v1 — 구버전 분석에만 있다
    count?: number; classified?: number; since?: string; months?: number;
  };
  // v2에만 있다. 이 필드의 유무가 곧 분석 버전 판별식(명부 SELECT의 analysis_v2도 이 키를 본다).
  activity?: Activity;
  stats: {
    // v2 기준: 직접 글 표본의 반응 중앙값·유형 분포·협찬 표기 수
    medianViews: number | null; medianLikes: number | null;
    typeDist: Partial<Record<ContentType, number>>; sponsoredCount: number;
    // v1 — 구버전 분석에만 있다(읽는 코드 없음)
    perWeek?: number; mix?: { original: number; retweet: number; quote: number };
  };
  topics: TopicStat[];                          // 직접 글 주제(조회 중앙값 포함)
  rtTopics?: { tag: string; count: number }[];  // 퍼나르는 주제 — 조회수는 원작자 것이라 건수만
  // v1의 발행 히트맵 재료. v2는 activity.dailyDirect/dailyRt 두 줄로 대체됐다.
  daily?: Record<string, number>;
  // 직접 글·RT 둘 다 0건이면 null. headline은 옵셔널 — 이 필드가 생기기 전 분석엔 없다(UI는 자리를 생략).
  summary: { headline?: string; tone: string; patterns: string; sponsorship: string } | null;
  models: { classify: string; synth: string };
}

export interface InfluencerRow {
  id: string; handle: string; xUserId: string | null;
  displayName: string | null; avatarUrl: string | null; bio: string | null;
  followersCount: number | null; profileRefreshedAt: string | null;
  tags: string[]; note: string; createdAt: string;
  lastLogAt: string | null;  // 파생: 로그 최신행(all kind) — 라벨은 "마지막 기록" (스펙 §2)
  draftCount: number;        // 파생: lower(handle) 조인 count
  lastContactAt: string | null;  // 파생: kind='manual' 로그만의 최신행 — "연락 기록" 축 (스펙 §① 라벨-값 일치)
  analyzedAt: string | null;  // 파생: influencer.analyzed_at — 목록에도 "언제 분석했는지"가 필요하다(v2 계정 분석)
  analysisV2: boolean;        // 파생: analysis jsonb에 activity 키가 있는지 — 값은 싣지 않는다(목록 payload 절약)
  // 파생: payment_methods 중 기본 수단 하나의 통화·수수료만(스펙 §5-4) — 계좌·이메일 등은 목록에 싣지 않는다
  // (전체 배열을 싣지 않는 이유는 InfluencerDetail.paymentMethods와 같은 privacy 경계).
  settlement: { currency: Currency; fee: PaymentFee | null } | null;
}

export interface InfluencerLogRow {
  id: string; kind: 'manual' | 'auto'; eventType: InfluencerAutoEvent | null;
  body: string | null; channel: InfluencerChannel | null;
  draftId: string | null; draftTitle: string | null;
  payload: LogPayload | null;
  member: Member | null; createdAt: string;
}

export interface DraftRollupItem { id: string; title: string; status: DraftStatus; createdAt: string }

export interface InfluencerDetail {
  influencer: InfluencerRow; logs: InfluencerLogRow[]; drafts: DraftRollupItem[];
  draftStatusCounts: Partial<Record<DraftStatus, number>>;  // 파생: lower 조인 group by status, 전체 기준(50건 롤업과 별개)
  // 단가·분석·결제 수단은 상세에만 싣는다 — 목록(InfluencerRow)까지 실으면 payload가 불필요하게 커진다.
  pricing: Pricing; analysis: InfluencerAnalysis | null; analyzedAt: string | null;
  paymentMethods: PaymentMethod[];
  // 참여 캠페인(캠페인 스펙 §5) — 원고가 배정됐거나 추가 비용 행이 있는 캠페인, 시작일 내림차순. 조회만, 로그 없음.
  // 상세에 싣는 이유: 프로필이 한 번의 GET으로 그려지고(탭 3개가 같은 data), 새 라우트·fetch를 만들 필요가 없다.
  campaigns: InfluencerCampaignItem[];
}

type IRow = {
  id: string; handle: string; x_user_id: string | null;
  display_name: string | null; avatar_url: string | null; bio: string | null;
  followers_count: number | null; profile_refreshed_at: Date | null;
  tags: string[]; note: string; created_at: Date;
  last_log_at: Date | null; draft_count: string | number;
  last_contact_at: Date | null;
  analyzed_at: Date | null; analysis_v2: boolean | null; // jsonb `?` — analysis가 null이면 결과도 null
  settlement: { currency?: Currency; fee?: PaymentFee | null } | null;
};

type LRow = {
  id: string; kind: 'manual' | 'auto'; event_type: InfluencerAutoEvent | null;
  body: string | null; channel: InfluencerChannel | null;
  draft_id: string | null; draft_title: string | null;
  payload: LogPayload | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

type DRow = {
  id: string; ko_title: string | null; ko_title_hash: string | null;
  edited: DraftContent | null; content: DraftContent; status: DraftStatus; created_at: Date;
};

const toRow = (r: IRow): InfluencerRow => ({
  id: r.id, handle: r.handle, xUserId: r.x_user_id,
  displayName: r.display_name, avatarUrl: r.avatar_url, bio: r.bio,
  followersCount: r.followers_count,
  profileRefreshedAt: r.profile_refreshed_at ? new Date(r.profile_refreshed_at).toISOString() : null,
  tags: r.tags, note: r.note, createdAt: new Date(r.created_at).toISOString(),
  lastLogAt: r.last_log_at ? new Date(r.last_log_at).toISOString() : null,
  draftCount: Number(r.draft_count), // count(*)는 bigint → postgres.js가 문자열로 준다
  lastContactAt: r.last_contact_at ? new Date(r.last_contact_at).toISOString() : null,
  analyzedAt: r.analyzed_at ? new Date(r.analyzed_at).toISOString() : null,
  analysisV2: Boolean(r.analysis_v2),
  // currency 없는 깨진 데이터(예: isDefault만 있고 currency가 빠진 수단) 방어 — null로 떨어뜨린다.
  settlement: r.settlement?.currency ? { currency: r.settlement.currency, fee: r.settlement.fee ?? null } : null,
});

const toLog = (r: LRow): InfluencerLogRow => ({
  id: r.id, kind: r.kind, eventType: r.event_type,
  body: r.body, channel: r.channel,
  draftId: r.draft_id, draftTitle: r.draft_title, payload: r.payload,
  member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  createdAt: new Date(r.created_at).toISOString(),
});

// 파생값들은 목록·상세·생성 직후가 모두 같은 정의를 써야 한다(드리프트 = 카드마다 다른 숫자).
// draft_count는 lower 조인 — 배정은 사용자가 친 표기 그대로 저장되기 때문이다.
// last_contact_at은 kind='manual'만 — auto 이벤트는 "연락"이 아니다(라벨-값 일치, 스펙 §①).
const SELECT = (sql: postgres.Sql) => sql`
  select i.id, i.handle, i.x_user_id, i.display_name, i.avatar_url, i.bio, i.followers_count,
         i.profile_refreshed_at, i.tags, i.note, i.created_at,
         (select max(l.created_at) from influencer_log l where l.influencer_id = i.id) as last_log_at,
         (select count(*) from draft d where lower(d.influencer_handle) = lower(i.handle)) as draft_count,
         (select max(l2.created_at) from influencer_log l2
           where l2.influencer_id = i.id and l2.kind = 'manual') as last_contact_at,
         i.analyzed_at, (i.analysis ? 'activity') as analysis_v2,
         -- 기본 결제 수단의 통화·수수료만(스펙 §5-4) — 전체 배열을 목록에 실으면 계좌·이메일 등이 새어나간다.
         (select jsonb_build_object('currency', m->'currency', 'fee', m->'fee')
            from jsonb_array_elements(coalesce(i.payment_methods, '[]'::jsonb)) m
           where (m->>'isDefault')::bool limit 1) as settlement
    from influencer i`;

const LOG_SELECT = (sql: postgres.Sql) => sql`
  select l.id, l.kind, l.event_type, l.body, l.channel, l.draft_id, l.draft_title, l.payload, l.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from influencer_log l
    left join member m on m.id = l.author_id`;

export async function createInfluencer(
  sql: postgres.Sql,
  input: { handle: string; createdBy: string | null; snapshot?: UserInfo | null },
): Promise<{ row: InfluencerRow; created: boolean }> {
  // 핸들은 대소문자 무관 — 이미 있으면 표기를 덮지 않고 기존 행을 돌려준다(스펙 §2)
  const existing = await findByHandle(sql, input.handle);
  if (existing) return { row: existing, created: false };

  const s = input.snapshot ?? null;
  const rows = await sql<Array<{ id: string }>>`
    insert into influencer (handle, created_by, x_user_id, display_name, avatar_url, bio, followers_count,
                            profile_refreshed_at)
    values (${input.handle}, ${input.createdBy}, ${s?.id ?? null}, ${s?.name ?? null},
            ${s?.profilePicture ?? null}, ${s?.description ?? null}, ${s?.followers ?? null},
            ${s ? sql`now()` : null})
    returning id`;
  const row = await findInfluencerById(sql, rows[0].id);
  return { row: row as InfluencerRow, created: true };
}

export async function listInfluencers(sql: postgres.Sql): Promise<InfluencerRow[]> {
  // 기본 정렬은 "최근에 뭔가 있었던 사람"이 위 — 아직 기록이 없는 사람은 뒤로, 그 안에서는 핸들 사전순
  const rows = await sql<IRow[]>`${SELECT(sql)} order by last_log_at desc nulls last, lower(i.handle)`;
  return rows.map(toRow);
}

export async function findInfluencerById(sql: postgres.Sql, id: string): Promise<InfluencerRow | null> {
  const rows = await sql<IRow[]>`${SELECT(sql)} where i.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function findByHandle(sql: postgres.Sql, handle: string): Promise<InfluencerRow | null> {
  const rows = await sql<IRow[]>`${SELECT(sql)} where lower(i.handle) = lower(${handle})`;
  return rows.length ? toRow(rows[0]) : null;
}

// 프로필 조회로 밝혀진 X 계정이 이미 다른 행에 붙어 있으면 그 핸들을 돌려준다(개명·중복 등록 감지).
export async function findDuplicateByXUserId(
  sql: postgres.Sql, xUserId: string, excludeId: string,
): Promise<string | null> {
  const rows = await sql<Array<{ handle: string }>>`
    select handle from influencer where x_user_id = ${xUserId} and id <> ${excludeId} limit 1`;
  return rows.length ? rows[0].handle : null;
}

// 원고 카드에 쓸 한 줄 제목 — 저장된 한국어 제목이 최신 버전 것일 때만 쓰고, 아니면 본문 첫 줄.
// (draftStore.toRow의 koTitle 스테일 판정과 같은 규칙 — 두 화면이 다른 제목을 보이면 안 된다)
function rollupTitle(r: DRow): string {
  const latest = r.edited ?? r.content;
  if (r.ko_title && r.ko_title_hash === draftVersionHash(latest.posts)) return r.ko_title;
  const first = latest.posts[0]?.text ?? '';
  const line = first.split('\n').find((l) => l.trim() !== '') ?? '';
  return line.trim().slice(0, 60);
}

export async function getInfluencerDetail(sql: postgres.Sql, id: string): Promise<InfluencerDetail | null> {
  const influencer = await findInfluencerById(sql, id);
  if (!influencer) return null;

  const logs = await sql<LRow[]>`${LOG_SELECT(sql)} where l.influencer_id = ${id} order by l.created_at desc`;
  const drafts = await sql<DRow[]>`
    select id, ko_title, ko_title_hash, edited, content, status, created_at
      from draft where lower(influencer_handle) = lower(${influencer.handle})
     order by created_at desc limit 50`;

  // 원고 요약 줄(스펙 §①)은 전체 카운트 기준 — 위 drafts(최근 50건 롤업)와는 다른 쿼리다(자기모순 v1 fast-follow #7 해소).
  const statusRows = await sql<Array<{ status: DraftStatus; count: string | number }>>`
    select status, count(*) from draft
     where lower(influencer_handle) = lower(${influencer.handle})
     group by status`;
  const draftStatusCounts: Partial<Record<DraftStatus, number>> = {};
  for (const r of statusRows) draftStatusCounts[r.status] = Number(r.count);

  const extra = await sql<Array<{
    pricing: Pricing; analysis: InfluencerAnalysis | null; analyzed_at: Date | null;
    payment_methods: PaymentMethod[] | null;
  }>>`
    select pricing, analysis, analyzed_at, payment_methods from influencer where id = ${id}`;
  const campaigns = await listInfluencerCampaigns(sql, influencer.handle);   // lower 기준 — 표기가 달라도 같은 사람

  return {
    influencer,
    logs: logs.map(toLog),
    drafts: drafts.map((d) => ({
      id: d.id, title: rollupTitle(d), status: d.status, createdAt: new Date(d.created_at).toISOString(),
    })),
    draftStatusCounts,
    // 위 findInfluencerById와 이 select 사이에 삭제됐을 수 있다 — 빈 값으로 떨어뜨린다(예외 대신).
    pricing: extra[0]?.pricing ?? {},
    analysis: extra[0]?.analysis ?? null,
    analyzedAt: extra[0]?.analyzed_at ? new Date(extra[0].analyzed_at).toISOString() : null,
    paymentMethods: extra[0]?.payment_methods ?? [],
    campaigns,
  };
}

export async function updateInfluencer(
  sql: postgres.Sql, id: string, patch: { note?: string; tags?: string[] },
): Promise<void> {
  await sql`update influencer set
      note = coalesce(${patch.note ?? null}, note),
      tags = coalesce(${patch.tags ? sql.json(patch.tags) : null}, tags)
    where id = ${id}`;
}

export async function deleteInfluencer(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from influencer where id = ${id}`; // 로그는 cascade
}

// X 프로필 조회 결과를 박제 — 표시는 항상 "언제 기준"인지와 함께 (profile_refreshed_at)
export async function applyProfileSnapshot(sql: postgres.Sql, id: string, info: UserInfo): Promise<void> {
  await sql`update influencer set
      x_user_id = ${info.id},
      display_name = ${info.name},
      avatar_url = ${info.profilePicture},
      bio = ${info.description},
      followers_count = ${info.followers},
      profile_refreshed_at = now()
    where id = ${id}`;
}

// 원고 배정이 만드는 자동 등록 — 프로필 조회(비용) 없이 행만 확보한다.
// 표현식 유니크 인덱스라 on conflict도 표현식으로 추론시킨다. do update의 no-op 대입은
// do nothing이 기존 행을 returning하지 않기 때문(=id를 못 받는다).
export async function ensureInfluencer(
  sql: postgres.Sql, handle: string, createdBy: string | null,
): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into influencer (handle, created_by) values (${handle}, ${createdBy})
    on conflict ((lower(handle))) do update set handle = influencer.handle
    returning id`;
  return rows[0].id;
}

// 개명 — 같은 사람이므로 이미 준 원고의 배정 사실은 그대로 따라간다 (스펙 §5).
// 트랜잭션으로 묶을지는 호출자가 정한다(라우트는 sql.begin 안에서 부른다) — 아래 세 UPDATE는 반드시 한 트랜잭션이어야 한다:
// 원고만 옮기고 비용 행이 남으면 캠페인 인플 목록에 옛 핸들 유령 줄("배정 원고 없음")이 생긴다(캠페인 스펙 §2-5).
export async function renameInfluencer(
  sql: postgres.Sql, args: { influencerId: string; from: string; to: string; actorId: string | null },
): Promise<void> {
  const { influencerId, from, to, actorId } = args;
  await sql`update influencer set handle = ${to} where id = ${influencerId}`;
  await sql`update draft set influencer_handle = ${to} where lower(influencer_handle) = ${from.toLowerCase()}`;
  // 작업(campaign_task)은 unique 제약이 없어 병합 없이 표기만 바꾼다
  await sql`update campaign_task set influencer_handle = ${to}, updated_at = now() where lower(influencer_handle) = ${from.toLowerCase()}`;
  await moveCampaignCostRows(sql, from, to);
  await insertAutoLog(sql, {
    influencerId, eventType: 'handle_changed', draftId: null, draftTitle: null,
    payload: { from, to }, authorId: actorId,
  });
}

// 캠페인 추가 비용 행(campaign_influencer_cost)의 핸들 이관. 같은 캠페인에 옛·새 핸들 행이 둘 다 있으면
// unique(campaign_id, lower(handle)) 위반이 나므로 병합한다(리뷰 Blocking 5): extra_costs는 새 행 뒤에 옛 것을 이어붙이고
// (jsonb 배열 ||), note는 새 행이 비어 있을 때만 옛 값, 옛 행은 삭제. 살아남는 새 행의 표기도 이 UPDATE에서 바로
// to로 맞춘다(리뷰 Minor 2) — 그래야 아래 마지막 UPDATE(단순 이동 경로)와 표기 규칙이 갈리지 않는다.
// from·to가 소문자 기준 같으면(표기만 바뀜) 병합 조인이 자기 자신과 맞아 extra_costs가 두 배가 된다 — 그 경우는 표기만 바꾼다.
async function moveCampaignCostRows(sql: postgres.Sql, from: string, to: string): Promise<void> {
  const fromLower = from.toLowerCase();
  const toLower = to.toLowerCase();
  if (fromLower !== toLower) {
    await sql`
      update campaign_influencer_cost n
         set extra_costs = n.extra_costs || o.extra_costs,
             note = case when n.note = '' then o.note else n.note end,
             influencer_handle = ${to},
             updated_at = now()
        from campaign_influencer_cost o
       where o.campaign_id = n.campaign_id
         and lower(o.influencer_handle) = ${fromLower}
         and lower(n.influencer_handle) = ${toLower}`;
    await sql`
      delete from campaign_influencer_cost o
       where lower(o.influencer_handle) = ${fromLower}
         and exists (select 1 from campaign_influencer_cost n
                      where n.campaign_id = o.campaign_id and lower(n.influencer_handle) = ${toLower})`;
  }
  // 충돌이 없던(또는 병합으로 옛 행이 지워진 뒤 남은) 행은 표기만 새 핸들로
  await sql`
    update campaign_influencer_cost set influencer_handle = ${to}, updated_at = now()
     where lower(influencer_handle) = ${fromLower}`;
}

export async function addManualLog(
  sql: postgres.Sql, influencerId: string,
  input: { body: string; channel: InfluencerChannel | null; authorId: string | null },
): Promise<InfluencerLogRow> {
  const ins = await sql<Array<{ id: string }>>`
    insert into influencer_log (influencer_id, kind, body, channel, author_id)
    values (${influencerId}, 'manual', ${input.body}, ${input.channel}, ${input.authorId})
    returning id`;
  const rows = await sql<LRow[]>`${LOG_SELECT(sql)} where l.id = ${ins[0].id}`;
  return toLog(rows[0]);
}

// 지울 수 있는 건 사람이 쓴 기록뿐 — kind 조건이 자동 이벤트 삭제를 원천 차단한다(타임라인은 사실 기록).
export async function deleteManualLog(
  sql: postgres.Sql, influencerId: string, logId: string,
): Promise<boolean> {
  const del = await sql`delete from influencer_log
    where id = ${logId} and influencer_id = ${influencerId} and kind = 'manual' returning id`;
  return del.length > 0;
}

// jsonb 파라미터 — 인터페이스 타입은 인덱스 시그니처가 없어 JSONValue에 그대로 붙지 않는다(값은 순수 JSON).
const asJson = (v: object): postgres.JSONValue => v as unknown as postgres.JSONValue;

export async function insertAutoLog(sql: postgres.Sql, input: {
  influencerId: string; eventType: InfluencerAutoEvent;
  draftId: string | null; draftTitle: string | null;
  payload?: LogPayload; authorId: string | null;
}): Promise<void> {
  await sql`insert into influencer_log (influencer_id, kind, event_type, draft_id, draft_title, payload, author_id)
    values (${input.influencerId}, 'auto', ${input.eventType}, ${input.draftId}, ${input.draftTitle},
            ${input.payload ? sql.json(asJson(input.payload)) : null}, ${input.authorId})`;
}

// 배정 자동완성 후보 — 명부가 기준이다(과거 배정 이력에서 긁어모으던 listInfluencerHandles의 후신).
// pricing도 함께 — 캠페인 비용 제안(스펙 §3-2 비용 셀)이 배정 직후 단가를 알아야 한다. 컬럼은 032(pricing jsonb not null default '{}').
export async function listOptions(sql: postgres.Sql): Promise<InfluencerOption[]> {
  const rows = await sql<Array<{ handle: string; display_name: string | null; pricing: Pricing | null }>>`
    select handle, display_name, pricing from influencer order by lower(handle)`;
  return rows.map((r) => ({ handle: r.handle, name: r.display_name ?? undefined, pricing: r.pricing ?? undefined }));
}

// 단가 병합 저장 — 행 잠금 후 diff라 동시 blur가 겹쳐도 로그·값이 어긋나지 않는다(스펙 §2).
// 로그는 유형별 한 줄씩: 단가 칸 옆 이력 펼침이 priceType 단위로 필터하기 때문.
export async function updatePricing(
  sql: postgres.Sql, id: string, patch: Pricing, actorId: string | null,
): Promise<{ pricing: Pricing; logs: InfluencerLogRow[] }> {
  return await sql.begin(async (tx) => {
    const rows = await tx<Array<{ pricing: Pricing }>>`
      select pricing from influencer where id = ${id} for update`;
    if (rows.length === 0) throw new Error(`influencer not found: ${id}`);
    const base = rows[0].pricing ?? {};
    const changes = diffPricing(base, patch);
    const merged = mergePricing(base, patch);
    // 헬퍼(LOG_SELECT)에 트랜잭션 핸들을 넘길 때의 관례 — 라우트의 renameInfluencer 호출과 같은 캐스팅.
    const tsql = tx as unknown as postgres.Sql;
    await tx`update influencer set pricing = ${tx.json(asJson(merged))} where id = ${id}`;
    const logIds: string[] = [];
    for (const c of changes) {
      const ins = await tx<Array<{ id: string }>>`
        insert into influencer_log (influencer_id, kind, event_type, payload, author_id)
        values (${id}, 'auto', 'pricing_changed', ${tx.json(asJson(c))}, ${actorId})
        returning id`;
      logIds.push(ins[0].id);
    }
    const logs = logIds.length
      ? (await tx<LRow[]>`${LOG_SELECT(tsql)} where l.id in ${tx(logIds)} order by l.created_at desc, l.id desc`).map(toLog)
      : [];
    return { pricing: merged, logs };
  });
}

// 결제 수단 연산 저장 — 행 잠금 후 applyPaymentOp가 배열 전체를 다시 만든다(updatePricing과 같은 구조).
// PAYMENT_NOT_FOUND로 던지는 오류(모르는 id)는 그대로 전파 — 라우트가 404로 매핑한다.
export async function updatePaymentMethods(
  sql: postgres.Sql, id: string, op: PaymentOp, actorId: string | null,
): Promise<{ paymentMethods: PaymentMethod[]; logs: InfluencerLogRow[] }> {
  return await sql.begin(async (tx) => {
    const rows = await tx<Array<{ payment_methods: PaymentMethod[] }>>`
      select payment_methods from influencer where id = ${id} for update`;
    if (rows.length === 0) throw new Error('influencer not found');
    const base = rows[0].payment_methods ?? [];
    const { list, changes } = applyPaymentOp(base, op, new Date().toISOString(), () => crypto.randomUUID());
    const tsql = tx as unknown as postgres.Sql;
    await tx`update influencer set payment_methods = ${tx.json(asJson(list))} where id = ${id}`;
    const logIds: string[] = [];
    for (const c of changes) {
      const ins = await tx<Array<{ id: string }>>`
        insert into influencer_log (influencer_id, kind, event_type, payload, author_id)
        values (${id}, 'auto', 'payment_method_changed', ${tx.json(asJson(c))}, ${actorId})
        returning id`;
      logIds.push(ins[0].id);
    }
    const logs = logIds.length
      ? (await tx<LRow[]>`${LOG_SELECT(tsql)} where l.id in ${tx(logIds)} order by l.created_at desc, l.id desc`).map(toLog)
      : [];
    return { paymentMethods: list, logs };
  });
}

// 분석 결과 박제 — analyzed_at이 "언제 기준"인지를 화면이 말할 근거다.
export async function saveAnalysis(
  sql: postgres.Sql, id: string, analysis: InfluencerAnalysis,
): Promise<void> {
  await sql`update influencer set analysis = ${sql.json(asJson(analysis))}, analyzed_at = now()
    where id = ${id}`;
}
