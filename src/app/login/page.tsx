'use client';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const signIn = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: 'clinicbridge.co.kr' }, // 구글 계정 선택 시 회사 도메인 힌트
      },
    });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-lg font-semibold">cb-x-deck</h1>
        <p className="mt-1 text-sm text-x-muted">회사 구글 계정으로 로그인하세요</p>
      </div>
      <button
        onClick={signIn}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5"
      >
        구글로 로그인
      </button>
    </main>
  );
}
