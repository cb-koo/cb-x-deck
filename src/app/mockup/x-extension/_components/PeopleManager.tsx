'use client';
import { useState } from 'react';
import { InfoTip } from '@/components/InfoTip';
import { CAMPAIGN_STATUS_LABEL, campaignStatus, formatDateKo } from '@/lib/campaignJudgment';
import { STATUS_LABEL } from '@/lib/draftStatus';
import type { DemoData, DemoTask, Person, SaveMode } from '../model';
import { TYPE_LABEL } from '../model';
import { campaigns } from '../data';
import { changedAt, koreanDay, money, participatingCampaigns, validAmount } from '../policy';
import { Badge, Button, Field, Modal, Notice, Section } from './shared';
export function PeopleManager({
  data,
  personId,
  now,
  onSelectPerson,
  onPerson,
  onCampaign,
  onTask,
  notify,
}: {
  data: DemoData;
  personId: string;
  now: number | null;
  onSelectPerson: (id: string) => void;
  onPerson: (p: Person) => void;
  onCampaign: (id: string) => void;
  onTask: (id: string) => void;
  notify: (s: string) => void;
}) {
  const [profileTab, setProfileTab] = useState('content');
  const [search, setSearch] = useState('');
  const [draftId, setDraftId] = useState<string | null>(null);
  const p = data.people.find((p) => p.id === personId)!;
  const tasks = data.tasks.filter((t) => t.personId === personId);
  const participation = participatingCampaigns(campaigns, data.tasks, personId);
  const drafts = tasks
    .filter((t) => t.draft)
    .sort((a, b) => b.draft!.createdOn.localeCompare(a.draft!.createdOn));
  const draftTask = drafts.find((t) => t.id === draftId);
  const draftSummary = Object.entries(STATUS_LABEL)
    .flatMap(([status, label]) => {
      const count = drafts.filter((t) => t.draft!.status === status).length;
      return count ? [`${label} ${count}`] : [];
    })
    .join(' · ');
  const people = data.people.filter((person) =>
    `${person.name} ${person.handle}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <div className="mock-management mock-people">
      <aside className="mock-management-list mock-people-list" aria-label="인플루언서 목록">
        <h2>
          인플루언서 <span className="mock-muted">{data.people.length}</span>
        </h2>
        <p className="mock-people-intro">함께하는 계정의 캠페인과 넘긴 원고를 한자리에서 확인하세요.</p>
        <Field label="인플루언서 찾기">
          <input placeholder="이름·핸들로 찾기" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <div className="mock-people-results">
          {people.map((person) => {
            const own = data.tasks.filter((t) => t.personId === person.id);
            return (
              <button
                key={person.id}
                className={personId === person.id ? 'selected' : ''}
                aria-pressed={personId === person.id}
                onClick={() => {
                  onSelectPerson(person.id);
                  setDraftId(null);
                }}
              >
                <span className={`mock-person-avatar ${person.id === 'yui' ? 'purple' : ''}`} aria-hidden>
                  {person.name[0]}
                </span>
                <span>
                  <b>{person.name}</b>
                  <small>@{person.handle}</small>
                  <small>
                    캠페인 {new Set(own.map((t) => t.campaignId)).size}개 · 원고{' '}
                    {own.filter((t) => t.draft).length}개
                  </small>
                </span>
              </button>
            );
          })}
          {!people.length && <p className="mock-empty-small">일치하는 계정이 없어요.</p>}
        </div>
      </aside>
      <div className="mock-management-body mock-profile-body">
        <header className="mock-card mock-profile-header">
          <div className="mock-profile-identity">
            <span className={`mock-person-avatar large ${p.id === 'yui' ? 'purple' : ''}`} aria-hidden>
              {p.name[0]}
            </span>
            <div>
              <h1>{p.name}</h1>
              <a href={`https://x.com/${p.handle}`} target="_blank" rel="noreferrer">
                @{p.handle} ↗
              </a>
              <p className="mock-muted">
                참여 캠페인 {participation.length}개 · 배정 작업 {tasks.length}건
              </p>
            </div>
            <Badge>샘플 계정</Badge>
          </div>
          <p className="mock-profile-summary">
            {draftSummary ? `원고 ${draftSummary}` : '아직 배정한 원고가 없어요.'}
          </p>
        </header>
        <nav className="mock-tabs mock-profile-tabs" aria-label="인플루언서 상세 메뉴">
          {[
            ['account', '계정 정보'],
            ['content', '협업 콘텐츠'],
            ['deal', '거래 정보'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={profileTab === id ? 'active' : ''}
              aria-pressed={profileTab === id}
              onClick={() => setProfileTab(id)}
            >
              {label}
              {id === 'content' && <span>{drafts.length}</span>}
            </button>
          ))}
        </nav>
        {profileTab === 'content' && (
          <>
            <div className="mock-card mock-participation-section">
              <Section
                title="참여 캠페인"
                aside={
                  <>
                    <InfoTip text="이 계정에 작업이 배정된 캠페인을 모아 보여줘요. 오른쪽 금액은 이 캠페인에서 이 사람의 작업 비용이에요(통화가 다르면 따로 보여요). 캠페인을 누르면 캠페인 화면이 열려요." />
                    {participation.length > 0 && (
                      <span className="mock-muted">· {participation.length}개</span>
                    )}
                  </>
                }
              >
                <div className="mock-participation-list">
                  {participation.map(({ campaign, taskCount, typeSummary, subtotal }) => {
                    const status =
                      now === null
                        ? null
                        : campaignStatus(campaign.startsOn, campaign.endsOn, koreanDay(now));
                    return (
                      <button
                        className="mock-participation-row"
                        key={campaign.id}
                        onClick={() => onCampaign(campaign.id)}
                        aria-label={`${campaign.name} 작업 보기`}
                      >
                        <span className="mock-participation-copy">
                          <strong>{campaign.name}</strong>
                          <span className="mock-muted">
                            {formatDateKo(campaign.startsOn)} ~ {formatDateKo(campaign.endsOn)} · 작업{' '}
                            {taskCount}건{typeSummary && ` (${typeSummary})`}
                          </span>
                        </span>
                        <span className="mock-participation-meta">
                          <Badge tone={status === 'active' ? 'green' : status === 'upcoming' ? 'blue' : ''}>
                            {status ? CAMPAIGN_STATUS_LABEL[status] : '기간 확인 중'}
                          </Badge>
                          <span className="mock-participation-money">{subtotal}</span>
                        </span>
                      </button>
                    );
                  })}
                  {!participation.length && (
                    <p className="mock-empty-small">
                      아직 참여한 캠페인이 없어요. 캠페인 작업에서 이 계정에 작업을 배정하면 여기에 모여요.
                    </p>
                  )}
                </div>
              </Section>
            </div>
            <div className="mock-card">
              <Section title="넘긴 원고" aside={<span className="mock-muted">{drafts.length}개</span>}>
                <div className="mock-draft-list">
                  {drafts.map((t) => (
                    <button key={t.id} onClick={() => setDraftId(t.id)}>
                      <span>{t.draft!.title}</span>
                      <Badge tone={t.draft!.status === 'delivered' ? 'green' : ''}>
                        {STATUS_LABEL[t.draft!.status]}
                      </Badge>
                      <small>{t.draft!.createdOn} 생성</small>
                    </button>
                  ))}
                </div>
                {!drafts.length && (
                  <p className="mock-empty-small">
                    아직 배정한 원고가 없어요. 원고를 배정하면 상태와 함께 여기에 모여요.
                  </p>
                )}
              </Section>
            </div>
          </>
        )}
        {profileTab === 'account' && (
          <div className="mock-card">
            <Section title="인플루언서 고정 메모">
              <textarea
                aria-label="인플루언서 고정 메모"
                rows={4}
                value={p.memo}
                onChange={(e) => onPerson({ ...p, memo: e.target.value })}
                placeholder="이 사람에 대해 기억할 내용"
              />
              <p className="mock-muted">여러 캠페인에서 함께 참고하는 메모예요.</p>
            </Section>
          </div>
        )}
        {profileTab === 'deal' && <PricingEditor key={p.id} person={p} onSave={onPerson} notify={notify} />}
      </div>
      {draftTask?.draft && (
        <Modal title="원고 확인" onClose={() => setDraftId(null)}>
          <div className="mock-modal-body">
            <Badge tone={draftTask.draft.status === 'delivered' ? 'green' : ''}>
              {STATUS_LABEL[draftTask.draft.status]}
            </Badge>
            <h3 className="mock-draft-title">{draftTask.draft.title}</h3>
            <p className="mock-muted">
              {campaigns.find((c) => c.id === draftTask.campaignId)?.name} · {TYPE_LABEL[draftTask.type]}
            </p>
            <pre>{draftTask.draft.body}</pre>
            <p className="mock-section-help bottom">원고 상태와 작업의 게시·정산 상태는 각각 관리해요.</p>
          </div>
          <footer>
            <Button onClick={() => setDraftId(null)}>닫기</Button>
            <Button
              variant="primary"
              onClick={() => {
                setDraftId(null);
                onTask(draftTask.id);
              }}
            >
              연결된 작업 보기
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
function PricingEditor({
  person,
  onSave,
  notify,
}: {
  person: Person;
  onSave: (p: Person) => void;
  notify: (s: string) => void;
}) {
  const [baseline, setBaseline] = useState(person);
  const [pricing, setPricing] = useState(person.pricing),
    [currency, setCurrency] = useState(person.currency),
    [mode, setMode] = useState<SaveMode>('success'),
    [error, setError] = useState(''),
    [latest, setLatest] = useState<Person | null>(null);
  function save() {
    if (!Object.values(pricing).every(validAmount)) {
      setError('단가는 0 이상의 정수로 입력해 주세요.');
      return;
    }
    if (mode === 'failure') {
      setError('단가 저장에 실패했어요. 입력을 보존했어요. 다시 저장해 주세요.');
      setMode('success');
      return;
    }
    if (mode === 'conflict') {
      setLatest({ ...person, pricing: { ...person.pricing, visit: '35000' } });
      setError('다른 담당자가 방문협찬 단가를 수정했어요. 최신 값을 확인해 주세요.');
      return;
    }
    const at = new Date().toISOString();
    const history = (Object.keys(TYPE_LABEL) as DemoTask['type'][])
      .filter((k) => pricing[k] !== person.pricing[k])
      .map((k) => ({
        at,
        label: TYPE_LABEL[k],
        before: money(person.pricing[k], person.currency),
        after: money(pricing[k], currency),
      }));
    if (currency !== person.currency)
      history.unshift({ at, label: '통화', before: person.currency, after: currency });
    const saved = { ...person, currency, pricing, priceHistory: [...history, ...person.priceHistory] };
    onSave(saved);
    setBaseline(saved);
    setError('');
    notify(history.length ? '기본 단가를 저장했어요. 기존 작업 금액은 유지돼요.' : '변경된 단가가 없어요.');
  }
  return (
    <div className="mock-card">
      <Section title="협찬 기본 단가">
        <Field label="기본 단가 통화">
          <select value={currency} onChange={(e) => setCurrency(e.target.value as Person['currency'])}>
            <option value="JPY">JPY · 엔</option>
            <option value="KRW">KRW · 원</option>
          </select>
        </Field>
        <p className="mock-muted">통화를 바꿔도 숫자는 환전되지 않아요. 이미 계약한 작업 금액과 별개예요.</p>
        {(Object.keys(TYPE_LABEL) as DemoTask['type'][]).map((type) => (
          <Field key={type} label={TYPE_LABEL[type]}>
            <div className="mock-price-input">
              <input
                aria-label={`${TYPE_LABEL[type]} 기본 단가`}
                inputMode="numeric"
                placeholder="미등록"
                value={pricing[type]}
                onChange={(e) => setPricing({ ...pricing, [type]: e.target.value })}
              />
              <span>{money(pricing[type], currency)}</span>
            </div>
          </Field>
        ))}
        <details>
          <summary>저장 상황 체험</summary>
          <Field label="단가 저장 상황">
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as SaveMode);
                setLatest(null);
                setError('');
              }}
            >
              <option value="success">정상</option>
              <option value="failure">저장 실패 1회</option>
              <option value="conflict">동시 수정 충돌</option>
            </select>
          </Field>
        </details>
        {error && <Notice danger>{error}</Notice>}
        {latest && (
          <Notice>
            최신 방문 단가: {money(latest.pricing.visit, latest.currency)}
            <br />내 입력: {money(pricing.visit, currency)}
            <div className="mock-actions">
              <Button
                onClick={() => {
                  onSave({
                    ...latest,
                    priceHistory: [
                      {
                        at: new Date().toISOString(),
                        label: '방문협찬 · 다른 담당자',
                        before: money(person.pricing.visit, person.currency),
                        after: money(latest.pricing.visit, latest.currency),
                      },
                      ...person.priceHistory,
                    ],
                  });
                  setPricing(
                    (current) =>
                      Object.fromEntries(
                        (Object.keys(TYPE_LABEL) as DemoTask['type'][]).map((k) => [
                          k,
                          current[k] === baseline.pricing[k] ? latest.pricing[k] : current[k],
                        ]),
                      ) as Person['pricing'],
                  );
                  if (currency === baseline.currency) setCurrency(latest.currency);
                  setBaseline(latest);
                  setLatest(null);
                  setMode('success');
                  setError('최신 값을 확인했어요. 내 입력을 검토하고 다시 저장해 주세요.');
                }}
              >
                최신 값 확인 · 내 입력 유지
              </Button>
            </div>
          </Notice>
        )}
        <Button variant="primary" disabled={!!latest} onClick={save}>
          기본 단가 저장
        </Button>
      </Section>
      <Section title="단가 변경 이력">
        {person.priceHistory.length ? (
          person.priceHistory.map((h, i) => (
            <article className="mock-history" key={i}>
              <b>{h.label}</b>
              <p>
                {h.before} → {h.after}
              </p>
              <time>{changedAt(h.at)}</time>
            </article>
          ))
        ) : (
          <p className="mock-muted">단가를 바꾸면 기록이 남아요. 예약 변경 횟수와 별개예요.</p>
        )}
      </Section>
    </div>
  );
}
