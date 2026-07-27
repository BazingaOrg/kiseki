import {useEffect, useRef, useState} from 'react';

interface DialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void | Promise<void>;
  onClose: () => void;
}

/** 项目内的轻量确认 / 错误弹窗，不把文件操作的结果交给浏览器原生 alert。 */
export const Dialog = ({title, message, confirmLabel = '知道了', destructive = false, onConfirm, onClose}: DialogProps) => {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (destructive ? cancelRef.current : confirmRef.current)?.focus();
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const buttons = [cancelRef.current, confirmRef.current].filter((button): button is HTMLButtonElement => Boolean(button && !button.disabled));
      if (buttons.length < 2) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const confirm = async () => {
    if (!onConfirm || busy) return onClose();
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" aria-describedby="dialog-message">
        <h2 id="dialog-title">{title}</h2>
        <p id="dialog-message">{message}</p>
        <div className="dialog-actions">
          {onConfirm && <button ref={cancelRef} className="link-button" disabled={busy} onClick={onClose}>取消</button>}
          <button ref={confirmRef} className={destructive ? 'primary-button dialog-delete' : 'primary-button'} disabled={busy} onClick={confirm}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};
