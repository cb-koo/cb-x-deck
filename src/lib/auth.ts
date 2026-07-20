export const ALLOWED_EMAIL_DOMAIN = 'clinicbridge.co.kr';

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === ALLOWED_EMAIL_DOMAIN;
}

type GateUser = {
  email?: string | null;
  app_metadata?: { provider?: string | null; providers?: string[] | null } | null;
};

// 도메인 검사만으로는 이메일/비밀번호 등 다른 provider 로 회사 도메인을 위조 가입해 통과할 수 있다.
// 구글 provider 여부까지 함께 확인해 이를 방어한다(defense-in-depth).
export function isAllowedUser(user: GateUser | null | undefined): boolean {
  if (!user) return false;
  if (!isAllowedEmail(user.email)) return false;
  const provider = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers ?? [];
  return provider === 'google' || providers.includes('google');
}
