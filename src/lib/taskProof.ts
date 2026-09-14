// RT 증빙 스크린샷 — 브라우저에서 앱 밖으로 나가는/들어오는 경로(업로드·서명·내려받기)와
// 그 경로가 쓰는 순수 규칙(검증·파일명). 경로 규칙 자체는 taskProofGuard가 갖는다(서버와 공유).
// draftMedia.ts와 나란히 두고 재사용하지 않는다 — 상한·형식·경로·파일명 규칙이 전부 다르다.
import { createClient } from './supabase/client.ts';
import { TASK_PROOF_EXTENSIONS } from './taskProofGuard.ts';

export const TASK_PROOF_BUCKET = 'task-proof';

// 마이그레이션 044의 버킷 file_size_limit과 반드시 같은 값 — 여기서 통과시킨 파일이 서버에서
// 거절되면 "골라서 바로 알았다"가 깨진다.
export const MAX_TASK_PROOF_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TASK_PROOF_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// 파일명 금지문자(Windows·macOS 공통) → 밑줄. 핸들은 자유 입력이라 섞일 수 있다.
const FORBIDDEN_CHARS_RE = /[/\\:*?"<>|]/g;

// ── 검증 (순수) ──
export function taskProofValidationError(file: File): string | null {
  if (!ALLOWED_TASK_PROOF_MIME.includes(file.type as (typeof ALLOWED_TASK_PROOF_MIME)[number])) {
    return '형식을 지원하지 않아요(jpg·png·webp만 올릴 수 있어요)';
  }
  if (file.size > MAX_TASK_PROOF_BYTES) return '10MB를 넘어요 — 크기를 줄여서 다시 올려주세요';
  return null;
}

// ── 파일명 (순수) ──
function extensionOf(pathOrName: string): string {
  const last = pathOrName.split('/').pop() ?? '';
  const i = last.lastIndexOf('.');
  if (i < 0 || i === last.length - 1) return '';
  const ext = last.slice(i + 1).toLowerCase();
  return (TASK_PROOF_EXTENSIONS as readonly string[]).includes(ext) ? ext : '';
}

// <게시일YYYYMMDD>_<핸들|미배정>_RT증빙.<확장자> — 게시일이 없으면 날짜를 빼고 핸들부터.
export function taskProofFilename(i: { postedAt: string | null; influencerHandle: string | null; url: string }): string {
  const name = (i.influencerHandle || '미배정').replace(/^@/, '').replace(FORBIDDEN_CHARS_RE, '_');
  const date = i.postedAt ? `${i.postedAt.replace(/-/g, '')}_` : '';
  return `${date}${name}_RT증빙.${extensionOf(i.url) || 'png'}`;
}

// ── 업로드 ──
function extensionForFile(file: File): string {
  return extensionOf(file.name) || MIME_EXT[file.type] || 'png';
}

// task-proof 버킷에 올리고 스토리지 경로를 돌려준다. 절대 URL이 아니다 — 비공개 버킷이라
// 표시·내려받기 모두 그때그때 서명 URL을 새로 받는다.
export async function uploadTaskProof(taskId: string, file: File): Promise<string> {
  const err = taskProofValidationError(file);
  if (err) throw new Error(err);
  const path = `task/${taskId}/${crypto.randomUUID()}.${extensionForFile(file)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(TASK_PROOF_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('올리지 못했어요 — 다시 시도해주세요');
  return path;
}

// ── 서명 ──
export async function signTaskProofUrl(path: string, expiresIn = 3600): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(TASK_PROOF_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error('이미지 링크를 만들지 못했어요 — 다시 시도해주세요');
  return data.signedUrl;
}

// ── 내려받기 ──
// 서명 URL을 클릭 시점에 새로 받는다 — 렌더 때 받은 URL을 재사용하면 만료된 채 조용히 실패한다.
export async function downloadTaskProof(path: string, filename: string): Promise<void> {
  const signed = await signTaskProofUrl(path, 60);
  const res = await fetch(signed);
  if (!res.ok) throw new Error('이미지를 받지 못했어요 — 다시 시도해주세요');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke를 미룬다 — click() 직후 동기로 걷으면 다운로드가 blob을 읽기 전에 무효화되어 저장이
  // 간헐적으로 끊긴다(draftMedia에서 리뷰로 잡힌 것과 같은 함정).
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}
