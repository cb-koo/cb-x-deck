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
export function DraftWrite({ task, clientId, onAttached, onSavedUnattached, onBusyChange, onDirtyChange }: {
  task: FlowRow;
  clientId: string | null;
  // 붙이기 성공 뒤 부모(FlowDetail)가 상세를 다시 읽는다 — DraftGenerate의 onAttached와 똑같은 계약
  // (재조회 성공 여부를 돌려준다). 재조회가 실패하면 여기서도 잠금을 풀고 새로고침을 안내한다.
  onAttached: (d: DraftRow) => Promise<boolean>;
  // 원고 생성은 됐는데(저장은 이미 끝났다) 그 작업에 붙이는 PATCH만 실패했을 때 — 쓴 글은 원고로
  // 이미 남아 있으므로 다시 칠 일이 없다. 부모가 '있는 원고 고르기' 후보를 다시 읽어야 거기서 보인다.
  onSavedUnattached: () => void;
  // busy가 켜진 진짜 이유를 함께 올린다(리뷰 지적 3) — DraftMode·TaskPanel이 이 문자열을 그대로 보여준다.
  // Task 3까지는 '만드는 중이에요'로 고정해도 참이었지만, 여기선 업로드 중·저장 중이 서로 다른 사실이라
  // boolean 하나로는 거짓 어포던스가 생긴다.
  onBusyChange: (busy: { label: string } | null) => void;
  // 작성 중(칸에 글자가 있거나 이미지가 붙어 있음)인지를 부모에 올린다(리뷰 지적 4) — 탭 전환·← 작업으로·
  // 패널 닫기가 이 값으로 "떠나기 전에 확인"을 건다. TaskPanel의 isNewDirty(새 작업 모드)와 같은 관례다.
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { show } = useToast();
  const [posts, setPosts] = useState<ComposerPost[]>([{ text: '', media: [], uploading: 0 }]);
  const [busy, setBusy] = useState(false);
  // 붙이기(PATCH)만 실패했을 때 재시도 대상 — 원고는 이미 만들어졌으므로 다시 누르면 새로 만들지 않고
  // 이 id로 붙이기만 다시 시도한다(리뷰 지적 5). 붙이기가 성공하면 비운다.
  const [createdDraftId, setCreatedDraftId] = useState<string | null>(null);

  // 칸별 uploading(ComposerPost.uploading, draftPickView.ts)의 합 — 이미지가 올라가는 중인지, 몇 장인지는
  // 여기서 더해서만 쓴다. XComposer가 칸마다 진행을 그리고(리뷰 지적 2), 여기는 총합으로 잠금·안내를 낸다.
  const uploadingTotal = posts.reduce((n, p) => n + p.uploading, 0);
  // busy를 부모에 올려 보낸다 — DraftGenerate와 같은 두 이펙트 관례(언마운트 시 정리). 업로드 중에도
  // 잠근다: 화면을 떠나면(다른 작업 클릭 등) 방금 올라간 이미지가 어느 칸에도 못 붙는 채로 남을 수 있다.
  const composing = busy || uploadingTotal > 0;
  useEffect(() => {
    if (busy) onBusyChange({ label: '저장하는 중이에요' });
    else if (uploadingTotal > 0) onBusyChange({ label: '이미지를 올리는 중이에요' });
    else onBusyChange(null);
  }, [busy, uploadingTotal, onBusyChange]);
  useEffect(() => () => onBusyChange(null), [onBusyChange]);

  // 작성 중 여부 — 친 글(트림)이 있거나, 이미 올라간 이미지가 있거나, 지금 올라가는 중이면 '작성 중'이다.
  // createdDraftId가 있으면(원고는 이미 저장, 붙이기만 재시도 대기) dirty가 아니다(자문 리뷰) — 이미
  // '있는 원고 고르기'에 안전하게 저장돼 있는데 dirty=true로 두면 떠날 때 "닫으면 저장되지 않고 사라져요"가
  // 거짓말이 된다. 언마운트(탭을 벗어남 등)되면 false로 정리한다 — 안 그러면 다음에 이 탭을 다시 열었을 때
  // (초기 상태인데도) 부모가 옛 값을 들고 있게 된다.
  const dirty = createdDraftId === null && posts.some((p) => p.text.trim() !== '' || p.media.length > 0 || p.uploading > 0);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  // 이미지는 고르는 즉시 올린다(브리프 머리 요구사항) — XComposer는 파일을 고르기만 하고, 실제 업로드와
  // uploading 카운트는 여기서 진다. uploading은 그 칸(posts[postIndex])에 직접 싣는다(draftPickView.ts
  // 주석) — 칸이 지워지거나 순서가 바뀌어도 값이 칸을 따라가지, 남의 칸에 남지 않는다. postIndex로
  // 도착지를 기억하므로 함수형 setPosts만 쓴다(클로저 금지) — 업로드가 도는 동안 다른 칸에서 텍스트를
  // 고쳐도 그 변경을 덮어쓰지 않는다.
  const onPickImages = useCallback((postIndex: number, files: File[]) => {
    setPosts((cur) => cur.map((p, i) => (i === postIndex ? { ...p, uploading: p.uploading + files.length } : p)));
    void Promise.all(files.map(async (file) => {
      try {
        const media = await uploadPendingDraftImage(file);
        setPosts((cur) => cur.map((p, i) => (i === postIndex ? { ...p, media: [...p.media, media] } : p)));
      } catch (e) {
        show(e instanceof Error ? e.message : '업로드에 실패했어요 — 다시 시도해주세요');
      } finally {
        setPosts((cur) => cur.map((p, i) => (i === postIndex ? { ...p, uploading: p.uploading - 1 } : p)));
      }
    }));
  }, [show]);

  async function save() {
    if (composing || !composerCanSave(posts)) return;
    setBusy(true);
    let draftId = createdDraftId;
    if (!draftId) {
      // procedureIds는 이 탭에 시술 선택 UI가 없다(브리프 §Step5에 없음) — 'AI로 만들기'의 접힌 설정과
      // 달리 직접 쓰기는 사람이 이미 완성한 문장을 그대로 저장하는 입구라 시술 필터가 프롬프트에 실릴 일이
      // 없다. 빈 배열로 보낸다(클라이언트 스냅샷 자체는 clientId만으로도 이름이 박제된다).
      const r = await createManualDraftApi({
        posts: posts.map((p) => ({ text: p.text.trim(), media: p.media })),
        clientId, procedureIds: [],
      });
      if (!r.ok) { setBusy(false); show(r.error); return; }
      const draft = r.data[0];
      // 응답이 비었거나([null] 등) 원고를 못 읽으면 여기서 멈추고 busy를 반드시 풀어야 한다(리뷰 minor) —
      // 안 풀면 이 상태가 패널의 Esc·바깥 클릭·탭까지 잠근 채로 굳는다. 저장 자체는 됐을 수 있으니
      // '있는 원고 고르기' 후보를 다시 읽게 한다(기존 입구 DraftWriteModal.save와 같은 방어).
      if (!draft) {
        setBusy(false);
        show('저장은 됐는데 결과를 읽지 못했어요 — 새로고침하면 \'있는 원고 고르기\'에 있어요');
        onSavedUnattached();
        return;
      }
      draftId = draft.id;
      setCreatedDraftId(draftId);
    }
    const a = await patchDraftApi(draftId, { taskId: task.id });
    if (!a.ok) {
      // 원고 자체는 이미 저장됐다 — 다시 쓰지 않아도 된다(브리프가 약속하는 문구 그대로). createdDraftId를
      // 비우지 않는다 — 다시 누르면 새로 만들지 않고 이 원고를 붙이기만 다시 시도한다(리뷰 지적 5).
      setBusy(false);
      show(`${a.error} — 쓴 글은 '있는 원고 고르기'에 저장돼 있어요`);
      onSavedUnattached();
      return;
    }
    setCreatedDraftId(null);
    // 성공해도 여기서 풀지 않는다(DraftGenerate.attach와 같은 이유) — 재조회(onAttached → 부모의
    // load())가 끝나기 전에 버튼이 다시 눌리면 같은 작업에 두 번째 원고를 만들게 된다. 재조회가 성공하면
    // 패널이 카드로 전환되며 이 컴포넌트 자체가 사라진다(언마운트 이펙트가 busy를 정리).
    if (!(await onAttached(a.data))) { setBusy(false); show('저장하고 붙였어요 — 화면을 새로고침해 주세요'); }
  }

  const ok = composerCanSave(posts);
  // 아직 아무것도 손대지 않은 첫 화면(칸 하나·빈 글·이미지 없음)에서는 "글자 수가 넘거나 빈 칸이 있어요"를
  // 띄우지 않는다(리뷰 minor) — 사실이지만 가만히 있는 화면에 오류처럼 읽힌다. 뭔가 치거나 지우는 순간부터는
  // 다시 보인다.
  const untouched = posts.length === 1 && posts[0].text === '' && posts[0].media.length === 0 && posts[0].uploading === 0;
  // 컴포저를 잠그는 진짜 이유 — XComposer에 그대로 넘겨서 그 컴포넌트가 스스로 지어낸 문구를 보이지
  // 않게 한다(자문 리뷰, Finding 3과 같은 규칙). 저장 중이 아닌데도 붙이기만 재시도하는 동안 컴포저가
  // 계속 편집 가능하면 [붙이기 다시 시도]가 taskId만 다시 PATCH할 뿐이라 그 수정이 조용히 버려진다.
  const composerDisabledReason = busy ? '저장하는 중이에요' : createdDraftId ? '글은 저장됐어요 — 붙이기만 다시 시도하면 돼요' : null;

  return (
    <div>
      <XComposer handle={task.influencerHandle} posts={posts} onChange={setPosts}
                 onPickImages={onPickImages} disabledReason={composerDisabledReason} />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" disabled={composing || !ok} onClick={() => void save()} className="h-10 px-4 text-content">
          {busy ? '저장 중…' : createdDraftId ? '붙이기 다시 시도' : '저장하고 붙이기'}
        </Button>
        {uploadingTotal > 0
          // 본문이 비었거나 글자 수가 넘었으면 업로드가 끝나도 저장할 수 없다 — 두 조건을 합쳐서 말한다(리뷰 minor).
          ? <span className="text-caption text-x-muted">{ok ? '이미지를 올리는 중이에요 — 끝나면 저장할 수 있어요' : '이미지를 올리는 중이에요 · 글자 수가 넘거나 빈 칸이 있어요'}</span>
          // createdDraftId 케이스는 XComposer 안(structureLockedReason)이 이미 같은 문장을 보여준다 —
          // 여기서 또 그리면 화면에 같은 문장이 두 번 겹친다(자문 리뷰). 한 곳(composerDisabledReason의
          // 출처)에서만 말한다.
          : (!ok && !untouched) && <span className="text-caption text-x-muted">글자 수가 넘거나 빈 칸이 있어요</span>}
      </div>
    </div>
  );
}
