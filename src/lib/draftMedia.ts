// 초안 이미지 첨부 — 업로드·검증·파일명·다운로드·복사 (설계 §C·§G).
// 표시(서명 URL 발급·MediaGrid 오버레이)는 이 파일 소관이 아니다 — 여기는 앱 밖으로
// 나가는/들어오는 경로(업로드·다운로드·복사)와 그 경로가 쓰는 순수 규칙(파일명·검증)만 둔다.
import { createClient } from './supabase/client.ts';
import type { DeckMedia } from './types.ts';
import { variantLabel } from './draftUi.ts';
import { kstDate } from './datetime.ts';

export const DRAFT_MEDIA_BUCKET = 'draft-media';

// 버킷 file_size_limit(마이그레이션 024)과 반드시 같은 값이어야 한다 — 여기서 통과시킨 파일이
// 서버에서 거절되면 "골라서 바로 알았다"는 원칙(§C)이 깨진다.
export const MAX_DRAFT_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_DRAFT_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const MAX_MEDIA_PER_POST = 4;

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};

// 파일명 금지문자(Windows·macOS 공통 기준) → 밑줄. 핸들·클라이언트명은 자유 입력이라 섞일 수 있다.
const FORBIDDEN_CHARS_RE = /[/\\:*?"<>|]/g;

// ─────────────────────────── 검증 (순수) ───────────────────────────

// 형식·용량 검사. 문제 없으면 null — 오류 문구는 설계 §C에 있는 그대로다(사용자 언어, AGENTS 원칙 1).
export function draftImageValidationError(file: File): string | null {
  if (!ALLOWED_DRAFT_IMAGE_MIME.includes(file.type as (typeof ALLOWED_DRAFT_IMAGE_MIME)[number])) {
    return '형식을 지원하지 않아요(jpg·png·gif·webp만 올릴 수 있어요)';
  }
  if (file.size > MAX_DRAFT_IMAGE_BYTES) {
    return '5MB를 넘어요 — 크기를 줄여서 다시 올려주세요';
  }
  return null;
}

export interface DraftImageRejection { file: File; reason: string }

export interface DraftImageSelection {
  accepted: File[];
  rejected: DraftImageRejection[];
  // 자리가 모자라 일부만 받았을 때만 값 — 형식/용량 거절만 있으면 null(자리 문제가 아니므로 §E 사후 통보 문구를 안 띈다).
  slotMessage: string | null;
}

// 남는 자리보다 많이 넣으면 앞에서부터 채우고 나머지는 사유를 돌려준다(설계 §C).
// 형식/용량이 안 맞는 파일은 자리 계산에서 먼저 빠진다 — 자리를 차지할 자격이 없다.
export function selectDraftImages(files: File[], remainingSlots: number): DraftImageSelection {
  const rejected: DraftImageRejection[] = [];
  const valid: File[] = [];
  for (const file of files) {
    const reason = draftImageValidationError(file);
    if (reason) rejected.push({ file, reason });
    else valid.push(file);
  }
  const cap = Math.max(0, remainingSlots);
  const accepted = valid.slice(0, cap);
  const overflow = valid.slice(cap);
  for (const file of overflow) {
    rejected.push({ file, reason: `트윗당 ${MAX_MEDIA_PER_POST}장까지예요` });
  }
  const slotMessage = overflow.length > 0
    ? `${accepted.length}장만 넣었어요 — 트윗당 ${MAX_MEDIA_PER_POST}장까지예요`
    : null;
  return { accepted, rejected, slotMessage };
}

// ─────────────────────────── 확장자 (순수) ───────────────────────────

// 스토리지 경로/URL에서 확장자만 뽑는다. 파일명 조립과 GIF 판별이 공유한다.
// 못 찾으면 빈 문자열 — 호출부가 판단(파일명에서는 그대로 비어도 무해, GIF 판별에서는 false가 된다).
export function draftMediaExtension(storageUrl: string): string {
  const last = storageUrl.split('/').pop() ?? '';
  const i = last.lastIndexOf('.');
  if (i < 0 || i === last.length - 1) return '';
  return last.slice(i + 1).toLowerCase();
}

// 클립보드 복사는 GIF에 안 그린다(캔버스를 거치면 움직임이 죽는다, 설계 §G) — 호출부가
// 복사 버튼을 그릴지 판단하는 자리에 쓴다.
export function isGifDraftMedia(storageUrl: string): boolean {
  return draftMediaExtension(storageUrl) === 'gif';
}

// ─────────────────────────── 파일명 (순수, 이 작업의 핵심) ───────────────────────────

export interface DraftMediaFilenameInput {
  createdAt: string;                 // 초안 생성일(ISO) — 다운로드일이 아니다(설계 §G)
  influencerHandle: string | null;   // '@' 없이 저장된 값. null = 미배정
  clientName: string | null;         // 미배정일 때의 대체값
  batchId: string | null;            // 다중 시안 묶음. null이면 시안 라벨을 넣지 않는다
  variantIndex: number | null;       // batchId가 있을 때만 의미 있음(A/B/C…)
  postIndex: number;                 // 0부터 — 트윗번호는 +1
  mediaIndex: number;                // 0부터 — 이미지순번은 +1
  storageUrl: string;                // DeckMedia.url — 확장자 추출용
}

// 금지문자를 밑줄로, 핸들의 '@'는 제거.
function sanitizeNamePart(raw: string): string {
  return raw.replace(/^@/, '').replace(FORBIDDEN_CHARS_RE, '_');
}

// <생성일YYYYMMDD>_<핸들|클라이언트명>[_<시안>]_<트윗번호>-<이미지순번>.<확장자> (설계 §G)
export function draftMediaFilename(input: DraftMediaFilenameInput): string {
  const date = kstDate(input.createdAt).replace(/-/g, ''); // 한국 기준 생성일, 다운로드 시점과 무관
  // 배정 없으면 클라이언트명, 그마저 없으면 화면에서 쓰는 것과 같은 '미배정' — 빈 세그먼트로 두지 않는다.
  const rawName = input.influencerHandle || input.clientName || '미배정';
  const namePart = sanitizeNamePart(rawName);
  const variantPart = input.batchId !== null ? `_${variantLabel(input.variantIndex ?? 0)}` : '';
  const tweetNo = input.postIndex + 1;   // 단문도 1-1로 통일 — 트윗번호/이미지순번 구분이 항상 되게
  const imageNo = input.mediaIndex + 1;
  const ext = draftMediaExtension(input.storageUrl) || 'jpg';
  return `${date}_${namePart}${variantPart}_${tweetNo}-${imageNo}.${ext}`;
}

// ─────────────────────────── 업로드 ───────────────────────────

function extensionForFile(file: File): string {
  const fromName = draftMediaExtension(file.name);
  if (fromName) return fromName;
  return MIME_EXT[file.type] ?? 'jpg';
}

// draft-media 버킷에 업로드하고 DeckMedia를 돌려준다. url은 절대 URL이 아니라 스토리지 경로다(설계 §B) —
// 비공개 버킷이라 표시·다운로드 모두 나중에 서명 URL을 새로 발급받아야 한다.
export async function uploadDraftImage(draftId: string, file: File): Promise<DeckMedia> {
  const validationError = draftImageValidationError(file);
  if (validationError) throw new Error(validationError);

  const path = `draft/${draftId}/${crypto.randomUUID()}.${extensionForFile(file)}`;
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(DRAFT_MEDIA_BUCKET)
    .upload(path, file, { contentType: file.type });
  if (error) throw new Error('업로드에 실패했어요 — 다시 시도해주세요');

  return { type: 'photo', url: path, videoUrl: null };
}

// 원고가 생기기 전에 올린다(캠페인 v2 직접 쓰기, §5-2) — X에서처럼 이미지를 고르는 순간 올라가고
// [저장하고 붙이기] 한 번으로 본문과 함께 저장된다. 경로의 앞부분(pending)은 표시·다운로드 어디서도
// 되읽지 않는다. draftMediaGuard.STORAGE_PATH_RE가 이 접두어를 알고 있어야 저장 후 PATCH 편집(다시
// 쓰기·이미지 편집)에서 거절되지 않는다 — draftMediaGuard.ts에서 함께 허용한다.
// 저장하지 않고 떠나면 올라간 파일이 남는다 — 원고에서 이미지를 뗐을 때와 같은 성질이라 같은 수준으로 둔다.
export async function uploadPendingDraftImage(file: File): Promise<DeckMedia> {
  const validationError = draftImageValidationError(file);
  if (validationError) throw new Error(validationError);
  const path = `draft/pending/${crypto.randomUUID()}.${extensionForFile(file)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from(DRAFT_MEDIA_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('업로드에 실패했어요 — 다시 시도해주세요');
  return { type: 'photo', url: path, videoUrl: null };
}

// ─────────────────────────── 다운로드 ───────────────────────────

// 서명 URL을 클릭 시점에 새로 발급받는다 — 렌더 때 받은 URL을 재사용하면 만료된 채로
// 조용히 실패한다(설계 §D). 60초짜리면 충분하다: 발급 즉시 fetch한다.
async function signDraftMediaUrl(storagePath: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(DRAFT_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !data?.signedUrl) throw new Error('이미지 링크를 만들지 못했어요 — 다시 시도해주세요');
  return data.signedUrl;
}

// Blob → object URL → <a download>. blob이므로 파일명이 그대로 적용된다(설계 §G).
export async function downloadDraftImage(storagePath: string, filename: string): Promise<void> {
  const signedUrl = await signDraftMediaUrl(storagePath);
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error('이미지를 받지 못했어요 — 다시 시도해주세요');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke는 미룬다 — click() 직후 동기로 걷으면 다운로드가 blob URL을 읽기 전에 무효화되어
  // 저장이 간헐적으로 끊긴다(특히 Firefox, 리뷰 발견). 10초면 로컬 blob 읽기에는 차고 넘친다.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

// ─────────────────────────── 클립보드 복사 ───────────────────────────

// 브라우저가 클립보드 이미지로 PNG만 받아서 jpg는 캔버스를 거쳐 변환한다(화질 손실 없음, 설계 §G).
// 호출부는 isGifDraftMedia로 GIF를 미리 걸러 이 함수를 부르지 않아야 한다 — 캔버스를 거치면 움직임이 죽는다.
async function toPngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 변환하지 못했어요');
  ctx.drawImage(bitmap, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 변환하지 못했어요'))), 'image/png');
  });
}

export async function copyDraftImageToClipboard(storagePath: string): Promise<void> {
  // clipboard.write를 첫 await '앞'에서 호출한다 — Safari는 클릭에서 비롯된 transient user activation이
  // 살아 있는 동안에만 클립보드 쓰기를 허용해서, 서명·fetch·변환(수백 ms~수 초)을 기다린 뒤 쓰면
  // NotAllowedError로 항상 거부된다(리뷰 발견). ClipboardItem에 Promise를 담아 동기적으로 write를
  // 시작해 두면 활성화가 유지된 채 데이터만 나중에 채워진다. Chrome도 같은 형태를 지원한다.
  const pngPromise = (async () => {
    const signedUrl = await signDraftMediaUrl(storagePath);
    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error('이미지를 가져오지 못했어요 — 다시 시도해주세요');
    const blob = await res.blob();
    return blob.type === 'image/png' ? blob : await toPngBlob(blob);
  })();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })]);
}
