// 슬랙 봇 토큰 연동(스펙 2026-11-13 §6) — 이미지 업로드와 블록 메시지 전송. 불편 알리기(issueSlack.ts)는 웹훅이라 따로 둔다.
// 웹훅은 파일을 올릴 수 없어서, 이미지를 붙이는 메시지는 봇 토큰(chat:write, files:write, files:read)으로 보낸다.
// 토큰은 로그·오류 메시지에 절대 넣지 않는다.
import type { SlackBlock } from './campaignStatusSlack.ts';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
const API = 'https://slack.com/api';
const TIMEOUT_MS = 15_000;   // 호출 하나당 — 라우트 전체 60초 안에 업로드 3번 + 전송 재시도가 들어가게

export class SlackApiError extends Error {
  constructor(public method: string, public code: string) {
    super(`slack ${method} failed: ${code}`);
    this.name = 'SlackApiError';
  }
}

async function call(f: FetchLike, token: string, method: string, init: { query?: Record<string, string>; json?: unknown }): Promise<Record<string, unknown>> {
  const qs = init.query ? `?${new URLSearchParams(init.query)}` : '';
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  const res = await f(`${API}/${method}${qs}`, {
    method: init.json !== undefined ? 'POST' : 'GET', headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (body.ok !== true) throw new SlackApiError(method, String(body.error ?? `http_${res.status}`));
  return body;
}

// 채널에 공유하지 않은 앱 소유 파일로 올린다 — 같은 토큰으로 보내는 블록의 image(slack_file)가 이 파일을 쓴다
export async function uploadPrivateImage(
  token: string, png: ArrayBuffer, filename: string, title: string, f: FetchLike = fetch,
): Promise<string> {
  const up = await call(f, token, 'files.getUploadURLExternal', { query: { filename, length: String(png.byteLength) } });
  const put = await f(String(up.upload_url), { method: 'POST', body: new Uint8Array(png), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!put.ok) throw new SlackApiError('upload', `http_${put.status}`);
  await call(f, token, 'files.completeUploadExternal', { json: { files: [{ id: String(up.file_id), title }] } });
  return String(up.file_id);
}

// 올린 직후 파일이 아직 처리 중이면 invalid_blocks가 난다 — 그때만 잠깐 기다렸다 다시 보낸다
export async function postBlocks(
  token: string, channel: string, msg: { text: string; blocks: SlackBlock[] }, f: FetchLike = fetch,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<{ ts: string }> {
  const retries = opts.retries ?? 3, delayMs = opts.delayMs ?? 1500;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await call(f, token, 'chat.postMessage', { json: { channel, text: msg.text, blocks: msg.blocks, unfurl_links: false } });
      return { ts: String(r.ts) };
    } catch (e) {
      if (!(e instanceof SlackApiError) || e.code !== 'invalid_blocks' || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
