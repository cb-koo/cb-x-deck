'use client';
import { useRef, useState, type ReactNode } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { checkPeriod, parseCampaignPatch, NAME_MAX, type CampaignPatchInput } from '@/lib/campaignInput';
import {
  campaignStatus, CAMPAIGN_STATUS_LABEL,
  formatDateKo, daysBetweenDates,
} from '@/lib/campaignJudgment';
import { Button } from '@/components/ui';
import { InfoTip } from '@/components/InfoTip';

// 상세 헤더 — 이름·기간·코드·메모를 그 자리에서 고친다(스펙 §3-3). 상태 pill은 기간에서 파생(수동 상태 없음, §10).
//
// QA 1라운드: 상시 폼 입력(테두리 있는 date·select·text) → 라벨-값 정의형 목록 + 클릭 편집(Atlassian Inline Edit).
// 읽는 화면인데 폼처럼 보였고, 편집 어포던스는 hover 배경 + 연필로 충분하다는 리서치 결론(§6-(1) 옵션 A).
// 메모는 '+ 메모' 한 줄에서 라벨 + 전용 패널로 승격했고, 길던 안내 문장은 기간 라벨 옆 ⓘ로 들어갔다.
//
// 저장은 부모(onPatch → PATCH /api/campaigns/[id])가 하고 boolean으로 결과를 준다 — 실패하면 입력을 남긴다(거짓 성공 방지).
// 검증은 서버 라우트와 같은 함수(parseCampaignPatch·checkPeriod) — 문구가 두 벌이 되지 않는다.
const STATUS_STYLE = {
  upcoming: 'bg-x-blue/10 text-x-blue-text', active: 'bg-green-100 text-green-800', ended: 'bg-x-border/60 text-x-secondary',
} as const;
// 편집 상태의 입력 — 읽기 상태에는 테두리가 없다(폼처럼 보이지 않게). 높이는 40px(h-10) 이상(가독성 기준).
const INPUT = 'h-10 rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';
// 편집 중인 항목 = 오류가 붙을 항목. 한 번에 하나만 연다 — 어느 칸 얘기인지 오류 줄이 가리켜야 한다.
type Field = 'name' | 'period' | 'code' | 'note';
const PERIOD_TIP = "기간을 줄여 예정일이 밖으로 나가도 막지 않고 '기간 밖'으로만 표시해요";

// 읽기 상태의 값 — 클릭이 곧 편집이라 hover 배경 + 연필로 '누를 수 있음'을 알린다(버튼이라 Tab·Enter로도 열린다).
function ReadValue({ onEdit, title, mono, children }: {
  onEdit: () => void; title: string; mono?: boolean; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onEdit} title={title}
            className={`group -mx-1 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded px-1 py-1 text-left text-content hover:bg-x-hover ${mono ? 'font-mono' : ''}`}>
      <span className="truncate">{children}</span>
      <span aria-hidden className="shrink-0 text-ui text-x-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">✎</span>
    </button>
  );
}

export function CampaignHeader({ campaign, draftCount, today, onPatch, onDelete, onAddDrafts }: {
  campaign: CampaignRow;
  draftCount: number;   // 지금 이 캠페인에 실린 원고 수(미사용 포함) — 삭제 안내가 말하는 '풀릴 원고'의 실제 수
  today: string;
  onPatch: (patch: CampaignPatchInput) => Promise<boolean>;
  onDelete: () => void; onAddDrafts: () => void;
}) {
  const [edit, setEdit] = useState<Field | null>(null);
  const [name, setName] = useState(campaign.name);
  const [code, setCode] = useState(campaign.nameEn);
  const [note, setNote] = useState(campaign.note);
  // 오류는 고치던 칸 바로 밑에 붙인다 — 이름 오류가 코드 줄 아래에 뜨면 어느 칸이 잘못됐는지 사용자가 되짚어야 한다
  const [err, setErr] = useState<{ field: Field; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Enter로 저장하면 곧이어 blur도 같은 저장을 부른다 — 잠금이 없으면 같은 PATCH가 두 번 나간다
  const saving = useRef(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const status = campaignStatus(campaign.startsOn, campaign.endsOn, today);
  const days = daysBetweenDates(campaign.startsOn, campaign.endsOn) + 1;   // 시작일·종료일 양끝 포함(하루짜리 = 1일)
  // 빈 칸을 상시 노출하면 채워야 할 것처럼 보이고 높이를 먹는다 — 값이 있을 때만 보인다(QA 2라운드 결정 A)
  // 방금 메뉴의 '메모 추가'로 편집을 열었을 때(edit==='note')도 보여야 텍스트영역이 뜬다 — 커밋 후 비어 있으면 다시 숨는다
  const showNote = campaign.note !== '' || edit === 'note';

  // 보내기 전 검증 — 서버 라우트와 같은 parseCampaignPatch를 그대로 쓴다(문구 한 벌).
  // 정규화된 값(코드의 공백→하이픈, 이름·메모 trim)을 돌려주므로 '바뀐 게 없다' 비교도 이 결과로 한다.
  function validate(patch: CampaignPatchInput, field: Field): CampaignPatchInput | null {
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
  function errLine(field: Field) {
    return err?.field === field ? <p role="alert" className="mt-1 text-ui text-red-600">{err.message}</p> : null;
  }
  // 편집 열기 — 열 때마다 입력값을 저장된 값으로 되돌린다(직전 편집에서 취소한 글자가 남지 않게)
  function open(field: Field) {
    setName(campaign.name); setCode(campaign.nameEn); setNote(campaign.note);
    setErr(null); setEdit(field);
  }
  function cancel() { setErr(null); setEdit(null); }
  // 포커스가 그 항목 밖(다른 칸·바깥)으로 나갈 때만 닫는다 — 기간의 두 입력을 오갈 때 닫히면 종료일을 못 고친다
  // 닫을 때 오류도 같이 지운다 — 안 그러면 되돌린(저장된) 값 밑에 방금 전 오류 줄이 남아 라벨-값이 안 맞는다
  function closeOnLeave(e: React.FocusEvent<HTMLElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setEdit(null); setErr(null); }
  }

  async function saveName() {
    // 이름은 필수라 지울 수 없다 — 빈 칸으로 빠져나가면 오류가 아니라 '취소'로 본다
    if (!name.trim()) { setName(campaign.name); cancel(); return; }
    const v = validate({ name }, 'name');
    if (!v) return;
    if (v.name === campaign.name) { setEdit(null); return; }
    if (await patchOnce(v)) setEdit(null);
  }
  async function saveCode() {
    const v = validate({ nameEn: code }, 'code');
    if (!v) return;
    if (v.nameEn === campaign.nameEn) { setEdit(null); return; }
    if (await patchOnce(v)) setEdit(null);
  }
  async function saveNote() {
    const v = validate({ note }, 'note');
    if (!v) return;
    if (v.note === campaign.note) { setEdit(null); return; }
    if (await patchOnce(v)) setEdit(null);
  }
  // 기간은 고른 즉시 저장한다 — 두 날짜를 이어서 고르는 일이 잦아 저장 후에도 칸을 열어 둔다.
  async function savePatch(patch: CampaignPatchInput, field: Field) {
    const v = validate(patch, field);
    if (!v) return;
    if (await patchOnce(v) && field !== 'period') setEdit(null);
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
            {edit === 'name' ? (
              <input autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)}
                     onBlur={() => void saveName()}
                     onKeyDown={(e) => {
                       if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveName();
                       if (e.key === 'Escape') { setName(campaign.name); cancel(); }
                     }}
                     aria-label="캠페인 이름" className={`${INPUT} h-11 min-w-[260px] text-[20px] font-bold`} />
            ) : (
              <button type="button" onClick={() => open('name')} title="눌러서 이름 바꾸기"
                      className="max-w-full truncate rounded-md px-1 text-left text-[20px] font-bold hover:bg-x-hover">{campaign.name}</button>
            )}
            <span className={`rounded-full px-2.5 py-0.5 text-ui font-bold ${STATUS_STYLE[status]}`}>{CAMPAIGN_STATUS_LABEL[status]}</span>
            <span className="text-ui text-x-secondary">{campaign.clientName ?? '클라이언트 없음'}</span>
          </div>
          {errLine('name')}

          {/* 라벨 위·값 아래 블록형(QA 3라운드 결정 A) — 글자만 한 줄이면 값 시작점을 눈이 못 찾는다 */}
          <div className="mt-3 flex flex-wrap items-center border-t border-x-border pt-2">
            <div className="flex min-h-[52px] flex-col justify-center gap-0.5 py-1 pl-0 pr-5">
              <span className="flex items-center gap-1 text-[13px] text-x-secondary">
                기간
                <InfoTip text={PERIOD_TIP} label="기간 설명 보기" />
              </span>
              {edit === 'period' ? (
                <span className="flex flex-wrap items-center gap-1.5" onBlur={closeOnLeave}
                      onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) cancel(); }}>
                  <input autoFocus type="date" value={campaign.startsOn} aria-label="시작일" className={INPUT}
                         onChange={(e) => { if (e.target.value) void savePatch({ startsOn: e.target.value }, 'period'); }} />
                  <span className="text-x-secondary">~</span>
                  <input type="date" value={campaign.endsOn} aria-label="종료일" className={INPUT}
                         onChange={(e) => { if (e.target.value) void savePatch({ endsOn: e.target.value }, 'period'); }} />
                </span>
              ) : (
                <ReadValue onEdit={() => open('period')} title="캠페인 기간 — 눌러서 바꾸기">
                  <span className="text-[16px] font-semibold">{formatDateKo(campaign.startsOn)} ~ {formatDateKo(campaign.endsOn)}</span>
                  <span className="ml-1.5 text-[13px] font-normal text-x-secondary">· {days}일</span>
                </ReadValue>
              )}
              {errLine('period')}
            </div>

            {/* 캠페인 유형은 아래 콘텐츠 표의 유형 열로 판단(koo 결정 08-26) — 시딩 등 성격은 캠페인명으로 표현 */}

            <span aria-hidden className="h-7 w-px shrink-0 self-center bg-x-border" />

            <div className="flex min-h-[52px] flex-col justify-center gap-0.5 py-1 pl-5">
              <span className="text-[13px] text-x-secondary">코드</span>
              {edit === 'code' ? (
                <input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }}
                       onBlur={() => void saveCode()}
                       onKeyDown={(e) => {
                         if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveCode();
                         if (e.key === 'Escape') { setCode(campaign.nameEn); cancel(); }
                       }}
                       aria-label="영문 코드" autoCapitalize="none" spellCheck={false} className={`${INPUT} w-[240px] font-mono`} />
              ) : (
                <span className="flex items-center gap-1.5">
                  <ReadValue mono onEdit={() => open('code')}
                             title="트래킹 링크의 캠페인명(utm_campaign) 기본값이에요 — 눌러서 바꾸기">
                    <span className="text-[15px] font-semibold tabular-nums">{campaign.nameEn}</span>
                  </ReadValue>
                  <button type="button" onClick={copyCode} aria-label={copied ? '복사됨' : '복사'}
                          title={copied ? '복사됨' : '영문 코드 복사'}
                          className="shrink-0 rounded-md px-1.5 py-1 text-ui text-x-muted hover:bg-x-hover hover:text-x-text">
                    {copied ? '✓' : '⧉'}
                  </button>
                </span>
              )}
              {errLine('code')}
            </div>
          </div>

          {/* 메모 — 값이 있을 때만 보인다. 빈 칸을 상시 노출하면 채워야 할 것처럼 보이고 높이를 먹는다(QA 2라운드 결정 A). 없으면 [···] 메뉴의 '메모 추가'로 연다 */}
          {showNote ? (
            <div className="mt-2">
              <p className="mb-1.5 text-ui font-bold text-x-secondary">메모</p>
              {edit === 'note' ? (
                <textarea autoFocus value={note} rows={3} onChange={(e) => setNote(e.target.value)}
                          onBlur={() => void saveNote()}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setNote(campaign.note); cancel(); } }}
                          aria-label="캠페인 메모" placeholder="메모를 적어 두세요"
                          className="w-full resize-y rounded-xl border border-x-border-strong bg-white px-4 py-3 text-content outline-none focus:border-x-blue" />
              ) : (
                <button type="button" onClick={() => open('note')} title="눌러서 메모 편집"
                        className="block w-full whitespace-pre-wrap rounded-xl bg-x-surface px-4 py-3 text-left text-content hover:bg-x-border/60">
                  {campaign.note}
                </button>
              )}
              {errLine('note')}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="primary" onClick={onAddDrafts} className="h-10 px-4 text-content">+ 원고 추가</Button>
          <details ref={menuRef} className="relative">
            <summary aria-label="캠페인 메뉴" className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-x-border-strong text-x-secondary hover:bg-x-hover">···</summary>
            <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-x-border-strong bg-white p-1 shadow-lg">
              {!showNote ? (
                <button type="button"
                        onClick={() => { if (menuRef.current) menuRef.current.open = false; open('note'); }}
                        className="block w-full rounded px-2.5 py-2 text-left text-ui text-x-text hover:bg-x-hover">메모 추가</button>
              ) : null}
              <button type="button" onClick={confirmDelete} className="block w-full rounded px-2.5 py-2 text-left text-ui text-red-700 hover:bg-red-50">캠페인 삭제</button>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
