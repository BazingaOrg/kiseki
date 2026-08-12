import {useEffect, useId, useRef, useState} from 'react';
import {Info} from 'lucide-react';

interface FieldHelpProps {
  label: string;
  children: string;
}

export const FieldHelp = ({label, children}: FieldHelpProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipId = `field-help-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <span
      className={open ? 'field-help field-help-open' : 'field-help'}
      ref={rootRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        className="field-help-button"
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tooltipId}
        aria-describedby={tooltipId}
        onClick={() => setOpen(true)}
      >
        <Info size={13} strokeWidth={1.6} aria-hidden="true" />
      </button>
      <span className="field-help-tooltip" id={tooltipId} role="tooltip">
        {children}
      </span>
    </span>
  );
};
