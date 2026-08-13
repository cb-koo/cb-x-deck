'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function LoginContent() {
  const searchParams = useSearchParams();
  const hasError = searchParams.get('error') !== null;
  // signInWithOAuth는 실패를 throw가 아니라 반환값으로 알린다 — 버리면 버튼이 "그냥 안 눌리는" 화면이 된다
  const [signInErr, setSignInErr] = useState('');

  const signIn = async () => {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { hd: 'clinicbridge.co.kr' }, // 구글 계정 선택 시 회사 도메인 힌트
      },
    });
    if (error) setSignInErr(`로그인을 시작하지 못했어요 — ${error.message}`);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <h1 className="text-lg font-semibold">cb-x-deck</h1>
        <p className="mt-1 text-sm text-x-muted">회사 구글 계정으로 로그인하세요</p>
      </div>
      {hasError && (
        <p className="text-sm text-red-600" role="alert">
          로그인에 실패했어요. 다시 시도해 주세요.
        </p>
      )}
      {signInErr && (
        <p className="text-sm text-red-600" role="alert">{signInErr}</p>
      )}
      <button
        onClick={signIn}
        className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-black/5"
      >
        구글로 로그인
      </button>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
