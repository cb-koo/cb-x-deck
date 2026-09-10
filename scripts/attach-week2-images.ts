// 게시물 이미지를 초안 첨부로 옮긴다 — X에서 내려받아 draft-media 버킷에 올리고 초안의 edited.media 를 채운다.
//
// koo 확인(2026-09-10): "우리가 기획해서 전달한 이미지" → 초안 첨부로 담는 것이 맞다.
//
// 왜 URL을 그대로 안 쓰나: draftMediaGuard 가 X CDN 절대 URL을 금지한다 — 임의 URL이 jsonb에 저장되면
// 워크스페이스 전원의 브라우저가 그 주소로 <img src> 요청을 보낸다(추적 픽셀·IP 유출). 그래서 내려받아
// 우리 버킷에 다시 올린다. 그러면 가드가 요구하는 형태(draft/<초안id>/<파일id>.<확장자>)가 되고
// 가드가 막으려던 문제도 함께 사라진다.
//
// 어디에 넣나: content 가 아니라 **edited**. 앱의 첨부 경로(PATCH /api/drafts/[id])가 edited 에만 쓰고
// content 는 "생성 원본. 불변"으로 남기기 때문이다 — 사람이 화면에서 붙인 것과 같은 자리에 둔다.
//
// 버킷 제약(마이그레이션 024 · draftMedia.ts와 같은 값이어야 한다): 5MB · jpg/png/gif/webp · 칸당 4장.
//
// 기본은 1건만 시험(--one). 전체는 --all. 실제 반영은 --apply. 이미 첨부가 있는 초안은 건너뛴다.
// 실행: node --env-file=.env --import tsx scripts/attach-week2-images.ts [--one|--all] [--apply]
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { getSql } from '../src/lib/db.ts';
import { tweetId } from './tweetDate.ts';

const BUCKET = 'draft-media';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_PER_POST = 4;

const RAWS = JSON.parse(readFileSync(new URL('../data-work/week2-posts-raw.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown> | null>;

function storage() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env 에 없습니다');
  return createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET);
}

// X 이미지 URL — 원본 크기를 받는다(기본 URL은 축소판일 수 있다)
const origUrl = (u: string) => (u.includes('?') ? `${u}&name=orig` : `${u}?name=orig`);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const all = argv.includes('--all');
  const sql = getSql();
  const st = storage();

  // 초안이 붙은 작업 — 초안 id 와 현재 첨부 상태
  const rows = await sql`
    select c.name as camp, t.influencer_handle as h, t.post_url, t.draft_id,
           d.content, d.edited
      from campaign_task t
      join campaign c on c.id = t.campaign_id
      join draft d on d.id = t.draft_id
     where c.name like '%_9월2주차' and t.post_url is not null
     order by c.name, t.influencer_handle`;

  type Job = { camp: string; h: string; draftId: string; text: string; urls: string[]; already: number };
  const jobs: Job[] = [];
  for (const r of rows) {
    const id = tweetId(String(r.post_url));
    const raw = id ? RAWS[id] : null;
    if (!raw) continue;
    const media = (Array.isArray(raw.media) ? raw.media : []) as Array<Record<string, unknown>>;
    const urls = media.filter((m) => m.type === 'photo' && typeof m.url === 'string').map((m) => String(m.url)).slice(0, MAX_PER_POST);
    const content = r.content as { posts: Array<{ text: string; media: unknown[] }> };
    const edited = r.edited as { posts: Array<{ text: string; media: unknown[] }> } | null;
    const already = (edited ?? content).posts[0]?.media?.length ?? 0;
    if (!urls.length) continue;
    jobs.push({ camp: String(r.camp), h: String(r.h), draftId: String(r.draft_id), text: content.posts[0].text, urls, already });
  }

  const todo = jobs.filter((j) => j.already === 0);
  const targets = all ? todo : todo.slice(0, 1);
  console.log(`총계 — 초안 ${jobs.length}건 · 첨부 필요 ${todo.length}건 · 이번 실행 대상 ${targets.length}건 (${all ? '전체' : '시험 1건'})`);
  console.log(`이미지 합계 ${targets.reduce((a, j) => a + j.urls.length, 0)}장\n`);

  for (const j of targets) {
    console.log(`━━ [${j.camp}] @${j.h} · 초안 ${j.draftId} · 이미지 ${j.urls.length}장`);
    const attached: Array<{ type: 'photo'; url: string; videoUrl: null }> = [];

    for (const [i, u] of j.urls.entries()) {
      const src = origUrl(u);
      const res = await fetch(src);
      if (!res.ok) { console.log(`   ✗ ${i + 1}/${j.urls.length} 내려받기 실패 ${res.status} — ${src}`); continue; }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      const okType = ALLOWED.includes(type);
      const okSize = buf.byteLength <= MAX_BYTES;
      console.log(`   ${okType && okSize ? '✓' : '✗'} ${i + 1}/${j.urls.length} ${type} ${(buf.byteLength / 1024).toFixed(0)}KB${okType ? '' : ' — 형식 불허'}${okSize ? '' : ' — 5MB 초과'}`);
      if (!okType || !okSize) continue;

      const path = `draft/${j.draftId}/${crypto.randomUUID()}.${MIME_EXT[type]}`;
      if (!apply) { console.log(`      → (드라이런) 올릴 경로 ${path}`); attached.push({ type: 'photo', url: path, videoUrl: null }); continue; }

      const up = await st.upload(path, buf, { contentType: type, upsert: false });
      if (up.error) { console.log(`      ✗ 업로드 실패: ${up.error.message}`); continue; }
      // 올라간 것을 서명 URL로 확인 — 경로만 저장하는 구조라 실제 객체가 있는지 여기서 확정한다
      const sign = await st.createSignedUrl(path, 60);
      if (sign.error || !sign.data?.signedUrl) { console.log(`      ✗ 서명 URL 발급 실패: ${sign.error?.message}`); continue; }
      const head = await fetch(sign.data.signedUrl, { method: 'GET' });
      const gotBytes = head.ok ? Buffer.from(await head.arrayBuffer()).byteLength : -1;
      const same = gotBytes === buf.byteLength;
      console.log(`      ${same ? '✓' : '✗'} 업로드·확인 ${path} (내려받아 ${gotBytes}B / 올린 ${buf.byteLength}B)`);
      if (!same) continue;
      attached.push({ type: 'photo', url: path, videoUrl: null });
    }

    if (!attached.length) { console.log('   → 첨부할 것이 없습니다'); continue; }
    if (!apply) { console.log(`   → (드라이런) edited.media 에 ${attached.length}장을 넣습니다`); continue; }

    // content 는 건드리지 않는다 — edited 에만 쓴다(앱의 PATCH와 같은 자리)
    await sql`update draft set edited = ${sql.json({ posts: [{ text: j.text, media: attached }] } as never)} where id = ${j.draftId}`;
    console.log(`   ✓ edited.media ${attached.length}장 기록`);
  }

  if (apply) {
    // 9월2주차 초안만 센다 — 앱 전체를 세면 이전에 사람이 붙인 것까지 섞여 오해를 준다
    const [x] = await sql`
      select count(*) as n, coalesce(sum(jsonb_array_length(d.edited->'posts'->0->'media')), 0) as imgs
        from campaign_task t
        join campaign c on c.id = t.campaign_id
        join draft d on d.id = t.draft_id
       where c.name like '%_9월2주차'
         and d.edited is not null and jsonb_array_length(d.edited->'posts'->0->'media') > 0`;
    console.log(`\n확인 — 9월2주차 초안 중 첨부가 있는 것 ${x.n}건 · 이미지 ${x.imgs}장`);
  } else {
    console.log(`\n드라이런입니다 — 실제로 올리려면 --apply${all ? ' --all' : ''}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
