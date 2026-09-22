// 정산 쪽이 정정 API로 보내는 QR을 해석한다(스펙 §3 받기). data URI만 받는다 — 외부 URL을 받으면
// 우리가 남의 서버로 요청을 보내게 되고(SSRF), 그 서버가 죽으면 정정이 실패한다.
// 순수 함수로 둔 이유: 저장소·DB 없이 테스트할 수 있어야 한다.
export const MAX_PAYMENT_QR_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PAYMENT_QR_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PaymentQrMime = (typeof ALLOWED_PAYMENT_QR_MIME)[number];

const MIME_LABEL = 'JPG·PNG·WebP';
const DATA_URI_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

export function parseQrDataUri(value: string): { bytes: Uint8Array; contentType: PaymentQrMime } | { error: string } {
  const m = DATA_URI_RE.exec(value.trim());
  if (!m) return { error: `QR 이미지는 data URI(base64)로 보내 주세요 — 예: data:image/png;base64,…` };
  const mime = m[1].toLowerCase();
  if (!(ALLOWED_PAYMENT_QR_MIME as readonly string[]).includes(mime)) {
    return { error: `QR 이미지는 ${MIME_LABEL}만 돼요 — 받은 형식: ${mime}` };
  }
  // base64는 4글자가 3바이트다 — 디코드 전에 크기를 가늠해 큰 값을 일찍 쳐낸다(메모리 보호).
  const b64 = m[2].replace(/\s+/g, '');
  if ((b64.length * 3) / 4 > MAX_PAYMENT_QR_BYTES) {
    return { error: `QR 이미지는 5MB까지예요` };
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return { error: 'QR 이미지를 읽지 못했어요 — base64 값을 확인해 주세요' };
  }
  if (buf.length === 0) return { error: 'QR 이미지가 비어 있어요' };
  if (buf.length > MAX_PAYMENT_QR_BYTES) return { error: `QR 이미지는 5MB까지예요` };
  return { bytes: new Uint8Array(buf), contentType: mime as PaymentQrMime };
}
