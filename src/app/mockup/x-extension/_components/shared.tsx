'use client';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui';
export { Button };
export type DisclosureControl = { open: boolean; onToggle: () => void };
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const generatedId = useId();
  const findControl = (nodes: ReactNode): ReactElement<{ id?: string; children?: ReactNode }> | undefined => {
    for (const child of Children.toArray(nodes)) {
      if (!isValidElement(child)) continue;
      const element = child as ReactElement<{ id?: string; children?: ReactNode }>;
      if (typeof element.type === 'string' && ['input', 'select', 'textarea'].includes(element.type))
        return element;
      const nested = findControl(element.props.children);
      if (nested) return nested;
    }
    return undefined;
  };
  const control = findControl(children);
  const inputId = control ? (control.props.id ?? generatedId) : undefined;
  const associate = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (child) => {
      if (!isValidElement(child)) return child;
      const element = child as ReactElement<{
        id?: string;
        children?: ReactNode;
        'aria-describedby'?: string;
      }>;
      if (typeof element.type === 'string' && ['input', 'select', 'textarea'].includes(element.type)) {
        return cloneElement(element, {
          id: inputId,
          'aria-describedby':
            [element.props['aria-describedby'], hint ? `${generatedId}-hint` : '']
              .filter(Boolean)
              .join(' ') || undefined,
        });
      }
      return element.props.children
        ? cloneElement(element, { children: associate(element.props.children) })
        : element;
    });
  const controls = associate(children);
  return (
    <div className="mock-field">
      {inputId ? <label htmlFor={inputId}>{label}</label> : <span>{label}</span>}
      {controls}
      {hint && <small id={`${generatedId}-hint`}>{hint}</small>}
    </div>
  );
}
export function Section({
  title,
  aside,
  children,
  summary,
  disclosure,
  actionLabel = '보기',
  id,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  summary?: ReactNode;
  disclosure?: DisclosureControl;
  actionLabel?: string;
  id?: string;
}) {
  const contentId = useId();
  return (
    <section id={id} className={`mock-section ${disclosure ? 'mock-summary-section' : ''}`}>
      <div className="mock-section-head">
        <div className="mock-section-heading">
          <h3>{title}</h3>
          {disclosure && summary && <div className="mock-section-summary">{summary}</div>}
        </div>
        {aside}
        {disclosure && (
          <Button
            variant="ghost"
            aria-expanded={disclosure.open}
            aria-controls={contentId}
            aria-label={`${title} ${disclosure.open ? '접기' : '펼치기'}`}
            onClick={disclosure.onToggle}
          >
            {disclosure.open ? '접기' : actionLabel} <span aria-hidden>{disclosure.open ? '⌃' : '⌄'}</span>
          </Button>
        )}
      </div>
      {disclosure ? (
        <div id={contentId} hidden={!disclosure.open} className="mock-section-content">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`mock-notice ${danger ? 'danger' : ''}`} role={danger ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`mock-badge ${tone}`}>{children}</span>;
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  side = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  side?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`mock-modal xmock ${wide ? 'wide' : ''} ${side ? 'side' : ''}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <Button variant="icon" aria-label="닫기" onClick={onClose}>
          ✕
        </Button>
      </header>
      {children}
    </dialog>
  );
}
export function CopyButton({
  text,
  label = '복사',
  onCopied,
}: {
  text: string;
  label?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <>
      <Button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState('done');
            onCopied?.();
          } catch {
            setState('failed');
          }
        }}
      >
        {state === 'done' ? '복사했어요' : label}
      </Button>
      {state === 'failed' && (
        <div className="mock-full">
          <Notice danger>복사 권한을 확인해 주세요. 아래 텍스트를 선택해 직접 복사할 수 있어요.</Notice>
          <textarea
            aria-label="직접 복사할 내용"
            readOnly
            value={text}
            onFocus={(e) => e.target.select()}
            rows={5}
          />
        </div>
      )}
    </>
  );
}
