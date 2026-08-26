'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { CampaignRow } from '@/lib/campaignStore';
import { createCampaignApi } from '@/lib/campaignApi';
import {
  checkPeriod, parseCampaignCreate, NAME_MAX,
  NAME_MESSAGE, CLIENT_MESSAGE, NAME_EN_EMPTY_MESSAGE, NAME_EN_FORMAT_MESSAGE,
} from '@/lib/campaignInput';
import {
  nextWeekRange, suggestCampaignName, suggestCampaignCode, CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind,
} from '@/lib/campaignJudgment';
import { checkCampaign } from '@/lib/trackingLink';
import { Button } from '@/components/ui';

// [+ 새 캠페인](스펙 §3-3) — 클라이언트(필수) → 기간(기본 다음 월~일) → 이름(자동 제안, 수정) → 영문 코드(자동 제안, 트래킹 링크 규칙) → 유형 → 메모.
// 제안값은 손대기 전까지만 따라간다(LinkCreateModal의 touched 관례) — 클라·시작일을 바꾸면 제안이 다시 계산되지만, 사람이 고친 값은 덮지 않는다.
// 검증은 서버와 같은 함수(checkCampaign·checkPeriod)로 즉시 피드백 — 문구가 두 벌이 되지 않는다.
// 입력은 40px(h-10) 이상(가독성 기준, CampaignHeader 관례) — text-caption(11px)은 쓰지 않는다.
const INPUT = 'mt-0.5 h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';
const LABEL = 'mt-3 block text-ui text-x-secondary';
const HELP = 'mt-1 text-ui text-x-muted';

export function CampaignCreateModal({ today, onClose, onCreated }: {
  today: string; onClose: () => void; onCreated: (row: CampaignRow) => void;
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientId, setClientId] = useState('');
  const initial = useMemo(() => nextWeekRange(today), [today]);
  // string으로 둔다(DateOnly 아님) — date input의 onChange가 순수 문자열을 준다. 서버로는 문자열 그대로 나간다(CampaignCreateInput.startsOn: string).
  const [startsOn, setStartsOn] = useState<string>(initial.startsOn);
  const [endsOn, setEndsOn] = useState<string>(initial.endsOn);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [kind, setKind] = useState<CampaignKind | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [clientsError, setClientsError] = useState(false);
  const [clientsLoaded, setClientsLoaded] = useState(false);

  // 클라이언트 명부 — 실패해도 모달은 뜬다(select가 비어 남지만, 실패·0건은 화면에 이유를 적는다: 리뷰 반영)
  // setState는 fetch 콜백(비동기) 안에서만 호출한다 — 이펙트 본문에서 동기로 부르면 렌더가 겹친다(react-hooks/set-state-in-effect).
  function loadClients() {
    apiFetch('/api/clients').then((r) => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then((rows: Array<{ client: ClientRow }>) => {
        setClients(Array.isArray(rows) ? rows.map((r) => r.client) : []);
        setClientsLoaded(true);
        setClientsError(false);
      })
      .catch(() => setClientsError(true));
  }
  useEffect(() => { loadClients(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const client = clients.find((c) => c.id === clientId) ?? null;
  const suggestedName = suggestCampaignName(client?.name ?? '', startsOn);   // '{클라} {M월 N주}'
  const suggestedCode = suggestCampaignCode(client?.nameEn ?? '', startsOn); // '{영문 소문자}-{YYYYMMDD}' / 영문 없으면 날짜만
  const nameValue = nameTouched ? name : suggestedName;
  const codeValue = codeTouched ? code : suggestedCode;
  // 빈 날짜는 checkPeriod가 못 잡는다(문자열 비교상 ''가 항상 작아 통과로 보임) — 여기서 먼저 가린다.
  const periodErr = !startsOn || !endsOn ? '기간을 입력해 주세요' : checkPeriod(startsOn, endsOn);
  const codeCheck = checkCampaign(codeValue);
  // campaignMessage는 "캠페인명…"이라 이름·영문 코드 두 칸이 있는 이 폼에서 어느 칸 얘기인지 안 가리킨다 —
  // 서버(parseNameEn)와 같은 전용 문구(NAME_EN_*)를 쓴다(리뷰 반영).
  const reason = !clientId ? CLIENT_MESSAGE
    : !nameValue.trim() ? NAME_MESSAGE
    : periodErr ? periodErr
    : !codeCheck.ok ? (codeCheck.reason === 'empty' ? NAME_EN_EMPTY_MESSAGE : NAME_EN_FORMAT_MESSAGE)
    : '';
  const canSubmit = reason === '' && !busy;

  async function submit() {
    if (!canSubmit || !codeCheck.ok) return;
    const body = {
      clientId, name: nameValue.trim(), nameEn: codeCheck.campaign, startsOn, endsOn, kind: kind || null, note: note.trim(),
    };
    // 클라이언트 쪽 판단이 서버(parseCampaignCreate)와 갈릴 수 있으니, 보내기 전 같은 함수로 마지막 관문을 한 번 더 통과시킨다.
    const parsed = parseCampaignCreate(body);
    if (!parsed.ok) { setErr(parsed.message); return; }
    setBusy(true); setErr('');
    const r = await createCampaignApi(body);
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated(r.data);   // 만들면 그 캠페인이 선택된 상세로(§3-3) — 페이지가 ?id=로 이동
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[520px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true" aria-label="새 캠페인" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-content font-bold">새 캠페인</h2>
          <button onClick={onClose} disabled={busy} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border disabled:opacity-40">✕</button>
        </div>
        <p className="mt-1 text-ui text-x-muted">클라이언트 한 곳 × 기간 하나예요. 원고는 만든 뒤 [+ 원고 추가]로 넣거나 콘텐츠 생성에서 바로 만들어요.</p>

        <label htmlFor="cc-client" className={LABEL}>클라이언트</label>
        <select id="cc-client" value={clientId} onChange={(e) => setClientId(e.target.value)} autoFocus className={INPUT}>
          <option value="">골라 주세요</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {clientsError ? (
          <p className="mt-1 text-ui text-red-600">
            클라이언트 목록을 불러오지 못했어요 —{' '}
            <button type="button" onClick={loadClients} className="underline">다시 시도</button>
          </p>
        ) : clientsLoaded && clients.length === 0 ? (
          <p className="mt-1 text-ui text-red-600">먼저 클라이언트를 등록해 주세요 (설정 › 클라이언트)</p>
        ) : (
          <p className={HELP}>고르면 이름과 영문 코드가 자동으로 제안돼요(직접 고친 값은 그대로 유지돼요)</p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-ui text-x-secondary">시작일
            {/* 비우는 것도 허용 — 이전 값으로 튕기면 지우려던 사용자가 못 지운다(리뷰 반영) */}
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className={INPUT} />
          </label>
          <label className="block text-ui text-x-secondary">종료일
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={INPUT} />
          </label>
        </div>
        <p className={periodErr ? 'mt-1 text-ui text-red-600' : HELP}>{periodErr ?? '기본은 다음 주 월~일이에요 — 주 단위 캠페인이 대부분이라서요. 더 길어도 돼요'}</p>

        <label htmlFor="cc-name" className={LABEL}>이름</label>
        <input id="cc-name" value={nameValue} maxLength={NAME_MAX}
               onChange={(e) => { setName(e.target.value); setNameTouched(true); }} className={INPUT} />
        <p className={HELP}>목록과 원고 카드에서 이 캠페인을 부를 이름이에요</p>

        <label htmlFor="cc-code" className={LABEL}>영문 코드</label>
        <input id="cc-code" value={codeValue} autoCapitalize="none" spellCheck={false}
               onChange={(e) => { setCode(e.target.value); setCodeTouched(true); }} className={`${INPUT} font-mono`} />
        {/* 이 폼은 항상 제안값이 있으니 비어 있다는 건 사용자가 지운 것 — 빈 값도 에러로 보여준다(리뷰 반영) */}
        <p className={!codeCheck.ok ? 'mt-1 text-ui text-red-600' : HELP}>
          {!codeCheck.ok
            ? (codeCheck.reason === 'empty' ? NAME_EN_EMPTY_MESSAGE : NAME_EN_FORMAT_MESSAGE)
            : '이 캠페인 원고로 트래킹 링크를 만들 때 캠페인명(utm_campaign)으로 들어가요 — 영어·숫자·하이픈'}
        </p>

        <label htmlFor="cc-kind" className={LABEL}>유형 <span className="text-x-muted">(선택)</span></label>
        <select id="cc-kind" value={kind} onChange={(e) => setKind(e.target.value as CampaignKind | '')} className={INPUT}>
          <option value="">없음</option>
          {CAMPAIGN_KINDS.map((k) => <option key={k} value={k}>{CAMPAIGN_KIND_LABEL[k]}</option>)}
        </select>
        <p className={HELP}>표시용이에요 — 방문 협찬이면 비용 제안이 방문 단가를 봐요</p>

        <label htmlFor="cc-note" className={LABEL}>메모 <span className="text-x-muted">(선택)</span></label>
        <textarea id="cc-note" value={note} rows={2} onChange={(e) => setNote(e.target.value)}
                  className="mt-0.5 w-full resize-y rounded-md border border-x-border-strong bg-white px-2.5 py-2 text-content outline-none focus:border-x-blue" />

        {err && <p role="alert" className="mt-2 text-ui text-red-600">{err}</p>}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} className="h-10 px-4 text-content">
            {busy ? '만드는 중…' : '캠페인 만들기'}
          </Button>
          <button onClick={onClose} disabled={busy} className="h-10 text-ui text-x-secondary disabled:opacity-40">취소</button>
        </div>
        {!canSubmit && !busy && reason && <p className="mt-1.5 text-ui text-x-muted">{reason}</p>}
      </div>
    </div>
  );
}
