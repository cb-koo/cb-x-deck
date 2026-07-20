export const ALLOWED_EMAIL_DOMAIN = 'clinicbridge.co.kr';

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}
