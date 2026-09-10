// 읽기 전용 — 결제수단 일괄 입력(08-27) 이후 인플루언서 데이터 변경 이력. 개인정보 값은 마스킹.
import { getSql } from '../src/lib/db.ts';

const TEST_HANDLES = ['aik_ooooo','b___zooly','eveniffen','_ponchan78','_____noay','_mi_pi03','pichan_032',
  'miyu_biyo_','kiria030208','chocomaru06','cie7le'].map((h) => h.toLowerCase());

const mask = (v: unknown): string => {
  const s = String(v ?? '');
  if (!s) return '(빈값)';
  return s.length <= 4 ? '*'.repeat(s.length) : `${s.slice(0, 2)}${'*'.repeat(Math.min(s.length - 4, 8))}${s.slice(-2)}`;
};

async function main(): Promise<void> {
  const sql = getSql();

  const rows = await sql`
    select to_char(l.created_at at time zone 'Asia/Seoul','MM-DD HH24:MI') as at,
           i.handle, l.kind, l.event_type, l.payload, l.body,
           coalesce(m.name, m.email, '(없음)') as author
      from influencer_log l
      join influencer i on i.id = l.influencer_id
      left join member m on m.id = l.author_id
     where l.created_at >= '2026-08-27 18:00+09'
       and (l.kind = 'manual' or l.event_type in ('payment_method_changed','handle_changed','pricing_changed'))
     order by l.created_at
  `;

  console.log(`\n══════ 08-27 일괄 입력 이후 데이터 변경 ${rows.length}건 ══════\n`);
  for (const r of rows) {
    const test = TEST_HANDLES.includes(String(r.handle).toLowerCase()) ? ' 🔴테스트캠페인핸들' : '';
    if (r.event_type === 'payment_method_changed') {
      const p = r.payload as { action: string; type: string; fields?: Array<{ field: string; from: string | null; to: string | null }> };
      const f = (p.fields ?? []).map((x) => `${x.field}: ${mask(x.from)} → ${mask(x.to)}`).join(', ');
      console.log(`[${r.at}] @${r.handle}${test}\n    결제수단 ${p.action} (${p.type})${f ? '\n    ' + f : ''}  · ${r.author}`);
    } else if (r.kind === 'manual') {
      console.log(`[${r.at}] @${r.handle}${test}\n    수동 메모: ${String(r.body ?? '').slice(0, 100)}  · ${r.author}`);
    } else {
      console.log(`[${r.at}] @${r.handle}${test}\n    ${r.event_type}: ${JSON.stringify(r.payload)}  · ${r.author}`);
    }
  }

  console.log('\n\n══════ 이력이 남지 않는 항목 — 현재 값만 확인 가능 ══════');
  const [c] = await sql`
    select count(*) filter (where tags <> '[]'::jsonb) as with_tags,
           count(*) filter (where note <> '') as with_note,
           count(*) filter (where pricing <> '{}'::jsonb) as with_pricing,
           count(*) filter (where analyzed_at is not null) as analyzed
      from influencer`;
  console.log(`태그 있는 인플 ${c.with_tags}명 / 메모 있는 인플 ${c.with_note}명 / 단가 있는 인플 ${c.with_pricing}명 / 분석된 인플 ${c.analyzed}명`);
  console.log('(influencer 테이블에 updated_at이 없어 태그·메모 수정은 시점을 알 수 없음)');

  console.log('\n── 테스트 캠페인 핸들의 현재 결제수단 ──');
  const pm = await sql`
    select i.handle, jsonb_array_length(i.payment_methods) as n,
           (select jsonb_agg(x->>'type') from jsonb_array_elements(i.payment_methods) x) as types
      from influencer i
     where lower(i.handle) in ${sql(TEST_HANDLES)}
     order by i.handle`;
  for (const r of pm) console.log(`   @${r.handle}: ${r.n}개 ${JSON.stringify(r.types)}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
