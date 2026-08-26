import { useEffect, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  panelClassName?: string;
  contentClassName?: string;
  overlayClassName?: string;
}

export const Modal = ({ isOpen, onClose, title, children, panelClassName, contentClassName, overlayClassName }: ModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4", overlayClassName)}>
      <div 
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div 
        ref={modalRef}
        className={cn(
          "bg-card-bg w-full max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl pointer-events-auto flex flex-col max-h-[92vh] relative z-10 animate-in fade-in zoom-in-95 duration-200",
          panelClassName
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-surface-200">
          <h3 className="text-lg font-bold text-text-primary">{title}</h3>
          <button 
            onClick={onClose}
            className="min-h-11 min-w-11 flex items-center justify-center rounded-full hover:bg-surface-100 text-text-secondary transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className={cn("p-4 overflow-y-auto no-scrollbar", contentClassName)}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
