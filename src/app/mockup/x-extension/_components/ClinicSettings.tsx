'use client';
import { useRef, useState } from 'react';
import type { Branch } from '../model';
import { SAMPLE_FIELDS } from '../data';
import { ClinicHours } from './ClinicHours';
import { fillTemplate, safeMapUrl, validIntervals } from '../policy';
import { Button, CopyButton, Field, Modal, Section } from './shared';
type TemplateKey = 'form' | 'sheetTemplate';
export function ClinicSettings({
  branch,
  draft,
  tab,
  onDraft,
  onTab,
  clientName,
  onSave,
}: {
  branch: Branch;
  draft: Branch;
  tab: 'hours' | 'forms';
  onDraft: (branch: Branch) => void;
  onTab: (tab: 'hours' | 'forms') => void;
  clientName: string;
  onSave: (b: Branch, remainingDraft?: Branch) => void;
}) {
  const [error, setError] = useState('');
  const [formTab, setFormTab] = useState('map');
  const [editingTemplates, setEditingTemplates] = useState({ form: false, sheetTemplate: false });
  const [pendingSave, setPendingSave] = useState<{
    key: TemplateKey;
    next: Branch;
    remainingDraft: Branch;
  } | null>(null);
  const sheetInput = useRef<HTMLTextAreaElement>(null);
  const templateView = tab === 'forms' && formTab === 'form';
  const dirty = JSON.stringify(draft) !== JSON.stringify(branch);
  const [language, setLanguage] = useState<'KO' | 'JA' | 'EN'>('JA');
  const patch = (p: Partial<Branch>) => onDraft({ ...draft, ...p });
  const values = {
    clinic: clientName,
    branch: draft.name,
    naver: draft.naver,
    google: draft.google,
    handle: 'hana_mozu',
    ...SAMPLE_FIELDS,
    preferred: SAMPLE_FIELDS.preferred.replace('T', ' '),
    preferred2: '',
    companion: '',
    note: '',
  };
  function save() {
    if (
      draft.week.some((w) => !w.closed && w.intervals !== '' && !validIntervals(w.intervals)) ||
      (draft.holiday === 'special' && !validIntervals(draft.holidayHours)) ||
      draft.exceptions.some((e) => !e.closed && !validIntervals(e.intervals))
    ) {
      onTab('hours');
      setError('설정한 운영시간을 확인해 주세요. 시작·종료 시간이나 점심시간이 올바르지 않은 날이 있어요.');
      return;
    }
    if ([draft.naver, draft.google].some((url) => url && !safeMapUrl(url))) {
      onTab('forms');
      setFormTab('map');
      setError('지도는 http 또는 https 주소로 입력해 주세요.');
      return;
    }
    setError('');
    onSave({ ...draft, form: branch.form, sheetTemplate: branch.sheetTemplate }, draft);
  }
  function saveTemplate(key: TemplateKey) {
    const next = { ...branch, [key]: draft[key] };
    if (draft[key] !== branch[key]) {
      setPendingSave({ key, next: structuredClone(next), remainingDraft: structuredClone(draft) });
    } else {
      setEditingTemplates((current) => ({ ...current, [key]: false }));
    }
  }
  function finishTemplateSave() {
    if (!pendingSave) return;
    onSave(pendingSave.next, pendingSave.remainingDraft);
    setEditingTemplates((current) => ({ ...current, [pendingSave.key]: false }));
    setPendingSave(null);
  }
  function templateAction(key: TemplateKey, label: string) {
    return (
      <Button
        variant={editingTemplates[key] ? 'primary' : 'subtle'}
        aria-label={`${label} ${editingTemplates[key] ? '저장' : '수정'}`}
        onClick={() =>
          editingTemplates[key]
            ? saveTemplate(key)
            : setEditingTemplates((current) => ({ ...current, [key]: true }))
        }
      >
        {editingTemplates[key] ? '저장' : '수정'}
      </Button>
    );
  }
  function insertHandle() {
    if (!editingTemplates.sheetTemplate) return;
    const input = sheetInput.current;
    const start = input?.selectionStart ?? draft.sheetTemplate.length;
    const end = input?.selectionEnd ?? start;
    const token = '@{{handle}}';
    patch({ sheetTemplate: draft.sheetTemplate.slice(0, start) + token + draft.sheetTemplate.slice(end) });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  }
  return (
    <>
      {tab === 'hours' ? (
        <ClinicHours draft={draft} clientName={clientName} onDraft={onDraft} />
      ) : (
        <div className="mock-card mock-form-settings">
          <nav className="mock-subtabs" aria-label="방문 안내·양식 세부 메뉴">
            {[
              ['map', '지도·방문 안내'],
              ['form', '고객 예약 양식·기재 시트'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={formTab === id ? 'active' : ''}
                aria-pressed={formTab === id}
                onClick={() => setFormTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {formTab === 'map' && (
            <Section title="본점 지도 링크">
              <p className="mock-muted">방문 안내와 예약 양식에 사용할 본점 위치예요.</p>
              <div className="mock-grid two">
                {(['naver', 'google'] as const).map((key) => (
                  <Field key={key} label={key === 'naver' ? '네이버 지도' : '구글 지도'}>
                    <input
                      type="url"
                      value={draft[key]}
                      onChange={(e) => patch({ [key]: e.target.value })}
                      placeholder="미등록"
                    />
                    {safeMapUrl(draft[key]) ? (
                      <a className="mock-link" href={draft[key]} target="_blank" rel="noreferrer">
                        지도 열기 ↗
                      </a>
                    ) : (
                      <small>지도 링크 미등록</small>
                    )}
                  </Field>
                ))}
              </div>
            </Section>
          )}
          {formTab === 'map' && (
            <Section
              title="언어별 방문 안내"
              aside={
                <select
                  aria-label="안내 언어"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as typeof language)}
                >
                  <option>JA</option>
                  <option>KO</option>
                  <option>EN</option>
                </select>
              }
            >
              <p className="mock-muted">치환 항목: {'{{clinic}}, {{branch}}, {{naver}}, {{google}}'}</p>
              <div className="mock-grid two">
                <Field label="안내 문구">
                  <textarea
                    rows={5}
                    value={draft.instructions[language]}
                    onChange={(e) =>
                      patch({ instructions: { ...draft.instructions, [language]: e.target.value } })
                    }
                  />
                </Field>
                <Field label="안내 미리보기">
                  <textarea rows={5} readOnly value={fillTemplate(draft.instructions[language], values)} />
                </Field>
              </div>
              <CopyButton text={fillTemplate(draft.instructions[language], values)} label="안내 복사" />
            </Section>
          )}
          {formTab === 'form' && (
            <div className="mock-template-columns">
              <Section title="일본어 고객 예약 양식" aside={templateAction('form', '고객 예약 양식')}>
                <p className="mock-muted">방문 예약을 조율할 때 고객에게 복사해 보내는 양식이에요.</p>
                <Field label="고객 예약 양식">
                  <textarea
                    rows={16}
                    readOnly={!editingTemplates.form}
                    value={draft.form}
                    onChange={(e) => patch({ form: e.target.value })}
                  />
                </Field>
              </Section>
              <Section title="클리닉 전달용 기재 시트" aside={templateAction('sheetTemplate', '기재 시트')}>
                <p className="mock-muted">
                  고객 응답을 클리닉에 전달할 때 사용하는 시트예요. 변경한 양식은 새 예약에 적용돼요.
                </p>
                <Field label="기재 시트 템플릿">
                  <textarea
                    ref={sheetInput}
                    rows={16}
                    readOnly={!editingTemplates.sheetTemplate}
                    value={draft.sheetTemplate}
                    onChange={(e) => patch({ sheetTemplate: e.target.value })}
                  />
                </Field>
                <div className="mock-template-toolbar">
                  <Button
                    aria-label="인플핸들"
                    disabled={!editingTemplates.sheetTemplate}
                    onClick={insertHandle}
                  >
                    [인플핸들]
                  </Button>
                  <span>기재 시트에서 원하는 위치를 선택한 뒤 눌러 주세요.</span>
                </div>
              </Section>
            </div>
          )}
        </div>
      )}
      {!templateView && (
        <div className="mock-save-bar">
          {error ? (
            <span className="mock-danger-text" role="alert">
              {error}
            </span>
          ) : (
            <span className="mock-muted">
              {dirty
                ? '저장하지 않은 변경이 있어요. 예약 양식과 기재 시트는 각 항목에서 저장해 주세요.'
                : '저장된 설정이에요. 새 예약·안내에 적용돼요.'}
            </span>
          )}
          <Button variant="primary" onClick={save}>
            클리닉 설정 저장
          </Button>
        </div>
      )}
      {pendingSave && (
        <Modal title="예약 파싱 형식도 함께 수정해야 해요" onClose={() => setPendingSave(null)}>
          <div className="mock-modal-body mock-parser-notice">
            <p>고객 예약 양식과 예약 파싱은 동일한 항목과 형식을 사용합니다.</p>
            <p>예약 양식이나 기재 시트의 항목을 수정할 경우, 예약 파싱도 동일한 형식으로 수정해야 합니다.</p>
            <p>
              <strong>변경한 내용을 개발자에게 전달하세요.</strong>
            </p>
          </div>
          <footer>
            <Button onClick={() => setPendingSave(null)}>계속 수정</Button>
            <Button variant="primary" onClick={finishTemplateSave}>
              확인하고 저장
            </Button>
          </footer>
        </Modal>
      )}
    </>
  );
}
