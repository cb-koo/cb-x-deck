'use client';
import { useState } from 'react';
import type { Branch, ClinicInfo, DemoData } from '../model';
import { clients } from '../data';
import { Badge, Button, Field, Section } from './shared';
import { ClinicSettings } from './ClinicSettings';
const TABS = [
  ['info', '기본 정보'],
  ['hours', '운영시간'],
  ['forms', '방문 안내·양식'],
] as const;
export function ClinicManager({
  data,
  onBranches,
  onClinicInfo,
  notify,
}: {
  data: DemoData;
  onBranches: (branches: Branch[]) => void;
  onClinicInfo: (id: string, info: ClinicInfo) => void;
  notify: (s: string) => void;
}) {
  const [clientId, setClient] = useState('mimo');
  const [tab, setTab] = useState<string>('info');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Branch>>({});
  const [infoDrafts, setInfoDrafts] = useState<Record<string, ClinicInfo>>({});
  const client = clients.find((c) => c.id === clientId)!;
  const branch = data.branches.find((b) => b.clientId === clientId);
  const info = infoDrafts[clientId] ?? data.clinicInfo[clientId];
  const infoDirty = JSON.stringify(info) !== JSON.stringify(data.clinicInfo[clientId]);
  const shownClients = clients.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <div className={`mock-management mock-clinics ${tab === 'hours' ? 'mock-clinics-hours' : ''}`}>
      <aside className="mock-management-list mock-people-list" aria-label="클리닉 목록">
        <h2>
          클리닉 <span className="mock-muted">{clients.length}</span>
        </h2>
        <p className="mock-people-intro">클리닉 정보와 방문 운영에 필요한 설정을 모아 관리하세요.</p>
        <Field label="클리닉 찾기">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="클리닉 이름으로 찾기"
          />
        </Field>
        <div className="mock-people-results">
          {shownClients.map((c) => {
            return (
              <button
                key={c.id}
                className={clientId === c.id ? 'selected' : ''}
                aria-pressed={clientId === c.id}
                onClick={() => {
                  setClient(c.id);
                }}
              >
                <span className="mock-person-avatar" aria-hidden>
                  {c.name[0]}
                </span>
                <span>
                  <b>{c.name}</b>
                  <small>본점 · 방문 운영</small>
                </span>
              </button>
            );
          })}
          {!shownClients.length && <p className="mock-empty-small">일치하는 클리닉이 없어요.</p>}
        </div>
      </aside>
      <div className="mock-management-body mock-profile-body">
        <header className="mock-card mock-profile-header">
          <div className="mock-profile-identity">
            <span className="mock-person-avatar large" aria-hidden>
              {client.name[0]}
            </span>
            <div>
              <h1>{client.name}</h1>
              <p className="mock-muted">클리닉 정보 · 방문 운영</p>
            </div>
            <Badge>본점</Badge>
          </div>
          <p className="mock-profile-summary">본점의 운영시간과 방문 안내, 예약 양식을 관리해요.</p>
        </header>
        <nav className="mock-tabs mock-profile-tabs" aria-label="클리닉 상세 메뉴">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === 'info' && (
          <>
            <div className="mock-card">
              <Section title="클리닉 기본 정보" aside={<Badge>클리닉 공통</Badge>}>
                <p className="mock-section-help">클리닉 소개와 콘텐츠 작성 시 참고할 기준을 관리해요.</p>
                <Field
                  label="클리닉·의사 정보"
                  hint="콘텐츠 작성 시 참고할 소개와 담당 의료진 정보를 기록해 주세요."
                >
                  <textarea
                    rows={5}
                    value={info.info}
                    onChange={(e) =>
                      setInfoDrafts({ ...infoDrafts, [clientId]: { ...info, info: e.target.value } })
                    }
                    placeholder="클리닉 소개 문서를 붙여넣거나 직접 입력해 주세요."
                  />
                </Field>
                <Field label="금지 표현" hint="콘텐츠에 쓰지 않을 표현을 한 줄에 하나씩 입력해 주세요.">
                  <textarea
                    rows={3}
                    value={info.banned}
                    onChange={(e) =>
                      setInfoDrafts({ ...infoDrafts, [clientId]: { ...info, banned: e.target.value } })
                    }
                  />
                </Field>
              </Section>
              <Section title="운영 담당자 메모">
                <textarea
                  aria-label="클리닉 운영 메모"
                  rows={3}
                  value={info.memo}
                  onChange={(e) =>
                    setInfoDrafts({ ...infoDrafts, [clientId]: { ...info, memo: e.target.value } })
                  }
                  placeholder="이 클리닉과 협업할 때 기억할 내용"
                />
                <p className="mock-muted">
                  팀 내부에서 참고하는 메모예요. 고객 예약 양식에는 포함되지 않아요.
                </p>
              </Section>
            </div>
            <div className="mock-save-bar">
              <span className="mock-muted">
                {infoDirty ? '저장하지 않은 변경이 있어요.' : '클리닉 전체에 공통으로 적용되는 정보예요.'}
              </span>
              <Button
                variant="primary"
                onClick={() => {
                  onClinicInfo(clientId, info);
                  notify('클리닉 기본 정보를 저장했어요.');
                }}
              >
                기본 정보 저장
              </Button>
            </div>
          </>
        )}
        <div hidden={tab !== 'hours' && tab !== 'forms'}>
          {branch && (
            <ClinicSettings
              key={branch.id}
              branch={branch}
              draft={drafts[branch.id] ?? branch}
              tab={tab === 'forms' ? 'forms' : 'hours'}
              onTab={setTab}
              clientName={client.name}
              onDraft={(next) => setDrafts((d) => ({ ...d, [next.id]: next }))}
              onSave={(next, remainingDraft) => {
                onBranches(data.branches.map((b) => (b.id === next.id ? next : b)));
                setDrafts((d) => {
                  const rest = { ...d };
                  if (remainingDraft && JSON.stringify(remainingDraft) !== JSON.stringify(next))
                    rest[next.id] = remainingDraft;
                  else delete rest[next.id];
                  return rest;
                });
                notify('본점 운영 설정을 저장했어요.');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
