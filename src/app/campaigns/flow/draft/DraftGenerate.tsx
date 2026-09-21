'use client';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow, ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftRow } from '@/lib/draftStore';
import type { FlowRow } from '@/lib/campaignFlowView';
import { createDraftsApi, patchDraftApi } from '@/lib/campaignApi';
import { canGenerate, bannedPhraseCount, COST_CAPTION, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { candidateLine } from '@/lib/draftPickView';
import { RefPickerSheet, MAX_REFS_UI } from '@/components/RefPickerSheet';
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import { Button } from '@/components/ui';

// 원고 모드 · AI로 만들기(C 원고 모드 Task 3) — 패널 안에서 시안을 만들고 하나를 그 작업에 붙인다.
// 첫 화면은 매번 바뀌는 레퍼런스·방향성 둘뿐(브리프 §5-1). 시술·형식·제약은 ▸ 설정으로 접고 클라이언트별
// 마지막 값을 localStorage에 기억한다(기존 /generate COMPOSER_KEY 관례). 시안 수는 기억하지 않는다 — 아래
// count 주석 참조(리뷰 지적 4).
//
// 참고 방식(form/angle/both)은 이 화면에 노출하지 않는다 — 브리프의 접힌 설정 목록(시술·형식·시안 수·제약)에
// 없고, "매번 바꾸는 둘만" 원칙과도 맞지 않아 항상 both로 고정한다(레퍼런스가 있으면 형식+앵글 모두 참고).
const settingsKey = (clientId: string) => `campaign-v2-draft-settings:${clientId}`;
// count(시안 수)는 여기 없다 — /generate가 이미 막아 둔 것과 같은 이유(generate/page.tsx:211,473 주석 "시안 수는
// 1회용"): 기억해 두면 한 번 5로 늘린 사용자가 그 뒤 모든 생성에서 조용히 5배를 낸다. 매 마운트 1에서 시작하고
// 생성이 끝나면 다시 1로 돌아온다(리뷰 지적 4).
type FoldedSettings = { procedureIds: string[]; format: ComposerState['format']; constraintsOn: boolean };
const DEFAULT_FOLDED: FoldedSettings = {
  procedureIds: DEFAULT_COMPOSER.procedureIds, format: DEFAULT_COMPOSER.format,
  constraintsOn: DEFAULT_COMPOSER.constraintsOn,
};

// 레퍼런스를 추가할 때 지키는 상한 규칙 — '+ 링크'(handleAddedByLink)와 고르기 시트(RefPickerSheet.onApply)가
// 같은 함수를 쓴다(3c 리뷰 지적 6). 시트는 자기 안에서 MAX_REFS_UI(8)까지 고르게 하지만 인용RT 대상 게시물
// (targetRef)을 모른다 — 대상이 있으면 실제 자리는 7이다. 여기서: 대상 게시물도 한 자리로 센다, 이미 있는
// tweetId는 중복으로 넣지 않는다, 상한에 걸려 잘라낸 건수를 돌려준다(호출부가 조용히 버리지 않고 토스트로 말한다).
function applyRefCap(
  candidates: ReferenceRow[], targetRef: { tweetId: string } | null,
): { rows: ReferenceRow[]; droppedByCap: number } {
  const cap = MAX_REFS_UI - (targetRef ? 1 : 0);
  const seen = new Set<string>();
  const rows: ReferenceRow[] = [];
  let droppedByCap = 0;
  for (const r of candidates) {
    if (targetRef?.tweetId === r.tweetId || seen.has(r.tweetId)) continue;   // 대상과 겹치거나 이미 본 건 중복
    seen.add(r.tweetId);   // push 여부와 무관하게 본 id로 표시한다 — 안 그러면 상한에 걸린 뒤 같은 id가 또
                            // 나올 때마다 '못 담음'이 다시 올라, 실제로 버린 고유 건수보다 커진다(리뷰 지적 2)
    if (rows.length >= cap) { droppedByCap++; continue; }
    rows.push(r);
  }
  return { rows, droppedByCap };
}

export function DraftGenerate({
  task, clientId, clientData, targetRef, onAttached, onAttachFailed, onGenerated, onBusyChange, onOverlayChange, onDirtyChange,
}: {
  task: FlowRow;
  clientId: string | null;
  // 클라이언트 정보 — FlowDetail의 clientData와 같은 모양(3c 리뷰 지적 5). 셋으로 나뉜다(리뷰 지적 4):
  // undefined는 아직 못 읽음(로딩 중이거나 clientId 자체가 없음), null은 읽다가 실패, 객체는 성공. clientId가
  // 없어서인지 실패해서인지는 clientId로 구분한다 — 아래 bannedCount 계산 참고. clientName은 따로 받지
  // 않는다 — clientData.client.name에서 그대로 나오는 값이라 읽는 자리(아래 JSX 한 곳)에서 파생시킨다
  // (리뷰 지적 5, 같은 사실을 prop 두 개로 넘기지 않는다).
  clientData: { client: ClientRow; procedures: ProcedureRow[] } | null | undefined;
  targetRef: { tweetId: string; label: string } | null;   // 인용RT의 대상 게시물(자동 포함)
  // 시안을 붙였다 — 부모가 상세를 다시 읽고 카드로 전환한다. 그 재조회가 성공했는지를 돌려준다(리뷰 지적 3):
  // 재조회가 실패하면 붙이기 자체는 이미 서버에서 끝났어도 task.draftId가 안 채워져 이 화면이 카드로
  // 전환되지 않는다 — attaching 잠금을 푸는 유일한 길이 그 전환이라, 실패를 모르면 잠금이 영영 안 풀린다.
  onAttached: (d: DraftRow) => Promise<boolean>;
  // 붙이기 실패(주로 409 — 다른 세션이 먼저 붙였거나 작업이 취소된 뒤) 뒤 복구를 부모(FlowDetail) 한
  // 곳으로 모은다(최종 리뷰 §2) — '있는 원고 고르기' 탭과 같은 PATCH를 쏘는데 회복 규칙만 여기 따로
  // 없으면 같은 오류로 계속 재시도하게 된다. status를 그대로 넘기고 판정은 부모가 진다.
  onAttachFailed: (status: number) => void;
  // 브리프의 계약엔 없지만(§ Interfaces), 생성 뒤 '있는 원고 고르기' 후보 수를 갱신하려면 부모(FlowDetail)의
  // reloadCandidates를 불러야 한다 — 고르지 않은 시안도 미부착 원고로 남기 때문(§Step3 주석).
  onGenerated: () => void;
  // 생성·붙이기 중엔 패널의 Esc·바깥 클릭 닫기를 부모(TaskPanel)가 끄게 한다(원고 모드 §Step3 "만드는 동안
  // 패널에 머무른다" — 최종 리뷰 §3에서 붙이는 동안도 넓혔다. 안 그러면 다른 두 탭과 달리 이 시안 붙이기
  // 중에 Esc 한 번으로 패널이 닫힌다. 데이터는 안전해도(서버 PATCH는 이미 끝났다) 사용자는 붙었는지 모른
  // 채 화면을 잃는다) — 이 컴포넌트의 로컬 busy·attaching은 TaskPanel이 못 보므로 콜백으로 올려 보낸다.
  // label을 함께 올린다(DraftWrite와 같은 계약) — 생성 중과 붙이는 중은 다른 사실이라 boolean 하나로는
  // 거짓 어포던스가 된다.
  onBusyChange: (busy: { label: string } | null) => void;
  // 레퍼런스 고르기 시트·링크 추가 모달이 떠 있는 동안은 패널의 Esc를 끈다(리뷰 지적 1, Critical) — 두 오버레이는
  // 버블 단계에서 keydown을 듣고 stopPropagation을 하지 않아, 패널의 Esc 리스너가 먼저 잡아 패널째로 닫혀 버린다.
  // onBusyChange와 같은 방식(부모가 못 보는 로컬 상태를 콜백으로 올린다, 언마운트 시 false로 정리).
  onOverlayChange: (open: boolean) => void;
  // 방향성에 글자가 있는지를 부모에 올린다(Task 4c §3) — '직접 쓰기' 탭의 onDirtyChange와 같은 값을
  // 같은 곳(FlowDetail의 draftWriteDirty)에 싣는다. 두 탭은 동시에 마운트되지 않으므로 값이 섞이지
  // 않는다. 레퍼런스 칩·만들어진 시안은 판정에 넣지 않는다(브리프 §3) — 레퍼런스는 다시 고르면 그만이고,
  // 시안은 이미 원고로 저장돼 '있는 원고 고르기'에 남아 잃을 게 없다. 방향성 글자만 "다시 칠 일"이라서다.
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { show } = useToast();
  const [refs, setRefs] = useState<ReferenceRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [folded, setFolded] = useState<FoldedSettings>(DEFAULT_FOLDED);
  const [count, setCount] = useState(DEFAULT_COMPOSER.count);   // 저장·복원하지 않는다(위 FoldedSettings 주석)
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<DraftRow[]>([]);
  const [attaching, setAttaching] = useState<string | null>(null);   // 붙이는 중인 시안의 id(리뷰 지적 6)

  // 클라이언트별 마지막 설정 복원 — 마운트 시 1회(기존 COMPOSER_KEY 관례와 같다). 저장값은 그대로 믿지 않는다
  // (리뷰 지적 4) — 깨졌거나 옛 모양이면 기본값으로 떨어뜨리고, format은 아는 값인지, procedureIds는 문자열
  // 배열인지 하나씩 확인한다. count는 이제 저장하지 않으니 검사할 것도, 복원할 것도 없다.
  useEffect(() => {
    if (!clientId) return;
    try {
      const s = localStorage.getItem(settingsKey(clientId));
      if (!s) return;
      const parsed: unknown = JSON.parse(s);
      if (!parsed || typeof parsed !== 'object') return;
      const p = parsed as Record<string, unknown>;
      const next: FoldedSettings = { ...DEFAULT_FOLDED };
      if (Array.isArray(p.procedureIds) && p.procedureIds.every((x) => typeof x === 'string')) next.procedureIds = p.procedureIds;
      if (p.format === 'single' || p.format === 'thread') next.format = p.format;
      if (typeof p.constraintsOn === 'boolean') next.constraintsOn = p.constraintsOn;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 저장값 복원(기존 코드베이스 관례, /generate 선례)
      setFolded(next);
    } catch { /* 무시 — 저장값이 깨졌어도 기본값으로 계속 쓴다 */ }
  }, [clientId]);

  // busy·attaching을 부모에 올려 보낸다(최종 리뷰 §3) — 시안을 만드는 동안과 붙이는 동안 둘 다 패널을
  // 잠근다. 언마운트(탭을 벗어남 등) 시에는 null로 되돌려 부모가 영영 막힌 채로 남지 않게 한다.
  useEffect(() => {
    if (busy) onBusyChange({ label: '만드는 중이에요' });
    else if (attaching) onBusyChange({ label: '붙이는 중이에요' });
    else onBusyChange(null);
  }, [busy, attaching, onBusyChange]);
  useEffect(() => () => onBusyChange(null), [onBusyChange]);
  // overlayOpen도 같은 방식으로 올려 보낸다(위 onOverlayChange 주석) — 언마운트 시 false로 정리.
  const overlayOpen = pickerOpen || linkOpen;
  useEffect(() => { onOverlayChange(overlayOpen); }, [overlayOpen, onOverlayChange]);
  useEffect(() => () => onOverlayChange(false), [onOverlayChange]);
  // 작성 중 여부 — 방향성에 글자가 있을 때만(위 onDirtyChange 주석, 브리프 §3). DraftWrite의 dirty
  // 관례와 같은 두 이펙트(값이 바뀔 때마다 올리고, 언마운트되면 false로 정리).
  const directionDirty = direction.trim() !== '';
  useEffect(() => { onDirtyChange(directionDirty); }, [directionDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const lastWsId = typeof window !== 'undefined' ? localStorage.getItem(LAST_WS_KEY) : null;

  function updateFolded(next: FoldedSettings) {
    setFolded(next);
    if (clientId) {
      try { localStorage.setItem(settingsKey(clientId), JSON.stringify(next)); } catch { /* 무시 */ }
    }
  }

  // 진입점 C(링크로 추가) 후처리 — 저장은 모달(/api/library/from-link)이 이미 끝냈고 여기선 '선택'만 한다.
  // /generate의 handleAddedByLink와 같은 패턴(단건 조회 API가 없어 전량에서 찾는다).
  async function handleAddedByLink(r: AddedByLink) {
    const saved = r.alreadyInLibrary ? '이미 보관함에 있어요' : '보관함에 추가했어요';
    // 대상 게시물(targetRef)도 레퍼런스 한 자리를 쓴다 — 중복으로 넣지 않는다. 여기서도 위 applyRefCap과
    // 같은 규칙이지만, fetch 전에 빠르게 걸러 불필요한 조회를 하지 않는다(최종 판정은 applyRefCap이 한다).
    if (targetRef?.tweetId === r.tweetId || refs.some((x) => x.tweetId === r.tweetId)) {
      show(`${saved} — 이미 레퍼런스로 선택돼 있어요`); return;
    }
    try {
      const res = await apiFetch('/api/references?scope=all');
      if (!res.ok) throw new Error(String(res.status));
      const rows: ReferenceRow[] = await res.json();
      const found = rows.find((x) => x.tweetId === r.tweetId);
      if (!found) { show(`${saved} — 목록을 갱신하지 못했어요. 보관함에서 골라주세요`); return; }
      // 고르기 시트(onApply)와 같은 함수로 상한을 지킨다(3c 리뷰 지적 6) — 대상 게시물도 한 자리로 센다.
      // 판정도 저장도 최신값(cur)에 대한 함수형 업데이터 안에서 한다(리뷰 지적 1) — fetch가 도는 동안
      // 사용자가 칩을 빼거나 시트를 적용했을 수 있어, await 이전 refs 클로저로 판정하면 토스트와 실제 저장이
      // 서로 다른 시점의 목록을 본다. flushSync로 감싸 이 setRefs가 커밋될 때까지 기다린 뒤에 토스트를
      // 말한다 — 업데이터 안에서 직접 show를 부르지 않는다(React가 업데이터를 두 번 부를 수 있어 그 안에서
      // 부르면 토스트가 두 번 뜰 수 있다). out은 업데이터가 몇 번 불려도 매번 같은 값으로 덮어써 안전하다.
      const out = { droppedByCap: 0 };
      flushSync(() => {
        setRefs((cur) => {
          const capped = applyRefCap([...cur, found], targetRef);
          out.droppedByCap = capped.droppedByCap;
          return capped.droppedByCap > 0 ? cur : capped.rows;
        });
      });
      show(out.droppedByCap > 0
        ? `${saved} — 레퍼런스가 대상 게시물 포함 ${MAX_REFS_UI}건이라 자동 선택은 안 했어요. 위 레퍼런스 목록에서 조정해주세요`
        : `${saved} — 레퍼런스로 선택했어요`);
    } catch {
      show(`${saved} — 목록을 갱신하지 못했어요. 보관함에서 골라주세요`);
    }
  }

  // 고르기 시트(RefPickerSheet)의 onApply — 시트가 돌려주는 선택 결과를 그대로 넣지 않는다(3c 리뷰 지적 6).
  // 시트는 targetRef를 모르므로 자기 안에서 8개까지 고르게 하지만, 대상 게시물이 있으면 실제 자리는 7이다.
  function applyPickedRefs(rows: ReferenceRow[]) {
    const { rows: next, droppedByCap } = applyRefCap(rows, targetRef);
    setRefs(next);
    if (droppedByCap > 0) {
      show(`레퍼런스가 대상 게시물 포함 ${MAX_REFS_UI}건이라 ${droppedByCap}건은 담지 못했어요. 목록에서 직접 조정해주세요`);
    }
  }

  const composerValue: ComposerState = {
    clientId, procedureIds: folded.procedureIds, format: folded.format, mode: 'both',
    constraintsOn: folded.constraintsOn, direction, count,
  };
  const refCount = refs.length + (targetRef ? 1 : 0);
  const ok = canGenerate(composerValue, refCount);
  const procedures = clientData?.procedures ?? [];
  // 세 상태를 구분한다(3c 리뷰 지적 2) — clientId가 없으면 금지 표현 0건이 확정이다. clientId는 있는데
  // clientData를 아직 못 읽었거나(undefined, 로딩 중) 실패했으면(null) '모름'이지 0건이 아니다 — 실제로는
  // 금지 표현이 있는 클라이언트일 수 있어, 없다고 말하면 사실이 아닌 말을 하는 것이다. 읽었으면
  // bannedPhraseCount 그대로.
  const bannedCount = clientId === null ? 0 : clientData ? bannedPhraseCount(clientData, folded.procedureIds) : null;
  // 로딩과 실패는 둘 다 '모름'으로 같이 잠기지만(위 bannedCount) 옆에 보이는 문구는 달라야 한다(리뷰 지적 4)
  // — 실패인데 "불러오는 중이에요"라고 계속 말하면(삭제된 클라이언트·네트워크 실패면 영원히) 거짓말이 된다.
  const clientLoadFailed = clientId !== null && clientData === null;

  async function run() {
    if (busy || !ok) return;
    setBusy(true);
    const r = await createDraftsApi({
      clientId, procedureIds: folded.procedureIds,
      refTweetIds: [...(targetRef ? [targetRef.tweetId] : []), ...refs.map((x) => x.tweetId)],
      mode: 'both', direction, format: folded.format, constraintsOn: folded.constraintsOn, count,
    });
    setBusy(false);
    if (!r.ok) { show(r.error); return; }
    setVariants(r.data);   // 미부착 원고들 — taskId를 보내지 않았다
    setCount(DEFAULT_COMPOSER.count);   // 시안 수는 1회용 — 다음 생성이 조용히 N배 비용이 되지 않게(/generate와 같은 규칙, 리뷰 지적 4)
    onGenerated();   // 고르지 않은 시안도 '있는 원고 고르기' 후보가 된다 — 부모가 다시 읽어야 그 수가 맞는다
  }

  async function attach(d: DraftRow) {
    if (attaching) return;
    setAttaching(d.id);
    const r = await patchDraftApi(d.id, { taskId: task.id });
    // 실패했을 때만 되돌린다(리뷰 지적 6) — 성공 경로에서 먼저 풀면 상세 재조회(onAttached → 부모의 load)가
    // 끝나기 전까지 다른 시안 버튼이 다시 눌려 409를 부른다. 재조회까지 성공하면 카드로 바뀌며 이 화면
    // 자체가 사라진다. 재조회가 실패하면(리뷰 지적 3) 잠금을 풀 유일한 길이 그 재조회뿐이라 — 붙이기 자체는
    // 서버에서 이미 끝났으니 "안 붙었다"고 말하지 않고, 붙었다는 사실과 새로고침 안내만 말한다.
    if (!r.ok) {
      setAttaching(null); show(r.error);   // 이미 붙었거나 취소된 작업이면 서버가 문구를 준다
      onAttachFailed(r.status);   // 409 복구(상세·후보 재조회)는 부모 한 곳(onAttachFailed)이 진다(최종 리뷰 §2)
      return;
    }
    // '있는 원고 고르기' 탭(FlowDetail.attachExistingDraft)과 같은 상황·같은 문구로 통일한다(최종 리뷰 §5
    // — 하는 일이 같으니 머리도 같아야 한다).
    if (!(await onAttached(r.data))) { setAttaching(null); show('붙였어요 — 화면을 새로고침해 주세요'); }
  }

  const procNames = procedures.filter((p) => folded.procedureIds.includes(p.id)).map((p) => p.name);
  const settingsSummary = [
    procNames.length ? `시술 ${procNames.join('·')}` : '시술 없음',
    folded.format === 'single' ? '단문' : '스레드',
    `시안 ${count}개`,
    // 금지 표현이 0건이면 켜도 프롬프트에 실리는 게 없다 — 적용되지 않는 보호를 적용됐다고 말하지 않는다.
    // 모르는 동안(bannedCount === null)에도 항목 자체를 뺀다 — 켰다고도 껐다고도 말하지 않는다(3c 리뷰 지적 2).
    bannedCount ? `제약 ${folded.constraintsOn ? '켬' : '끔'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      {clientData?.client.name && <p className="text-caption text-x-muted">{clientData.client.name} 정보를 반영해서 만들어요</p>}

      <div className="space-y-1">
        <p className="text-ui text-x-secondary">레퍼런스 <span className="text-x-muted">이 글들을 참고해서 써요</span></p>
        <div className="flex flex-wrap items-center gap-1.5">
          {targetRef && <span className="rounded-full bg-x-surface px-2.5 py-1 text-ui text-x-secondary">🔗 대상 · {targetRef.label}</span>}
          {refs.map((r) => (
            <span key={r.tweetId} className="inline-flex items-center gap-1 rounded-full bg-x-surface px-2.5 py-1 text-ui">
              {r.authorHandle ? `@${r.authorHandle}` : '레퍼런스'}
              <button type="button" onClick={() => setRefs((cur) => cur.filter((x) => x.tweetId !== r.tweetId))} aria-label="레퍼런스 빼기">✕</button>
            </span>
          ))}
          <Button variant="subtle" className="h-8 px-2.5" onClick={() => setPickerOpen(true)}>+ 보관함에서</Button>
          <Button variant="subtle" className="h-8 px-2.5" onClick={() => setLinkOpen(true)}>+ 링크</Button>
        </div>
        {targetRef && <p className="text-caption text-x-muted">인용RT의 대상 게시물은 자동으로 들어가요</p>}
      </div>

      <label className="block">
        <span className="text-ui text-x-secondary">방향성</span>
        <textarea value={direction} onChange={(e) => setDirection(e.target.value)} rows={3}
                  placeholder="예: 시술 후 3일차 실제 느낌, 담담한 톤, 가격 언급 없이"
                  className="mt-1 w-full resize-none rounded-md border border-x-border-strong px-3 py-2 text-content outline-none focus:border-x-blue" />
      </label>

      <details className="group border-t border-x-border pt-3">
        <summary className="cursor-pointer list-none text-ui text-x-secondary">
          {/* group-open: 열렸을 때 ▸를 90도 돌려 방향을 맞춘다(리뷰 지적 6 — 열어도 안 돌아가던 것) */}
          <span className="inline-block transition-transform group-open:rotate-90">▸</span> 설정 <span className="text-x-muted">{settingsSummary}</span>
        </summary>
        <div className="mt-3 space-y-3.5">
          {procedures.length > 0 && (
            <div>
              <p className="text-ui text-x-secondary">시술</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {procedures.map((p) => {
                  const on = folded.procedureIds.includes(p.id);
                  return (
                    <button key={p.id} type="button"
                            onClick={() => updateFolded({ ...folded, procedureIds: on ? folded.procedureIds.filter((x) => x !== p.id) : [...folded.procedureIds, p.id] })}
                            className={`inline-flex h-7 items-center rounded-full border px-3 text-ui ${on ? 'border-x-blue bg-x-blue/10 font-medium text-x-blue-text' : 'border-x-border-strong text-x-secondary hover:bg-x-hover'}`}>
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <p className="text-ui text-x-secondary">형식</p>
            <div className="mt-1.5 flex gap-1.5">
              {(['single', 'thread'] as const).map((f) => (
                <button key={f} type="button" onClick={() => updateFolded({ ...folded, format: f })}
                        className={`inline-flex h-8 flex-1 items-center justify-center rounded-lg border text-ui ${folded.format === f ? 'border-x-blue bg-x-blue font-bold text-white' : 'border-x-border-strong bg-white text-x-secondary hover:bg-x-hover'}`}>
                  {f === 'single' ? '단문' : '스레드'}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="text-ui text-x-secondary">시안 수</span>
            <span className="flex items-center gap-1.5">
              <input type="number" min={1} max={5} value={count}
                     onChange={(e) => setCount(Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 1))))}
                     className="h-9 w-14 rounded-lg border border-x-border-strong bg-white px-2 text-center text-ui outline-none focus:border-x-blue" />
              <span className="text-ui text-x-secondary">개</span>
            </span>
          </label>
          {/* 금지 표현이 0건이거나 아직 모르면 잠근다(DraftComposer.tsx:224와 같은 규칙) — 켜도 아무 일이
              없는데(또는 실제론 있는데 없다고 잘못 말하고) 켤 수 있게 두면 지켜지는 줄 알고 안심하게 된다.
              title만으로 끝내지 않고 보이는 이유를 붙인다(3c 리뷰 지적 2 — 불러오는 중에 '없다'고 말하던 것). */}
          <label className={`flex items-center gap-2 ${!bannedCount ? 'opacity-60' : ''}`}>
            <input type="checkbox" checked={folded.constraintsOn} disabled={!bannedCount}
                   onChange={(e) => updateFolded({ ...folded, constraintsOn: e.target.checked })} className="h-4 w-4 shrink-0" />
            <span className="text-ui text-x-text">의료광고 제약(금지 표현) 피하기</span>
          </label>
          {bannedCount === null && !clientLoadFailed && (
            <p className="-mt-2 text-caption text-x-muted">클라이언트 정보를 불러오는 중이에요</p>
          )}
          {clientLoadFailed && (
            <p className="-mt-2 text-caption text-x-muted">클라이언트 정보를 불러오지 못했어요 — 새로고침해 주세요</p>
          )}
          {bannedCount === 0 && (
            <p className="-mt-2 text-caption text-x-muted">등록된 금지 표현이 없어 지금은 켜도 달라지는 게 없어요</p>
          )}
        </div>
      </details>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" disabled={busy || !ok} onClick={() => void run()} className="h-10 px-4 text-content">
          {busy ? '만드는 중…' : `시안 ${count}개 만들기`}
        </Button>
        {/* DraftComposer.tsx(ComposerFooter)와 같은 문구 — 시안 수만큼 비용이 늘어난다는 걸 값으로도 말한다(리뷰 지적 3).
            소요 시간도 함께 — 만드는 중엔 Esc가 말없이 먹히므로 얼마나 걸리는지 알아야 한다. */}
        <span className="text-caption text-x-muted">{COST_CAPTION}{count > 1 ? ` × ${count}` : ''} · 15~30초</span>
      </div>
      {!ok && <p className="text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 만들 수 있어요</p>}
      {/* 표의 다른 행을 누르면 패널이 통째로 리마운트돼 막을 수 없다 — 그래서 미리 말한다(리뷰 지적 2).
          실제로 그렇게 동작한다: onGenerated가 클로저에서 불려 후보 목록이 갱신된다. */}
      {busy && <p className="text-caption text-x-muted">화면을 떠나도 만들어진 시안은 ‘있는 원고 고르기’에 남아요</p>}

      {variants.length > 0 && (
        <div className="space-y-2 border-t border-x-border pt-3">
          <p className="text-ui text-x-secondary">만들어진 시안 <span className="text-x-muted">하나를 골라 붙여요 · 다듬기는 붙인 뒤에</span></p>
          {variants.map((d, i) => {
            const line = candidateLine(d);
            return (
              <div key={d.id} className="rounded-lg border border-x-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-ui text-x-secondary">시안 {'ABCDE'[i] ?? i + 1}</p>
                  <Button variant={i === 0 ? 'primary' : 'subtle'} disabled={!!attaching} onClick={() => void attach(d)} className="h-8 shrink-0 px-2.5">
                    {attaching === d.id ? '붙이는 중…' : '이 시안 붙이기'}
                  </Button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-content">{(d.edited ?? d.content).posts.map((p) => p.text).join('\n\n')}</p>
                <p className="mt-1 text-caption text-x-muted">{line.meta}</p>
              </div>
            );
          })}
          <p className="text-caption text-x-muted">고르지 않은 시안은 ‘있는 원고 고르기’에 남아요</p>
        </div>
      )}

      <RefPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} lastWsId={lastWsId}
                      selectedIds={refs.map((r) => r.tweetId)} seedRows={refs} onApply={applyPickedRefs} />
      <AddByLinkModal open={linkOpen} onClose={() => setLinkOpen(false)} defaultWsId={lastWsId}
                      onAdded={(r) => { void handleAddedByLink(r); }} />
    </div>
  );
}
