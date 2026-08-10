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
  koTitle: string | null; // 최신 버전과 해시가 일치할 때만 값 — 아니면 null(스테일 방지, koLatest와 동일 패턴)
  dismissedFlags: string[];
  status: DraftStatus; // 결정 진행도 라벨 — 전이 제약 없음 (스펙 §2)
  batchId: string | null;      // 다중 시안 묶음 — 단일 생성은 null
  variantIndex: number | null; // 묶음 내 순번(0부터, 표시 라벨 A/B/C…)
  model: string | null; createdAt: string; member: Member | null;
}

type Row = {
  id: string; client_id: string | null; client_name: string | null; procedure_names: string[];
  direction: string; format: DraftFormat; reference_mode: ReferenceMode; refs: RefSnapshot[];
  content: DraftContent; edited: DraftContent | null;
  history: DraftContent[]; translation: DraftTranslation | null;
  ko_title: string | null; ko_title_hash: string | null;
  dismissed_flags: string[];
  status: DraftStatus;
  batch_id: string | null; variant_index: number | null;
  model: string | null; created_at: Date;
  member_id: string | null; member_name: string | null; member_color: string | null;
};

const toRow = (r: Row): DraftRow => {
  const translation = normalizeTranslation(r.translation);
  const latest = r.edited ?? r.content;
  return {
    id: r.id, clientId: r.client_id, clientName: r.client_name, procedureNames: r.procedure_names,
    direction: r.direction, format: r.format, referenceMode: r.reference_mode, refs: r.refs,
    content: r.content, edited: r.edited, history: r.history,
    translation,
    // 최신 버전의 캐시 번역 — 해시 계산은 서버 소관(node:crypto), 클라이언트는 이 필드만 읽는다 (4차 스펙)
    koLatest: translation?.[draftVersionHash(latest.posts)] ?? null,
    // 저장된 제목의 hash가 최신 버전과 다르면(=편집·재생성 이후) 낡은 제목이므로 숨긴다
    koTitle: r.ko_title && r.ko_title_hash === draftVersionHash(latest.posts) ? r.ko_title : null,
    dismissedFlags: r.dismissed_flags,
    status: r.status,
    batchId: r.batch_id, variantIndex: r.variant_index,
    model: r.model, createdAt: r.created_at.toISOString(),
    member: r.member_id ? { id: r.member_id, name: r.member_name as string, color: r.member_color as string } : null,
  };
};

const SELECT = (sql: postgres.Sql) => sql`
  select d.id, d.client_id, d.client_name, d.procedure_names, d.direction, d.format,
         d.reference_mode, d.refs, d.content, d.edited, d.history, d.translation,
         d.ko_title, d.ko_title_hash,
         d.dismissed_flags, d.status, d.batch_id, d.variant_index, d.model, d.created_at,
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
           koTitle?: string | null; koTitleHash?: string | null }, // 호출부가 둘을 항상 쌍으로 세팅
): Promise<void> {
  await sql`update draft set
      edited = coalesce(${patch.edited ? sql.json(patch.edited as never) : null}, edited),
      dismissed_flags = coalesce(${patch.dismissedFlags ? sql.json(patch.dismissedFlags) : null}, dismissed_flags),
      history = coalesce(${patch.history ? sql.json(patch.history as never) : null}, history),
      translation = coalesce(${patch.translation ? sql.json(patch.translation as never) : null}, translation),
      status = coalesce(${patch.status ?? null}, status),
      ko_title = coalesce(${patch.koTitle ? patch.koTitle : null}, ko_title),
      ko_title_hash = coalesce(${patch.koTitleHash ? patch.koTitleHash : null}, ko_title_hash)
    where id = ${id}`;
}

export async function removeDraft(sql: postgres.Sql, id: string): Promise<void> {
  await sql`delete from draft where id = ${id}`;
}
