import { useCallback, useState } from 'react';
import type { ConfirmDialogProps } from '@/components/ui/ConfirmDialog';

export interface ConfirmRequest {
  title: string;
  message: string | React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  requireTypedConfirm?: boolean;
  typedConfirmValue?: string;
  onConfirm: () => void | Promise<void>;
}

type DialogState = {
  open: boolean;
  request: ConfirmRequest | null;
  loading: boolean;
};

const INITIAL_STATE: DialogState = { open: false, request: null, loading: false };

export function useConfirmDialog() {
  const [state, setState] = useState<DialogState>(INITIAL_STATE);

  const close = useCallback(() => {
    setState((current) => (current.loading ? current : INITIAL_STATE));
  }, []);

  const requestConfirm = useCallback((request: ConfirmRequest) => {
    setState({ open: true, request, loading: false });
  }, []);

  const handleConfirm = useCallback(async () => {
    const request = state.request;
    if (!request) return;

    setState((current) => ({ ...current, loading: true }));
    try {
      await request.onConfirm();
      setState(INITIAL_STATE);
    } catch {
      setState((current) => ({ ...current, loading: false }));
    }
  }, [state.request]);

  const confirmDialogProps: ConfirmDialogProps = {
    isOpen: state.open,
    onClose: close,
    onConfirm: handleConfirm,
    title: state.request?.title ?? '',
    message: state.request?.message ?? '',
    confirmLabel: state.request?.confirmLabel,
    cancelLabel: state.request?.cancelLabel,
    variant: state.request?.variant,
    requireTypedConfirm: state.request?.requireTypedConfirm,
    typedConfirmValue: state.request?.typedConfirmValue,
    loading: state.loading,
  };

  return { requestConfirm, confirmDialogProps };
}
