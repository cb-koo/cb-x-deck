'use client';
import { useState } from 'react';
import type { DemoTask } from '../model';
import { completed, money, settlementCandidate, validAmount } from '../policy';
import { Badge, Button, Field, Modal, Notice, Section, type DisclosureControl } from './shared';
export function TaskMoney({
  task,
  onChange,
  notify,
  disclosure,
}: {
  task: DemoTask;
  onChange: (task: DemoTask) => void;
  notify: (message: string) => void;
  disclosure?: DisclosureControl;
}) {
  const [amount, setAmount] = useState(task.amount),
    [currency, setCurrency] = useState(task.currency),
    [noCost, setNoCost] = useState(task.noCost),
    [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payment, setPayment] = useState(
    task.payment ?? { method: 'PayPal', holder: '', account: '', fee: '없음' },
  );
  const saved = amount === task.amount && currency === task.currency && noCost === task.noCost;
  const locked = !!task.end || completed(task);
  return (
    <Section
      title="예산 · 정산"
      id="task-money"
      disclosure={disclosure}
      actionLabel={locked ? '보기' : '관리'}
      aside={
        !disclosure && <span className="mock-muted">{money(task.amount, task.currency, task.noCost)}</span>
      }
      summary={
        <>
          <span>
            {money(task.amount, task.currency, task.noCost)} ·{' '}
            {task.end
              ? '종료'
              : task.noCost
                ? '정산 제외'
                : task.paid
                  ? '지급 완료'
                  : task.settlementActive
                    ? '정산 요청 중'
                    : '지급 전'}
          </span>
          {!task.noCost && !task.payment && !locked && <Badge tone="amber">결제 수단 미등록</Badge>}
          {!saved && <Badge tone="amber">금액 변경 미저장</Badge>}
          {error && <span className="mock-danger-text">{error}</span>}
        </>
      }
    >
      {!locked && (
        <>
          <div className="mock-cost-input">
            <Field label="금액">
              <input
                inputMode="numeric"
                value={amount}
                disabled={noCost || task.settlementActive}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="미등록"
              />
            </Field>
            <select
              aria-label="작업 통화"
              value={currency}
              disabled={noCost || task.settlementActive}
              onChange={(e) => setCurrency(e.target.value as DemoTask['currency'])}
            >
              <option value="JPY">엔</option>
              <option value="KRW">원</option>
            </select>
          </div>
          <label className="mock-check">
            <input
              type="checkbox"
              checked={noCost}
              disabled={task.settlementActive}
              onChange={(e) => setNoCost(e.target.checked)}
            />
            비용 없음
          </label>
          {saved && <small className="mock-cost-status">✓ 확정{noCost ? ' · 비용 없음' : ''}</small>}
          {task.settlementActive ? (
            <Notice>활성 정산 요청이 있어 비용 설정을 바꿀 수 없어요.</Notice>
          ) : (
            !saved && (
              <Button
                onClick={() => {
                  if (!validAmount(amount)) {
                    setError('금액은 0 이상의 정수로 입력해 주세요.');
                    return;
                  }
                  setError('');
                  onChange({ ...task, amount, currency, noCost });
                  notify('작업 금액을 샘플에 저장했어요.');
                }}
              >
                확인
              </Button>
            )
          )}
          {error && <Notice danger>{error}</Notice>}
        </>
      )}
      {!task.noCost && (
        <div className="mock-payment-section">
          <b>결제 수단</b>
          <div className="mock-payment-row">
            <div>
              {task.payment ? (
                <>
                  <span>
                    {task.payment.method} · {task.payment.holder}
                  </span>
                  <small>{task.payment.account}</small>
                </>
              ) : (
                <span className="mock-muted">등록된 결제 수단이 없어요.</span>
              )}
            </div>
            {task.payment && <Badge>수수료 부담 {task.payment.fee}</Badge>}
            {!locked && (
              <Button variant="ghost" onClick={() => setPaymentOpen(true)}>
                {task.payment ? '다른 수단 등록' : '결제 수단 등록'}
              </Button>
            )}
          </div>
        </div>
      )}
      {(task.type !== 'visit' || task.posted) && (
        <div className="mock-inline-summary">
          {task.type !== 'visit' && (
            <span>
              게시 확인 <b>{task.posted ? '완료' : '미확인'}</b>
            </span>
          )}
          <span>
            정산{' '}
            <b>
              {task.noCost
                ? '대상 제외'
                : task.paid
                  ? '지급 완료'
                  : task.settlementActive
                    ? '요청 중'
                    : settlementCandidate(task)
                      ? '후보'
                      : '게시 확인 전'}
            </b>
          </span>
        </div>
      )}
      {!locked && (
        <div className="mock-actions">
          {!task.posted && task.type !== 'visit' && (
            <Button
              onClick={() => {
                onChange({ ...task, posted: true });
                notify(
                  task.noCost
                    ? '게시를 확인해 비용 없는 작업을 완료했어요.'
                    : '게시를 확인했어요. 정산 후보에 포함돼요.',
                );
              }}
            >
              게시 확인
            </Button>
          )}
          {settlementCandidate(task) && (
            <Button
              variant={task.type === 'visit' ? 'primary' : 'subtle'}
              onClick={() => {
                onChange({ ...task, settlementActive: true });
                notify('샘플 정산을 요청했어요.');
              }}
            >
              정산 요청
            </Button>
          )}
          {task.settlementActive && !task.paid && (
            <Button
              variant={task.type === 'visit' ? 'primary' : 'subtle'}
              onClick={() => {
                onChange({ ...task, paid: true, settlementActive: false });
                notify('지급을 완료했어요.');
              }}
            >
              지급 완료
            </Button>
          )}
        </div>
      )}
      {paymentOpen && (
        <Modal title="결제 수단 등록" onClose={() => setPaymentOpen(false)}>
          <div className="mock-modal-body">
            <Field label="결제 수단">
              <select
                value={payment.method}
                onChange={(e) => setPayment({ ...payment, method: e.target.value })}
              >
                <option>PayPal</option>
                <option>계좌 이체</option>
              </select>
            </Field>
            <Field label="수취인">
              <input
                value={payment.holder}
                onChange={(e) => setPayment({ ...payment, holder: e.target.value })}
              />
            </Field>
            <Field label={payment.method === 'PayPal' ? 'PayPal 계정' : '은행·계좌번호'}>
              <input
                value={payment.account}
                onChange={(e) => setPayment({ ...payment, account: e.target.value })}
              />
            </Field>
            <Field label="수수료 부담">
              <select value={payment.fee} onChange={(e) => setPayment({ ...payment, fee: e.target.value })}>
                <option>없음</option>
                <option>클리닉</option>
                <option>인플루언서</option>
              </select>
            </Field>
          </div>
          <footer>
            <Button onClick={() => setPaymentOpen(false)}>돌아가기</Button>
            <Button
              variant="primary"
              disabled={!payment.holder.trim() || !payment.account.trim()}
              onClick={() => {
                onChange({ ...task, payment });
                setPaymentOpen(false);
              }}
            >
              등록
            </Button>
          </footer>
        </Modal>
      )}
      {completed(task) && (
        <Notice>{task.noCost ? '비용 없는 협찬 · 게시 확인으로 완료' : '게시 확인·지급 완료'}</Notice>
      )}
    </Section>
  );
}
