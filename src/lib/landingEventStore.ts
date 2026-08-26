// src/lib/landingEventStore.ts
// 랜딩 이벤트 원장 읽기/쓰기. 사람·봇 판정은 저장하지 않고 여기서 읽기 시점 SQL로 한다 —
// 규칙이 바뀌어도 과거 데이터가 새 규칙으로 다시 읽힌다(스펙 §집계 규칙).
import type postgres from 'postgres';
import type { LandingEventInput } from './landingEvent.ts';
import { kstDaysAgoStart, kstDayStart } from './datetime.ts';

export type Range = 'all' | '7d' | '30d' | 'custom';

// 기간 창 — since 포함, until 미포함(다음 날 00:00). null = 그쪽 경계 없음. 전부 서울 00:00 순간이다.
export interface Window { since: Date | null; until: Date | null }
export const OPEN_WINDOW: Window = { since: null, until: null };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

// 기간 프리셋(또는 직접 지정 from~to, YYYY-MM-DD 서울 날짜)을 SQL 경계 두 개로. 시계 주입은 datetime.ts 관례(테스트용).
// custom인데 날짜가 둘 다 유효하지 않으면 경계 없음(all)으로 — 반쪽 입력으로 표가 비는 일을 막는다.
export function rangeWindow(range: Range, from: string | null = null, to: string | null = null, now: () => number = Date.now): Window {
  if (range === '7d') return { since: kstDaysAgoStart(6, now), until: null };   // 오늘 포함 7일
  if (range === '30d') return { since: kstDaysAgoStart(29, now), until: null };
  if (range === 'custom' && from && to && YMD.test(from) && YMD.test(to) && from <= to) {
    return { since: kstDayStart(from), until: new Date(kstDayStart(to).getTime() + 86_400_000) };
  }
  return OPEN_WINDOW;
}

// 기간 시작 순간만 필요한 호출부용(프리셋 전용).
export function rangeStart(range: Range, now: () => number = Date.now): Date | null {
  return rangeWindow(range, null, null, now).since;
}

const windowSql = (sql: postgres.Sql, w: Window) => sql`
  ${w.since ? sql`and occurred_at >= ${w.since}` : sql``}
  ${w.until ? sql`and occurred_at < ${w.until}` : sql``}`;

// 멱등 insert — event_id unique에 걸린 건은 조용히 넘기고 개수만 알려준다(브릿지 재시도가 중복을 만들지 않게).
export async function insertLandingEvents(
  sql: postgres.Sql, events: LandingEventInput[],
): Promise<{ accepted: number; duplicates: number }> {
  if (events.length === 0) return { accepted: 0, duplicates: 0 };
  const rows = events.map((e) => ({
    event_id: e.eventId, visit_id: e.visitId, kind: e.kind, clinic: e.clinic, hostname: e.hostname, path: e.path,
    utm_source: e.utmSource, utm_medium: e.utmMedium, utm_campaign: e.utmCampaign, utm_content: e.utmContent, utm_term: e.utmTerm,
    referer_host: e.refererHost, ua: e.ua, is_bot_ua: e.isBotUa, sec_fetch_ok: e.secFetchOk,
    ip_hash: e.ipHash, country: e.country, occurred_at: e.occurredAt,
  }));
  const ins = await sql<Array<{ id: string }>>`
    insert into landing_event ${sql(rows)}
    on conflict (event_id) do nothing
    returning id`;
  return { accepted: ins.length, duplicates: events.length - ins.length };
}

// 방문 단위 사람·탭 판정 — 두 집계 쿼리가 같은 규칙을 써야 한다(한쪽만 바뀌면 숫자가 어긋난다)
const visitFlags = (sql: postgres.Sql) => sql`
  bool_or(not is_bot_ua and kind in ('view','tap')) as human,
  bool_or(not is_bot_ua and kind = 'tap') as tapped`;

export interface ContentStats {
  utmContent: string;
  visits: number;    // distinct visit_id 전체(봇·프리페치 포함)
  arrivals: number;  // 사람 도착 = not bot and (view or tap)
  taps: number;      // not bot and tap
}

// 방문(visit_id) 단위로 먼저 접고 콘텐츠별로 센다. window 경계가 null이면 그쪽은 열려 있다.
export async function statsByUtmContent(
  sql: postgres.Sql, utmContents: string[], window: Window,
): Promise<Map<string, ContentStats>> {
  if (utmContents.length === 0) return new Map();
  const rows = await sql<Array<{ utm_content: string; visits: number; arrivals: number; taps: number }>>`
    with v as (
      select utm_content, visit_id,
             ${visitFlags(sql)}
        from landing_event
       where utm_content = any(${utmContents}::text[])
         ${windowSql(sql, window)}
       group by utm_content, visit_id)
    select utm_content,
           count(*)::int as visits,
           count(*) filter (where human)::int as arrivals,
           count(*) filter (where tapped)::int as taps
      from v group by utm_content`;
  return new Map(rows.map((r) => [r.utm_content, {
    utmContent: r.utm_content, visits: r.visits, arrivals: r.arrivals, taps: r.taps,
  }]));
}

export interface UnlinkedStats {
  total: number;   // 사람 도착 합
  byContent: Array<{ utmContent: string | null; arrivals: number; taps: number }>; // 도착 많은 순
}

// 어느 링크에도 안 맞는 유입 — 버리지 않고 따로 센다(아는 만큼만 말한다).
// 캠페인 필터는 이벤트 자신의 utm_campaign으로(선택 캠페인과 같거나 null). campaign이 null이면 캠페인 조건 없음.
export async function unlinkedStats(
  sql: postgres.Sql, knownUtmContents: string[], campaign: string | null, window: Window,
): Promise<UnlinkedStats> {
  const rows = await sql<Array<{ utm_content: string | null; arrivals: number; taps: number }>>`
    with v as (
      select utm_content, visit_id,
             ${visitFlags(sql)}
        from landing_event
       where (utm_content is null or not (utm_content = any(${knownUtmContents}::text[])))
         ${campaign ? sql`and (utm_campaign = ${campaign} or utm_campaign is null)` : sql``}
         ${windowSql(sql, window)}
       group by utm_content, visit_id)
    select utm_content,
           count(*) filter (where human)::int as arrivals,
           count(*) filter (where tapped)::int as taps
      from v group by utm_content
     having count(*) filter (where human) > 0
     order by arrivals desc, utm_content nulls last`;
  return {
    total: rows.reduce((s, r) => s + r.arrivals, 0),
    byContent: rows.map((r) => ({ utmContent: r.utm_content, arrivals: r.arrivals, taps: r.taps })),
  };
}
