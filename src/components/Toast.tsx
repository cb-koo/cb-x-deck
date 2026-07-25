'use client';

export function Toast({ message, actionLabel, onAction, onDismiss }: {
  message: string; actionLabel?: string; onAction?: () => void; onDismiss?: () => void;
}) {
  return (
    <div role="status" aria-live="polite"
         className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-x-text px-4 py-2.5 text-ui text-x-surface shadow-lg">
      <span>{message}</span>
      {actionLabel && onAction && (
        <button onClick={onAction} className="font-bold text-x-blue-text underline-offset-2 hover:underline">{actionLabel}</button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} aria-label="닫기" className="text-x-surface/70 hover:text-x-surface">✕</button>
      )}
    </div>
  );
}
