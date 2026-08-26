import { useNavigate } from 'react-router-dom';
import { Lock, ChevronLeft } from 'lucide-react';

export default function SecurityPanel() {
  const navigate = useNavigate();

  return (
    <div className="w-full max-w-full px-4 sm:px-6 pt-6 pb-24 min-h-screen bg-surface-50">
      <button
        type="button"
        onClick={() => navigate('/admin')}
        className="min-h-11 inline-flex items-center gap-1 text-text-secondary mb-10 -ml-1 px-1"
      >
        <ChevronLeft size={20} /> Voltar
      </button>
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-surface-100 border border-surface-200 flex items-center justify-center">
          <Lock size={28} className="text-text-secondary" aria-hidden />
        </div>
        <h1 className="text-xl font-bold text-text-primary">Segurança</h1>
        <p className="text-sm text-text-secondary">Em breve</p>
      </div>
    </div>
  );
}
