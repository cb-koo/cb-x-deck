// 실호출 스모크: 방향성만으로 초안 1건 생성 → 출력 → 삭제. 비용 ~$0.07 (opus-5)
import { getSql } from '../src/lib/db.ts';
import { generateDraft } from '../src/lib/generate.ts';
import { getDraft, removeDraft } from '../src/lib/draftStore.ts';

(async () => {
  const sql = getSql();
  const id = await generateDraft(sql, {
    clientId: null, procedureIds: [], refTweetIds: [], mode: 'off',
    direction: '여름 전 시술을 고민하는 20대에게, 다운타임이 짧다는 점을 강조하는 단문',
    format: 'single', constraintsOn: false, memberId: null,
  });
  const draft = await getDraft(sql, id);
  console.log('생성 결과:', JSON.stringify(draft?.content, null, 2));
  console.log('모델:', draft?.model);
  await removeDraft(sql, id);
  console.log('스모크 초안 삭제 완료');
  await sql.end();
})();
