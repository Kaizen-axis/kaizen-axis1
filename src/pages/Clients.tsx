import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { PremiumCard, StatusBadge, RoundedButton } from '@/components/ui/PremiumComponents';
import {
  Search, Filter, Phone, Mail, MessageCircle, UserPlus,
  Clock, Plus, Loader2, Zap, Brain, AlertTriangle, CheckCircle2,
  Sparkles, X, BadgeCheck, ChevronDown, LayoutGrid, List, Edit2, Trash2, Calendar, Video, FileText
} from 'lucide-react';
import { CLIENT_STAGES, ClientStage, Client, isStageRestrictedForRole, missingFieldsForConcluido } from '@/data/clients';
import { AutomationLead } from '@/data/leads';
import { useApp } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ClientHierarchyTags } from '@/components/ui/ClientHierarchyTags';
import { ClientsKanban } from '@/components/clients/ClientsKanban';
import { NewClientForm, NewClientPrefill } from '@/components/clients/NewClientForm';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { CardActionsMenu, type CardActionItem } from '@/components/ui/CardActionsMenu';
import { CreateAppointmentModal } from '@/components/schedule/CreateAppointmentModal';
import { EditClientModal } from '@/components/clients/EditClientModal';
import { ClientFichaModal } from '@/components/clients/ClientFichaModal';
import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

type MainTab = 'clientes' | 'documentacao';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoDate: string) {
  const diff = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (diff < 60) return 'agora mesmo';
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return new Date(isoDate).toLocaleDateString('pt-BR');
}

function formatPhone(phone: string) {
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

function whatsappDigits(phone?: string) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? digits : `55${digits}`;
}

// ─── Urgency indicator ────────────────────────────────────────────────────────

function getClientUrgency(client: Client): { days: number; level: 'critical' | 'urgent' | 'warning' | null } {
  if (client.stage === 'Concluído') {
    return { days: 0, level: null };
  }

  const stageEntries = (client.history || []).filter(
    h => h.action === `Estágio alterado para ${client.stage}`
  );
  let refDate: Date;
  if (stageEntries.length > 0) {
    const sorted = [...stageEntries].sort((a, b) =>
      new Date((b as any).created_at).getTime() - new Date((a as any).created_at).getTime()
    );
    refDate = new Date((sorted[0] as any).created_at);
  } else {
    refDate = new Date((client as any).createdAt || (client as any).created_at);
  }
  const days = Math.floor((Date.now() - refDate.getTime()) / (1000 * 60 * 60 * 24));
  // Conformidade: urgente a partir de 7 dias
  if (client.stage === 'Conformidade' && days >= 7) return { days, level: 'urgent' };
  if (days >= 3) return { days, level: 'critical' };
  if (days >= 2) return { days, level: 'urgent' };
  if (days >= 1) return { days, level: 'warning' };
  return { days, level: null };
}

// ─── Priority indicator ───────────────────────────────────────────────────────

function PriorityBadge({ metadata }: { metadata?: AutomationLead['ai_metadata'] }) {
  const priority = metadata?.priority;
  if (!priority || priority === 'baixa') return null;
  const isHigh = priority === 'alta';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isHigh ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
      }`}>
      <AlertTriangle size={10} />
      {isHigh ? 'Prioridade Alta' : 'Prioridade Média'}
    </span>
  );
}

// ─── Lead Card ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onConvert }: { lead: AutomationLead; onConvert: (lead: AutomationLead) => void }) {
  const isNew = !lead.viewed_at;
  const initial = lead.name?.charAt(0).toUpperCase() || '?';

  const handleWhatsApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    const phone = lead.phone.replace(/\D/g, '');
    window.open(`https://wa.me/55${phone}`, '_blank');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="bg-card-bg rounded-2xl border border-surface-200 shadow-sm hover:shadow-md hover:border-gold-200 transition-all overflow-hidden"
    >
      <div className="p-3.5">
        {/* Row: avatar + info + time */}
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-text-primary text-sm truncate leading-tight">{lead.name}</p>
              <span className="text-[10px] text-text-secondary flex items-center gap-0.5 flex-shrink-0">
                <Clock size={9} />{timeAgo(lead.timestamp)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-[#128C7E] font-mono cursor-pointer hover:underline" onClick={handleWhatsApp}>
                {formatPhone(lead.phone)}
              </span>
              {isNew && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
              {lead.ai_metadata?.priority === 'alta' && (
                <span className="text-[9px] font-bold text-red-500 bg-red-50 border border-red-100 px-1.5 py-px rounded-full flex items-center gap-0.5">
                  <AlertTriangle size={8} />Alta
                </span>
              )}
            </div>
          </div>
        </div>

        {/* AI summary */}
        {lead.aiSummary && (
          <p className="mt-2.5 text-[11px] text-text-secondary leading-relaxed line-clamp-2">
            <Brain size={9} className="inline mr-1 opacity-50" />
            {lead.aiSummary}
          </p>
        )}

        {/* Chips */}
        {lead.ai_metadata && (lead.ai_metadata.region || lead.ai_metadata.propertyType || lead.ai_metadata.income) && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {lead.ai_metadata.region && <span className="text-[9px] px-1.5 py-px rounded-full bg-surface-100 text-text-secondary border border-surface-200">📍 {lead.ai_metadata.region}</span>}
            {lead.ai_metadata.propertyType && <span className="text-[9px] px-1.5 py-px rounded-full bg-surface-100 text-text-secondary border border-surface-200">🏠 {lead.ai_metadata.propertyType}</span>}
            {lead.ai_metadata.income && <span className="text-[9px] px-1.5 py-px rounded-full bg-surface-100 text-text-secondary border border-surface-200">💰 {lead.ai_metadata.income}</span>}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex border-t border-surface-100">
        <button onClick={handleWhatsApp} className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold text-[#128C7E] hover:bg-[#25D366]/5 transition-colors">
          <MessageCircle size={11} /> Conversar
        </button>
        <div className="w-px bg-surface-100" />
        <button onClick={(e) => { e.stopPropagation(); onConvert(lead); }} className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] font-semibold text-gold-600 hover:bg-accent-hover transition-colors">
          <UserPlus size={11} /> Criar Ficha
        </button>
      </div>
    </motion.div>
  );
}

// ─── Convert Lead Modal ───────────────────────────────────────────────────────

function ConvertLeadModal({ lead, onClose, onConfirm }: {
  lead: AutomationLead;
  onClose: () => void;
  onConfirm: (lead: AutomationLead, data: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: lead.name || '',
    phone: lead.phone || '',
    cpf: '',
    email: '',
    profession: '',
    grossIncome: lead.ai_metadata?.income || '',
    incomeType: 'CLT' as string,
    regionOfInterest: lead.ai_metadata?.region || '',
    intendedValue: '',
    observations: lead.aiSummary ? `Resumo IA: ${lead.aiSummary}` : '',
    stage: 'Em Análise' as string,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onConfirm(lead, form);
    setLoading(false);
  };

  const inputClass = "w-full px-3 py-2 rounded-xl bg-surface-50 border border-surface-200 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-gold-200 transition-all placeholder:text-text-secondary";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="relative bg-card-bg rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[88vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-card-bg px-5 pt-5 pb-3 border-b border-surface-100 z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                <Sparkles size={18} className="text-gold-500" />
                Criar Ficha de Cliente
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">Dados pré-preenchidos pelo agente de IA</p>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
              <X size={20} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* AI Summary banner */}
          {lead.aiSummary && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-3">
              <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1 mb-1">
                <Brain size={10} /> Resumo do Agente de IA
              </p>
              <p className="text-xs text-indigo-800 dark:text-indigo-200">{lead.aiSummary}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Nome *</label>
              <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Nome completo" />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Telefone *</label>
              <input className={inputClass} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} required placeholder="(xx) xxxxx-xxxx" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">CPF</label>
                <input className={inputClass} value={form.cpf} onChange={e => setForm(f => ({ ...f, cpf: e.target.value }))} placeholder="000.000.000-00" />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">E-mail</label>
                <input className={inputClass} type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Renda Aproximada</label>
                <input className={inputClass} value={form.grossIncome} onChange={e => setForm(f => ({ ...f, grossIncome: e.target.value }))} placeholder="R$ 3.000" />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Tipo de Renda</label>
                <select className={inputClass} value={form.incomeType} onChange={e => setForm(f => ({ ...f, incomeType: e.target.value }))}>
                  <option>CLT</option>
                  <option>MEI</option>
                  <option>Autônomo</option>
                  <option>Funcionário Público</option>
                  <option>Aposentado</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Região de Interesse</label>
                <input className={inputClass} value={form.regionOfInterest} onChange={e => setForm(f => ({ ...f, regionOfInterest: e.target.value }))} placeholder="Bairro / Cidade" />
              </div>
              <div>
                <label className="text-xs font-medium text-text-secondary mb-1 block">Valor</label>
                <input className={inputClass} value={form.intendedValue} onChange={e => {
                  let val = e.target.value;
                  let v = val.replace(/\D/g, '');
                  if (v) {
                    v = (parseInt(v, 10) / 100).toFixed(2);
                    val = v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                  } else {
                    val = '';
                  }
                  setForm(f => ({ ...f, intendedValue: val }));
                }} placeholder="R$ 200.000" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Etapa Inicial</label>
              <select className={inputClass} value={form.stage} onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}>
                {CLIENT_STAGES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary mb-1 block">Observações</label>
              <textarea className={`${inputClass} resize-none`} rows={3} value={form.observations} onChange={e => setForm(f => ({ ...f, observations: e.target.value }))} placeholder="Resumo da conversa inicial..." />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !form.name || !form.phone}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-gold-500 hover:bg-gold-600 text-white font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-gold"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <BadgeCheck size={18} />}
            {loading ? 'Criando Ficha...' : 'Confirmar e Criar Ficha'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Clients() {
  const navigate = useNavigate();
  const location = useLocation();
  const { clients, leads, loading, userRole, allProfiles, teams, directorates, user, updateClient, deleteClient } = useApp();
  const [pipelineView, setPipelineView] = useState<'list' | 'kanban'>('list');
  const { isAdmin, isDirector, canViewAllClients, role } = useAuthorization();
  const canViewUrgencyState = isAdmin || isDirector;

  const [mainTab, setMainTab] = useState<MainTab>('clientes');
  const [activeStage, setActiveStage] = useState<ClientStage | 'Todos'>('Todos');
  const [searchTerm, setSearchTerm] = useState('');
  const [convertSuccess, setConvertSuccess] = useState(false);
  const [stageDropdownOpen, setStageDropdownOpen] = useState(false);
  const [moreDropdownOpen, setMoreDropdownOpen] = useState(false);
  const [isNewClientModalOpen, setIsNewClientModalOpen] = useState(false);
  const [newClientPrefill, setNewClientPrefill] = useState<NewClientPrefill | undefined>(undefined);
  const [appointmentClient, setAppointmentClient] = useState<{ id: string; name: string } | null>(null);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();

  const closeNewClientModal = () => {
    setIsNewClientModalOpen(false);
    setNewClientPrefill(undefined);
  };

  const openNewClientModal = (prefill?: NewClientPrefill) => {
    setNewClientPrefill(prefill);
    setIsNewClientModalOpen(true);
  };

  const clientCardActions = (client: Client): CardActionItem[] => [
    {
      label: 'Editar',
      icon: <Edit2 size={13} />,
      onClick: () => setEditingClient(client),
    },
    {
      label: 'Ver ficha',
      icon: <FileText size={13} />,
      onClick: () => setViewingClient(client),
    },
    {
      label: 'Agendar',
      icon: <Calendar size={13} />,
      onClick: () => setAppointmentClient({ id: client.id, name: client.name }),
    },
    {
      label: 'Enviar email',
      icon: <Mail size={13} />,
      onClick: () => navigate(`/clients/${client.id}/email`),
    },
    {
      label: 'WhatsApp',
      icon: <MessageCircle size={13} />,
      disabled: !whatsappDigits(client.phone),
      onClick: () => {
        const digits = whatsappDigits(client.phone);
        if (!digits) return;
        window.open(`https://wa.me/${digits}`, '_blank');
      },
    },
    {
      label: 'Videochamada',
      icon: <Video size={13} />,
      disabled: true,
    },
    {
      label: 'Excluir',
      icon: <Trash2 size={13} />,
      danger: true,
      onClick: () => {
        requestConfirm({
          title: 'Excluir cliente',
          message: `Tem certeza que deseja excluir "${client.name}"? Esta ação não poderá ser desfeita.`,
          confirmLabel: 'Excluir',
          onConfirm: () => deleteClient(client.id),
        });
      },
    },
  ];

  // Estágios principais (visíveis) e secundários (dropdown "Outros")
  const PRIMARY_STAGES = CLIENT_STAGES.slice(0, 8); // até "Contrato"
  const SECONDARY_STAGES = CLIENT_STAGES.slice(8);  // Formulários → Concluído
  const activeIsSecondary = SECONDARY_STAGES.includes(activeStage as ClientStage);

  // Filtro por coordenador via query param (vindo do Dashboard do Gerente)
  const urlParams = new URLSearchParams(location.search);
  const coordFilterId = urlParams.get('coordinator');
  const coordFilterName = urlParams.get('coordName');

  useEffect(() => {
    if (location.state?.initialStage) {
      setActiveStage(location.state.initialStage);
    }
    if (location.state?.tab === 'documentacao') {
      setMainTab('documentacao');
    }
    if (location.state?.openNewClient) {
      setNewClientPrefill(location.state.prefill);
      setIsNewClientModalOpen(true);
      navigate(location.pathname + location.search, { replace: true, state: { ...location.state, openNewClient: undefined, prefill: undefined } });
    }
  }, [location.state]);

  const handleSendManagerAlert = async (client: Client) => {
    const ownerId = (client as any).owner_id;
    if (!ownerId) { alert('Cliente sem responsável definido.'); return; }

    const ownerProfile = allProfiles.find(p => p.id === ownerId);

    // Busca managerId: primeiro direto no perfil, depois via equipe
    let managerId: string | null = (ownerProfile as any)?.manager_id || null;
    if (!managerId && ownerProfile?.team_id) {
      const team = teams.find(t => t.id === ownerProfile.team_id);
      managerId = team?.manager_id || null;
    }

    if (!managerId) { alert('Gerente não encontrado para este cliente.'); return; }

    const myId = user?.id;
    if (!myId) return;

    const conversationId = [myId, managerId].sort().join('_');
    const managerProfile = allProfiles.find(p => p.id === managerId);
    const senderProfile = allProfiles.find(p => p.id === myId);
    const msg = `⚠️ ALERTA URGENTE\n\nCliente: ${client.name}\nEtapa: ${client.stage}\nResponsável: ${ownerProfile?.name || '—'}\n\nEste cliente requer sua atenção imediata.\n\n— ${senderProfile?.name || 'Diretoria'}`;

    // Envia mensagem no chat
    const { error: chatError } = await supabase.from('chat_messages').insert({
      sender_id: myId,
      receiver_id: managerId,
      conversation_id: conversationId,
      content: msg,
      type: 'text',
    });

    // Envia notificação direta para o gerente
    await supabase.functions.invoke('send-notification', {
      body: {
        target_user_id: managerId,
        type: 'aviso',
        title: `⚠️ Alerta: Cliente parado — ${client.name}`,
        message: `${client.name} está na etapa "${client.stage}" há muito tempo. Atenção necessária.`,
        reference_route: `/clients/${client.id}`,
      },
    });

    if (chatError) alert('Erro ao enviar alerta.');
    else alert(`Alerta enviado para ${managerProfile?.name || 'o gerente'}!`);
  };

  const filteredClients = clients.filter(client => {
    const matchesStage = activeStage === 'Todos' || client.stage === activeStage;
    const matchesSearch =
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.development || '').toLowerCase().includes(searchTerm.toLowerCase());
    // Filtro por coordenador (quando vindo do Dashboard)
    if (coordFilterId) {
      const ownerId = (client as any).owner_id;
      const ownerProfile = ownerId ? allProfiles.find(p => p.id === ownerId) : null;
      const belongsToCoord =
        ownerProfile?.coordinator_id === coordFilterId || ownerId === coordFilterId;
      return matchesStage && matchesSearch && belongsToCoord;
    }
    return matchesStage && matchesSearch;
  });

  // Kanban: mesmos clientes, mas sem filtrar por estágio (cada estágio é uma coluna).
  const kanbanClients = clients.filter(client => {
    const matchesSearch =
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.development || '').toLowerCase().includes(searchTerm.toLowerCase());
    if (coordFilterId) {
      const ownerId = (client as any).owner_id;
      const ownerProfile = ownerId ? allProfiles.find(p => p.id === ownerId) : null;
      return matchesSearch && (ownerProfile?.coordinator_id === coordFilterId || ownerId === coordFilterId);
    }
    return matchesSearch;
  });

  const filteredLeads = leads.filter(lead =>
    lead.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (lead.origin || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleConvert = (lead: AutomationLead) => {
    openNewClientModal({
      name: lead.name || '',
      phone: lead.phone || '',
      notes: lead.aiSummary ? `Resumo IA: ${lead.aiSummary}` : '',
      origin: lead.origin || 'Novo Lead',
    });
  };

  return (
    <div className="h-full flex flex-col bg-surface-50">
      {/* Header */}
      <div className="px-6 pt-8 pb-3 z-10">
        <div className="flex justify-between items-center mb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-400">Carteira</p>
            <h1 className="v3-serif text-2xl sm:text-3xl text-text-primary tracking-tight mt-1">Gestão de Clientes</h1>
            <p className="text-sm text-text-secondary mt-1">Acompanhe e mova seus clientes pelo funil de vendas.</p>
          </div>
          <RoundedButton size="sm" onClick={() => openNewClientModal()} className="flex items-center gap-1">
            <Plus size={16} /> Novo Cliente
          </RoundedButton>
        </div>

        {/* Main Tabs */}
        <div className="flex gap-1 bg-surface-100 rounded-xl p-1 border border-surface-200">
          <button
            onClick={() => setMainTab('clientes')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${mainTab === 'clientes'
              ? 'bg-card-bg border border-surface-200 text-text-primary'
              : 'text-text-secondary hover:text-text-primary'
              }`}
          >
            Clientes
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-surface-100 text-text-secondary">
              {clients.length}
            </span>
          </button>
          <button
            onClick={() => setMainTab('documentacao')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${mainTab === 'documentacao'
              ? 'bg-card-bg border border-surface-200 text-text-primary'
              : 'text-text-secondary hover:text-text-primary'
              }`}
          >
            <span className="flex items-center gap-1.5">
              <Zap size={13} className={mainTab === 'documentacao' ? 'text-green-500' : ''} />
              Novo Lead
            </span>
            {leads.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-500 text-white animate-pulse">
                {leads.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-6 pt-3 pb-2">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
            <input
              type="text"
              placeholder={mainTab === 'clientes' ? 'Buscar cliente...' : 'Buscar lead...'}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-card-bg border border-surface-200 rounded-xl text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all placeholder:text-text-secondary"
            />
          </div>
          {mainTab === 'clientes' && (
            <div className="flex flex-shrink-0 rounded-xl border border-surface-200 bg-surface-100/40 p-0.5">
              <button
                onClick={() => setPipelineView('list')}
                className={`flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${pipelineView === 'list' ? 'bg-card-bg text-text-primary border border-surface-200' : 'text-text-secondary'}`}
              ><List size={14} /> Lista</button>
              <button
                onClick={() => setPipelineView('kanban')}
                className={`flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${pipelineView === 'kanban' ? 'bg-card-bg text-text-primary border border-surface-200' : 'text-text-secondary'}`}
              ><LayoutGrid size={14} /> Kanban</button>
            </div>
          )}
        </div>
      </div>

      {/* ── KANBAN (pipeline drag-and-drop) ── */}
      {mainTab === 'clientes' && pipelineView === 'kanban' && (
        <ClientsKanban
          clients={kanbanClients}
          stages={CLIENT_STAGES}
          renderActions={(client) => <CardActionsMenu items={clientCardActions(client)} />}
          onCardOpen={(client) => setViewingClient(client)}
          onMove={(id, stage) => {
            if (isStageRestrictedForRole(stage, role)) {
              alert('⚠️ Você não tem permissão para mover clientes para a etapa "' + stage + '".');
              return;
            }
            if (stage === 'Concluído') {
              const c = clients.find(x => x.id === id);
              const missing = c ? missingFieldsForConcluido(c) : ['dados do cliente'];
              if (missing.length > 0) {
                alert(`⚠️ Para concluir a venda, preencha na ficha do cliente: ${missing.join(', ')}.`);
                return;
              }
            }
            updateClient(id, { stage });
          }}
        />
      )}

      {/* ── CLIENTES TAB ── */}
      {mainTab === 'clientes' && pipelineView === 'list' && (
        <>
          {/* Stage Filter Chips */}

          {/* ── Mobile filter (below md): Todos + Documentação + Mais ▼ ───── */}
          <div className="md:hidden pt-2 pb-2 px-6 flex gap-1.5 items-center">
            {/* Todos */}
            <button
              onClick={() => { setActiveStage('Todos'); setMoreDropdownOpen(false); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeStage === 'Todos'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-card-bg text-text-secondary border border-surface-200'
              }`}
            >
              Todos ({clients.length})
            </button>

            {/* Documentação — always visible on mobile */}
            <button
              onClick={() => { setActiveStage('Documentação'); setMoreDropdownOpen(false); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeStage === 'Documentação'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-card-bg text-text-secondary border border-surface-200'
              }`}
            >
              Documentação
            </button>

            {/* Mais ▼ — opens grid with all remaining stages */}
            <div className="relative flex-shrink-0">
              <button
                onClick={() => setMoreDropdownOpen(o => !o)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeStage !== 'Todos' && activeStage !== 'Documentação'
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-card-bg text-text-secondary border border-surface-200'
                }`}
              >
                {activeStage !== 'Todos' && activeStage !== 'Documentação'
                  ? activeStage.length > 8 ? activeStage.slice(0, 8) + '…' : activeStage
                  : 'Mais'}
                <ChevronDown size={11} className={`transition-transform ${moreDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {moreDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-50 bg-card-bg border border-surface-200 rounded-2xl shadow-lg p-3 min-w-[220px]">
                    {/* Primary stages (excluding Documentação already pinned) */}
                    <div className="grid grid-cols-2 gap-1.5 mb-2">
                      {PRIMARY_STAGES.filter(s => s !== 'Documentação').map(stage => (
                        <button
                          key={stage}
                          onClick={() => { setActiveStage(stage); setMoreDropdownOpen(false); }}
                          className={`px-2 py-1.5 rounded-xl text-xs font-medium transition-colors text-center ${
                            activeStage === stage
                              ? 'bg-gold-500 text-white'
                              : 'bg-surface-50 text-text-primary hover:bg-surface-100'
                          }`}
                        >
                          {stage}
                        </button>
                      ))}
                    </div>
                    {/* Divider + secondary stages */}
                    <div className="border-t border-surface-200 pt-2">
                      <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1.5 px-1">Outros</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {SECONDARY_STAGES.map(stage => (
                          <button
                            key={stage}
                            onClick={() => { setActiveStage(stage); setMoreDropdownOpen(false); }}
                            className={`px-2 py-1.5 rounded-xl text-xs font-medium transition-colors text-center ${
                              activeStage === stage
                                ? 'bg-primary-600 text-white'
                                : 'bg-surface-50 text-text-primary hover:bg-surface-100'
                            }`}
                          >
                            {stage}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Desktop filter (md and above): all pills + Outros dropdown ── */}
          <div className="hidden md:block pt-2 pb-2 px-6">
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-surface-200 bg-surface-100/40 p-1">
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar">
                {/* Chip: Todos */}
                <button
                  onClick={() => setActiveStage('Todos')}
                  className={`h-8 flex-shrink-0 whitespace-nowrap px-3 rounded-lg text-xs font-medium transition-all ${activeStage === 'Todos'
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-card-bg text-text-secondary border border-surface-200'
                    }`}
                >
                  Todos ({clients.length})
                </button>

                {/* Chips primários */}
                {PRIMARY_STAGES.map(stage => (
                  <button
                    key={stage}
                    onClick={() => setActiveStage(stage)}
                    className={`h-8 flex-shrink-0 whitespace-nowrap px-3 rounded-lg text-xs font-medium transition-all ${activeStage === stage
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-card-bg text-text-secondary border border-surface-200'
                      }`}
                  >
                    {stage}
                  </button>
                ))}
              </div>
              {/* Dropdown "Outros" — fora da área de scroll (não é cortado) */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => setStageDropdownOpen(o => !o)}
                  className={`flex h-8 min-w-[86px] items-center justify-center gap-1 whitespace-nowrap px-3 rounded-lg text-xs font-medium transition-all ${
                    activeIsSecondary
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-card-bg text-text-secondary border border-surface-200'
                  }`}
                >
                  {activeIsSecondary ? activeStage : 'Outros'}
                  <ChevronDown size={11} className={`transition-transform ${stageDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {stageDropdownOpen && (
                  <>
                    {/* Overlay para fechar */}
                    <div className="fixed inset-0 z-40" onClick={() => setStageDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-50 bg-card-bg border border-surface-200 rounded-2xl shadow-lg py-1.5 min-w-[160px]">
                      {SECONDARY_STAGES.map(stage => (
                        <button
                          key={stage}
                          onClick={() => { setActiveStage(stage); setStageDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors hover:bg-surface-50 ${
                            activeStage === stage ? 'text-gold-600 font-bold' : 'text-text-primary'
                          }`}
                        >
                          {stage}
                          {activeStage === stage && <span className="ml-1 text-gold-500">✓</span>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                </div>
              </div>
            </div>

          <div className="flex-1 px-6 py-4 space-y-4 overflow-y-auto pb-24">
            {/* Banner de filtro por coordenador */}
            {coordFilterId && coordFilterName && (
              <div className="flex items-center justify-between bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl px-4 py-2">
                <p className="text-xs text-purple-700 dark:text-purple-300 font-medium">
                  📋 Filtrando por coordenação: <span className="font-bold">{decodeURIComponent(coordFilterName)}</span>
                </p>
                <button onClick={() => navigate('/clients')} className="text-xs text-purple-500 hover:text-purple-700 font-medium underline ml-2">
                  Limpar
                </button>
              </div>
            )}
            {loading && (
              <div className="flex justify-center py-10">
                <Loader2 className="animate-spin text-gold-500" size={32} />
              </div>
            )}
            {filteredClients.map(client => {
              const ownerId = (client as any).owner_id;
              const urgency = getClientUrgency(client);
              return (
              <PremiumCard
                key={client.id}
                interactive
                className={`relative group ${canViewUrgencyState && urgency.level === 'critical' ? 'border-red-300 dark:border-red-700' : canViewUrgencyState && urgency.level === 'urgent' ? 'border-orange-300 dark:border-orange-700' : ''}`}
                onClick={() => setViewingClient(client)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0 pr-2">
                    <h3 className="font-bold text-text-primary text-lg">{client.name}</h3>
                    <p className="text-sm text-text-secondary">{client.development || 'Sem empreendimento'}</p>
                  </div>
                  <div className="flex items-start gap-2 flex-shrink-0">
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={client.stage} />
                      {canViewUrgencyState && urgency.level && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          urgency.level === 'critical' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400' :
                          urgency.level === 'urgent'   ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' :
                                                         'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                        }`}>
                          <AlertTriangle size={9} />
                          {urgency.level === 'critical' ? 'Crítico' : urgency.level === 'urgent' ? 'Urgente' : 'Atenção'} · {urgency.days}d
                        </span>
                      )}
                    </div>
                    <CardActionsMenu items={clientCardActions(client)} />
                  </div>
                </div>
                {/* Tags hierárquicas — visíveis para liderança */}
                {canViewAllClients && (
                  <ClientHierarchyTags
                    ownerId={ownerId}
                    allProfiles={allProfiles}
                    teams={teams}
                    directorates={directorates}
                    className="mb-2"
                  />
                )}
                <div className="flex justify-between items-center mt-2 mb-4">
                  <span className="font-mono text-sm font-semibold text-text-primary bg-surface-100 px-2 py-1 rounded-md">
                    {client.intendedValue || '—'}
                  </span>
                </div>
                <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                  <RoundedButton variant="secondary" size="sm" className="flex-1 h-9 text-xs" href={`tel:+55${client.phone?.replace(/\D/g, '')}`}>
                    <Phone size={14} /> Ligar
                  </RoundedButton>
                  <RoundedButton
                    variant="secondary" size="sm" className="flex-1 h-9 text-xs"
                    onClick={e => { e.stopPropagation(); navigate(`/clients/${client.id}/email`); }}
                  >
                    <Mail size={14} /> Email
                  </RoundedButton>
                  {canViewUrgencyState && urgency.level && (
                    <RoundedButton
                      variant="secondary" size="sm"
                      className={`h-9 px-3 text-xs ${
                        urgency.level === 'critical'
                          ? 'text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 hover:bg-danger-subtle dark:hover:bg-red-900/20'
                          : urgency.level === 'urgent'
                          ? 'text-orange-500 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20'
                          : urgency.level === 'warning'
                          ? 'text-yellow-500 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                          : 'text-blue-500 dark:text-blue-400 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                      }`}
                      onClick={e => { e.stopPropagation(); handleSendManagerAlert(client); }}
                    >
                      <AlertTriangle size={14} />
                    </RoundedButton>
                  )}
                </div>
              </PremiumCard>
              );
            })}
            {filteredClients.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-40 text-text-secondary gap-3">
                <p>Nenhum cliente encontrado</p>
                <RoundedButton size="sm" variant="outline" onClick={() => openNewClientModal()}>
                  <Plus size={16} /> Adicionar cliente
                </RoundedButton>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── DOCUMENTAÇÃO TAB ── */}
      {mainTab === 'documentacao' && (
        <div className="flex-1 px-5 py-4 overflow-y-auto pb-24">
          {/* Header info bar */}
          <div className="flex items-center justify-end mb-4">
            <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Fila ativa
            </span>
          </div>

          {loading && (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-gold-500" size={32} />
            </div>
          )}

          {/* Success toast */}
          <AnimatePresence>
            {convertSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                className="mb-4 flex items-center gap-2 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm font-semibold"
              >
                <CheckCircle2 size={16} />
                Ficha criada com sucesso! O lead foi movido para Clientes.
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {filteredLeads.length === 0 && !loading ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-64 text-center"
              >
                <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-green-500" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">Tudo em dia!</h3>
                <p className="text-sm text-text-secondary max-w-xs mt-2">
                  Não há novos leads na fila no momento. Quando chegarem via WhatsApp, aparecerão aqui automaticamente.
                </p>
              </motion.div>
            ) : (
              <div className="space-y-4">
                {filteredLeads.map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onConvert={handleConvert}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>
      )}

      <Modal
        isOpen={isNewClientModalOpen}
        onClose={closeNewClientModal}
        title="Novo Cliente"
        panelClassName="max-w-2xl"
      >
        <NewClientForm
          key={isNewClientModalOpen ? `${newClientPrefill?.name ?? ''}-${newClientPrefill?.phone ?? 'new'}` : 'closed'}
          embedded
          prefill={newClientPrefill}
          onSuccess={closeNewClientModal}
        />
      </Modal>

      <ClientFichaModal
        isOpen={!!viewingClient}
        client={viewingClient}
        onClose={() => setViewingClient(null)}
      />

      <EditClientModal
        isOpen={!!editingClient}
        client={editingClient}
        onClose={() => setEditingClient(null)}
      />

      <CreateAppointmentModal
        isOpen={!!appointmentClient}
        onClose={() => setAppointmentClient(null)}
        initialValues={appointmentClient ? {
          title: `Visita — ${appointmentClient.name}`,
          client_name: appointmentClient.name,
          client_id: appointmentClient.id,
          type: 'Visita',
        } : undefined}
      />

      <ConfirmDialog {...confirmDialogProps} />

    </div>
  );
}
