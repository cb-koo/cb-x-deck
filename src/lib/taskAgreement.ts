// 방문협찬 협찬 동의서 — 브라우저에서 앱 밖으로 나가는/들어오는 경로(업로드·서명·보기)와 그 경로가 쓰는 순수 규칙.
// 경로·모양 규칙 자체는 taskAgreementGuard가 갖는다(서버와 공유). taskProof.ts와 나란히 두고 재사용하지 않는다 —
// 버킷·허용 형식(PDF)·보기 방식(새 탭)이 다르다.
import { createClient } from './supabase/client.ts';
import {
  ALLOWED_TASK_AGREEMENT_MIME, MAX_TASK_AGREEMENT_BYTES, TASK_AGREEMENT_EXTENSIONS, TASK_AGREEMENT_NAME_MAX,
  type TaskAgreementInput,
} from './taskAgreementGuard.ts';

export const TASK_AGREEMENT_BUCKET = 'task-agreement';
export { MAX_TASK_AGREEMENT_BYTES, ALLOWED_TASK_AGREEMENT_MIME };
// <input accept> — 고르는 창에서부터 허용 형식만 보이게
export const TASK_AGREEMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';

const MIME_EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

// ── 검증 (순수) ──
export function taskAgreementValidationError(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_TASK_AGREEMENT_MIME as readonly string[]).includes(file.type)) {
    return '형식을 지원하지 않아요(PDF·jpg·png만 올릴 수 있어요)';
  }
  if (file.size > MAX_TASK_AGREEMENT_BYTES) return '10MB를 넘어요 — 크기를 줄여서 다시 올려주세요';
  if (file.size <= 0) return '빈 파일이에요 — 다른 파일을 골라주세요';
  return null;
}

// 저장 경로의 확장자 — 파일 이름의 확장자가 허용 목록에 있으면 그걸, 아니면 형식에서 정한다
export function agreementExtension(file: { name: string; type: string }): string {
  const i = file.name.lastIndexOf('.');
  const ext = i >= 0 ? file.name.slice(i + 1).toLowerCase() : '';
  return (TASK_AGREEMENT_EXTENSIONS as readonly string[]).includes(ext) ? ext : (MIME_EXT[file.type] ?? 'pdf');
}

// 붙여 넣은 동의서의 이름(koo 10-01) — 클립보드 이미지는 브라우저가 'image.png' 같은 이름을 줘서 무엇인지 안 읽힌다.
// '동의서_@핸들_YYYYMMDD.확장자'(today는 서울 날짜 YYYY-MM-DD — 부모가 kstToday로 넘긴다), 핸들이 없으면 '동의서_YYYYMMDD'.
// 확장자는 형식에서(허용 밖 형식이면 확장자 없이 — 올리기 전 검증이 먼저 거른다). 끌어다 놓기·파일 고르기는 원래 이름을 쓴다.
export function agreementPasteName(handle: string | null, today: string, mime: string): string {
  const h = (handle ?? '').trim().replace(/^@+/, '');
  const ext = MIME_EXT[mime];
  return `동의서_${h ? `@${h}_` : ''}${today.replaceAll('-', '')}${ext ? `.${ext}` : ''}`;
}

// 표시할 파일명 — 너무 긴 이름은 서버가 거절하므로(TASK_AGREEMENT_NAME_MAX) 확장자를 살려 앞을 자른다
export function agreementDisplayName(name: string): string {
  const n = name.trim() || '협찬 동의서';
  if (n.length <= TASK_AGREEMENT_NAME_MAX) return n;
  const i = n.lastIndexOf('.');
  const ext = i > 0 && n.length - i <= 6 ? n.slice(i) : '';
  return n.slice(0, TASK_AGREEMENT_NAME_MAX - ext.length - 1) + '…' + ext;
}

// ── 업로드 ──
// task-agreement 버킷에 올리고, PATCH에 보낼 값({경로·이름·크기·형식})을 돌려준다. 올린 사람·시각은 서버가 붙인다.
export async function uploadTaskAgreement(taskId: string, file: File): Promise<TaskAgreementInput> {
  const err = taskAgreementValidationError(file);
  if (err) throw new Error(err);
  const path = `task/${taskId}/${crypto.randomUUID()}.${agreementExtension(file)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(TASK_AGREEMENT_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('올리지 못했어요 — 다시 시도해주세요');
  return { path, name: agreementDisplayName(file.name), size: file.size, mime: file.type };
}

// ── 서명 ──
export async function signTaskAgreementUrl(path: string, expiresIn = 300): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(TASK_AGREEMENT_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error('파일 링크를 만들지 못했어요 — 다시 시도해주세요');
  return data.signedUrl;
}

// ── 보기(새 탭) ──
// 창을 먼저(클릭 제스처 안에서) 열고 서명 URL을 나중에 넣는다 — 서명을 기다린 뒤 window.open하면 Safari가
// 팝업으로 막는다. 서명은 클릭 때마다 새로 받는다(렌더 때 받은 URL은 만료된 채 조용히 실패한다).
export async function openTaskAgreement(path: string): Promise<void> {
  const w = window.open('', '_blank');
  // 팝업이 막혔으면 같은 탭으로 가지 않는다 — 패널에서 하던 편집이 사라진다
  if (!w) throw new Error('새 탭을 열지 못했어요 — 브라우저의 팝업 차단을 풀어 주세요');
  try {
    const url = await signTaskAgreementUrl(path);
    w.opener = null;
    w.location.href = url;
  } catch (e) {
    w.close();
    throw e;
  }
}
