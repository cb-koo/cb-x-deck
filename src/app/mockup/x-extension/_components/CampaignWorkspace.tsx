'use client';
import { useState, type ReactNode } from 'react';
import { CAMPAIGN_STATUS_LABEL, FLOW_STAGES, FLOW_STAGE_LABEL, campaignStatus } from '@/lib/campaignJudgment';
import { periodLabel } from '@/lib/campaignView';
import { STATUS_LABEL } from '@/lib/draftStatus';
import { campaigns, clients, makeTask } from '../data';
import type { DemoData, DemoTask } from '../model';
import { TYPE_LABEL } from '../model';
import { commonFlow, koreanDay, money, stage, visitSchedule } from '../policy';
import { Badge, Button, Field, Modal, Notice } from './shared';

function costTotal(tasks: DemoTask[]) {
  const totals = new Map<DemoTask['currency'], number>();
  let missing = 0;
  for (const t of tasks) {
    if (t.noCost) continue;
    if (!t.amount.trim()) missing++;
    else totals.set(t.currency, (totals.get(t.currency) ?? 0) + Number(t.amount));
  }
  const parts = [...totals].map(([currency, amount]) => money(String(amount), currency));
  if (missing) parts.push(`미등록 ${missing}건`);
  return parts.join(' · ') || (tasks.length ? '비용 없음' : '—');
}

export function CampaignWorkspace({
  data,
  campaignId,
  personId,
  selectedId,
  now,
  error,
  onDismissError,
  onCampaign,
  onTask,
  onAdd,
  onBack,
  onClearPerson,
  onCloseTask,
  children,
}: {
  data: DemoData;
  campaignId: string;
  personId: string;
  selectedId: string;
  now: number | null;
  error: string;
  onDismissError: () => void;
  onCampaign: (id: string) => void;
  onTask: (id: string) => void;
  onAdd: (task: DemoTask) => void;
  onBack: () => void;
  onClearPerson: () => void;
  onCloseTask: () => void;
  children: (visible: DemoTask[]) => ReactNode;
}) {
  const campaign = campaigns.find((c) => c.id === campaignId) ?? campaigns[0];
  const today = now === null ? null : koreanDay(now);
  const allTasks = data.tasks.filter((t) => t.campaignId === campaign.id);
  const assigned = allTasks.filter((t) => !t.end);
  const person = data.people.find((p) => p.id === personId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const [newPersonId, setNewPerson] = useState(personId || data.people[0].id);
  const [newType, setNewType] = useState<DemoTask['type']>('visit');
  const [scheduledOn, setScheduledOn] = useState('');
  const visible = allTasks.filter((t) => {
    const p = data.people.find((p) => p.id === t.personId)!;
    return (
      (!personId || t.personId === personId) &&
      (filter === 'all' || commonFlow(t) === filter) &&
      (typeFilter === 'all' || t.type === typeFilter) &&
      `${p.name} ${p.handle} ${t.draft?.title ?? ''} ${t.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });
  const status = today ? campaignStatus(campaign.startsOn, campaign.endsOn, today) : null;
  return (
    <div className="mock-management mock-campaigns">
      <aside className="mock-management-list mock-campaign-list" aria-label="캠페인 목록">
        <h2>
          캠페인 <span className="mock-muted">{campaigns.length}</span>
        </h2>
        {(['active', 'upcoming', 'ended'] as const).map((group) => {
          const rows = campaigns.filter((c) =>
            today ? campaignStatus(c.startsOn, c.endsOn, today) === group : group === 'active',
          );
          return rows.length ? (
            <section key={group}>
              <h3>
                {today ? CAMPAIGN_STATUS_LABEL[group] : '전체'} <span>{rows.length}</span>
              </h3>
              {rows.map((c) => (
                <button
                  key={c.id}
                  className={c.id === campaign.id ? 'selected' : ''}
                  aria-pressed={c.id === campaign.id}
                  onClick={() => onCampaign(c.id)}
                >
                  <b>{c.name}</b>
                  <small>{periodLabel(c.startsOn, c.endsOn)}</small>
                  <small>작업 {data.tasks.filter((t) => t.campaignId === c.id && !t.end).length}건</small>
                </button>
              ))}
            </section>
          ) : null;
        })}
      </aside>
      <div className="mock-management-body mock-campaign-body">
        {person && (
          <button className="mock-profile-back" onClick={onBack}>
            ← {person.name} · 협업 콘텐츠
          </button>
        )}
        <header className="mock-card mock-campaign-header">
          <div>
            <p className="mock-eyebrow">{clients.find((c) => c.id === campaign.clientId)?.name}</p>
            <h1>{campaign.name}</h1>
            <p className="mock-muted">{periodLabel(campaign.startsOn, campaign.endsOn)}</p>
          </div>
          {status && (
            <Badge tone={status === 'active' ? 'green' : status === 'upcoming' ? 'blue' : ''}>
              {CAMPAIGN_STATUS_LABEL[status]}
            </Badge>
          )}
        </header>
        <div className="mock-card mock-campaign-summary" aria-label="캠페인 요약">
          <div>
            <h3>작업</h3>
            <strong>
              {assigned.filter((t) => t.posted).length} <span>/ {assigned.length}</span>
            </strong>
            <p>게시 · 취소 제외</p>
          </div>
          <div>
            <h3>성과</h3>
            <strong>—</strong>
            <p>조회·좋아요 미집계</p>
          </div>
          <div>
            <h3>비용</h3>
            <strong>{costTotal(assigned)}</strong>
            <p>작업 비용 · 취소 제외</p>
          </div>
        </div>
        {error && (
          <Notice danger>
            {error}
            <Button variant="ghost" onClick={onDismissError}>
              닫기
            </Button>
          </Notice>
        )}
        <section className="mock-card mock-campaign-tasks" aria-label="캠페인 작업 목록">
          <div className="mock-section-head">
            <h2>작업</h2>
            <Button variant="primary" onClick={() => setAdding(true)}>
              + 작업 추가
            </Button>
          </div>
          {person && (
            <div className="mock-person-filter">
              <span>
                {person.name} · @{person.handle}의 작업
              </span>
              <Button variant="ghost" onClick={onClearPerson}>
                캠페인 전체 작업 보기
              </Button>
            </div>
          )}
          <div className="mock-campaign-filters">
            <Field label="작업 단계">
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  onCloseTask();
                }}
              >
                <option value="all">전체 단계</option>
                {FLOW_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {FLOW_STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="작업 유형">
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  onCloseTask();
                }}
              >
                <option value="all">전체 유형</option>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="작업 검색">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  onCloseTask();
                }}
                placeholder="인플루언서, 원고, 작업 ID"
              />
            </Field>
            <span className="mock-muted">{visible.length}건</span>
          </div>
          <div className="mock-table-wrap">
            <table className="mock-table mock-campaign-table">
              <thead>
                <tr>
                  <th>단계</th>
                  <th>유형</th>
                  <th>인플루언서</th>
                  <th>원고</th>
                  <th>게시 예정일</th>
                  <th>작업 비용</th>
                  <th>방문 예약</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const p = data.people.find((p) => p.id === t.personId)!;
                  return (
                    <tr key={t.id} className={selectedId === t.id ? 'selected' : ''}>
                      <td>
                        <Badge tone={t.end ? 'red' : commonFlow(t) === 'done' ? 'green' : 'blue'}>
                          {FLOW_STAGE_LABEL[commonFlow(t)]}
                        </Badge>
                      </td>
                      <td>{TYPE_LABEL[t.type]}</td>
                      <td>
                        <button
                          className="mock-task-link"
                          onClick={() => onTask(t.id)}
                          aria-label={`${p.name} ${t.id} 상세`}
                        >
                          <span>
                            <b>{p.name}</b>
                            <span>@{p.handle}</span>
                          </span>
                        </button>
                      </td>
                      <td className="mock-draft-cell">
                        {t.draft ? (
                          <>
                            <span title={t.draft.title}>{t.draft.title}</span>
                            <small>{STATUS_LABEL[t.draft.status]}</small>
                          </>
                        ) : (
                          <span className="mock-muted">—</span>
                        )}
                      </td>
                      <td>{t.scheduledOn || <span className="mock-muted">미등록</span>}</td>
                      <td className="mock-money">{money(t.amount, t.currency, t.noCost)}</td>
                      <td>
                        {t.type === 'visit' ? (
                          <button
                            className="mock-visit-cell"
                            onClick={() => onTask(t.id)}
                            aria-label={`${p.name} ${t.id} 방문 예약`}
                          >
                            {t.reservation || t.end ? (
                              <>
                                <Badge tone={t.end ? 'red' : ''}>{stage(t)}</Badge>
                                <span>{visitSchedule(t)}</span>
                              </>
                            ) : (
                              <>
                                <span className="mock-link">예약 추가</span>
                                <small>{t.visitOn ? `${t.visitOn} · 시간 미정` : '예약 미등록'}</small>
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="mock-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visible.length && <p className="mock-empty">조건에 맞는 작업이 없어요.</p>}
          </div>
        </section>
      </div>
      {children(visible)}
      {adding && (
        <Modal title="작업 추가" onClose={() => setAdding(false)}>
          <div className="mock-modal-body">
            <p className="mock-muted">{campaign.name}</p>
            <Field label="인플루언서">
              <select value={newPersonId} onChange={(e) => setNewPerson(e.target.value)}>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · @{p.handle}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="작업 유형">
              <select value={newType} onChange={(e) => setNewType(e.target.value as DemoTask['type'])}>
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="게시 예정일">
              <input type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} />
            </Field>
            {newType === 'visit' && (
              <p className="mock-muted">
                작업을 추가한 뒤 상세에서 방문 예약을 등록할 수 있어요. 방문일은 게시 예정일과 별도로
                관리해요.
              </p>
            )}
          </div>
          <footer>
            <Button onClick={() => setAdding(false)}>취소</Button>
            <Button
              variant="primary"
              onClick={() => {
                const p = data.people.find((p) => p.id === newPersonId)!;
                const task = {
                  ...makeTask(`task-${crypto.randomUUID()}`, p.id, campaign.id),
                  type: newType,
                  scheduledOn,
                  amount: p.pricing[newType],
                  currency: p.currency,
                };
                setFilter('all');
                setTypeFilter('all');
                setSearch('');
                setAdding(false);
                onAdd(task);
              }}
            >
              작업 추가
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
