'use client';
import { useState } from 'react';
import { parseTweetLink, tweetLinkParseMessage } from '@/lib/tweetLink';
import type { DemoTask } from '../model';
import { changedAt, stage } from '../policy';
import { Button, Notice, Section, type DisclosureControl } from './shared';

export function TaskPosting({
  task,
  onChange,
  disclosure,
  notify,
}: {
  task: DemoTask;
  onChange: (task: DemoTask) => void;
  disclosure?: DisclosureControl;
  notify: (message: string) => void;
}) {
  const [url, setUrl] = useState(task.postUrl ?? '');
  const [error, setError] = useState('');
  function confirmPost() {
    if (task.end || task.posted) return;
    const parsed = parseTweetLink(url);
    if (!parsed.ok) {
      setError(tweetLinkParseMessage(parsed.reason));
      return;
    }
    const address = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    address.protocol = 'https:';
    onChange({ ...task, posted: true, postUrl: address.href, postedAt: new Date().toISOString() });
    setError('');
    notify(
      task.noCost ? '게시를 확인해 비용 없는 작업을 완료했어요.' : '게시를 확인했어요. 정산 후보에 포함돼요.',
    );
  }
  return (
    <Section
      title="게시"
      id="task-posting"
      disclosure={disclosure}
      actionLabel={task.posted || task.end ? '보기' : '링크 입력'}
      summary={
        <>
          <span>
            {task.end ? `${task.end.kind} · 게시 종료` : task.posted ? '게시 확인 완료' : '게시물 미등록'}
          </span>
          {error && <span className="mock-danger-text">{error}</span>}
        </>
      }
    >
      {task.end ? (
        <p className="mock-muted">
          {task.end.kind} · {task.end.reason}
        </p>
      ) : task.posted ? (
        <div className="mock-posted-result">
          <span>✓ 게시 확인{task.postedAt ? ` · ${changedAt(task.postedAt)}` : ''}</span>
          {task.postUrl && (
            <a className="mock-profile-link" href={task.postUrl} target="_blank" rel="noreferrer">
              게시물 보기 ↗
            </a>
          )}
        </div>
      ) : (
        <>
          <form
            className="mock-posting-form"
            onSubmit={(e) => {
              e.preventDefault();
              confirmPost();
            }}
          >
            <input
              aria-label="게시물 링크"
              placeholder="게시물 링크 붙여넣기 (https://x.com/.../status/...)"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError('');
              }}
            />
            <Button
              type="submit"
              variant={stage(task) === '방문' ? 'primary' : 'subtle'}
              disabled={!url.trim()}
            >
              게시 확인
            </Button>
          </form>
          {error && <Notice danger>{error}</Notice>}
        </>
      )}
    </Section>
  );
}
