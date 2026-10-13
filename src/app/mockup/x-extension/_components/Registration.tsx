'use client';
import { useState } from 'react';
import type { DemoData, DemoTask } from '../model';
import { campaigns, clients, makeTask, SAMPLE_FIELDS, SAMPLE_SOURCE } from '../data';
import { createClientSheet, readClientSheetInputs } from '../sheet';
import { bucket, fillTemplate, reservationScheduleSheet } from '../policy';
import { locationLabel } from '../clinic-policy';
import { Button, CopyButton, Field, Modal, Notice } from './shared';
export function Registration({
  data,
  existing,
  initialCampaignId,
  initialPersonId,
  onClose,
  onSave,
  onOpen,
}: {
  data: DemoData;
  existing?: DemoTask;
  initialCampaignId?: string;
  initialPersonId?: string;
  onClose: () => void;
  onSave: (task: DemoTask) => void;
  onOpen: (id: string) => void;
}) {
  const [step, setStep] = useState(1);
  const [campaignId, setCampaign] = useState(existing?.campaignId ?? initialCampaignId ?? campaigns[0].id);
  const [personId, setPerson] = useState(existing?.personId ?? initialPersonId ?? data.people[0].id);
  const [targetId, setTarget] = useState(existing?.id ?? 'new');
  const campaign = campaigns.find((c) => c.id === campaignId)!;
  const clientName = clients.find((c) => c.id === campaign.clientId)?.name ?? '';
  const branch = data.branches.find((b) => b.clientId === campaign.clientId);
  const person = data.people.find((p) => p.id === personId)!;
  const target = data.tasks.find((t) => t.id === targetId);
  const available = data.tasks.filter(
    (t) =>
      t.campaignId === campaignId && t.personId === personId && t.type === 'visit' && bucket(t) === 'active',
  );
  const [source, setSource] = useState(''),
    [sheet, setSheet] = useState('');
  const [error, setError] = useState(''),
    [copyFailed, setCopyFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const [simulate, setSimulate] = useState('normal');
  const customerForm = branch
    ? fillTemplate(branch.form, {
        clinic: clientName,
        branch: branch.name,
        naver: branch.naver,
        google: branch.google,
        handle: person.handle,
      })
    : '';
  function resetContext() {
    if (
      (source || sheet) &&
      !window.confirm('예약 대상을 바꾸면 작성 중인 원문·기재 시트를 비워요. 대상을 바꿀까요?')
    )
      return false;
    setSource('');
    setSheet('');
    setError('');
    setCopyFailed(false);
    return true;
  }
  function makeSheet(sample = false) {
    return branch
      ? fillTemplate(branch.sheetTemplate, {
          handle: person.handle,
          clinic: clientName,
          branch: branch.name,
          naver: branch.naver,
          google: branch.google,
          preferred: '',
          visitType: '',
          name: '',
          gender: '',
          birthDate: '',
          koreanAbility: '',
          treatment: '',
          preferred2: '',
          companion: '',
          note: '',
          ...(sample ? { ...SAMPLE_FIELDS, preferred: SAMPLE_FIELDS.preferred.replace('T', ' ') } : {}),
        })
      : createClientSheet(person);
  }
  function parse() {
    if (sheet && !window.confirm('작성한 기재 시트를 새 파싱 결과로 바꿀까요?')) return;
    if (simulate === 'parse-failure' || source.trim() !== SAMPLE_SOURCE) {
      setError('샘플 응답만 파싱할 수 있어요. 원문은 보존했어요. 수동 작성으로 계속해 주세요.');
      return;
    }
    const next = makeSheet(true);
    setSheet(reservationScheduleSheet(next));
    setError('');
  }
  function commit() {
    if (!branch || !sheet.trim()) {
      setError('본점 정보와 기재 시트를 확인해 주세요.');
      return;
    }
    if (target?.reservation) {
      onOpen(target.id);
      return;
    }
    if (simulate === 'save-failure') {
      setError('대기 저장에 실패했어요. 입력을 보존했으니 다시 시도해 주세요.');
      setSimulate('normal');
      return;
    }
    const task = target ?? { ...makeTask(`visit-${crypto.randomUUID()}`, personId, campaignId), amount: '' };
    const savedSheet = reservationScheduleSheet(sheet);
    onSave({
      ...task,
      scheduledOn: readClientSheetInputs(savedSheet).uploadDeadline,
      reservation: {
        branchId: branch.id,
        source,
        sheet: savedSheet,
        phase: 'waiting',
        history: [],
      },
    });
  }
  async function copyAndSave() {
    if (busy || !sheet.trim()) return;
    setBusy(true);
    setError('');
    const readySheet = reservationScheduleSheet(sheet);
    setSheet(readySheet);
    try {
      if (simulate === 'copy-failure') throw new Error('sample');
      await navigator.clipboard.writeText(readySheet);
      commit();
    } catch {
      setCopyFailed(true);
      setError('복사하지 못해 저장하지 않았어요. 기재 시트를 직접 선택해 복사한 뒤 아래 버튼을 눌러 주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={existing ? '기존 방문 작업에 예약 추가' : '방문 예약 등록'} onClose={onClose} wide>
      <div className="mock-steps">
        <span className={step === 1 ? 'current' : ''}>1 고객 양식</span>
        <span>→</span>
        <span className={step === 2 ? 'current' : ''}>2 응답 파싱</span>
      </div>
      {step === 1 ? (
        <div className="mock-modal-body">
          <div className="mock-grid two">
            <Field label="캠페인">
              <select
                disabled={!!existing}
                value={campaignId}
                onChange={(e) => {
                  if (resetContext()) {
                    setCampaign(e.target.value);
                    setTarget('new');
                  }
                }}
              >
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="인플루언서">
              <select
                disabled={!!existing}
                value={personId}
                onChange={(e) => {
                  if (resetContext()) {
                    setPerson(e.target.value);
                    setTarget('new');
                  }
                }}
              >
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · @{p.handle}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="연결할 작업">
              <select
                value={targetId}
                disabled={!!existing}
                onChange={(e) => {
                  if (resetContext()) setTarget(e.target.value);
                }}
              >
                <option value="new">새 작업과 함께 등록</option>
                {available.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                    {t.reservation ? ' · 예약 있음' : ' · 예약 상세 없음'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="방문 클리닉">
              <span>{branch ? locationLabel(branch, clientName) : clientName}</span>
            </Field>
          </div>
          {!branch && <Notice danger>본점 운영 정보를 찾을 수 없어요. 클리닉 설정을 확인해 주세요.</Notice>}
          {target && (
            <Notice>
              작업 {target.id}에 연결해요.{target.visitOn && ` 기존 방문일 ${target.visitOn} · 시간 미정`}
            </Notice>
          )}
          {target?.reservation ? (
            <Notice>
              이미 예약이 있어요. 기존 예약에서 수정해 주세요.{' '}
              <Button onClick={() => onOpen(target.id)}>기존 예약 열기</Button>
            </Notice>
          ) : branch ? (
            <>
              <Field label="고객에게 보낼 일본어 예약 양식">
                <textarea readOnly rows={10} value={customerForm} />
              </Field>
              <div className="mock-actions">
                <CopyButton text={customerForm} label="예약 양식 복사" />
                <a className="mock-link" href="https://x.com/messages" target="_blank" rel="noreferrer">
                  X에서 안내하기 ↗
                </a>
              </div>
              <p className="mock-muted">
                양식을 복사해 X에서 직접 보내 주세요. 이 화면에서 DM을 전송하지 않아요.
              </p>
            </>
          ) : null}
        </div>
      ) : (
        <div className="mock-modal-body">
          <p className="mock-muted">
            {campaign.name} · @{person.handle} · {branch && locationLabel(branch, clientName)}. 파싱은 예시
            응답으로 체험해요.
          </p>
          <div className="mock-actions">
            <Button onClick={() => setSource(SAMPLE_SOURCE)}>예시 응답 넣기</Button>
            <Button onClick={parse}>예약 정보 파싱</Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (!sheet) setSheet(makeSheet());
                setError('원문을 보며 기재 시트를 직접 작성해 주세요.');
              }}
            >
              수동 작성
            </Button>
          </div>
          <div className="mock-grid two mock-compare">
            <Field label="고객 응답 원문">
              <textarea
                rows={15}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="고객 응답을 붙여 넣어 주세요."
              />
            </Field>
            <Field label="편집 가능한 기재 시트" hint="추가 문구와 줄바꿈까지 그대로 복사·저장해요.">
              <textarea
                rows={15}
                value={sheet}
                onChange={(e) => setSheet(e.target.value)}
                placeholder="파싱 후 직접 수정하거나 수동 작성해 주세요."
              />
            </Field>
          </div>
          <details>
            <summary>실패 상황 체험</summary>
            <Field label="등록 상황">
              <select value={simulate} onChange={(e) => setSimulate(e.target.value)}>
                <option value="normal">정상</option>
                <option value="parse-failure">파싱 실패</option>
                <option value="copy-failure">복사 실패</option>
                <option value="save-failure">저장 실패</option>
              </select>
            </Field>
          </details>
          {error && <Notice danger>{error}</Notice>}
          {copyFailed && <Button onClick={commit}>직접 복사했어요 · 대기 저장</Button>}
        </div>
      )}
      <footer>
        {step === 2 ? <Button onClick={() => setStep(1)}>고객 양식으로</Button> : <span />}
        {step === 1 ? (
          <Button variant="primary" disabled={!branch || !!target?.reservation} onClick={() => setStep(2)}>
            응답 파싱으로
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !sheet.trim()} onClick={copyAndSave}>
            {busy ? '복사 중…' : '파싱 결과 복사하기'}
          </Button>
        )}
      </footer>
    </Modal>
  );
}
