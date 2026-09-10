// 읽기 전용 — 초안 첨부 34장을 전건 검증한다: 앱 가드 통과 · 스토리지 객체 실존 · content 불변.
// 실행: node --env-file=.env --import tsx scripts/audit-week2-images.ts
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getSql } from '../src/lib/db.ts';
import { normalizeDraftMedia, MAX_MEDIA_PER_POST } from '../src/lib/draftMediaGuard.ts';
import { tweetId } from './tweetDate.ts';

const RAWS = JSON.parse(readFileSync(new URL('../data-work/week2-posts-raw.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown> | null>;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE 환경변수 없음');
  const st = createClient(url, key, { auth: { persistSession: false } }).storage.from('draft-media');
  const sql = getSql();
  const fails: string[] = [];

  const rows = await sql`
    select c.name as camp, t.influencer_handle as h, t.post_url, d.id as draft_id,
           d.model, d.status, d.content, d.edited
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      join draft d on d.id = t.draft_id
     where c.name like '%_9월2주차' and t.post_url is not null
     order by c.name, t.influencer_handle`;

  let totalImgs = 0, verified = 0;
  for (const r of rows) {
    const h = String(r.h);
    const content = r.content as { posts: Array<{ text: string; media: unknown[] }> };
    const edited = r.edited as { posts: Array<{ text: string; media: Array<{ url: string }> }> } | null;
    if (!edited) { fails.push(`@${h}: edited 가 없다(첨부 안 됨)`); continue; }

    // content 불변
    if (content.posts[0].media.length !== 0) fails.push(`🔴 @${h}: content.media 가 비어 있지 않다 — 원본을 건드렸다`);
    if (content.posts[0].text !== edited.posts[0].text) fails.push(`@${h}: content 와 edited 의 본문이 다르다`);

    // 앱 가드 — 거절되면 화면에서 저장할 때 400이 난다
    const norm = normalizeDraftMedia(edited.posts[0].media);
    if (norm === null) { fails.push(`🔴 @${h}: 앱 가드가 거절하는 값이다`); continue; }
    if (JSON.stringify(norm) !== JSON.stringify(edited.posts[0].media)) fails.push(`@${h}: 가드가 값을 바꾼다(정규화 불일치)`);
    if (edited.posts[0].media.length > MAX_MEDIA_PER_POST) fails.push(`@${h}: 칸당 상한 초과`);

    // 원본 트윗의 이미지 개수와 같은가
    const id = tweetId(String(r.post_url));
    const raw = id ? RAWS[id] : null;
    const want = raw && Array.isArray(raw.media) ? (raw.media as Array<Record<string, unknown>>).filter((m) => m.type === 'photo').length : -1;
    if (want !== edited.posts[0].media.length) fails.push(`@${h}: 이미지 ${edited.posts[0].media.length}장 ≠ 원본 ${want}장`);

    // 스토리지에 실제로 있나 — 경로만 저장하는 구조라 이걸 확인해야 표시가 된다
    let ok = 0;
    for (const m of edited.posts[0].media) {
      if (!m.url.startsWith(`draft/${r.draft_id}/`)) { fails.push(`@${h}: 경로가 자기 초안 폴더가 아니다 — ${m.url}`); continue; }
      const sign = await st.createSignedUrl(m.url, 60);
      if (sign.error || !sign.data?.signedUrl) { fails.push(`@${h}: 서명 URL 실패 ${m.url}`); continue; }
      const res = await fetch(sign.data.signedUrl);
      if (!res.ok) { fails.push(`@${h}: 객체 없음 ${m.url} (${res.status})`); continue; }
      const bytes = Buffer.from(await res.arrayBuffer()).byteLength;
      if (bytes === 0) { fails.push(`@${h}: 빈 파일 ${m.url}`); continue; }
      ok++; verified++;
    }
    totalImgs += edited.posts[0].media.length;
    console.log(`  @${h.padEnd(16)} ${edited.posts[0].media.length}장 · 가드 통과 · 스토리지 확인 ${ok}/${edited.posts[0].media.length} · content.media ${content.posts[0].media.length}`);
  }

  console.log(`\n총계 — 초안 ${rows.length}건 · 첨부 ${totalImgs}장 · 스토리지 실존 확인 ${verified}장`);
  if (verified !== totalImgs) fails.push(`스토리지 확인 ${verified} ≠ 첨부 ${totalImgs}`);

  console.log('════════════');
  if (!fails.length) console.log('✓ 검증 통과 — 가드·스토리지·원본 불변 모두 정상');
  else { console.log(`✗ 문제 ${fails.length}건`); for (const f of fails) console.log(`   ✗ ${f}`); }
  await sql.end();
  if (fails.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
