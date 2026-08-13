import type postgres from 'postgres';
import type { Member } from './types.ts';
import type { DraftContent, DraftFormat, ReferenceMode, RefSnapshot } from './draftTypes.ts';
import type { DraftStatus } from './draftStatus.ts';
import { hashSource } from './translationStore.ts';

// 버전별 한국어 번역 캐시 — sourceHash(원문 지문) → 번역 posts. 어떤 버전이든 한 번 번역하면 재사용.
export type DraftTranslation = Record<string, string[]>;

// 버전 텍스트의 캐시 키 — 생성·다시쓰기·라우트·toRow가 전부 이 식을 써야 한다(드리프트=조용한 캐시 미스=이중 과금)
export function draftVersionHash(posts: Array<{ text: string }>): string {
  return hashSource(JSON.stringify(posts.map((p) => p.text)), null);
}

// 초기 단일 슬롯 형태({sourceHash, posts})의 잔존 데이터를 맵으로 정규화
function normalizeTranslation(v: unknown): DraftTranslation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { sourceHash?: unknown; posts?: unknown };
  if (typeof o.sourceHash === 'string' && Array.isArray(o.posts)) {
    return { [o.sourceHash]: o.posts as string[] };
  }
  return v as DraftTranslation;
}

export interface DraftRow {
  id: string; clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null;
  history: DraftContent[]; // 재생성 직전 표시본 스냅샷들 — [ ...history, edited ?? content ]가 버전 타임라인
  translation: DraftTranslation | null;
  koLatest: string[] | null; // 최신 버전(edited ?? content)의 캐시 번역 파생값 — 클라이언트는 이 필드만 읽는다 (4차 스펙)
  // 사람이 붙인 제목 — ko_title과 달리 해시 검사를 타지 않는다(본문을 고쳐도 남는다, 설계 §A)
  title: string | null;
  koTitle: string | null; // 최신 버전과 해시가 일치할 때만 값 — 아니면 null(스테일 방지, koLatest와 동일 패턴)
  dismissedFlags: string[];
  status: DraftStatus; // 결정 진행도 라벨 — 전이 제약 없음 (스펙 §2)
  // 게시할 인플루언서의 X 핸들('@' 없음, 사용자가 친 대소문자 그대로) — null = 미배정.
  // 배정 단위는 시안 하나(행)다: 형제 시안 셋 다 배정하면 "원고 3개를 줬다"가 되어 사실과 어긋난다.
  influencerHandle: string | null;
  batchId: string | null;      // 다중 시안 묶음 — 단일 생성은 null
  variantIndex: number | null; // 묶음 내 순번(0부터, 표시 라벨 A/B/C…)
  model: string | null; createdAt: string; member: Member | null;
}

type Row = {
  id: string; client_id: string | null; client_name: string | null; procedure_names: string[];
  direction: string; format: DraftFormat; reference_mode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null;
  history: DraftContent[]; translation: DraftTranslation | null;
  title: string | null;
  ko_title: string | null; ko_title_hash: string | null;
  dismissed_flags: string[];
  status: DraftStatus;
  influencer_handle: string | null;
  batch_id: string | null; variant_index: number | null;
  model: string | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

const toRow = (r: Row): DraftRow => {
  const translation = normalizeTranslation(r.translation);
  const latest = r.edited ?? r.content;
  const latestHash = draftVersionHash(latest.posts); // koLatest·koTitle이 공유 — 행당 SHA 1회
  return {
    id: r.id, clientId: r.client_id, clientName: r.client_name, procedureNames: r.procedure_names,
    direction: r.direction, format: r.format, referenceMode: r.reference_mode, refs: r.refs,
    content: r.content, edited: r.edited, history: r.history,
    translation,
    // 최신 버전의 캐시 번역 — 해시 계산은 서버 소관(node:crypto), 클라이언트는 이 필드만 읽는다 (4차 스펙)
    koLatest: translation?.[latestHash] ?? null,
    title: r.title,
    // 저장된 제목의 hash가 최신 버전과 다르면(=편집·재생성 이후) 낡은 제목이므로 숨긴다
    koTitle: r.ko_title && r.ko_title_hash === latestHash ? r.ko_title : null,
    dismissedFlags: r.dismissed_flags,
    status: r.status,
    influencerHandle: r.influencer_handle,
    batchId: r.batch_id, variantIndex: r.variant_index,
    model: r.model, createdAt: r.created_at.toISOString(),
    member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  };
};

const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.title, d.ko_title, d.ko_title_hash,
         d.dismissed_flags, d.status, d.influencer_handle, d.batch_id, d.variant_index, d.model, d.created_at,
         m.id as member_id, m.name as member_name, m.color as member_color
    from draft d
    left join member m on m.id = d.created_by`;

export async function insertDraft(sql: postgres.Sql, input: {
  clientId: string | null; clientName: string | null; procedureNames: string[];
  direction: string; format: DraftFormat; referenceMode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; model: string | null; memberId: string | null;
  batchId?: string | null; variantIndex?: number | null;
  translation?: DraftTranslation | null; // 생성 시점에 함께 마련된 한국어 대역 캐시 — 없으면 null(부가물 실패 허용)
  koTitle?: string | null; koTitleHash?: string | null; // 생성 시점에 함께 마련된 한국어 제목 — 둘은 항상 쌍
}): Promise<string> {
  const rows = await sql<Array<{ id: string }>>`
    insert into draft (client_id, client_name, procedure_names, direction, format,
                       reference_mode, refs, content, model, created_by, batch_id, variant_index, translation,
                       ko_title, ko_title_hash)
    values (${input.clientId}, ${input.clientName}, ${sql.json(input.procedureNames)},
            ${input.direction}, ${input.format}, ${input.referenceMode},
            ${sql.json(input.refs as never)}, ${sql.json(input.content as never)},
            ${input.model}, ${input.memberId}, ${input.batchId ?? null}, ${input.variantIndex ?? null},
            ${input.translation ? sql.json(input.translation as never) : null},
            ${input.koTitle ?? null}, ${input.koTitleHash ?? null})
    returning id`;
  return rows[0].id;
}

export async function listDrafts(
  sql: postgres.Sql, opts: { clientId?: string; status?: DraftStatus; limit?: number } = {},
): Promise<DraftRow[]> {
  const byClient = opts.clientId ? sql`and d.client_id = ${opts.clientId}` : sql``;
  const byStatus = opts.status ? sql`and d.status = ${opts.status}` : sql``;
  // 배치 형제는 created_at이 동일 — variant_index로 A/B/C 순서 고정 (단일 초안 null은 앞)
  const rows = await sql<Row[]>`
    ${SELECT(sql)} where true ${byClient} ${byStatus}
    order by d.created_at desc, d.variant_index asc nulls first
    limit ${opts.limit ?? 50}`;
  return rows.map(toRow);
}

export async function getDraft(sql: postgres.Sql, id: string): Promise<DraftRow | null> {
  const rows = await sql<Row[]>`${SELECT(sql)} where d.id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function updateDraft(
  sql: postgres.Sql, id: string,
  patch: { edited?: DraftContent; dismissedFlags?: string[]; history?: DraftContent[];
           translation?: DraftTranslation; status?: DraftStatus;
           title?: string | null; // '' · null = 지움 · 문자열 = 설정 · undefined = 건드리지 않음
           koTitle?: string | null; koTitleHash?: string | null; // 호출부가 둘을 항상 쌍으로 세팅
           influencerHandle?: string | null; // null이 '배정 해제'라는 뜻을 갖는 유일한 필드 — 아래 case when 참조
           format?: DraftFormat }, // 칸 수 변경 시 서버가 파생해 넘긴다 — '지움' 개념이 없으므로 coalesce로 충분
): Promise<void> {
  await sql`update draft set
      edited = coalesce(${patch.edited ? sql.json(patch.edited as never) : null}, edited),
      dismissed_flags = coalesce(${patch.dismissedFlags ? sql.json(patch.dismissedFlags) : null}, dismissed_flags),
      history = coalesce(${patch.history ? sql.json(patch.history as never) : null}, history),
      translation = coalesce(${patch.translation ? sql.json(patch.translation as never) : null}, translation),
      status = coalesce(${patch.status ?? null}, status),
      format = coalesce(${patch.format ?? null}, format),
      -- undefined = 건드리지 않음 · '' 또는 null = 지움 · 문자열 = 설정 (influencer_handle과 같은 구조)
      title = case when ${patch.title !== undefined}
                then ${patch.title ? patch.title : null}::text
                else title end,
      ko_title = coalesce(${patch.koTitle ? patch.koTitle : null}, ko_title),
      ko_title_hash = coalesce(${patch.koTitleHash ? patch.koTitleHash : null}, ko_title_hash),
      -- 이 컬럼만 coalesce를 쓰지 않는다: coalesce는 "null이면 기존값 유지"라 배정 해제를 표현할 방법이 없다.
      -- undefined = 건드리지 않음 · null = 배정 해제 · 문자열 = 배정 (::text는 파라미터 타입 추론 명시)
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end
    where id = ${id}`;
}

// 일괄 변경 — 개별 updateDraft를 N번 부르지 않는다. 50건을 고르면 커넥션 50개가 동시에 붙는데,
// 이 저장소는 이미 커넥션 고갈로 목록이 비는 회귀를 겪었다(설계 §B). 한 문장으로 끝낸다.
// null·undefined 의미는 updateDraft와 같다: undefined = 건드리지 않음, null = 배정 해제.
export async function updateDraftsBulk(
  sql: postgres.Sql, ids: string[],
  patch: { status?: DraftStatus; influencerHandle?: string | null },
): Promise<void> {
  if (ids.length === 0) return; // any(빈 배열)은 0건을 맞히지만, 쿼리를 안 쏘는 편이 정직하다
  await sql`update draft set
      status = coalesce(${patch.status ?? null}, status),
      influencer_handle = case when ${patch.influencerHandle !== undefined}
                            then ${patch.influencerHandle ?? null}::text
                            else influencer_handle end
    where id = any(${ids}::uuid[])`;
}

export async function removeDraftsBulk(sql: postgres.Sql, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`delete from draft where id = any(${ids}::uuid[])`;
}

// 벌크 PATCH가 자동 로그(influencerSync)를 우회하지 않도록, 갱신 전 상태를 잠그고 통째로 읽는다.
// for update of d: member 조인은 잠그지 않는다. 호출자는 같은 트랜잭션에서 갱신+로그까지 끝낸다.
export async function getDraftsByIdsForUpdate(sql: postgres.Sql, ids: string[]): Promise<DraftRow[]> {
  if (ids.length === 0) return [];
  const rows = await sql<Row[]>`${SELECT(sql)} where d.id = any(${ids}::uuid[]) for update of d`;
  return rows.map(toRow);
}

export async function removeDraft(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from draft where id = ${id}`;
}
