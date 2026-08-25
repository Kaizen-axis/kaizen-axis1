import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { RoundedButton } from '@/components/ui/PremiumComponents';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  requireTypedConfirm?: boolean;
  typedConfirmValue?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  loading = false,
  requireTypedConfirm = false,
  typedConfirmValue = 'CONFIRMAR',
}: ConfirmDialogProps) {
  const [typedValue, setTypedValue] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setTypedValue('');
      setIsConfirming(false);
    }
  }, [isOpen]);

  const isBusy = loading || isConfirming;
  const canConfirm = !requireTypedConfirm || typedValue === typedConfirmValue;

  const handleConfirm = async () => {
    if (!canConfirm || isBusy) return;
    setIsConfirming(true);
    try {
      await onConfirm();
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !isBusy && onClose()}
      title={title}
    >
      <div className="space-y-4">
        {typeof message === 'string' ? (
          <p className="text-sm text-text-secondary whitespace-pre-line">{message}</p>
        ) : (
          <div className="text-sm text-text-secondary">{message}</div>
        )}

        {requireTypedConfirm && (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              Digite <span className="font-bold text-text-primary">{typedConfirmValue}</span> para confirmar
            </label>
            <input
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              disabled={isBusy}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-red-200 text-text-primary text-sm"
              placeholder={typedConfirmValue}
              autoComplete="off"
            />
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <RoundedButton
            variant="secondary"
            className="flex-1 min-w-0"
            onClick={onClose}
            disabled={isBusy}
          >
            {cancelLabel}
          </RoundedButton>
          <RoundedButton
            className={
              variant === 'danger'
                ? 'flex-1 min-w-0 !bg-red-500 hover:!bg-red-600 text-white border-none disabled:opacity-60'
                : 'flex-1 min-w-0'
            }
            onClick={() => { void handleConfirm(); }}
            disabled={isBusy || !canConfirm}
          >
            {isBusy ? (
              <>
                <Loader2 size={16} className="animate-spin mr-1" />
                Aguarde...
              </>
            ) : (
              confirmLabel
            )}
          </RoundedButton>
        </div>
      </div>
    </Modal>
  );
}
