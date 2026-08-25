import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
  ShieldCheck, AlertTriangle, DownloadCloud, RefreshCcw,
  ChevronLeft, LogIn, User, FileText, Clock, Activity, CircleDot,
} from 'lucide-react';
import { PremiumCard, SectionHeader } from '@/components/ui/PremiumComponents';
import { logAuditEventNow } from '@/services/auditLogger';

interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entity_id?: string | null;
  metadata?: Record<string, any> | null;
  user_id?: string | null;
  ip_address?: string | null;
  device_info?: string | null;
  created_at: string;
}

interface SecurityEvent {
  id: string;
  event_type: string;
  description?: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any> | null;
  ip_address?: string | null;
  created_at: string;
}

interface Profile {
  id: string;
  name: string;
  role: string;
}

const ACTION_LABELS: Record<string, string> = {
  login_success: 'Login realizado',
  login_failed: 'Falha de login',
  logout: 'Logout',
  client_created: 'Cliente criado',
  client_updated: 'Cliente atualizado',
  client_deleted: 'Cliente excluído',
  client_view: 'Cliente visualizado',
  client_proponent_added: 'Proponente adicionado',
  client_proponent_updated: 'Proponente atualizado',
  client_proponent_deleted: 'Proponente removido',
  document_uploaded: 'Documento enviado',
  document_deleted: 'Documento excluído',
  document_downloaded: 'Documento baixado',
  permissions_updated: 'Permissão alterada',
  profile_updated: 'Perfil atualizado',
  lead_converted: 'Lead convertido',
  sale_updated: 'Venda atualizada',
  user_deactivated: 'Usuário desativado',
  user_deleted: 'Usuário excluído',
  announcement_created: 'Anúncio criado',
  announcement_updated: 'Anúncio atualizado',
  announcement_deleted: 'Anúncio excluído',
  test_event: 'Teste de canal',
};

const ACTION_COLORS: Record<string, string> = {
  login_success: 'text-emerald-400',
  login_failed: 'text-red-400',
  logout: 'text-text-secondary',
  client_created: 'text-blue-400',
  client_updated: 'text-amber-400',
  client_deleted: 'text-red-400',
  client_view: 'text-text-secondary',
  document_uploaded: 'text-blue-400',
  document_deleted: 'text-red-400',
  document_downloaded: 'text-purple-400',
  permissions_updated: 'text-orange-400',
  user_deactivated: 'text-amber-400',
  user_deleted: 'text-red-400',
  announcement_created: 'text-gold-400',
  announcement_updated: 'text-gold-400',
  announcement_deleted: 'text-red-400',
  test_event: 'text-gold-400',
};

const SEVERITY_BADGE: Record<string, string> = {
  low: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  high: 'bg-orange-500/15 text-orange-300',
  critical: 'bg-red-500/15 text-red-300',
};

const SEVERITY_LABELS: Record<string, string> = {
  low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico',
};

const TIMELINE_FILTERS = [
  { value: 'all', label: 'Atividade' },
  { value: 'login_success', label: 'Logins' },
  { value: 'login_failed', label: 'Falhas' },
  { value: 'client_created', label: 'Clientes criados' },
  { value: 'client_updated', label: 'Atualizações' },
  { value: 'client_deleted', label: 'Exclusões' },
  { value: 'document_downloaded', label: 'Downloads' },
  { value: 'document_uploaded', label: 'Uploads' },
  { value: 'client_view', label: 'Visualizações' },
];

function formatDate(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `${min}min atrás`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

export default function SecurityPanel() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [filter, setFilter] = useState('all');
  const [auditError, setAuditError] = useState<string | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const loadDashboard = async () => {
    setLoading(true);
    setAuditError(null);
    setEventsError(null);
    try {
      const [auditRes, eventsRes, profilesRes] = await Promise.all([
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('security_events').select('*').order('created_at', { ascending: false }).limit(40),
        supabase.from('profiles').select('id, name, role'),
      ]);

      if (auditRes.error) {
        setAuditError(`${auditRes.error.message} (código: ${auditRes.error.code})`);
        setAuditLogs([]);
      } else {
        setAuditLogs(auditRes.data || []);
      }

      if (eventsRes.error) {
        setEventsError(`${eventsRes.error.message} (código: ${eventsRes.error.code})`);
        setSecurityEvents([]);
      } else {
        setSecurityEvents(eventsRes.data || []);
      }

      const profileMap: Record<string, Profile> = {};
      for (const p of (profilesRes.data || [])) profileMap[p.id] = p;
      setProfiles(profileMap);
    } catch (err: any) {
      setAuditError(`Exceção: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await logAuditEventNow({
      action: 'test_event',
      entity: 'security_panel',
      metadata: { source: 'channel_status' },
    });
    if (result.ok) {
      setTestResult('Canal OK: evento gravado pela Edge Function audit-log.');
      await loadDashboard();
    } else {
      setTestResult(`Falha no canal: ${result.message || 'não foi possível gravar via Edge Function.'}`);
    }
    setTesting(false);
  };

  useEffect(() => { loadDashboard(); }, []);

  const recentLogins = useMemo(() => auditLogs.filter(l => l.action === 'login_success').slice(0, 20), [auditLogs]);
  const failedLogins = useMemo(() => auditLogs.filter(l => l.action === 'login_failed').slice(0, 20), [auditLogs]);
  const documentDownloads = useMemo(() => auditLogs.filter(l => l.action === 'document_downloaded').slice(0, 20), [auditLogs]);

  const filteredActivity = useMemo(() => {
    const base = filter === 'all'
      ? auditLogs.filter(l => l.action !== 'client_view')
      : auditLogs.filter(l => l.action === filter);
    return base.slice(0, 50);
  }, [auditLogs, filter]);

  const lastEventAt = auditLogs[0]?.created_at || securityEvents[0]?.created_at || null;

  const userName = (log: AuditLog) =>
    profiles[log.user_id ?? '']?.name
    || log.metadata?.name as string
    || log.metadata?.email as string
    || (log.user_id ? `ID: ${log.user_id.slice(0, 8)}…` : 'Sistema');

  const summaryCards = [
    { icon: <ShieldCheck size={20} />, label: 'Logins aprovados', value: recentLogins.length, color: 'text-emerald-400' },
    { icon: <AlertTriangle size={20} />, label: 'Falhas de login', value: failedLogins.length, color: 'text-red-400' },
    { icon: <DownloadCloud size={20} />, label: 'Downloads', value: documentDownloads.length, color: 'text-purple-400' },
    { icon: <Activity size={20} />, label: 'Eventos na amostra', value: auditLogs.length, color: 'text-blue-400' },
  ];

  return (
    <div className="min-h-screen bg-surface-50 pb-24">
      <div className="bg-card-bg/95 backdrop-blur px-4 py-4 border-b border-surface-200 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
            <ChevronLeft size={22} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <ShieldCheck size={20} className="text-gold-500" /> Painel de Segurança
            </h1>
            <p className="text-xs text-text-secondary">Monitoramento de acessos, documentos e eventos suspeitos</p>
          </div>
        </div>
        <button
          onClick={loadDashboard}
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-gold-500 text-white text-xs font-semibold shadow"
          disabled={loading}
        >
          <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Carregando…' : 'Atualizar'}
        </button>
      </div>

      <div className="p-4 space-y-6">
        <PremiumCard className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CircleDot size={16} className="text-gold-400" />
            <h2 className="text-sm font-semibold text-text-primary">Status do canal</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className={`rounded-xl border px-3 py-2 ${auditError ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
              <p className="font-semibold">audit_logs</p>
              <p className="mt-0.5 opacity-90">{auditError ? `Erro: ${auditError}` : 'Leitura OK'}</p>
            </div>
            <div className={`rounded-xl border px-3 py-2 ${eventsError ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>
              <p className="font-semibold">security_events</p>
              <p className="mt-0.5 opacity-90">{eventsError ? `Erro: ${eventsError}` : 'Leitura OK'}</p>
            </div>
            <div className="rounded-xl border border-surface-200 bg-surface-100/60 px-3 py-2 text-text-secondary">
              <p className="font-semibold text-text-primary">Último evento</p>
              <p className="mt-0.5">{lastEventAt ? timeAgo(lastEventAt) : 'Nenhum na amostra'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={runTest}
              disabled={testing}
              className="px-4 py-2 rounded-full bg-gold-500 hover:bg-gold-600 disabled:opacity-60 text-white text-xs font-semibold"
            >
              {testing ? 'Testando…' : 'Testar gravação (Edge Function)'}
            </button>
            {testResult && (
              <p className={`text-xs ${testResult.startsWith('Canal OK') ? 'text-emerald-300' : 'text-red-300'}`}>
                {testResult}
              </p>
            )}
          </div>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Fora deste ciclo: captura consistente de IP no cliente, totais via SQL, export CSV e alerta em tempo real.
          </p>
        </PremiumCard>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryCards.map(card => (
            <PremiumCard key={card.label} className="flex items-center gap-3 p-4">
              <div className={`${card.color} shrink-0`}>{card.icon}</div>
              <div>
                <p className="text-[11px] text-text-secondary leading-tight">{card.label}</p>
                <p className="text-2xl font-bold text-text-primary">{loading ? '…' : card.value}</p>
                <p className="text-[10px] text-text-secondary mt-0.5">nesta amostra (até 200)</p>
              </div>
            </PremiumCard>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PremiumCard>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
              <LogIn size={16} className="text-emerald-400" /> Logins recentes
              <span className="ml-auto text-xs text-text-secondary font-normal">Últimos 20 na amostra</span>
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {recentLogins.length === 0
                ? <p className="text-sm text-text-secondary">Nenhum login registrado ainda.</p>
                : recentLogins.map(log => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 hover:bg-surface-100/50">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
                      <User size={14} className="text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{userName(log)}</p>
                      <p className="text-xs text-text-secondary">{timeAgo(log.created_at)} · {log.ip_address || 'IP não registrado'}</p>
                      {profiles[log.user_id ?? '']?.role && (
                        <span className="text-[10px] text-emerald-400 font-medium uppercase">{profiles[log.user_id!].role}</span>
                      )}
                    </div>
                    <p className="text-xs text-text-secondary shrink-0 hidden sm:block">{formatDate(log.created_at)}</p>
                  </div>
                ))
              }
            </div>
          </PremiumCard>

          <PremiumCard>
            <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
              <AlertTriangle size={16} className="text-red-400" /> Tentativas falhadas
              <span className="ml-auto text-xs text-text-secondary font-normal">Últimos 20 na amostra</span>
            </h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {failedLogins.length === 0
                ? <p className="text-sm text-text-secondary">Sem falhas de login registradas.</p>
                : failedLogins.map(log => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-red-500/25 bg-red-500/10">
                    <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                      <AlertTriangle size={14} className="text-red-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-300 truncate">{userName(log)}</p>
                      <p className="text-xs text-red-400/80">{timeAgo(log.created_at)} · {log.ip_address || 'IP não registrado'}</p>
                      {log.metadata?.reason && (
                        <p className="text-xs text-text-secondary mt-0.5">Motivo: {log.metadata.reason}</p>
                      )}
                    </div>
                    <p className="text-xs text-red-400/70 shrink-0 hidden sm:block">{formatDate(log.created_at)}</p>
                  </div>
                ))
              }
            </div>
          </PremiumCard>
        </div>

        <PremiumCard>
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
            <DownloadCloud size={16} className="text-purple-400" /> Downloads de documentos
            <span className="ml-auto text-xs text-text-secondary font-normal">nesta amostra</span>
          </h3>
          {documentDownloads.length === 0
            ? <p className="text-sm text-text-secondary">Nenhum download registrado ainda.</p>
            : (
              <div className="grid md:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                {documentDownloads.map(log => (
                  <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl border border-surface-200 hover:bg-surface-100/50">
                    <div className="w-8 h-8 rounded-full bg-purple-500/15 flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-purple-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{userName(log)}</p>
                      <p className="text-xs text-text-secondary truncate">
                        {log.metadata?.fileName as string || log.entity_id || 'Documento'}
                      </p>
                      <p className="text-xs text-text-secondary">{timeAgo(log.created_at)} · {log.ip_address || '—'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </PremiumCard>

        <div>
          <SectionHeader title="Eventos suspeitos" subtitle="Alertas automáticos do sistema" />
          <PremiumCard className="mt-3">
            {eventsError
              ? <p className="text-sm text-red-300">Não foi possível ler security_events: {eventsError}</p>
              : securityEvents.length === 0
                ? <p className="text-sm text-text-secondary">Nenhum evento suspeito detectado.</p>
                : (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {securityEvents.map(event => (
                      <div key={event.id} className="p-4 rounded-xl border border-surface-200 hover:bg-surface-100/50">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-text-primary">{event.description || event.event_type}</p>
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${SEVERITY_BADGE[event.severity] || ''}`}>
                            {SEVERITY_LABELS[event.severity] || event.severity}
                          </span>
                        </div>
                        <p className="text-xs text-text-secondary mt-1">
                          {formatDate(event.created_at)}
                          {event.ip_address ? ` · IP: ${event.ip_address}` : ''}
                        </p>
                        {event.metadata && Object.keys(event.metadata).length > 0 && (
                          <pre className="text-[10px] bg-surface-100 rounded-lg mt-2 p-2 overflow-x-auto text-text-secondary">
                            {JSON.stringify(event.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )
            }
          </PremiumCard>
        </div>

        <div>
          <SectionHeader title="Linha do tempo" subtitle="Atividade da amostra, sem visualizações por padrão" />
          <div className="flex flex-wrap gap-2 mt-3 mb-3">
            {TIMELINE_FILTERS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  filter === opt.value
                    ? 'bg-gold-500 text-white border-gold-500'
                    : 'border-surface-200 text-text-secondary hover:border-gold-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <PremiumCard>
            {filteredActivity.length === 0
              ? <p className="text-sm text-text-secondary">Sem registros para este filtro.</p>
              : (
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                  {filteredActivity.map(log => (
                    <div key={log.id} className="flex items-start gap-3 p-3 border border-surface-200 rounded-xl hover:bg-surface-100/50">
                      <div className="w-8 h-8 rounded-full bg-surface-100 flex items-center justify-center shrink-0 mt-0.5">
                        <Clock size={13} className="text-text-secondary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${ACTION_COLORS[log.action] || 'text-text-primary'}`}>
                            {ACTION_LABELS[log.action] || log.action}
                          </span>
                          <span className="text-xs text-text-secondary">·</span>
                          <span className="text-xs text-text-secondary">{userName(log)}</span>
                          {profiles[log.user_id ?? '']?.role && (
                            <span className="text-[10px] text-gold-400 font-semibold uppercase bg-gold-500/10 px-1.5 py-0.5 rounded">
                              {profiles[log.user_id!].role}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">
                          {formatDate(log.created_at)}
                          {log.ip_address ? ` · ${log.ip_address}` : ''}
                          {log.entity_id ? ` · ${log.entity}: ${log.entity_id.slice(0, 8)}…` : ''}
                        </p>
                        {log.metadata && Object.keys(log.metadata).filter(k => k !== 'userAgent').length > 0 && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-text-secondary cursor-pointer select-none">Ver detalhes</summary>
                            <pre className="text-[10px] bg-surface-100 rounded mt-1 p-2 overflow-x-auto text-text-secondary">
                              {JSON.stringify(
                                Object.fromEntries(Object.entries(log.metadata).filter(([k]) => k !== 'userAgent')),
                                null, 2
                              )}
                            </pre>
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </PremiumCard>
        </div>
      </div>
    </div>
  );
}
