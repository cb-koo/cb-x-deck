'use client';
import { useEffect, useState } from 'react';
import { useToast } from '@/lib/toastContext';
import { apiFetch } from '@/lib/apiFetch';
import type { ProcedureRow } from '@/lib/clientStore';
import type { ReferenceRow } from '@/lib/referenceStore';
import type { DraftRow } from '@/lib/draftStore';
import type { FlowRow } from '@/lib/campaignFlowView';
import { createDraftsApi, patchDraftApi } from '@/lib/campaignApi';
import { canGenerate, COST_CAPTION, DEFAULT_COMPOSER, type ComposerState } from '@/components/DraftComposer';
import { candidateLine } from '@/lib/draftPickView';
import { RefPickerSheet } from '@/components/RefPickerSheet';
import { AddByLinkModal, type AddedByLink } from '@/components/AddByLinkModal';
import { LAST_WS_KEY } from '@/components/GlobalShell';
import { Button } from '@/components/ui';

// 원고 모드 · AI로 만들기(C 원고 모드 Task 3) — 패널 안에서 시안을 만들고 하나를 그 작업에 붙인다.
// 첫 화면은 매번 바뀌는 레퍼런스·방향성 둘뿐(브리프 §5-1). 시술·형식·시안 수·제약은 ▸ 설정으로 접고
// 클라이언트별 마지막 값을 localStorage에 기억한다(기존 /generate COMPOSER_KEY 관례).
//
// 참고 방식(form/angle/both)은 이 화면에 노출하지 않는다 — 브리프의 접힌 설정 목록(시술·형식·시안 수·제약)에
// 없고, "매번 바꾸는 둘만" 원칙과도 맞지 않아 항상 both로 고정한다(레퍼런스가 있으면 형식+앵글 모두 참고).
const settingsKey = (clientId: string) => `campaign-v2-draft-settings:${clientId}`;
type FoldedSettings = { procedureIds: string[]; format: ComposerState['format']; constraintsOn: boolean; count: number };
const DEFAULT_FOLDED: FoldedSettings = {
  procedureIds: DEFAULT_COMPOSER.procedureIds, format: DEFAULT_COMPOSER.format,
  constraintsOn: DEFAULT_COMPOSER.constraintsOn, count: DEFAULT_COMPOSER.count,
};

export function DraftGenerate({
  task, clientId, clientName, procedures, targetRef, onAttached, onGenerated, onBusyChange,
}: {
  task: FlowRow;
  clientId: string | null;
  clientName: string | null;
  procedures: ProcedureRow[];
  targetRef: { tweetId: string; label: string } | null;   // 인용RT의 대상 게시물(자동 포함)
  onAttached: (d: DraftRow) => void;   // 시안을 붙였다 — 부모가 상세를 다시 읽고 카드로 전환한다
  // 브리프의 계약엔 없지만(§ Interfaces), 생성 뒤 '있는 원고 고르기' 후보 수를 갱신하려면 부모(FlowDetail)의
  // reloadCandidates를 불러야 한다 — 고르지 않은 시안도 미부착 원고로 남기 때문(§Step3 주석).
  onGenerated: () => void;
  // 생성 중엔 패널의 Esc·바깥 클릭 닫기를 부모(TaskPanel)가 끄게 한다(원고 모드 §Step3 "만드는 동안
  // 패널에 머무른다") — 이 컴포넌트의 로컬 busy는 TaskPanel이 못 보므로 콜백으로 올려 보낸다.
  onBusyChange: (busy: boolean) => void;
}) {
  const { show } = useToast();
  const [refs, setRefs] = useState<ReferenceRow[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [direction, setDirection] = useState('');
  const [folded, setFolded] = useState<FoldedSettings>(DEFAULT_FOLDED);
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<DraftRow[]>([]);
  const [attaching, setAttaching] = useState(false);

  // 클라이언트별 마지막 설정 복원 — 마운트 시 1회(기존 COMPOSER_KEY 관례와 같다)
  useEffect(() => {
    if (!clientId) return;
    try {
      const s = localStorage.getItem(settingsKey(clientId));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 시 1회 저장값 복원(기존 코드베이스 관례, /generate 선례)
      if (s) setFolded((cur) => ({ ...cur, ...JSON.parse(s) }));
    } catch { /* 무시 — 저장값이 깨졌어도 기본값으로 계속 쓴다 */ }
  }, [clientId]);

  // busy를 부모에 올려 보낸다 — 언마운트(탭을 벗어남 등) 시에는 false로 되돌려 부모가 영영 막힌 채로 남지 않게 한다.
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

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
    if (refs.some((x) => x.tweetId === r.tweetId)) { show(`${saved} — 이미 레퍼런스로 선택돼 있어요`); return; }
    try {
      const res = await apiFetch('/api/references?scope=all');
      if (!res.ok) throw new Error(String(res.status));
      const rows: ReferenceRow[] = await res.json();
      const found = rows.find((x) => x.tweetId === r.tweetId);
      if (!found) { show(`${saved} — 목록을 갱신하지 못했어요. 보관함에서 골라주세요`); return; }
      setRefs((cur) => (cur.some((x) => x.tweetId === r.tweetId) ? cur : [...cur, found]));
      show(`${saved} — 레퍼런스로 선택했어요`);
    } catch {
      show(`${saved} — 목록을 갱신하지 못했어요. 보관함에서 골라주세요`);
    }
  }

  const composerValue: ComposerState = {
    clientId, procedureIds: folded.procedureIds, format: folded.format, mode: 'both',
    constraintsOn: folded.constraintsOn, direction, count: folded.count,
  };
  const refCount = refs.length + (targetRef ? 1 : 0);
  const ok = canGenerate(composerValue, refCount);

  async function run() {
    if (busy || !ok) return;
    setBusy(true);
    const r = await createDraftsApi({
      clientId, procedureIds: folded.procedureIds,
      refTweetIds: [...(targetRef ? [targetRef.tweetId] : []), ...refs.map((x) => x.tweetId)],
      mode: 'both', direction, format: folded.format, constraintsOn: folded.constraintsOn, count: folded.count,
    });
    setBusy(false);
    if (!r.ok) { show(r.error); return; }
    setVariants(r.data);   // 미부착 원고들 — taskId를 보내지 않았다
    onGenerated();   // 고르지 않은 시안도 '있는 원고 고르기' 후보가 된다 — 부모가 다시 읽어야 그 수가 맞는다
  }

  async function attach(d: DraftRow) {
    if (attaching) return;
    setAttaching(true);
    const r = await patchDraftApi(d.id, { taskId: task.id });
    setAttaching(false);
    if (!r.ok) { show(r.error); return; }   // 이미 붙었거나 취소된 작업이면 서버가 문구를 준다
    onAttached(r.data);
  }

  const procNames = procedures.filter((p) => folded.procedureIds.includes(p.id)).map((p) => p.name);
  const settingsSummary = [
    procNames.length ? `시술 ${procNames.join('·')}` : '시술 없음',
    folded.format === 'single' ? '단문' : '스레드',
    `시안 ${folded.count}개`,
    `제약 ${folded.constraintsOn ? '켬' : '끔'}`,
  ].join(' · ');

  return (
    <div className="space-y-4">
      {clientName && <p className="text-caption text-x-muted">{clientName} 정보를 반영해서 만들어요</p>}

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

      <details className="border-t border-x-border pt-3">
        <summary className="cursor-pointer list-none text-ui text-x-secondary">
          ▸ 설정 <span className="text-x-muted">{settingsSummary}</span>
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
              <input type="number" min={1} max={5} value={folded.count}
                     onChange={(e) => updateFolded({ ...folded, count: Math.min(5, Math.max(1, Math.trunc(Number(e.target.value) || 1))) })}
                     className="h-9 w-14 rounded-lg border border-x-border-strong bg-white px-2 text-center text-ui outline-none focus:border-x-blue" />
              <span className="text-ui text-x-secondary">개</span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={folded.constraintsOn} onChange={(e) => updateFolded({ ...folded, constraintsOn: e.target.checked })} className="h-4 w-4 shrink-0" />
            <span className="text-ui text-x-text">의료광고 제약(금지 표현) 피하기</span>
          </label>
        </div>
      </details>

      <div className="flex items-center gap-2 pt-1">
        <Button variant="primary" disabled={busy || !ok} onClick={() => void run()} className="h-10 px-4 text-content">
          {busy ? '만드는 중…' : `시안 ${folded.count}개 만들기`}
        </Button>
        <span className="text-caption text-x-muted">{COST_CAPTION}</span>
      </div>
      {!ok && <p className="text-caption text-x-muted">클라이언트·레퍼런스·방향성 중 하나는 있어야 만들 수 있어요</p>}

      {variants.length > 0 && (
        <div className="space-y-2 border-t border-x-border pt-3">
          <p className="text-ui text-x-secondary">만들어진 시안 <span className="text-x-muted">하나를 골라 붙여요 · 다듬기는 붙인 뒤에</span></p>
          {variants.map((d, i) => {
            const line = candidateLine(d);
            return (
              <div key={d.id} className="rounded-lg border border-x-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-ui text-x-secondary">시안 {'ABCDE'[i] ?? i + 1}</p>
                  <Button variant={i === 0 ? 'primary' : 'subtle'} disabled={attaching} onClick={() => void attach(d)} className="h-8 shrink-0 px-2.5">이 시안 붙이기</Button>
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
                      selectedIds={refs.map((r) => r.tweetId)} seedRows={refs} onApply={setRefs} />
      <AddByLinkModal open={linkOpen} onClose={() => setLinkOpen(false)} defaultWsId={lastWsId}
                      onAdded={(r) => { void handleAddedByLink(r); }} />
    </div>
  );
}
