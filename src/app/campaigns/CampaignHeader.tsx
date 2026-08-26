'use client';
import { useRef, useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { checkPeriod, parseCampaignPatch, NAME_MAX, type CampaignPatchInput } from '@/lib/campaignInput';
import { campaignStatus, CAMPAIGN_STATUS_LABEL, CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind } from '@/lib/campaignJudgment';
import { Button } from '@/components/ui';

// 상세 헤더 — 이름·기간·유형·코드·메모를 그 자리에서 고친다(스펙 §3-3). 상태 pill은 기간에서 파생(수동 상태 없음, §10).
// 저장은 부모(onPatch → PATCH /api/campaigns/[id])가 하고 boolean으로 결과를 준다 — 실패하면 입력을 남긴다(거짓 성공 방지).
// 검증은 서버 라우트와 같은 함수(parseCampaignPatch·checkPeriod) — 문구가 두 벌이 되지 않는다.
const STATUS_STYLE = {
  upcoming: 'bg-x-blue/10 text-x-blue-text', active: 'bg-green-100 text-green-800', ended: 'bg-x-border/60 text-x-secondary',
} as const;
// 입력은 40px(h-10) 이상 — 표 셀 안의 compact 컨트롤과 달리 헤더 입력은 행 높이가 받쳐주지 않는다(가독성 기준).
const INPUT = 'h-10 rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';
// 오류 줄이 붙을 자리 — meta는 기간·유형·코드가 한 줄에 같이 있어 셋이 자리를 공유한다
type ErrField = 'name' | 'meta' | 'note';

export function CampaignHeader({ campaign, draftCount, today, onPatch, onDelete, onAddDrafts }: {
  campaign: CampaignRow;
  draftCount: number;   // 지금 이 캠페인에 실린 원고 수(미사용 포함) — 삭제 안내가 말하는 '풀릴 원고'의 실제 수
  today: string;
  onPatch: (patch: CampaignPatchInput) => Promise<boolean>;
  onDelete: () => void; onAddDrafts: () => void;
}) {
  const [editName, setEditName] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [editCode, setEditCode] = useState(false);
  const [code, setCode] = useState(campaign.nameEn);
  const [editNote, setEditNote] = useState(false);
  const [note, setNote] = useState(campaign.note);
  // 오류는 고치던 칸 바로 밑에 붙인다 — 이름 오류가 코드 줄 아래에 뜨면 어느 칸이 잘못됐는지 사용자가 되짚어야 한다
  const [err, setErr] = useState<{ field: ErrField; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Enter로 저장하면 곧이어 blur도 같은 저장을 부른다 — 잠금이 없으면 같은 PATCH가 두 번 나간다
  const saving = useRef(false);
  const status = campaignStatus(campaign.startsOn, campaign.endsOn, today);

  // 보내기 전 검증 — 서버 라우트와 같은 parseCampaignPatch를 그대로 쓴다(문구 한 벌).
  // 정규화된 값(코드의 공백→하이픈, 이름·메모 trim)을 돌려주므로 '바뀐 게 없다' 비교도 이 결과로 한다.
  function validate(patch: CampaignPatchInput, field: ErrField): CampaignPatchInput | null {
    const parsed = parseCampaignPatch(patch);
    if (!parsed.ok) { setErr({ field, message: parsed.message }); return null; }
    // 기간은 한쪽만 고쳐도 저장된 반대쪽과 비교해야 한다 — parseCampaignPatch는 양쪽이 다 왔을 때만 순서를 본다
    const period = checkPeriod(parsed.value.startsOn ?? campaign.startsOn, parsed.value.endsOn ?? campaign.endsOn);
    if (period) { setErr({ field, message: period }); return null; }
    setErr(null);
    return parsed.value;
  }
  // 저장은 한 번에 하나 — 이미 보내는 중이면 false를 돌려 두 번째 호출(blur)은 아무것도 하지 않는다.
  // 실패와 같은 값이라 편집 상태가 열린 채 남고, 먼저 보낸 요청이 성공하면 그쪽이 닫는다.
  async function patchOnce(v: CampaignPatchInput): Promise<boolean> {
    if (saving.current) return false;
    saving.current = true;
    try { return await onPatch(v); } finally { saving.current = false; }
  }
  function errLine(field: ErrField) {
    return err?.field === field ? <p role="alert" className="mt-1 text-ui text-red-600">{err.message}</p> : null;
  }

  async function saveName() {
    // 이름은 필수라 지울 수 없다 — 빈 칸으로 빠져나가면 오류가 아니라 '취소'로 본다
    if (!name.trim()) { setName(campaign.name); setEditName(false); setErr(null); return; }
    const v = validate({ name }, 'name');
    if (!v) return;
    if (v.name === campaign.name) { setEditName(false); return; }
    if (await patchOnce(v)) setEditName(false);
  }
  async function saveCode() {
    const v = validate({ nameEn: code }, 'meta');
    if (!v) return;
    if (v.nameEn === campaign.nameEn) { setEditCode(false); return; }
    if (await patchOnce(v)) setEditCode(false);
  }
  async function saveNote() {
    const v = validate({ note }, 'note');
    if (!v) return;
    if (v.note === campaign.note) { setEditNote(false); return; }
    if (await patchOnce(v)) setEditNote(false);
  }
  async function savePatch(patch: CampaignPatchInput) {
    const v = validate(patch, 'meta');   // 보내기 전에 막되, 저장된 값은 그대로 보인다(입력은 controlled)
    if (v) await patchOnce(v);
  }
  function copyCode() {
    navigator.clipboard.writeText(campaign.nameEn)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }
  function confirmDelete() {
    // 확인 다이얼로그 필수(§2-5) — 원고 무손실이라 실행취소는 없다(§3-3)
    if (window.confirm(
      `'${campaign.name}' 캠페인을 삭제할까요?\n\n원고 ${draftCount}개는 남고 캠페인 소속만 풀립니다. 예정일·비용도 원고에 그대로 남아요.\n실행 취소는 없어요.`)) onDelete();
  }

  return (
    <header>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {editName ? (
              <input autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)}
                     onBlur={() => void saveName()}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveName();
                       if (e.key === 'Escape') { setName(campaign.name); setErr(null); setEditName(false); }
                     }}
                     aria-label="캠페인 이름" className={`${INPUT} h-11 min-w-[260px] text-[20px] font-bold`} />
            ) : (
              <button type="button" onClick={() => { setName(campaign.name); setErr(null); setEditName(true); }} title="눌러서 이름 바꾸기"
                      className="max-w-full truncate rounded-md px-1 text-left text-[20px] font-bold hover:bg-x-hover">{campaign.name}</button>
            )}
            <span className={`rounded-full px-2.5 py-0.5 text-ui font-bold ${STATUS_STYLE[status]}`}>{CAMPAIGN_STATUS_LABEL[status]}</span>
            <span className="text-ui text-x-secondary">{campaign.clientName ?? '클라이언트 없음'}</span>
          </div>
          {errLine('name')}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <label className="flex items-center gap-1 text-ui text-x-secondary">기간
              <input type="date" value={campaign.startsOn} aria-label="시작일" className={INPUT}
                     onChange={(e) => { if (e.target.value) void savePatch({ startsOn: e.target.value }); }} />
              <span>~</span>
              <input type="date" value={campaign.endsOn} aria-label="종료일" className={INPUT}
                     onChange={(e) => { if (e.target.value) void savePatch({ endsOn: e.target.value }); }} />
            </label>
            <label className="flex items-center gap-1 text-ui text-x-secondary">유형
              <select value={campaign.kind ?? ''} aria-label="캠페인 유형" className={INPUT}
                      onChange={(e) => void savePatch({ kind: (e.target.value || null) as CampaignKind | null })}>
                <option value="">없음</option>
                {CAMPAIGN_KINDS.map((k) => <option key={k} value={k}>{CAMPAIGN_KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <span className="flex items-center gap-1 text-ui text-x-secondary">코드
              {editCode ? (
                <input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }}
                       onBlur={() => void saveCode()}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveCode();
                         if (e.key === 'Escape') { setCode(campaign.nameEn); setErr(null); setEditCode(false); }
                       }}
                       aria-label="영문 코드" autoCapitalize="none" spellCheck={false} className={`${INPUT} w-[240px] font-mono`} />
              ) : (
                <button type="button" onClick={() => { setCode(campaign.nameEn); setErr(null); setEditCode(true); }}
                        title="트래킹 링크의 캠페인명(utm_campaign) 기본값이에요 — 눌러서 바꾸기"
                        className="rounded-md px-1 font-mono text-content text-x-text hover:bg-x-hover">{campaign.nameEn}</button>
              )}
              <button type="button" onClick={copyCode} className="rounded-full border border-x-border-strong px-2.5 py-1 text-ui hover:bg-x-hover">
                {copied ? '복사됨 ✓' : '복사'}
              </button>
            </span>
          </div>
          {errLine('meta')}

          {editNote ? (
            <textarea autoFocus value={note} rows={2} onChange={(e) => setNote(e.target.value)}
                      onBlur={() => void saveNote()}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setNote(campaign.note); setErr(null); setEditNote(false); } }}
                      aria-label="캠페인 메모" placeholder="이 캠페인에 대한 메모"
                      className="mt-2 w-full max-w-[640px] resize-y rounded-md border border-x-border-strong bg-white px-2.5 py-2 text-content outline-none focus:border-x-blue" />
          ) : (
            <button type="button" onClick={() => { setNote(campaign.note); setErr(null); setEditNote(true); }}
                    className={`mt-2 block max-w-[640px] whitespace-pre-wrap rounded-md px-1 text-left text-ui hover:bg-x-hover ${campaign.note ? 'text-x-secondary' : 'text-x-muted'}`}>
              {campaign.note || '+ 메모'}
            </button>
          )}
          {errLine('note')}
          <p className="mt-1 text-ui text-x-muted">여기서 고친 값은 바로 저장돼요. 기간을 줄여 예정일이 밖으로 나가도 막지 않고 &apos;기간 밖&apos;으로만 표시해요.</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" onClick={onAddDrafts} className="h-10 px-4 text-content">+ 원고 추가</Button>
          <details className="relative">
            <summary aria-label="캠페인 메뉴" className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-x-border-strong text-x-secondary hover:bg-x-hover">···</summary>
            <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
              <button type="button" onClick={confirmDelete} className="block w-full rounded px-2.5 py-2 text-left text-ui text-red-700 hover:bg-red-50">캠페인 삭제</button>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
