'use client';
import { useState } from 'react';
import type { CampaignRow } from '@/lib/campaignStore';
import { normalizeTargetTweetUrl } from '@/lib/campaignTaskInput';
import { targetLabel } from '@/lib/campaignTableView';
import type { FlowRow } from '@/lib/campaignFlowView';
import { TargetPicker } from '../TargetPicker';

// 대상 칸(Task 9, 스펙 §4-2) — "그 게시물"은 언제나 링크 하나다. 어느 작업인지까지 고르면(체크 후
// TargetPicker) 그 작업이 게시 확인되는 순간 링크가 저절로 채워진다(useCampaignTaskActions.markPosted가
// target_task_id로 걸린 작업의 target_tweet_url을 대신 채우는 게 아니라, targetLabel이 target 조인을
// 다시 계산해 이 칸이 '게시됨' 상태를 그대로 반영한다 — 저장 값은 내부적으로 targetTaskId 하나뿐).
const URL_MESSAGE = 'X 게시물 주소가 아니에요 — x.com/계정/status/숫자 형식이어야 해요';
const input = 'h-10 w-full rounded-md border border-x-border-strong bg-white px-2.5 text-content outline-none focus:border-x-blue';
const card = 'mt-1.5 flex items-center gap-2 rounded-md border border-x-border-strong bg-x-surface px-3 py-2';
const changeBtn = 'shrink-0 text-ui text-x-secondary hover:underline';

export function TargetLinkField({ task, campaign, onChange }: {
  task: FlowRow;
  campaign: CampaignRow;
  onChange: (next: { taskId: string } | { url: string } | null) => void;
}) {
  const [text, setText] = useState(task.targetTweetUrl ?? '');
  const [err, setErr] = useState('');
  const [pending, setPending] = useState(false);   // "아직 게시 전인 글이에요" 체크 — 저장되지 않는 로컬 표시일 뿐(어느 작업인지 고르면 그때 저장된다)

  // 취소된 작업은 대상 칸도 읽기 전용이다(R18) — TaskPanel의 편집 칸 분기가 이미 이 칸을 그리지 않고
  // targetLabel로 직접 그려 주므로 여기까지 오지 않지만, 재사용 대비 같은 문구로 한 번 더 막는다.
  if (task.cancelledAt) {
    const tgt = targetLabel(task, campaign.id);
    return <span className={`text-content ${tgt.muted ? 'text-x-muted' : ''}`}>{tgt.text}{tgt.sub && ` · ${tgt.sub}`}</span>;
  }

  const tgt = targetLabel(task, campaign.id);

  // 대상 작업이 조인돼 있다 — 이미 정해진 대상. 상태는 셋(I3): 링크 있음(게시됨, 새 탭으로 열기) /
  // postedAt은 있는데 링크 없음(게시됐지만 링크가 아직 안 들어왔다 — 잠그지 않고 직접 넣을 수 있게 둔다,
  // "자동으로 채워진다"고 말하지 않는다 — 이 상태는 그 약속이 이미 어긋난 경우다) / 둘 다 없음(게시 확인 전,
  // 입력칸은 잠근 채로 — 대상 작업 쪽에서 정해진다).
  if (task.target) {
    const linked = !!task.target.postUrl;
    const postedNoLink = !linked && !!task.target.postedAt;
    return (
      <div>
        {task.target.postUrl ? (
          <a href={task.target.postUrl} target="_blank" rel="noreferrer"
             className={`${input} flex items-center text-x-blue-text hover:underline`}>
            {task.target.postUrl.replace(/^https?:\/\//, '')} ↗
          </a>
        ) : postedNoLink ? (
          // commit()이 onChange({ url })을 부른다 — "그 게시물은 언제나 링크 하나"(파일 상단 주석) 원칙대로
          // 대상 작업 참조(targetTaskId)를 이 링크로 바꿔치기한다(actions.changeTarget이 targetTaskId를
          // null로 함께 보낸다). 대상 작업 자체의 링크를 대신 채워 주는 게 아니다 — 이 작업만 링크를 갖는다.
          <input value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} onBlur={commit}
                 onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commit(); } }}
                 placeholder="https://x.com/계정/status/…" className={input} />
        ) : (
          <input value="" disabled placeholder="게시 확인 전" className={input} />
        )}
        {postedNoLink && err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
        <div className={card}>
          <span className="min-w-0 flex-1 truncate text-content">
            {tgt.text}
            <span className="text-x-muted">{linked ? ' · 게시됨' : postedNoLink ? ' · 게시됨 · 링크 없음' : ' · 게시 확인 전'}</span>
            {tgt.sub && <span className="text-x-muted"> · {tgt.sub}</span>}
            {/* 대상 작업이 취소됐으면 알리고 바꾸기를 권한다(결정 3) — 표의 문구와 같은 뜻 */}
            {task.target.cancelledAt && <span className="text-red-600"> · 대상 작업 취소됨</span>}
          </span>
          {/* text도 같이 비운다 — 안 그러면 이 작업이 원래 targetTweetUrl을 갖고 있던 상태에서 마운트된 뒤
              대상 작업으로 바꿨다가 다시 [바꾸기]로 돌아올 때, 입력칸에 그 옛 링크가 남아 블러 한 번에
              되살아난다(대상 비우기 버튼과 같은 이유로 같은 처리). */}
          <button type="button" onClick={() => { onChange(null); setText(''); }} className={changeBtn}>바꾸기</button>
        </div>
      </div>
    );
  }

  // 대상 작업 참조는 있는데 아직 조인되지 않았다 — 방금 고른 직후(낙관적 갱신, 응답 전) 또는 그 작업이
  // 지워진 경우. 어느 쪽이든 입력 모드로 떨어지면 잠깐이라도 빈 칸처럼 보여 사용자가 다시 골라야 하는
  // 것처럼 보인다 — targetLabel의 '대상 게시 대기' 문구를 그대로 쓴다.
  if (task.targetTaskId) {
    return (
      <div>
        <input value="" disabled placeholder="대상 확인 중…" className={input} />
        <div className={card}>
          <span className="min-w-0 flex-1 truncate text-x-muted">{tgt.text}</span>
          <button type="button" onClick={() => { onChange(null); setText(''); }} className={changeBtn}>바꾸기</button>
        </div>
      </div>
    );
  }

  // 링크 입력 모드 — targetTweetUrl이 있으면 그 값으로 채워 보여준다(현재 값 표시). 없으면 빈 칸.
  function commit() {
    const v = text.trim();
    if (!v) { setErr(''); return; }   // 빈 칸으로 블러는 비우기가 아니다 — [대상 비우기]만 비운다
    if (v === (task.targetTweetUrl ?? '')) { setErr(''); return; }   // 값이 그대로면 다시 보내지 않는다
    const u = normalizeTargetTweetUrl(v);
    if (!u) { setErr(URL_MESSAGE); return; }
    setErr('');
    setText(u);
    onChange({ url: u });
  }

  return (
    <div>
      <input value={text} onChange={(e) => { setText(e.target.value); setErr(''); }} onBlur={commit}
             onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commit(); } }}
             placeholder="https://x.com/계정/status/…" className={input} />
      {err && <p role="alert" className="mt-1 text-ui text-red-600">{err}</p>}
      {task.targetTweetUrl && (
        <button type="button" onClick={() => { onChange(null); setText(''); }} className="mt-1 text-ui text-x-secondary hover:underline">대상 비우기</button>
      )}
      <label className="mt-2 flex items-center gap-2 text-ui text-x-secondary">
        <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />
        아직 게시 전인 글이에요 — 링크는 나중에
      </label>
      {pending && (
        <div className="mt-2">
          <p className="text-ui text-x-secondary">어느 작업인가요?</p>
          <div className="mt-1">
            <TargetPicker value={null} clientId={campaign.clientId} campaignId={campaign.id} excludeTaskId={task.id}
                          onChange={(n) => { if (n && 'taskId' in n) onChange({ taskId: n.taskId }); }} />
          </div>
          {/* 체크만 하고 작업을 안 고르면 저장할 칸이 없다(스키마를 안 바꾼다) — 다시 열면 '미정'으로 보인다는
              한계를 여기서 한 줄로, 사실대로 알린다(M5 — 저장된다고 말하지 않는다). */}
          <p className="mt-1 text-caption text-x-muted">어느 작업인지 고르면 기억해요 — 체크만 하면 저장되지 않아요</p>
        </div>
      )}
    </div>
  );
}
