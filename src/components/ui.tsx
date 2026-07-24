'use client';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

// 경량 디자인 시스템 (spec §5) — 덱의 버튼은 이 4변형만 사용
// primary = 파랑(주요·비용 액션 1개), subtle = 테두리, ghost = 호버만, icon = 원형 아이콘
const VARIANT = {
  primary: 'bg-x-blue px-3 py-1 font-medium text-white hover:bg-x-blue-hover',
  subtle: 'border border-x-border-strong bg-white px-3 py-1 hover:bg-x-hover',
  ghost: 'px-2.5 py-1 text-x-secondary hover:bg-x-text/5',
  icon: 'p-1.5 text-x-secondary hover:bg-x-blue/10 hover:text-x-blue-text',
} as const;

export type ButtonVariant = keyof typeof VARIANT;

export function Button({ variant = 'subtle', className = '', children, ...props }:
  { variant?: ButtonVariant; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
            className={`rounded-full text-ui transition-colors disabled:opacity-50 ${VARIANT[variant]} ${className}`}>
      {children}
    </button>
  );
}

// 분석 패널 공통 골격 — 제목(500) + 설명 캡션 + 닫기, 도구층 표면 (spec §5)
export function PanelShell({ title, sub, onClose, children }:
  { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="border-b border-x-border bg-x-surface px-3 py-2 text-ui">
      <div className="flex items-baseline gap-2">
        <p className="font-medium">{title}</p>
        {sub && <span className="min-w-0 truncate text-caption text-x-muted">{sub}</span>}
        <button onClick={onClose} aria-label="닫기"
                className="ml-auto shrink-0 rounded px-1 text-x-secondary hover:bg-x-border">✕</button>
      </div>
      {children}
    </div>
  );
}
