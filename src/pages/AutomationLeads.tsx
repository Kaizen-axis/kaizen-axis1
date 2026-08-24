import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard, RoundedButton, SectionHeader } from '@/components/ui/PremiumComponents';
import { ChevronLeft, MessageCircle, Edit, UserPlus, Clock, CheckCircle2, AlertCircle, Phone } from 'lucide-react';

interface AutomationLead {
  id: string;
  name: string; // Provisional name
  phone: string;
  origin: string;
  timestamp: string;
  aiSummary: string;
  interestLevel: 'Alto' | 'Médio' | 'Baixo';
  data?: {
    income?: string;
    region?: string;
    propertyType?: string;
  };
}

// Mock data simulating leads from n8n webhook
const MOCK_LEADS: AutomationLead[] = [
  {
    id: 'lead-001',
    name: 'Contato via Instagram',
    phone: '11999998888',
    origin: 'Instagram Ads - Campanha Lançamento',
    timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 mins ago
    aiSummary: 'Cliente interessado em apartamentos de 2 dormitórios na zona sul. Renda compatível com financiamento. Perguntou sobre entrada parcelada.',
    interestLevel: 'Alto',
    data: {
      income: 'R$ 8.000',
      region: 'Zona Sul',
      propertyType: 'Apartamento 2 dorms'
    }
  },
  {
    id: 'lead-002',
    name: 'Visitante Site',
    phone: '11977776666',
    origin: 'Site Oficial - Formulário Contato',
    timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
    aiSummary: 'Dúvida sobre valores do empreendimento Vista Verde. Ainda não possui financiamento aprovado.',
    interestLevel: 'Médio',
    data: {
      income: 'Não informado',
      region: 'Centro',
      propertyType: 'Studio'
    }
  }
];

export default function AutomationLeads() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<AutomationLead[]>(MOCK_LEADS);
  const [selectedLead, setSelectedLead] = useState<AutomationLead | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');

  const handleOpenWhatsapp = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    window.open(`https://wa.me/55${cleanPhone}`, '_blank');
  };

  const handleRename = () => {
    if (selectedLead && newName.trim()) {
      const updatedLeads = leads.map(l => 
        l.id === selectedLead.id ? { ...l, name: newName } : l
      );
      setLeads(updatedLeads);
      setSelectedLead({ ...selectedLead, name: newName });
      setIsRenaming(false);
    }
  };

  const handleCreateClient = (lead: AutomationLead) => {
    navigate('/clients', {
      state: {
        openNewClient: true,
        prefill: {
          name: lead.name !== 'Contato via Instagram' && lead.name !== 'Visitante Site' ? lead.name : '',
          phone: lead.phone,
          origin: lead.origin,
          notes: `Resumo IA: ${lead.aiSummary}\n\nDados Coletados:\nRenda: ${lead.data?.income}\nRegião: ${lead.data?.region}\nTipo: ${lead.data?.propertyType}`
        }
      }
    });
  };

  if (selectedLead) {
    return (
      <div className="min-h-screen bg-surface-50 pb-24">
        {/* Header */}
        <div className="bg-card-bg shadow-sm px-4 py-4 sticky top-0 z-20 flex items-center gap-4">
          <button onClick={() => setSelectedLead(null)} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Detalhes do Lead</h1>
        </div>

        <div className="p-6 space-y-6">
          <PremiumCard className="space-y-4">
            <div className="flex justify-between items-start">
              <div>
                {isRenaming ? (
                  <div className="flex items-center gap-2">
                    <input 
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="border border-gold-300 rounded px-2 py-1 text-lg font-bold text-text-primary focus:outline-none focus:ring-2 focus:ring-gold-500"
                      autoFocus
                    />
                    <button onClick={handleRename} className="text-green-600 p-1"><CheckCircle2 size={20} /></button>
                  </div>
                ) : (
                  <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
                    {selectedLead.name}
                    <button onClick={() => { setIsRenaming(true); setNewName(selectedLead.name); }} className="text-text-secondary hover:text-gold-500">
                      <Edit size={16} />
                    </button>
                  </h2>
                )}
                <p className="text-sm text-text-secondary mt-1 flex items-center gap-1">
                  <Phone size={14} /> {selectedLead.phone}
                </p>
              </div>
              <span className={`px-3 py-1 rounded-lg text-xs font-medium border ${
                selectedLead.interestLevel === 'Alto' ? 'bg-green-50 text-green-700 border-green-200' :
                selectedLead.interestLevel === 'Médio' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                'bg-subtle-bg text-text-primary border-line-subtle'
              }`}>
                Interesse {selectedLead.interestLevel}
              </span>
            </div>

            <div className="bg-surface-50 p-4 rounded-xl border border-surface-200">
              <h3 className="text-xs font-bold text-text-secondary uppercase mb-2 flex items-center gap-1">
                <AlertCircle size={14} /> Resumo do Atendimento IA
              </h3>
              <p className="text-sm text-text-primary leading-relaxed">
                {selectedLead.aiSummary}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-50 p-3 rounded-lg">
                <p className="text-xs text-text-secondary">Origem</p>
                <p className="text-sm font-medium text-text-primary truncate">{selectedLead.origin}</p>
              </div>
              <div className="bg-surface-50 p-3 rounded-lg">
                <p className="text-xs text-text-secondary">Chegou às</p>
                <p className="text-sm font-medium text-text-primary">
                  {new Date(selectedLead.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <RoundedButton 
                onClick={() => handleOpenWhatsapp(selectedLead.phone)}
                className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white border-none shadow-none flex items-center justify-center gap-2"
              >
                <MessageCircle size={20} /> Iniciar Conversa no WhatsApp
              </RoundedButton>
              
              <RoundedButton 
                onClick={() => handleCreateClient(selectedLead)}
                variant="outline"
                fullWidth
                className="flex items-center justify-center gap-2"
              >
                <UserPlus size={20} /> Criar Ficha Completa
              </RoundedButton>
            </div>
          </PremiumCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 pb-24">
      {/* Header */}
      <div className="bg-card-bg shadow-sm px-4 py-4 sticky top-0 z-20 flex items-center gap-4">
        <button onClick={() => navigate('/clients')} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
          <ChevronLeft size={24} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-text-primary">Novos Leads (Automação)</h1>
          <p className="text-xs text-text-secondary">Fila de distribuição automática</p>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 bg-surface-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 size={32} className="text-green-500" />
            </div>
            <h3 className="text-lg font-semibold text-text-primary">Tudo em dia!</h3>
            <p className="text-sm text-text-secondary max-w-xs mt-2">
              Você não tem novos leads pendentes na fila de automação no momento.
            </p>
          </div>
        ) : (
          leads.map((lead) => (
            <PremiumCard 
              key={lead.id}
              interactive
              onClick={() => setSelectedLead(lead)}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">Novo Lead Recebido</span>
                </div>
                <span className="text-xs text-text-secondary flex items-center gap-1">
                  <Clock size={12} />
                  {new Date(lead.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              
              <h3 className="font-bold text-text-primary text-lg mb-1">{lead.name}</h3>
              <p className="text-sm text-text-secondary mb-3 truncate">{lead.origin}</p>
              
              <div className="bg-surface-50 p-3 rounded-lg border border-surface-100">
                <p className="text-xs text-text-secondary line-clamp-2">
                  <span className="font-semibold text-text-primary">IA:</span> {lead.aiSummary}
                </p>
              </div>
            </PremiumCard>
          ))
        )}
      </div>
    </div>
  );
}
