// scripts/setup-staging.ts — 마이그레이션이 만들지 않는 것: Storage 버킷(원고 이미지). 멱등.
import { createClient } from '@supabase/supabase-js';
import { assertStaging } from './stagingGuard.ts';
import { DRAFT_MEDIA_BUCKET } from '../src/lib/draftMedia.ts';

assertStaging(); // DB/Storage 연결 전에 먼저 — 이 프로젝트는 package.json에 "type":"module"이 없어 tsx가 최상위 await를 cjs로 트랜스폼하지 못한다(다른 scripts/*.ts와 동일하게 async IIFE로 감싼다)

(async () => {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) { console.error(error.message); process.exit(1); return; }
  if (buckets.some((b) => b.name === DRAFT_MEDIA_BUCKET)) console.log(`버킷 있음: ${DRAFT_MEDIA_BUCKET}`);
  else {
    const r = await supabase.storage.createBucket(DRAFT_MEDIA_BUCKET, { public: false });
    if (r.error) { console.error(r.error.message); process.exit(1); return; }
    console.log(`버킷 생성: ${DRAFT_MEDIA_BUCKET}`);
  }
})();
