'use client';

import { createClient } from '@/lib/supabase/client';

export default function DeniedPage() {
  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">접근할 수 없어요</h1>
        <p className="mt-2 text-sm text-x-muted">
          cb-x-deck는 회사 계정(@clinicbridge.co.kr)으로만 사용할 수 있어요.
          다른 계정으로 로그인하려면 아래에서 로그아웃하세요.
        </p>
      </div>
      <button
        onClick={signOut}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5"
      >
        로그아웃
      </button>
    </main>
  );
}
