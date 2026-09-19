'use client';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import type { DraftRow } from '@/lib/draftStore';
import type { FlowRow } from '@/lib/campaignFlowView';
import { createManualDraftApi, patchDraftApi } from '@/lib/campaignApi';
import { uploadPendingDraftImage } from '@/lib/draftMedia';
import { composerCanSave, type ComposerPost } from '@/lib/draftPickView';
import { Button } from '@/components/ui';
import { XComposer } from './XComposer';

// 원고 모드 · 직접 쓰기(C 원고 모드 Task 4) — X의 글쓰기 화면을 본떠 사람이 직접 쓰고, 이미지를 붙이고,
// [저장하고 붙이기] 한 번으로 그 작업에 붙인다. 이 화면을 요청한 사람이 가장 싫어한 것이 "저장한 뒤 이미지를
// 다시 올리는 일"이라(위 c-task-4-brief.md 머리) — 그래서 이미지는 고르는 순간 올라가고(uploadPendingDraftImage,
// 아직 원고가 없으므로 draftId가 필요한 uploadDraftImage 대신 쓴다), 저장 버튼은 본문과 이미 올라간
// 이미지를 함께 실어 원고 생성 + 작업 붙이기를 한 번에 끝낸다(DraftGenerate처럼 "만들고 → 고르고 →
// 붙이고" 세 단계가 아니다 — 여기엔 고를 시안이 없다).
export function DraftWrite({ task, clientId, onAttached, onSavedUnattached, onBusyChange }: {
  task: FlowRow;
  clientId: string | null;
  // 붙이기 성공 뒤 부모(FlowDetail)가 상세를 다시 읽는다 — DraftGenerate의 onAttached와 똑같은 계약
  // (재조회 성공 여부를 돌려준다). 재조회가 실패하면 여기서도 잠금을 풀고 새로고침을 안내한다.
  onAttached: (d: DraftRow) => Promise<boolean>;
  // 원고 생성은 됐는데(저장은 이미 끝났다) 그 작업에 붙이는 PATCH만 실패했을 때 — 쓴 글은 원고로
  // 이미 남아 있으므로 다시 칠 일이 없다. 부모가 '있는 원고 고르기' 후보를 다시 읽어야 거기서 보인다.
  onSavedUnattached: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { show } = useToast();
  const [posts, setPosts] = useState<ComposerPost[]>([{ text: '', media: [] }]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  // busy를 부모에 올려 보낸다 — DraftGenerate와 같은 두 이펙트 관례(언마운트 시 false로 정리). 업로드 중에도
  // 잠근다: 화면을 떠나면(다른 작업 클릭 등) 방금 올라간 이미지가 어느 칸에도 못 붙는 채로 남을 수 있다.
  const composing = busy || uploading > 0;
  useEffect(() => { onBusyChange(composing); }, [composing, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  // 이미지는 고르는 즉시 올린다(브리프 머리 요구사항) — XComposer는 파일을 고르기만 하고, 실제 업로드와
  // uploading 카운트는 여기서 진다. postIndex로 도착지를 기억하므로 함수형 setPosts만 쓴다(클로저 금지) —
  // 업로드가 도는 동안 다른 칸에서 텍스트를 고쳐도 그 변경을 덮어쓰지 않는다.
  const onPickImages = useCallback((postIndex: number, files: File[]) => {
    setUploading((n) => n + files.length);
    void Promise.all(files.map(async (file) => {
      try {
        const media = await uploadPendingDraftImage(file);
        setPosts((cur) => cur.map((p, i) => (i === postIndex ? { ...p, media: [...p.media, media] } : p)));
      } catch (e) {
        show(e instanceof Error ? e.message : '업로드에 실패했어요 — 다시 시도해주세요');
      } finally {
        setUploading((n) => n - 1);
      }
    }));
  }, [show]);

  async function save() {
    if (composing || !composerCanSave(posts)) return;
    setBusy(true);
    // procedureIds는 이 탭에 시술 선택 UI가 없다(브리프 §Step5에 없음) — 'AI로 만들기'의 접힌 설정과
    // 달리 직접 쓰기는 사람이 이미 완성한 문장을 그대로 저장하는 입구라 시술 필터가 프롬프트에 실릴 일이
    // 없다. 빈 배열로 보낸다(클라이언트 스냅샷 자체는 clientId만으로도 이름이 박제된다).
    const r = await createManualDraftApi({
      posts: posts.map((p) => ({ text: p.text.trim(), media: p.media })),
      clientId, procedureIds: [],
    });
    if (!r.ok) { setBusy(false); show(r.error); return; }
    const draft = r.data[0];
    const a = await patchDraftApi(draft.id, { taskId: task.id });
    if (!a.ok) {
      // 원고 자체는 이미 저장됐다 — 다시 쓰지 않아도 된다(브리프가 약속하는 문구 그대로).
      setBusy(false);
      show(`${a.error} — 쓴 글은 '있는 원고 고르기'에 저장돼 있어요`);
      onSavedUnattached();
      return;
    }
    // 성공해도 여기서 풀지 않는다(DraftGenerate.attach와 같은 이유) — 재조회(onAttached → 부모의
    // load())가 끝나기 전에 버튼이 다시 눌리면 같은 작업에 두 번째 원고를 만들게 된다. 재조회가 성공하면
    // 패널이 카드로 전환되며 이 컴포넌트 자체가 사라진다(언마운트 이펙트가 busy를 정리).
    if (!(await onAttached(a.data))) { setBusy(false); show('저장하고 붙였어요 — 화면을 새로고침해 주세요'); }
  }

  const ok = composerCanSave(posts);

  return (
    <div>
      <XComposer handle={task.influencerHandle} posts={posts} onChange={setPosts}
                 onPickImages={onPickImages} uploading={uploading} disabled={busy} />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={composing || !ok} onClick={() => void save()} className="h-10 px-4 text-content">
          {busy ? '저장 중…' : '저장하고 붙이기'}
        </Button>
        {uploading > 0
          ? <span className="text-caption text-x-muted">이미지를 올리는 중이에요 — 끝나면 저장할 수 있어요</span>
          : !ok && <span className="text-caption text-x-muted">글자 수가 넘거나 빈 칸이 있어요</span>}
      </div>
    </div>
  );
}
