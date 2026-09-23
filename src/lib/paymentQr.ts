// PayPay 수취 QR 이미지의 저장소 접근(스펙 2026-09-22 §1). task-proof(src/lib/taskProof.ts)와 같은 구조다.
// 비공개 버킷이라 표시·전달 모두 그때그때 서명 URL을 새로 받는다 — DB에는 경로만 남긴다.
import { createClient as createBrowserClient } from './supabase/client.ts';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { ALLOWED_PAYMENT_QR_MIME, MAX_PAYMENT_QR_BYTES } from './paymentQrInput.ts';

export const PAYMENT_QR_BUCKET = 'payment-qr';
export { ALLOWED_PAYMENT_QR_MIME, MAX_PAYMENT_QR_BYTES };

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function paymentQrValidationError(file: File): string | null {
  if (!(ALLOWED_PAYMENT_QR_MIME as readonly string[]).includes(file.type)) return 'QR 이미지는 JPG·PNG·WebP만 돼요';
  if (file.size > MAX_PAYMENT_QR_BYTES) return 'QR 이미지는 5MB까지예요';
  return null;
}

export function paymentQrExtension(contentType: string): string {
  return MIME_EXT[contentType] ?? 'png';
}

function qrPath(influencerId: string, ext: string): string {
  return `${influencerId}/${crypto.randomUUID()}.${ext}`;
}

// 이 저장소에 서버 전용 Storage 클라이언트가 아직 없다(taskProof의 외부 API 라우트가 즉석으로
// 만드는 것과 같은 사정 — src/app/api/external/settlement/requests/[id]/proof/route.ts 주석 참고).
// 호출마다 새로 만든다 — 전역 인스턴스를 두지 않는다.
//
// uploadPaymentQrBytes·downloadPaymentQrBytes는 우리 사용자의 로그인 세션이 없는 자리에서 불린다
// (uploadPaymentQrBytes는 정정 API — 그쪽이 베어러 키로 부르는 외부 라우트, downloadPaymentQrBytes는
// 그쪽에 바이트를 흘려보내는 외부 라우트). storage.objects의 RLS 정책(마이그레이션 059)은
// `to authenticated`만 허용하므로 로그인 세션이 없는 anon 키 클라이언트로는 통과하지 못한다.
// 그래서 이 둘은 taskProof.ts의 브라우저 클라이언트 대신, 같은 파일이 이미 쓰는 서비스 롤 관리자
// 클라이언트로 RLS를 우회한다. uploadPaymentQr·signPaymentQrUrl은 화면(로그인 세션이 있는 브라우저)
// 에서 불리므로 taskProof.ts와 같은 브라우저 클라이언트를 그대로 쓴다.
function adminClient() {
  return createAdminClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// 화면에서 고른 파일을 올린다. 경로를 돌려준다(절대 URL이 아니다).
export async function uploadPaymentQr(influencerId: string, file: File): Promise<string> {
  const err = paymentQrValidationError(file);
  if (err) throw new Error(err);
  const path = qrPath(influencerId, paymentQrExtension(file.type));
  const supabase = createBrowserClient();
  const { error } = await supabase.storage.from(PAYMENT_QR_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error('올리지 못했어요 — 다시 시도해주세요');
  return path;
}

// 서버가 바이트를 직접 올린다(정정 API — 그쪽이 베어러 키로 부르는 외부 라우트, 로그인 세션 없음).
// File을 만들 수 없는 자리라 따로 둔다.
export async function uploadPaymentQrBytes(influencerId: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const path = qrPath(influencerId, paymentQrExtension(contentType));
  const supabase = adminClient();
  const { error } = await supabase.storage.from(PAYMENT_QR_BUCKET).upload(path, bytes, { contentType });
  if (error) throw new Error('올리지 못했어요 — 다시 시도해주세요');
  return path;
}

// 비공개 버킷이라 표시할 때마다 새로 서명한다.
export async function signPaymentQrUrl(path: string, expiresIn = 3600): Promise<string> {
  const supabase = createBrowserClient();
  const { data, error } = await supabase.storage.from(PAYMENT_QR_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) throw new Error('이미지 링크를 만들지 못했어요 — 다시 시도해주세요');
  return data.signedUrl;
}

// 그쪽에 흘려보낼 바이트. 파일이 없으면 null(라우트가 404 storage-miss로 바꾼다).
// taskProof.ts의 downloadTaskProof(브라우저에서 파일로 내려받기, void 반환)와는 용도가 다르다 —
// 여기는 서버가 바이트를 받아 HTTP 응답 본문으로 흘려보내기 위한 것이라, task-proof 외부 라우트의
// 로컬 downloadTaskProof(같은 파일 route.ts)와 같은 모양({ body, contentType } | null)으로 맞춘다.
export async function downloadPaymentQrBytes(path: string): Promise<{ body: ReadableStream; contentType: string } | null> {
  const supabase = adminClient();
  const { data, error } = await supabase.storage.from(PAYMENT_QR_BUCKET).download(path);
  if (error || !data) return null;
  const contentType = data.type || 'application/octet-stream';
  return { body: data.stream(), contentType };
}
