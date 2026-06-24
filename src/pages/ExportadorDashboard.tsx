import { useState } from 'react';
import { RoundedButton } from '@/components/ui/PremiumComponents';
import { Download, Loader2, ShieldCheck, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { useNavigate } from 'react-router-dom';

export default function ExportadorDashboard() {
  const { signOut } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('export-all-data', { body: {} });
      if (fnError) {
        let message = 'Não foi possível gerar a exportação agora. Tente novamente.';
        try {
          const resp = (fnError as any).context;
          if (resp) { const j = await resp.json().catch(() => ({})); message = j?.error || message; }
        } catch { /* mantém genérica */ }
        throw new Error(message);
      }
      if (!data?.url) throw new Error('Resposta inválida do servidor.');
      setLastAt(data.generated_at || new Date().toISOString());
      // Inicia o download
      const a = document.createElement('a');
      a.href = data.url;
      a.rel = 'noopener';
      a.click();
    } catch (e: any) {
      setError(e?.message || 'Erro ao exportar.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => { await signOut(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-card-bg rounded-3xl shadow-xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-500">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Exportação de Dados</h1>
            <p className="text-sm text-text-secondary">Kaizen Axis</p>
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-relaxed">
          Baixe um pacote <strong>.zip</strong> com todos os dados do sistema: clientes, agendamentos,
          leads, vendas, empreendimentos, equipe, presença e relatórios. Inclui os dados em
          <strong> CSV</strong> (abrem no Excel) e em <strong>JSON</strong> (para migração), além da
          lista de documentos com links de download.
        </p>

        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400">
          O pacote contém dados pessoais (incluindo CPF). Guarde-o com segurança e trate conforme a LGPD.
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <RoundedButton fullWidth onClick={handleExport} disabled={loading} className="py-4 text-base font-semibold">
          {loading ? <Loader2 size={20} className="animate-spin" /> : <><Download size={18} /> Baixar todos os dados</>}
        </RoundedButton>

        {lastAt && !loading && (
          <p className="text-center text-xs text-text-secondary">
            Última exportação: {new Date(lastAt).toLocaleString('pt-BR')}
          </p>
        )}

        <button onClick={handleLogout} className="flex items-center justify-center gap-2 w-full text-sm text-text-secondary hover:text-text-primary transition-colors pt-2">
          <LogOut size={16} /> Sair
        </button>
      </div>
    </div>
  );
}
