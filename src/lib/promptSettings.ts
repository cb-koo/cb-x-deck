import type postgres from 'postgres';
import { PROMPT_DEFAULTS, type PromptFieldKey, type PromptOverrides } from './generatePrompt.ts';

export interface PromptVersionRow {
  id: string; overrides: PromptOverrides; memberName: string | null; createdAt: string;
}

const KEYS = Object.keys(PROMPT_DEFAULTS) as PromptFieldKey[];

// 쓰기 검증 — 알려진 키·문자열·2000자 이내만(위반 = null). 트림 후 빈 값·기본값과 같은 값은 버린다:
// diff만 저장해야 코드 기본값이 나중에 개선될 때 편집 안 한 필드가 자동으로 따라간다 (스펙).
export function sanitizeOverrides(input: unknown): PromptOverrides | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const out: PromptOverrides = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(KEYS as string[]).includes(k)) return null;
    if (typeof v !== 'string' || v.length > 2000) return null;
    const t = v.trim();
    if (t && t !== PROMPT_DEFAULTS[k as PromptFieldKey]) out[k as PromptFieldKey] = t;
  }
  return out;
}

// 읽기는 관대하게 — 아는 키만 남긴다 (필드가 코드에서 사라져도 나머지 오버라이드는 유지)
function filterKnown(raw: unknown): PromptOverrides {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: PromptOverrides = {};
  for (const k of KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  return out;
}

export async function getPromptOverrides(sql: postgres.Sql): Promise<PromptOverrides> {
  const rows = await sql<Array<{ overrides: unknown }>>`
    select overrides from prompt_template_version order by created_at desc limit 1`;
  return rows.length ? filterKnown(rows[0].overrides) : {};
}

export async function savePromptOverrides(
  sql: postgres.Sql, overrides: PromptOverrides, memberId: string | null,
): Promise<void> {
  await sql`insert into prompt_template_version (overrides, member_id)
            values (${sql.json(overrides)}, ${memberId})`;
}

export async function listPromptVersions(sql: postgres.Sql, limit = 20): Promise<PromptVersionRow[]> {
  const rows = await sql<Array<{ id: string; overrides: unknown; created_at: Date; member_name: string | null }>>`
    select v.id, v.overrides, v.created_at, m.name as member_name
      from prompt_template_version v
      left join member m on m.id = v.member_id
     order by v.created_at desc
     limit ${limit}`;
  return rows.map((r) => ({
    id: r.id, overrides: filterKnown(r.overrides),
    memberName: r.member_name, createdAt: new Date(r.created_at).toISOString(),
  }));
}
