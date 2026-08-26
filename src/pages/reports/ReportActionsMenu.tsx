import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Loader2, MoreHorizontal } from 'lucide-react';

interface ReportActionsMenuProps {
  label: string;
  onDownloadPdf: () => void;
  pdfLoading: boolean;
  disabled?: boolean;
  extraActions?: ReactNode;
}

export function ReportActionsMenu({ label, onDownloadPdf, pdfLoading, disabled, extraActions }: ReportActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-surface-200 bg-card-bg text-text-secondary hover:text-gold-700 hover:border-gold-300 shadow-sm transition-all"
        aria-label="Abrir ações do relatório"
      >
        <MoreHorizontal size={18} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-20 w-56 bg-card-bg border border-surface-200 rounded-xl shadow-xl overflow-hidden p-2">
          <p className="px-2 pb-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Exportar relatório</p>
          <button
            type="button"
            onClick={() => { setIsOpen(false); onDownloadPdf(); }}
            disabled={disabled || pdfLoading}
            className="w-full flex items-center gap-2 min-h-11 px-2.5 py-2 border border-surface-200 rounded-lg text-text-secondary text-[11px] font-semibold hover:text-gold-700 hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {pdfLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} {label}
          </button>
          {extraActions}
        </div>
      )}
    </div>
  );
}
