import { useEffect } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export type FloatingToastFeedback = {
  type: 'success' | 'error';
  message: string;
};

export const FLOATING_TOAST_DURATION_MS = 4_000;

export function FloatingToast({
  feedback,
  onClose,
}: {
  feedback: FloatingToastFeedback | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!feedback) return;
    const timeoutId = window.setTimeout(onClose, FLOATING_TOAST_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [feedback, onClose]);

  if (!feedback) return null;

  const isSuccess = feedback.type === 'success';
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;

  return (
    <div
      className={`fixed top-4 right-4 left-4 sm:left-auto z-[100] sm:w-full sm:max-w-sm flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl backdrop-blur ${
        isSuccess
          ? 'border-emerald-500/50 bg-emerald-950/95 text-emerald-100'
          : 'border-red-500/50 bg-red-950/95 text-red-100'
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Icon size={18} className="shrink-0" aria-hidden="true" />
      <span>{feedback.message}</span>
    </div>
  );
}
