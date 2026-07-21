'use client';

export function HelpButton({ onClick, label = '사용법 다시 보기' }: { onClick: () => void; label?: string }) {
  return (
    <button
      data-tour="help-button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-x-border-strong text-ui text-x-secondary hover:bg-x-text/5"
    >
      ?
    </button>
  );
}
