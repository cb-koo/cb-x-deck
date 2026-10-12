'use client';
import { useState } from 'react';
import type { DemoData } from '../model';
import { TYPE_LABEL } from '../model';
import { campaigns } from '../data';
import { bucket, money, taskStatus } from '../policy';
import { Badge, Button, Field, Notice, Section } from './shared';
export function ConnectionPreview({ data, onTask }: { data: DemoData; onTask: (id: string) => void }) {
  const [scenario, setScenario] = useState('ok'),
    [retried, setRetried] = useState(false);
  const person = data.people.find((p) => p.id === 'hana')!,
    active = data.tasks.filter((t) => t.personId === person.id && bucket(t) === 'active');
  return (
    <div className="mock-connection">
      <div className="mock-page-title">
        <div>
          <p className="mock-eyebrow">연동 전 화면 검토</p>
          <h2>익스텐션 연결 결과</h2>
        </div>
        <Badge tone="amber">가상 응답</Badge>
      </div>
      <Notice>웹 목업의 샘플 상태예요. 승인된 익스텐션 목업과 실시간 동기화되지는 않아요.</Notice>
      <div className="mock-grid two">
        <div className="mock-card">
          <Section title="조회 상황 선택">
            <Field label="연결 결과">
              <select
                value={scenario}
                onChange={(e) => {
                  setScenario(e.target.value);
                  setRetried(false);
                }}
              >
                <option value="ok">일치 · 진행중 작업 있음</option>
                <option value="failure">조회 실패</option>
                <option value="unregistered">미등록 인플루언서</option>
                <option value="empty">등록됨 · 작업 0건</option>
                <option value="mismatch">핸들 일치 · 숫자 ID 불일치</option>
                <option value="expired">로그인 만료</option>
                <option value="denied">권한 없음</option>
              </select>
            </Field>
            <p className="mock-muted">
              조회 실패는 작업 0건과 다르게 안내해요. 아래 바로가기는 해당 작업을 선택한 상태로 열어요.
            </p>
          </Section>
          <Section title="특정 작업 바로가기">
            <p className="mock-muted">
              URL에 캠페인·작업을 함께 담아요. 삭제된 작업이나 다른 캠페인의 작업은 오류를 보여 줘요.
            </p>
            <a
              className="mock-link"
              href="?campaign=autumn&task=visit-confirmed"
              target="_blank"
              rel="noreferrer"
            >
              확정 예약 바로 열기 ↗
            </a>
            <br />
            <a
              className="mock-link"
              href="?campaign=skin&task=visit-confirmed"
              target="_blank"
              rel="noreferrer"
            >
              잘못된 캠페인 연결 체험 ↗
            </a>
            <br />
            <a className="mock-link" href="?campaign=autumn&task=missing" target="_blank" rel="noreferrer">
              없는 작업 체험 ↗
            </a>
          </Section>
        </div>
        <div className="mock-card">
          <Section title="조회 결과 미리보기">
            {(scenario === 'ok' || (scenario === 'failure' && retried)) && (
              <>
                <h3>
                  {person.name} <span className="mock-muted">@{person.handle}</span>
                </h3>
                <p className="mock-muted">
                  진행중 {active.length}건 · 목록 {active.length}건
                </p>
                <div className="mock-person-tasks">
                  {active.map((t) => (
                    <button key={t.id} onClick={() => onTask(t.id)}>
                      <div>
                        <Badge tone="blue">{taskStatus(t)}</Badge>
                        <b>{TYPE_LABEL[t.type]}</b>
                        <strong>{money(t.amount, t.currency, t.noCost)}</strong>
                      </div>
                      <p>{campaigns.find((c) => c.id === t.campaignId)?.name}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
            {scenario === 'failure' && !retried && (
              <Notice danger>
                작업을 조회하지 못했어요. 기존 작업이 없는 것으로 처리하지 않아요.
                <div>
                  <Button onClick={() => setRetried(true)}>다시 조회</Button>
                </div>
              </Notice>
            )}
            {scenario === 'unregistered' && (
              <Notice>
                <b>@new_sample · 미등록</b>
                <br />
                명부 등록이 필요해요. 이 목업에서는 실제 프로필 조회나 등록을 실행하지 않아요.
              </Notice>
            )}
            {scenario === 'empty' && (
              <Notice>
                <b>@mika_sample · 등록됨</b>
                <br />
                진행중 0건 · 아직 연결된 작업이 없어요.
              </Notice>
            )}
            {scenario === 'mismatch' && (
              <Notice danger>
                확인 필요 · 핸들은 같지만 숫자 ID가 달라요. 확인 전에는 작업을 연결하지 않아요.
              </Notice>
            )}
            {scenario === 'expired' && (
              <Notice danger>회사 계정 로그인이 만료됐어요. 실제 연동에서는 다시 로그인해야 해요.</Notice>
            )}
            {scenario === 'denied' && (
              <Notice danger>이 작업을 조회할 권한이 없어요. 담당자에게 접근 권한을 확인해 주세요.</Notice>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
