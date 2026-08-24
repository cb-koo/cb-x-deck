'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/apiFetch';
import { Button } from '@/components/ui';
import { InfluencerField } from '@/components/InfluencerField';
import type { InfluencerOption } from '@/lib/draftTypes';
import type { ClientRow } from '@/lib/clientStore';
import type { InfluencerRow } from '@/lib/influencerStore';
import type { TrackingLinkRow } from '@/lib/linkStore';
import { checkLandingUrl, landingUrlMessage, buildTrackedUrl, suggestCampaign, checkCampaign, campaignMessage, suggestSlug, checkSlug, slugMessage } from '@/lib/trackingLink';
import { parseXHandle, handleParseMessage } from '@/lib/xHandle';

// 트래킹 링크 생성 모달 — 원고 카드(자동 채움)와 트래킹 페이지(직접 입력) 양쪽이 공유한다(스펙 §화면).
export function LinkCreateModal({ open, onClose, onCreated, configured, prefill }: {
  open: boolean; onClose: () => void; onCreated: (row: TrackingLinkRow) => void;
  configured: boolean;
  prefill?: { draftId?: string; influencerHandle?: string; clientId?: string; clientName?: string };
}) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [influencers, setInfluencers] = useState<InfluencerOption[]>([]);
  const [clientId, setClientId] = useState(prefill?.clientId ?? '');
  const [landingUrl, setLandingUrl] = useState('');
  const [landingTouched, setLandingTouched] = useState(false);
  const [handle, setHandle] = useState(prefill?.influencerHandle ?? '');
  const [campaign, setCampaign] = useState(suggestCampaign(prefill?.clientName ?? null));
  const [campaignTouched, setCampaignTouched] = useState(false);
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<TrackingLinkRow | null>(null); // 성공 화면
  const [copied, setCopied] = useState(false);
  // 클라 목록 로드(비동기)가 끝난 시점의 touched 여부를 봐야 하는데, 그 로드 이펙트의 의존성에
  // touched를 넣으면 타이핑할 때마다 다시 조회하게 된다 — ref로 최신값만 곁눈질한다.
  const landingTouchedRef = useRef(landingTouched);
  const campaignTouchedRef = useRef(campaignTouched);
  useEffect(() => { landingTouchedRef.current = landingTouched; }, [landingTouched]);
  useEffect(() => { campaignTouchedRef.current = campaignTouched; }, [campaignTouched]);

  // 열 때마다 초기화(모달 재사용, ColumnSettings 관례) — prefill은 그 시점 값을 스냅샷한다.
  // prefill을 통째로 의존하면 호출부가 인라인 객체(`prefill={{...}}`)를 넘길 때마다 새 참조가 되어
  // 모달이 열린 채로 재발화되고, 입력 중인 값이 기본값으로 되돌아간다 — 프리미티브만 의존한다
  // (clients-load effect의 `prefill?.clientId` 단독 의존 관례를 따름).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때마다 초기화(모달 재사용, ColumnSettings 관례)
  useEffect(() => { if (!open) return; setClientId(prefill?.clientId ?? ''); setLandingUrl(''); setLandingTouched(false); setHandle(prefill?.influencerHandle ?? ''); setCampaign(suggestCampaign(prefill?.clientName ?? null)); setCampaignTouched(false); setSlug(''); setSlugTouched(false); setBusy(false); setErr(''); setDone(null); setCopied(false); }, [open, prefill?.clientId, prefill?.influencerHandle, prefill?.clientName, prefill?.draftId]);

  // 클라이언트·인플루언서 목록 — 자동 채움·자동완성 소스일 뿐, 실패해도 모달은 그대로 동작한다.
  useEffect(() => {
    if (!open) return;
    apiFetch('/api/clients')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: Array<{ client: ClientRow }>) => {
        const list = rows.map((r) => r.client);
        setClients(list);
        // prefill.clientId는 목록이 로드된 뒤에야 그 클라의 landingUrl을 알 수 있다 — 같은 채움 규칙 적용.
        if (prefill?.clientId) {
          const c = list.find((x) => x.id === prefill.clientId);
          if (c) {
            if (!landingTouchedRef.current) setLandingUrl(c.landingUrl);
            if (!campaignTouchedRef.current) setCampaign(suggestCampaign(c.nameEn || c.name));
          }
        }
      })
      .catch(() => setClients([]));
    apiFetch('/api/influencers')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: InfluencerRow[]) => setInfluencers(rows.map((r) => ({ handle: r.handle, name: r.displayName ?? undefined }))))
      .catch(() => setInfluencers([]));
  }, [open, prefill?.clientId]);

  useEffect(() => {
    if (!open) return;
    // 생성 요청이 진행 중일 때 닫히면 성공 화면을 못 보고, 링크는 이미 만들어져 몰래 생긴 것처럼 보인다 — busy면 무시.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); }; // IME 조합 중 Esc 무시
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  const landing = checkLandingUrl(landingUrl);
  // 미리보기·제출 판단 모두 서버와 같은 정규화(parseXHandle)를 거친 값을 쓴다 — 프로필 링크를 붙여넣었을 때
  // 미리보기가 원시 입력(도메인이 섞인 문자열)을 그대로 보여주면 실제 생성값과 어긋난다(UX 원칙 4).
  const handleParse = parseXHandle(handle);
  const campaignCheck = checkCampaign(campaign); // 서버와 같은 검사·정규화(공백→하이픈) — 영문 규칙(koo QA 08-24)
  // 링크 주소 = 사람이 읽는 조합 {캠페인}-{핸들}, 랜덤 없음(koo QA 08-25). 손대기 전엔 입력을 따라간다.
  const effectiveSlug = slugTouched
    ? slug
    : suggestSlug(campaignCheck.ok ? campaignCheck.campaign : campaign, handleParse.ok ? handleParse.handle : '');
  const slugCheck = checkSlug(effectiveSlug);
  const canSubmit = configured && landing.ok && handleParse.ok && campaignCheck.ok && slugCheck.ok && !busy;
  // 랜딩 URL 문제는 위 인라인 오류(또는 안내문)가 이미 있으니 중복 표시하지 않는다 — 그 다음 미충족 사유만.
  const disabledReason = !landing.ok
    ? ''
    : handle.trim() === ''
    ? '게시할 인플루언서를 입력해 주세요'
    : !handleParse.ok
    ? handleParseMessage(handleParse.reason) // 사유별 문구 — 클라이언트 표면 관례(InfluencerChip 등)와 통일
    : !campaignCheck.ok
    ? campaignMessage(campaignCheck.reason)
    : !slugCheck.ok
    ? slugMessage(slugCheck.reason)
    : '';
  const preview = landing.ok && handleParse.ok && campaignCheck.ok && slugCheck.ok
    ? buildTrackedUrl({ landingUrl: landing.url, campaign: campaignCheck.campaign, content: slugCheck.slug })
    : null;

  const submit = useCallback(async () => {
    if (!canSubmit || !landing.ok || !handleParse.ok || !campaignCheck.ok || !slugCheck.ok) return;
    setBusy(true); setErr('');
    try {
      const r = await apiFetch('/api/links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landingUrl: landing.url, influencerHandle: handleParse.handle, utmCampaign: campaignCheck.campaign,
          slug: slugCheck.slug, draftId: prefill?.draftId, clientId: clientId || undefined,
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { row?: TrackingLinkRow; error?: string };
      if (!r.ok || !data.row) { setErr(data.error ?? '링크를 만들지 못했어요 — 잠시 후 다시 시도해 주세요'); return; }
      setDone(data.row);
      onCreated(data.row);
    } catch {
      setErr('링크를 만들지 못했어요 — 네트워크를 확인하고 다시 시도해 주세요');
    } finally { setBusy(false); }
  }, [canSubmit, landing, handleParse, campaignCheck, slugCheck, clientId, prefill, onCreated]);

  const copy = useCallback(() => {
    if (!done) return;
    navigator.clipboard.writeText(done.shortUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [done]);

  const onClientChange = useCallback((id: string) => {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!landingTouched) setLandingUrl(c ? c.landingUrl : '');
    if (!campaignTouched) setCampaign(suggestCampaign(c ? (c.nameEn || c.name) : null));
  }, [clients, landingTouched, campaignTouched]);

  if (!open) return null;

  const showLandingErr = landingUrl.trim().length > 0 && !landing.ok;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => { if (!busy) onClose(); }}>
      <div className="w-full max-w-[480px] rounded-2xl bg-white p-4" role="dialog" aria-modal="true"
           aria-label="트래킹 링크 만들기" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center">
          <h2 className="text-[15px] font-bold">트래킹 링크 만들기</h2>
          <button onClick={onClose} disabled={busy} aria-label="닫기" className="ml-auto rounded px-1.5 text-x-secondary hover:bg-x-border disabled:opacity-40">✕</button>
        </div>

        {done ? (
          <div className="mt-3">
            <p className="text-caption text-x-muted">단축 링크가 만들어졌어요</p>
            <code className="mt-1 block break-all rounded-md border border-x-border-strong bg-x-hover px-2 py-1.5 text-[15px] font-bold">
              {done.shortUrl}
            </code>
            <div className="mt-2 flex items-center gap-3">
              <Button variant="subtle" onClick={copy}>{copied ? '복사됨 ✓' : '복사'}</Button>
            </div>
            <p className="mt-3 text-caption text-x-muted">
              인플루언서에게 이 링크를 전달해 게시할 때 함께 올려달라고 요청하세요.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" onClick={onClose}>닫기</Button>
            </div>
          </div>
        ) : configured === false ? (
          <div className="mt-3">
            <p className="text-caption text-red-600">
              short.io 연결이 아직 설정되지 않았어요 — 관리자에게 요청해 주세요
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button variant="subtle" onClick={onClose}>닫기</Button>
            </div>
          </div>
        ) : (
          <>
            <label htmlFor="link-create-client" className="mt-3 block text-caption text-x-muted">클라이언트</label>
            <select id="link-create-client" value={clientId} onChange={(e) => onClientChange(e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue">
              <option value="">(없음)</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <p className="mt-1 text-caption text-x-muted">고르면 랜딩 주소·캠페인명이 자동으로 채워져요(직접 고친 값은 그대로 유지돼요)</p>

            <label htmlFor="link-create-landing" className="mt-3 block text-caption text-x-muted">랜딩 페이지 주소</label>
            <input id="link-create-landing" type="url" value={landingUrl}
                   onChange={(e) => { setLandingUrl(e.target.value); setLandingTouched(true); }}
                   placeholder="https://example.com/이벤트"
                   className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
            {showLandingErr && !landing.ok
              ? <p className="mt-1 text-caption text-red-600">{landingUrlMessage(landing.reason)}</p>
              : <p className="mt-1 text-caption text-x-muted">인플루언서가 클릭했을 때 도착할 실제 주소예요</p>}

            <div className="mt-3">
              <InfluencerField value={handle} options={influencers} onChange={setHandle} error={null} />
            </div>

            <label htmlFor="link-create-campaign" className="mt-3 block text-caption text-x-muted">캠페인명</label>
            <input id="link-create-campaign" value={campaign}
                   onChange={(e) => { setCampaign(e.target.value); setCampaignTouched(true); }}
                   className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
            <p className="mt-1 text-caption text-x-muted">랜딩 쪽 분석 도구에서 이 캠페인 이름으로 모아 볼 수 있어요 — 영어·숫자로 적어 주세요</p>

            <label htmlFor="link-create-slug" className="mt-3 block text-caption text-x-muted">링크 주소</label>
            <input id="link-create-slug" value={effectiveSlug}
                   onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                   autoComplete="off" autoCapitalize="none" spellCheck={false}
                   className="mt-0.5 w-full rounded-md border border-x-border-strong bg-white px-2 py-1.5 text-ui outline-none focus:border-x-blue" />
            <p className="mt-1 text-caption text-x-muted">단축 도메인 뒤에 붙어요 — 캠페인·인플루언서 이름으로 자동으로 지어져요. 이미 쓰인 주소면 뒤에 -2가 붙어요</p>

            {preview && (
              <div className="mt-3">
                <p className="text-caption text-x-muted">이렇게 만들어져요</p>
                <code className="mt-0.5 block break-all rounded-md border border-x-border-strong bg-x-hover px-2 py-1.5 text-caption">
                  {preview}
                </code>
                <p className="mt-1 text-caption text-x-muted">xxxxxx 자리는 만들 때 정해지는 6자리 코드예요</p>
              </div>
            )}

            {err && <p className="mt-2 text-caption text-red-600">{err}</p>}

            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit}>
                {busy ? '만드는 중…' : '짧은 링크 만들기'}
              </Button>
              <button onClick={onClose} disabled={busy} className="text-ui text-x-secondary disabled:opacity-40">취소</button>
            </div>
            {!canSubmit && !busy && disabledReason && (
              <p className="mt-1.5 text-caption text-x-muted">{disabledReason}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
