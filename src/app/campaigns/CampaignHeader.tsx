'use client';
import { useRef, useState, type ReactNode } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import type { ClientRow } from '@/lib/clientStore';
import { checkPeriod, parseCampaignPatch, NAME_MAX, type CampaignPatchInput } from '@/lib/campaignInput';
import {
  campaignStatus, CAMPAIGN_STATUS_LABEL,
  formatDateKo, daysBetweenDates,
} from '@/lib/campaignJudgment';
import { apiFetch } from '@/lib/apiFetch';
import { InfoTip } from '@/components/InfoTip';

// 상세 헤더 — 이름·기간·코드·메모를 그 자리에서 고친다(스펙 §3-3). 상태 pill은 기간에서 파생(수동 상태 없음, §10).
//
// QA 1라운드: 상시 폼 입력(테두리 있는 date·select·text) → 라벨-값 정의형 목록 + 클릭 편집(Atlassian Inline Edit).
// 읽는 화면인데 폼처럼 보였고, 편집 어포던스는 hover 배경 + 연필로 충분하다는 리서치 결론(§6-(1) 옵션 A).
// 메모는 '+ 메모' 한 줄에서 라벨 + 전용 패널로 승격했고, 길던 안내 문장은 기간 라벨 옆 ⓘ로 들어갔다.
//
// 저장은 부모(onPatch → PATCH /api/campaigns/[id])가 하고 boolean으로 결과를 준다 — 실패하면 입력을 남긴다(거짓 성공 방지).
// 검증은 서버 라우트와 같은 함수(parseCampaignPatch·checkPeriod) — 문구가 두 벌이 되지 않는다.
// 진행 중 색은 상세 상단 시안(10-08) 값 그대로 — 예정·종료는 시안에 없어 기존 색 유지
const STATUS_STYLE = {
  upcoming: 'bg-x-blue/10 text-x-blue-text', active: 'bg-[#e6f6ee] text-[#15803d]', ended: 'bg-x-border/60 text-x-secondary',
} as const;
// 편집 상태의 입력 — 읽기 상태에는 테두리가 없다(폼처럼 보이지 않게). 높이는 40px(h-10) 이상(가독성 기준).
const INPUT = 'h-10 rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';
// 편집 중인 항목 = 오류가 붙을 항목. 한 번에 하나만 연다 — 어느 칸 얘기인지 오류 줄이 가리켜야 한다.
type Field = 'name' | 'period' | 'code' | 'note' | 'client';
const PERIOD_TIP = "기간을 줄여 예정일이 밖으로 나가도 막지 않고 '기간 밖'으로만 표시해요";
// 클라이언트를 바꾸면 예산·대상 후보(작업 만들 때 고르는 목록)가 새 클라이언트 기준으로 바로 다시 계산된다 —
// 조용히 넘어가면 안 되는 변화라 저장 직전 한 번 더 묻는다(koo 09-22: 잘못 고른 클라이언트를 바로잡는 용도).
const CLIENT_CHANGE_CONFIRM = '클라이언트를 바꾸면 예산·대상 후보가 새 클라이언트 기준으로 바뀌어요. 계속할까요?';

// 읽기 상태의 값 — 클릭이 곧 편집이라 hover 배경 + 연필로 '누를 수 있음'을 알린다(버튼이라 Tab·Enter로도 열린다).
// 연필은 값 오른쪽에 띄워(absolute) 항목 사이 간격을 밀지 않는다 — 접힌 머리(10-08 시안)의 한 줄 정보 줄을 지킨다.
function ReadValue({ onEdit, title, className, children }: {
  onEdit: () => void; title: string; className: string; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onEdit} title={title}
            className={`group relative inline-flex min-w-0 max-w-full items-center text-left ${className}`}>
      {children}
      <span aria-hidden className="pointer-events-none absolute left-full top-1/2 ml-0.5 -translate-y-1/2 text-[13px] text-x-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">✎</span>
    </button>
  );
}

// 시안의 선 아이콘(stroke 1.8) — 클라이언트(건물)·기간(달력)·코드(#)·메모(쪽지)
const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const IconClient = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...ICON} className="shrink-0 text-x-muted"><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 9h4a1 1 0 0 1 1 1v11" /><path d="M3 21h18M8 8h3M8 12h3M8 16h3" /></svg>
);
const IconCalendar = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...ICON} className="shrink-0 text-x-muted"><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
const IconHash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...ICON} className="shrink-0 text-x-muted"><path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" /></svg>
);
const IconNote = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" {...ICON} className="mt-[2px] shrink-0 text-x-muted"><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4" /></svg>
);

export function CampaignHeader({ campaign, deleteInfo, today, onPatch, onDelete }: {
  campaign: CampaignRow;
  // 삭제 시 실제로 지워질 작업 수·대상 미정이 되는 다른 캠페인 작업 수 — 삭제 확인 문구가 말하는 그 숫자들
  deleteInfo: { taskCount: number; detachedTargets: number; activeRequests: number };
  today: string;
  onPatch: (patch: CampaignPatchInput) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [edit, setEdit] = useState<Field | null>(null);
  const [name, setName] = useState(campaign.name);
  const [code, setCode] = useState(campaign.nameEn);
  const [note, setNote] = useState(campaign.note);
  // 클라이언트 목록 — 처음 편집을 열 때만 받아온다(상세 화면을 열 때마다 매번 부를 필요 없음)
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
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
    if (field === 'client' && !clientsLoaded) {
      apiFetch('/api/clients').then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
        .then((rows: Array<{ client: ClientRow }>) => {
          setClients(Array.isArray(rows) ? rows.map((r) => r.client) : []);
          setClientsLoaded(true);
        })
        .catch(() => {});
    }
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
  // 확인 다이얼로그를 거절하면 아무것도 보내지 않는다 — select는 campaign.clientId를 그대로 반영하므로
  // 다음 렌더에서 고르기 전 값으로 저절로 돌아간다(로컬 상태를 따로 되돌릴 필요 없음)
  async function saveClient(next: string) {
    if (!next || next === (campaign.clientId ?? '')) { setEdit(null); return; }
    if (!window.confirm(CLIENT_CHANGE_CONFIRM)) return;
    if (await patchOnce({ clientId: next })) setEdit(null);
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
    // 정산 보호(정산 스펙 §4-4) — 활성 요청이 붙은 작업이 있으면 삭제 확인 대신 알림만 보이고 끝낸다
    if (deleteInfo.activeRequests > 0) {
      window.alert(`정산 요청된 작업이 ${deleteInfo.activeRequests}건 있어요 — 먼저 정산에서 취소해 주세요`);
      return;
    }
    // 확인 다이얼로그 필수(§2-5) — 원고 무손실이라 실행취소는 없다(§3-3)
    if (window.confirm(
      `'${campaign.name}' 캠페인을 삭제할까요?\n\n작업 ${deleteInfo.taskCount}개가 함께 지워져요. 원고는 남아요 — 예정일·비용은 작업과 함께 사라져요.${deleteInfo.detachedTargets > 0 ? `\n다른 캠페인 작업 ${deleteInfo.detachedTargets}건의 대상이 '대상 미정'으로 바뀌어요.` : ''}\n실행 취소는 없어요.`)) onDelete();
  }

  // 접힌 머리(koo 10-08 시안 A): 1줄 이름·상태·메뉴 / 2줄 클라이언트·기간·코드 / 3줄 메모 전체(빈 메모면 줄 없음).
  // 라벨 블록(기간/코드 라벨 위·값 아래)을 아이콘으로 바꿔 높이를 줄였다 — 값마다 클릭 편집·검증·오류 줄은 그대로.
  return (
    <header className="flex flex-col gap-[4px]">
      <div className="flex min-h-[28px] items-center gap-[10px]">
        {edit === 'name' ? (
          <input autoFocus value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)}
                 onBlur={() => void saveName()}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveName();
                   if (e.key === 'Escape') { setName(campaign.name); cancel(); }
                 }}
                 aria-label="캠페인 이름" className={`${INPUT} h-11 min-w-0 flex-1 text-[20px] font-extrabold sm:max-w-[520px]`} />
        ) : (
          <button type="button" onClick={() => open('name')} title="눌러서 이름 바꾸기"
                  className="-mx-1 min-w-0 truncate rounded-md px-1 text-left text-[20px] font-extrabold leading-[28px] text-x-text hover:bg-x-hover">{campaign.name}</button>
        )}
        <span className={`shrink-0 whitespace-nowrap rounded-full px-[10px] py-[3px] text-[13px] font-bold leading-[18px] ${STATUS_STYLE[status]}`}>{CAMPAIGN_STATUS_LABEL[status]}</span>
        <span className="flex-1" />
        {/* 헤더 오른쪽은 메뉴(메모 추가·삭제)뿐 — '+ 작업 추가'는 표 바로 위 툴바에 있다(작업을 보면서 누르는 버튼) */}
        <details ref={menuRef} className="relative -mr-[6px] shrink-0">
          <summary aria-label="캠페인 메뉴" title="캠페인 메뉴"
                   className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-full text-x-secondary hover:bg-x-hover [&::-webkit-details-marker]:hidden">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M5 12h.01M12 12h.01M19 12h.01" /></svg>
          </summary>
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
      {errLine('name')}

      {/* 정보 줄 — 좁은 화면에선 감겨서 코드가 다음 줄로 간다(시안 Narrow) */}
      <div className="flex min-h-[20px] flex-wrap items-center gap-x-[18px] gap-y-[4px] whitespace-nowrap text-[14px] text-x-secondary">
        {edit === 'client' ? (
          <select autoFocus value={campaign.clientId ?? ''} onChange={(e) => void saveClient(e.target.value)}
                  onBlur={closeOnLeave}
                  onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) cancel(); }}
                  aria-label="클라이언트" className={`${INPUT} h-8 text-ui`}>
            <option value="" disabled>{clientsLoaded ? '클라이언트 선택' : '불러오는 중…'}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <ReadValue onEdit={() => open('client')} title="클라이언트 — 눌러서 바꾸기"
                     className="h-[24px] gap-[6px] rounded-full bg-x-surface pl-[7px] pr-[9px] text-[14px] font-semibold text-x-text hover:bg-x-border">
            <IconClient />
            <span className="truncate">{campaign.clientName ?? '클라이언트 없음'}</span>
          </ReadValue>
        )}

        {edit === 'period' ? (
          <span className="flex flex-wrap items-center gap-1.5" onBlur={closeOnLeave}
                onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) cancel(); }}>
            <IconCalendar />
            <input autoFocus type="date" value={campaign.startsOn} aria-label="시작일" className={INPUT}
                   onChange={(e) => { if (e.target.value) void savePatch({ startsOn: e.target.value }, 'period'); }} />
            <span className="text-x-secondary">~</span>
            <input type="date" value={campaign.endsOn} aria-label="종료일" className={INPUT}
                   onChange={(e) => { if (e.target.value) void savePatch({ endsOn: e.target.value }, 'period'); }} />
            <InfoTip text={PERIOD_TIP} label="기간 설명 보기" />
          </span>
        ) : (
          <ReadValue onEdit={() => open('period')} title={`캠페인 기간 — 눌러서 바꾸기\n${PERIOD_TIP}`}
                     className="-mx-1 gap-[6px] rounded px-1 hover:bg-x-hover">
            <IconCalendar />
            <span className="text-x-text">{formatDateKo(campaign.startsOn)} ~ {formatDateKo(campaign.endsOn)}</span>
            <span>· {days}일</span>
          </ReadValue>
        )}

        {/* 캠페인 유형은 아래 콘텐츠 표의 유형 열로 판단(koo 결정 08-26) — 시딩 등 성격은 캠페인명으로 표현 */}

        {edit === 'code' ? (
          <span className="inline-flex items-center gap-[6px]">
            <IconHash />
            <input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null); }}
                   onBlur={() => void saveCode()}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' && !e.nativeEvent.isComposing) void saveCode();
                     if (e.key === 'Escape') { setCode(campaign.nameEn); cancel(); }
                   }}
                   aria-label="영문 코드" autoCapitalize="none" spellCheck={false} className={`${INPUT} w-[240px] font-mono`} />
          </span>
        ) : (
          // 복사 버튼은 시안에 없어 평소엔 숨기고, 코드에 마우스를 올리거나 Tab으로 오면 보인다(줄 끝이라 자리를 밀지 않는다)
          <span className="group/code inline-flex min-w-0 items-center gap-1">
            <ReadValue onEdit={() => open('code')} title="영문 코드 — 트래킹 링크의 캠페인명(utm_campaign) 기본값이에요. 눌러서 바꾸기"
                       className="-mx-1 gap-[6px] rounded px-1 hover:bg-x-hover">
              <IconHash />
              <span className="truncate font-mono text-[13px] text-x-muted">{campaign.nameEn}</span>
            </ReadValue>
            <button type="button" onClick={copyCode} aria-label={copied ? '복사됨' : '영문 코드 복사'}
                    title={copied ? '복사됨' : '영문 코드 복사'}
                    className={`ml-4 shrink-0 rounded-md px-1.5 text-ui text-x-muted transition-opacity hover:bg-x-hover hover:text-x-text focus-visible:opacity-100 group-hover/code:opacity-100 ${copied ? 'opacity-100' : 'opacity-0'}`}>
              {copied ? '✓' : '⧉'}
            </button>
          </span>
        )}
      </div>
      {errLine('period')}
      {errLine('code')}

      {/* 메모 — 값이 있을 때만 보인다(전체, 줄바꿈 유지·자르지 않음). 빈 칸을 상시 노출하면 채워야 할 것처럼 보이고 높이를 먹는다(QA 2라운드 결정 A). 없으면 [⋯] 메뉴의 '메모 추가'로 연다 */}
      {showNote ? (
        <div>
          {edit === 'note' ? (
            <textarea autoFocus value={note} rows={3} onChange={(e) => setNote(e.target.value)}
                      onBlur={() => void saveNote()}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setNote(campaign.note); cancel(); } }}
                      aria-label="캠페인 메모" placeholder="메모를 적어 두세요"
                      className="mt-1 w-full resize-y rounded-xl border border-x-border-strong bg-white px-4 py-3 text-content outline-none focus:border-x-blue" />
          ) : (
            <button type="button" onClick={() => open('note')} title="메모 — 눌러서 편집"
                    className="-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-[6px] rounded px-1 text-left text-[14px] leading-[20px] text-x-secondary hover:bg-x-hover">
              <IconNote />
              <span className="min-w-0 whitespace-pre-line break-words">{campaign.note}</span>
            </button>
          )}
          {errLine('note')}
        </div>
      ) : null}
    </header>
  );
}
