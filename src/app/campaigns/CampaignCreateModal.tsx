'use client';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import type { ClientRow } from '@/lib/clientStore';
import type { CampaignRow } from '@/lib/campaignStore';
import { createCampaignApi } from '@/lib/campaignApi';
import { checkPeriod, NAME_MAX } from '@/lib/campaignInput';
import {
  nextWeekRange, suggestCampaignName, suggestCampaignCode, CAMPAIGN_KINDS, CAMPAIGN_KIND_LABEL, type CampaignKind,
} from '@/lib/campaignJudgment';
import { checkCampaign, campaignMessage } from '@/lib/trackingLink';
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

  // 클라이언트 명부 — 실패해도 모달은 뜬다(select가 비어 '골라 주세요'가 남는다)
  useEffect(() => {
    apiFetch('/api/clients').then((r) => (r.ok ? r.json() : [])).catch(() => [])
      .then((rows: Array<{ client: ClientRow }>) => setClients(Array.isArray(rows) ? rows.map((r) => r.client) : []));
  }, []);
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
  const periodErr = checkPeriod(startsOn, endsOn);
  const codeCheck = checkCampaign(codeValue);
  const reason = !clientId ? '클라이언트를 골라 주세요'
    : !nameValue.trim() ? '캠페인 이름을 입력해 주세요'
    : periodErr ? periodErr
    : !codeCheck.ok ? campaignMessage(codeCheck.reason)
    : '';
  const canSubmit = reason === '' && !busy;

  async function submit() {
    if (!canSubmit || !codeCheck.ok) return;
    setBusy(true); setErr('');
    const r = await createCampaignApi({
      clientId, name: nameValue.trim(), nameEn: codeCheck.campaign, startsOn, endsOn, kind: kind || null, note: note.trim(),
    });
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
        <p className={HELP}>고르면 이름과 영문 코드가 자동으로 제안돼요(직접 고친 값은 그대로 유지돼요)</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block text-ui text-x-secondary">시작일
            <input type="date" value={startsOn} onChange={(e) => { if (e.target.value) setStartsOn(e.target.value); }} className={INPUT} />
          </label>
          <label className="block text-ui text-x-secondary">종료일
            <input type="date" value={endsOn} onChange={(e) => { if (e.target.value) setEndsOn(e.target.value); }} className={INPUT} />
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
        <p className={codeValue.trim() && !codeCheck.ok ? 'mt-1 text-ui text-red-600' : HELP}>
          {codeValue.trim() && !codeCheck.ok ? campaignMessage(codeCheck.reason) : '이 캠페인 원고로 트래킹 링크를 만들 때 캠페인명(utm_campaign)으로 들어가요 — 영어·숫자·하이픈'}
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
