import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function ReportBackLink({ href, label }: { href: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(href)}
      className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-gold-600 font-medium mb-2 transition-colors"
    >
      <ArrowLeft size={13} /> {label}
    </button>
  );
}
