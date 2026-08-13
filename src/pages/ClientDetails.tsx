import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PremiumCard, StatusBadge, SectionHeader, RoundedButton } from '@/components/ui/PremiumComponents';
import { ChevronLeft, Phone, Mail, Calendar, Edit2, Check, Building2, Wallet, History, Trash2, FileText, Save, X, UploadCloud, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Client, CLIENT_STAGES, ClientStage, isStageRestrictedForRole, missingFieldsForConcluido } from '@/data/clients';
import { RJ_CITIES, getNeighborhoods } from '@/data/cities';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { BuilderSelect } from '@/components/ui/BuilderSelect';
import { motion, AnimatePresence } from 'motion/react';
import { Modal } from '@/components/ui/Modal';
import { useApp } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { supabase } from '@/lib/supabase';
import { logAuditEvent } from '@/services/auditLogger';
import { ClientHierarchyTags } from '@/components/ui/ClientHierarchyTags';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { loadKaizenLogo, drawReportHeader, addStandardFooters } from '@/lib/pdf/reportKit';

type SalesMirrorForm = {
  diretoria: string;
  constInvest: string;
  empreendimento: string;
  cliente1: string;
  cpf1: string;
  cliente2: string;
  cpf2: string;
  vgv: string;
  origem: string;
  unidade: string;
  gerente: string;
  bloco: string;
  coordenador: string;
  corretor: string;
  dataAto: string;
  valorAto: string;
  pagoPelaKaizen: string;
  cca: string;
  dataContrato: string;
  assGerente: string;
  assDiretorVenda: string;
  assSetorAvulso: string;
  assDiretorFinanceiro: string;
  assDiretorComercial: string;
};

const EMPTY_SALES_MIRROR: SalesMirrorForm = {
  diretoria: '', constInvest: '', empreendimento: '', cliente1: '', cpf1: '', cliente2: '', cpf2: '', vgv: '', origem: '', unidade: '', gerente: '', bloco: '', coordenador: '', corretor: '', dataAto: '', valorAto: '', pagoPelaKaizen: '', cca: '', dataContrato: '', assGerente: '', assDiretorVenda: '', assSetorAvulso: '', assDiretorFinanceiro: '', assDiretorComercial: '',
};

const formatCurrencyInput = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const value = Number(digits) / 100;
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDateInput = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

export default function ClientDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    getClient,
    updateClient,
    deleteClient,
    userName,
    getDownloadUrl,
    uploadFile,
    addDocumentToClient,
    deleteDocumentFromClient,
    addClientProponent,
    updateClientProponent,
    deleteClientProponent,
    clients,
    allProfiles,
    teams,
    directorates,
  } = useApp();
  const { role, canViewAllClients } = useAuthorization();

  // Regra de etapas avançadas centralizada em @/data/clients (isStageRestrictedForRole)

  const [client, setClient] = useState<Client | null>(null);
  const [isEditingStage, setIsEditingStage] = useState(false);
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isDeleteClientModalOpen, setIsDeleteClientModalOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [newProponent, setNewProponent] = useState({
    name: '',
    cpf: '',
    email: '',
    phone: '',
    address: '',
    profession: '',
    grossIncome: '',
    incomeType: 'Formal' as 'Formal' | 'Informal',
    cotista: 'Não',
    socialFactor: 'Não',
  });
  const [editingProponentId, setEditingProponentId] = useState<string | null>(null);
  const [openProponentIndex, setOpenProponentIndex] = useState<number | null>(null);
  const [showAddProponentForm, setShowAddProponentForm] = useState(false);
  const [editingProponent, setEditingProponent] = useState({
    name: '',
    cpf: '',
    email: '',
    phone: '',
    address: '',
    profession: '',
    grossIncome: '',
    incomeType: 'Formal' as 'Formal' | 'Informal',
    cotista: 'Não',
    socialFactor: 'Não',
  });
  const [isSalesMirrorOpen, setIsSalesMirrorOpen] = useState(false);
  const [salesMirrorLoading, setSalesMirrorLoading] = useState(false);
  const [salesMirrorSaving, setSalesMirrorSaving] = useState(false);
  const [salesMirrorForm, setSalesMirrorForm] = useState<SalesMirrorForm>(EMPTY_SALES_MIRROR);

  // Load from context
  useEffect(() => {
    if (!id) return;
    const found = getClient(id);
    if (found) {
      setClient(found);
      setEditForm(found);
    }
  }, [id, getClient, clients]);

  useEffect(() => {
    if (id && client) {
      logAuditEvent({ action: 'client_view', entity: 'client', entityId: id });
    }
  }, [id, client?.id]);

  const handleStageChange = async (newStage: ClientStage) => {
    if (!client || !id) return;

    // Bloqueia CORRETOR de avançar para etapas avançadas
    if (isStageRestrictedForRole(newStage, role)) {
      alert(`⛔ Apenas Coordenador, Gerente, Diretor ou ADMIN podem mover o cliente para "${newStage}".`);
      setIsEditingStage(false);
      return;
    }

    if (newStage === 'Concluído') {
      const missing = missingFieldsForConcluido(client);
      if (missing.length > 0) {
        alert(`⚠️ Para concluir a venda, preencha: ${missing.join(', ')}.`);
        setIsEditingStage(false);
        setIsEditingInfo(true);
        return;
      }
    }

    try {
      await updateClient(id, { stage: newStage });
      setIsEditingStage(false);
    } catch (e: any) {
      const msg = e?.message || 'Erro desconhecido';
      alert(`Erro ao atualizar estágio:\n${msg}`);
    }
  };

  const handleSaveInfo = async () => {
    if (!client || !id) return;

    try {
      await updateClient(id, editForm);
      setIsEditingInfo(false);
    } catch (e) {
      alert('Erro ao salvar informações.');
    }
  };

  const confirmDeleteClient = async () => {
    if (!id) return;
    try {
      await deleteClient(id);
      setIsDeleteClientModalOpen(false);
      navigate('/clients');
    } catch (e) {
      alert('Erro ao excluir cliente.');
    }
  };

  const handleOpenDocument = async (rawPath: string, documentId?: string) => {
    if (!rawPath) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) { alert('Sessão expirada. Faça login novamente.'); return; }
    const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

    try {
      const { data: v2Data, error: v2Error } = await supabase.functions.invoke('get-doc-url-v2', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: { documentId: documentId || undefined, rawPath, expiresIn: 300 },
      });

      const signedUrl = v2Data?.signedUrl ?? null;
      if (v2Error || !signedUrl) {
        alert('Erro ao abrir documento.');
        return;
      }

      logAuditEvent({
        action: 'document_downloaded',
        entity: 'client_document',
        entityId: documentId || rawPath,
        metadata: { client_id: id }
      });
      logAuditEvent({
        action: 'document_downloaded',
        entity: 'client_document',
        entityId: documentId || rawPath,
        userId: session?.user?.id ?? null,
        metadata: { clientId: id, rawPath },
      });

      window.open(signedUrl, '_blank');
    } catch {
      alert('Erro ao abrir documento.');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !id) return;

    setIsUploading(true);
    try {
      const filePath = `${id}/${Date.now()}-${file.name}`;
      const uploadedPath = await uploadFile(file, filePath, 'client-documents');

      if (uploadedPath) {
        const dbResult = await addDocumentToClient(id, file.name, uploadedPath);
        if (dbResult.success) {
          alert('Documento anexado com sucesso!');
        } else {
          alert(`Erro do Banco de Dados: ${dbResult.error}`);
        }
      } else {
        alert('Erro ao fazer upload do documento.');
      }
    } catch (e) {
      alert('Erro inesperado durante o upload.');
    } finally {
      setIsUploading(false);
      event.target.value = ''; // reset input
    }
  };

  const handleDeleteDocument = (docId: string) => {
    setDocumentToDelete(docId);
  };

  const handleAddProponent = async () => {
    if (!id || !newProponent.name.trim()) {
      alert('Informe o nome do proponente.');
      return;
    }

    const result = await addClientProponent(id, {
      name: newProponent.name.trim(),
      cpf: newProponent.cpf.trim() || undefined,
      email: newProponent.email.trim() || undefined,
      phone: newProponent.phone.trim() || undefined,
      address: newProponent.address.trim() || undefined,
      profession: newProponent.profession.trim() || undefined,
      grossIncome: newProponent.grossIncome.trim() || undefined,
      incomeType: newProponent.incomeType,
      cotista: newProponent.cotista,
      socialFactor: newProponent.socialFactor,
      isPrimary: false,
    });

    if (!result.success) {
      alert(`Erro ao adicionar proponente: ${result.error || 'erro desconhecido'}`);
      return;
    }

    setNewProponent({
      name: '',
      cpf: '',
      email: '',
      phone: '',
      address: '',
      profession: '',
      grossIncome: '',
      incomeType: 'Formal',
      cotista: 'Não',
      socialFactor: 'Não',
    });
    setShowAddProponentForm(false);
  };

  const startEditProponent = (proponent: any) => {
    setEditingProponentId(proponent.id);
    setEditingProponent({
      name: proponent.name || '',
      cpf: proponent.cpf || '',
      email: proponent.email || '',
      phone: proponent.phone || '',
      address: proponent.address || '',
      profession: proponent.profession || '',
      grossIncome: proponent.grossIncome || '',
      incomeType: (proponent.incomeType || 'Formal') as 'Formal' | 'Informal',
      cotista: proponent.cotista || 'Não',
      socialFactor: proponent.socialFactor || 'Não',
    });
  };

  const cancelEditProponent = () => {
    setEditingProponentId(null);
    setEditingProponent({
      name: '',
      cpf: '',
      email: '',
      phone: '',
      address: '',
      profession: '',
      grossIncome: '',
      incomeType: 'Formal',
      cotista: 'Não',
      socialFactor: 'Não',
    });
  };

  const saveEditProponent = async () => {
    if (!editingProponentId) return;
    if (!editingProponent.name.trim()) {
      alert('Informe o nome do proponente.');
      return;
    }

    const result = await updateClientProponent(editingProponentId, {
      name: editingProponent.name.trim(),
      cpf: editingProponent.cpf.trim() || undefined,
      email: editingProponent.email.trim() || undefined,
      phone: editingProponent.phone.trim() || undefined,
      address: editingProponent.address.trim() || undefined,
      profession: editingProponent.profession.trim() || undefined,
      grossIncome: editingProponent.grossIncome.trim() || undefined,
      incomeType: editingProponent.incomeType,
      cotista: editingProponent.cotista,
      socialFactor: editingProponent.socialFactor,
    });

    if (!result.success) {
      alert(`Erro ao atualizar proponente: ${result.error || 'erro desconhecido'}`);
      return;
    }

    cancelEditProponent();
  };

  const handleDeleteProponent = async (proponentId: string) => {
    const confirmed = window.confirm('Deseja realmente remover este proponente?');
    if (!confirmed) return;

    const result = await deleteClientProponent(proponentId);
    if (!result.success) {
      alert(`Erro ao remover proponente: ${result.error || 'erro desconhecido'}`);
    }
  };

  const confirmDeleteDocument = async () => {
    if (!client || !documentToDelete || !id) return;

    const docTarget = client.documents.find(d => d.id === documentToDelete);
    if (!docTarget) {
      setDocumentToDelete(null);
      return;
    }

    const { success, error } = await deleteDocumentFromClient(docTarget.id, docTarget.file_path);

    if (success) {
      const { error: historyError } = await supabase
        .from('client_history')
        .insert([{ client_id: id, action: `Documento excluído: ${docTarget.name}`, user_name: userName }]);

      if (historyError) {
        console.error('Erro ao registrar histórico de exclusão de documento:', historyError);
      }

      const newHistory = [
        {
          id: Date.now().toString(),
          date: new Date().toLocaleDateString('pt-BR'),
          action: 'Documento excluído',
          user: userName,
        },
        ...client.history,
      ];

      const updatedDocs = client.documents.filter(d => d.id !== documentToDelete);
      const updated: Client = { ...client, documents: updatedDocs, history: newHistory };

      setClient(updated);
      alert('Documento excluído com sucesso!');
    } else {
      alert(`Erro ao excluir documento: ${error}`);
    }

    setDocumentToDelete(null);
  };

  const canUseSalesMirror = !!client && client.stage === 'Concluído' && ['ADMIN', 'DIRETOR', 'GERENTE', 'COORDENADOR'].includes(role ?? '');

  const buildDefaultSalesMirror = (): SalesMirrorForm => {
    if (!client) return EMPTY_SALES_MIRROR;
    const firstProponent = (client.proponents || [])[0];
    return {
      ...EMPTY_SALES_MIRROR,
      cliente1: client.name || '',
      cpf1: client.cpf || '',
      cliente2: firstProponent?.name || '',
      cpf2: firstProponent?.cpf || '',
      empreendimento: client.development || '',
      vgv: client.intendedValue || '',
    };
  };

  const openSalesMirror = async () => {
    if (!id || !canUseSalesMirror) return;
    setIsSalesMirrorOpen(true);
    setSalesMirrorLoading(true);
    const defaults = buildDefaultSalesMirror();
    setSalesMirrorForm(defaults);

    const { data, error } = await supabase.from('sales_mirrors').select('*').eq('client_id', id).maybeSingle();
    if (!error && data) {
      const pick = (value: any, fallback: string) => {
        const normalized = String(value ?? '').trim();
        return normalized ? normalized : fallback;
      };
      setSalesMirrorForm({
        diretoria: pick(data.diretoria, defaults.diretoria),
        constInvest: pick(data.const_invest, defaults.constInvest),
        empreendimento: pick(data.empreendimento, defaults.empreendimento),
        cliente1: pick(data.cliente_1, defaults.cliente1),
        cpf1: pick(data.cpf_1, defaults.cpf1),
        cliente2: pick(data.cliente_2, defaults.cliente2),
        cpf2: pick(data.cpf_2, defaults.cpf2),
        vgv: pick(data.vgv, defaults.vgv),
        origem: pick(data.origem, defaults.origem),
        unidade: pick(data.unidade, defaults.unidade),
        gerente: pick(data.gerente, defaults.gerente),
        bloco: pick(data.bloco, defaults.bloco),
        coordenador: pick(data.coordenador, defaults.coordenador),
        corretor: pick(data.corretor, defaults.corretor),
        dataAto: pick(data.data_ato, defaults.dataAto),
        valorAto: pick(data.valor_ato, defaults.valorAto),
        pagoPelaKaizen: pick(data.pago_pela_kaizen, defaults.pagoPelaKaizen),
        cca: pick(data.cca, defaults.cca),
        dataContrato: pick(data.data_contrato, defaults.dataContrato),
        assGerente: pick(data.ass_gerente, defaults.assGerente),
        assDiretorVenda: pick(data.ass_diretor_venda, defaults.assDiretorVenda),
        assSetorAvulso: pick(data.ass_setor_avulso, defaults.assSetorAvulso),
        assDiretorFinanceiro: pick(data.ass_diretor_financeiro, defaults.assDiretorFinanceiro),
        assDiretorComercial: pick(data.ass_diretor_comercial, defaults.assDiretorComercial),
      });
    }

    setSalesMirrorLoading(false);
  };

  const saveSalesMirror = async () => {
    if (!id || !canUseSalesMirror) return;
    setSalesMirrorSaving(true);
    const { error } = await supabase.from('sales_mirrors').upsert({
      client_id: id,
      diretoria: salesMirrorForm.diretoria,
      const_invest: salesMirrorForm.constInvest,
      empreendimento: salesMirrorForm.empreendimento,
      cliente_1: salesMirrorForm.cliente1,
      cpf_1: salesMirrorForm.cpf1,
      cliente_2: salesMirrorForm.cliente2,
      cpf_2: salesMirrorForm.cpf2,
      vgv: salesMirrorForm.vgv,
      origem: salesMirrorForm.origem,
      unidade: salesMirrorForm.unidade,
      gerente: salesMirrorForm.gerente,
      bloco: salesMirrorForm.bloco,
      coordenador: salesMirrorForm.coordenador,
      corretor: salesMirrorForm.corretor,
      data_ato: salesMirrorForm.dataAto,
      valor_ato: salesMirrorForm.valorAto,
      pago_pela_kaizen: salesMirrorForm.pagoPelaKaizen,
      cca: salesMirrorForm.cca,
      data_contrato: salesMirrorForm.dataContrato,
      ass_gerente: salesMirrorForm.assGerente,
      ass_diretor_venda: salesMirrorForm.assDiretorVenda,
      ass_setor_avulso: salesMirrorForm.assSetorAvulso,
      ass_diretor_financeiro: salesMirrorForm.assDiretorFinanceiro,
      ass_diretor_comercial: salesMirrorForm.assDiretorComercial,
    }, { onConflict: 'client_id' });
    setSalesMirrorSaving(false);
    if (error) {
      alert(`Erro ao salvar espelho: ${error.message}`);
      return;
    }
    alert('Espelho salvo com sucesso.');
  };

  const buildSalesMirrorPdf = async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([841.89, 595.28]);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdf.embedFont(StandardFonts.Helvetica);

    const pageW = 841.89;
    const pageH = 595.28;
    const margin = 26;
    const contentW = pageW - margin * 2;
    const top = pageH - margin;

    const colors = {
      title: rgb(0.145, 0.388, 0.922), // azul da marca (#2563eb)
      label: rgb(0.38, 0.43, 0.51),
      text: rgb(0.09, 0.12, 0.17),
      border: rgb(0.82, 0.84, 0.88),
      soft: rgb(0.94, 0.96, 1), // azul bem claro
    };

    const fmtValue = (v?: string) => {
      const value = String(v || '').trim();
      return value ? value : '—';
    };

    const drawCell = (opts: { label: string; value: string; x: number; y: number; w: number; h?: number }) => {
      const h = opts.h ?? 38;
      page.drawRectangle({ x: opts.x, y: opts.y - h, width: opts.w, height: h, borderColor: colors.border, borderWidth: 0.8, color: rgb(1, 1, 1) });
      page.drawText(opts.label, { x: opts.x + 6, y: opts.y - 11, size: 7.5, font: bold, color: colors.label });
      page.drawText(fmtValue(opts.value).slice(0, 62), { x: opts.x + 6, y: opts.y - 27, size: 11, font: regular, color: colors.text });
    };

    const logo = await loadKaizenLogo(pdf);
    drawReportHeader(page, { regular, bold }, logo, { title: 'Espelho de Vendas', subtitle: `Cliente: ${fmtValue(client?.name)}` });

    const hasSecondClient = !!String(salesMirrorForm.cliente2 || '').trim() || !!String(salesMirrorForm.cpf2 || '').trim();
    const colGap = 12;
    const colW = (contentW - colGap) / 2;
    const leftX = margin;
    const rightX = margin + colW + colGap;
    let y = top - 78;

    drawCell({ label: 'CONST./INVEST.', value: salesMirrorForm.constInvest, x: leftX, y, w: colW });
    drawCell({ label: 'EMPREENDIMENTO', value: salesMirrorForm.empreendimento, x: rightX, y, w: colW });
    y -= 43;
    drawCell({ label: 'CLIENTE 1', value: salesMirrorForm.cliente1, x: leftX, y, w: colW });
    drawCell({ label: 'CPF 1', value: salesMirrorForm.cpf1, x: rightX, y, w: colW });
    if (hasSecondClient) {
      y -= 43;
      drawCell({ label: 'CLIENTE 2', value: salesMirrorForm.cliente2, x: leftX, y, w: colW });
      drawCell({ label: 'CPF 2', value: salesMirrorForm.cpf2, x: rightX, y, w: colW });
    }
    y -= 43;
    drawCell({ label: 'VGV', value: salesMirrorForm.vgv, x: leftX, y, w: colW });
    drawCell({ label: 'ORIGEM', value: salesMirrorForm.origem, x: rightX, y, w: colW });
    y -= 43;
    drawCell({ label: 'UNIDADE', value: salesMirrorForm.unidade, x: leftX, y, w: colW });
    drawCell({ label: 'GERENTE', value: salesMirrorForm.gerente, x: rightX, y, w: colW });
    y -= 43;
    drawCell({ label: 'BLOCO', value: salesMirrorForm.bloco, x: leftX, y, w: colW });
    drawCell({ label: 'COORDENADOR', value: salesMirrorForm.coordenador, x: rightX, y, w: colW });
    y -= 43;
    drawCell({ label: 'DIRETORIA', value: salesMirrorForm.diretoria, x: leftX, y, w: colW });
    drawCell({ label: 'CORRETOR', value: salesMirrorForm.corretor, x: rightX, y, w: colW });

    y -= 50;
    const widths = [110, 130, 130, 75, 120, 170];
    const gap = 8;
    let x = margin;
    const row = [
      ['DATA DO ATO', salesMirrorForm.dataAto],
      ['VALOR DO ATO', salesMirrorForm.valorAto],
      ['PAGO PELA KAIZEN', salesMirrorForm.pagoPelaKaizen],
      ['CCA', salesMirrorForm.cca],
      ['DATA DO CONTRATO', salesMirrorForm.dataContrato],
      ['ASS. DO GERENTE', salesMirrorForm.assGerente],
    ] as const;
    row.forEach(([label, value], i) => {
      drawCell({ label, value, x, y, w: widths[i] });
      x += widths[i] + gap;
    });

    y -= 62;
    drawCell({ label: 'ASS. DIRETOR DE VENDA', value: salesMirrorForm.assDiretorVenda, x: leftX, y, w: colW, h: 44 });
    drawCell({ label: 'ASS. SETOR DE AVULSO', value: salesMirrorForm.assSetorAvulso, x: rightX, y, w: colW, h: 44 });
    y -= 50;
    drawCell({ label: 'ASS. DIRETOR DE FINANCEIRO', value: salesMirrorForm.assDiretorFinanceiro, x: leftX, y, w: colW, h: 44 });
    drawCell({ label: 'ASS. DIRETOR COMERCIAL', value: salesMirrorForm.assDiretorComercial, x: rightX, y, w: colW, h: 44 });

    addStandardFooters(pdf, { regular, bold });
    return pdf.save();
  };

  const printSalesMirrorPdf = async () => {
    try {
      const bytes = await buildSalesMirrorPdf();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e: any) {
      alert(`Erro ao preparar impressão: ${e?.message || 'erro desconhecido'}`);
    }
  };

  if (!client) return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[50vh] text-text-secondary">
      <p>Cliente não encontrado.</p>
      <button onClick={() => navigate('/clients')} className="mt-4 text-gold-600 font-medium hover:underline">
        Voltar para clientes
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-surface-50 pb-24">
      {/* Header / Nav */}
      <div className="bg-card-bg shadow-sm px-4 py-4 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Ficha do Cliente</h1>
        </div>
        <button
          onClick={() => setIsDeleteClientModalOpen(true)}
          className="p-2 text-red-500 hover:bg-red-50 rounded-full transition-colors"
          title="Excluir Cliente"
        >
          <Trash2 size={20} />
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Main Info Card */}
        <PremiumCard highlight className="space-y-4">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">{client.name}</h2>
              <p className="text-text-secondary flex items-center gap-1 mt-1">
                <Building2 size={14} /> {client.development || 'Sem empreendimento'}
              </p>
            </div>
            <StatusBadge status={client.stage} className="text-sm px-3 py-1.5" />
          </div>

          {/* Tags hierárquicas — visíveis para liderança */}
          {canViewAllClients && (
            <ClientHierarchyTags
              ownerId={(client as any).owner_id}
              allProfiles={allProfiles}
              teams={teams}
              directorates={directorates}
            />
          )}

          <div className="flex items-center gap-2 text-gold-600 dark:text-gold-400 font-medium bg-gold-50 dark:bg-gold-900/20 p-3 rounded-xl">
            <Wallet size={18} />
            <span>{client.intendedValue || 'Valor não informado'}</span>
          </div>

          {canUseSalesMirror && (
            <div className="pt-1">
              <RoundedButton size="sm" variant="secondary" onClick={openSalesMirror}>
                Espelho de vendas
              </RoundedButton>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <RoundedButton
              variant="secondary"
              size="sm"
              className="w-full"
              href={`tel:+55${client.phone?.replace(/\D/g, '')}`}
            >
              <Phone size={16} /> Ligar
            </RoundedButton>
            <RoundedButton
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => navigate(`/clients/${id}/email`)}
            >
              <Mail size={16} /> Email
            </RoundedButton>
          </div>
        </PremiumCard>

        {/* Stage Management */}
        <section>
          <SectionHeader
            title="Estágio Atual"
            action={
              <button
                onClick={() => setIsEditingStage(!isEditingStage)}
                className="text-gold-600 dark:text-gold-400 text-sm font-medium flex items-center gap-1"
              >
                {isEditingStage ? 'Cancelar' : <><Edit2 size={14} /> Alterar</>}
              </button>
            }
          />

          <AnimatePresence>
            {isEditingStage ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-2 gap-2 overflow-hidden"
              >
                {CLIENT_STAGES.map((stage) => {
                  const isRestricted = isStageRestrictedForRole(stage, role);
                  return (
                    <button
                      key={stage}
                      onClick={() => !isRestricted && handleStageChange(stage)}
                      disabled={isRestricted}
                      title={isRestricted ? 'Apenas Coordenador, Gerente, Diretor ou ADMIN podem usar esta etapa' : undefined}
                      className={`p-3 rounded-xl text-sm font-medium border transition-all text-left flex items-center justify-between ${client.stage === stage
                        ? 'bg-gold-50 dark:bg-gold-900/20 border-gold-400 text-gold-700 dark:text-gold-400'
                        : isRestricted
                          ? 'bg-surface-50 border-surface-200 text-text-secondary opacity-50 cursor-not-allowed'
                          : 'bg-card-bg border-surface-200 text-text-secondary hover:border-gold-300'
                        }`}
                    >
                      {stage}
                      {client.stage === stage ? <Check size={16} /> : isRestricted ? <span className="text-[10px]">🔒</span> : null}
                    </button>
                  );
                })}
              </motion.div>
            ) : (
              <PremiumCard className="flex items-center justify-between py-4 cursor-pointer" onClick={() => setIsEditingStage(true)}>
                <span className="font-medium text-text-primary">{client.stage}</span>
                <ChevronLeft size={20} className="rotate-180 text-text-secondary" />
              </PremiumCard>
            )}
          </AnimatePresence>
        </section>

        {/* Details */}
        <section className="space-y-4">
          <SectionHeader
            title="Dados Pessoais"
            action={
              isEditingInfo ? (
                <div className="flex gap-2">
                  <button onClick={() => setIsEditingInfo(false)} className="text-text-secondary p-1"><X size={18} /></button>
                  <button onClick={handleSaveInfo} className="text-green-600 p-1"><Save size={18} /></button>
                </div>
              ) : (
                <button onClick={() => setIsEditingInfo(true)} className="text-gold-600 dark:text-gold-400 text-sm font-medium flex items-center gap-1">
                  <Edit2 size={14} /> Editar
                </button>
              )
            }
          />
          <PremiumCard className="space-y-4">
            {isEditingInfo ? (
              <div className="grid grid-cols-1 gap-4">
                {[
                  { label: 'Nome', key: 'name' },
                  { label: 'CPF', key: 'cpf' },
                  { label: 'Email', key: 'email' },
                  { label: 'Telefone', key: 'phone' },
                  { label: 'Endereço', key: 'address' },
                  { label: 'Profissão', key: 'profession' },
                  { label: 'Renda Bruta', key: 'grossIncome' },
                  { label: 'Empreendimento', key: 'development' },
                  { label: 'Construtora', key: 'builder' },
                  { label: 'Valor', key: 'intendedValue' },
                  { label: 'Cidade de Interesse', key: 'regionOfInterest' },
                  { label: 'Bairro', key: 'neighborhood' },
                ].map(({ label, key }) => (
                  <div key={key}>
                    <label className="text-xs text-text-secondary uppercase tracking-wider mb-1 block">{label}</label>
                    {key === 'regionOfInterest' ? (
                      <SearchableSelect
                        value={(editForm as Record<string, string>)[key] || ''}
                        onChange={(v) => setEditForm({ ...editForm, regionOfInterest: v, neighborhood: '' })}
                        options={RJ_CITIES}
                        placeholder="Selecione a cidade"
                        searchPlaceholder="Buscar cidade do RJ..."
                      />
                    ) : key === 'neighborhood' ? (
                      getNeighborhoods(editForm.regionOfInterest).length > 0 ? (
                        <SearchableSelect
                          value={editForm.neighborhood || ''}
                          onChange={(v) => setEditForm({ ...editForm, neighborhood: v })}
                          options={getNeighborhoods(editForm.regionOfInterest)}
                          placeholder="Selecione o bairro"
                          searchPlaceholder={`Buscar bairro em ${editForm.regionOfInterest}...`}
                        />
                      ) : (
                        <input
                          value={editForm.neighborhood || ''}
                          onChange={e => setEditForm({ ...editForm, neighborhood: e.target.value })}
                          className="w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary"
                          placeholder="Digite o bairro (opcional)"
                        />
                      )
                    ) : key === 'builder' ? (
                      <BuilderSelect
                        value={editForm.builder || ''}
                        onChange={(v) => setEditForm({ ...editForm, builder: v })}
                        inputClassName="p-2 rounded-lg focus:ring-gold-400"
                      />
                    ) : (
                      <input
                        value={(editForm as Record<string, string>)[key] || ''}
                        onChange={e => {
                          let val = e.target.value;
                          if (key === 'intendedValue') {
                            let v = val.replace(/\D/g, '');
                            if (v) {
                              v = (parseInt(v, 10) / 100).toFixed(2);
                              val = v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                            } else {
                              val = '';
                            }
                          }
                          setEditForm({ ...editForm, [key]: val });
                        }}
                        className="w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary"
                      />
                    )}
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div>
                    <label className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider mb-1 block leading-tight min-h-[2.25rem] sm:min-h-0">Tipo de Renda</label>
                    <select
                      value={editForm.incomeType || ''}
                      onChange={e => setEditForm({ ...editForm, incomeType: e.target.value as 'Formal' | 'Informal' | 'Mista' })}
                      className="w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary"
                    >
                      <option value="">Selecione</option>
                      <option value="Formal">Formal</option>
                      <option value="Informal">Informal</option>
                      <option value="Mista">Mista</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider mb-1 block leading-tight min-h-[2.25rem] sm:min-h-0">Cotista</label>
                    <select
                      value={editForm.cotista || ''}
                      onChange={e => setEditForm({ ...editForm, cotista: e.target.value })}
                      className="w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary"
                    >
                      <option value="">Selecione</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wider mb-1 block leading-tight min-h-[2.25rem] sm:min-h-0">Fator Social</label>
                    <select
                      value={editForm.socialFactor || ''}
                      onChange={e => setEditForm({ ...editForm, socialFactor: e.target.value })}
                      className="w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary"
                    >
                      <option value="">Selecione</option>
                      <option value="Sim">Sim</option>
                      <option value="Não">Não</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-text-secondary uppercase tracking-wider mb-1 block">Observações</label>
                  <textarea
                    value={editForm.observations || ''}
                    onChange={e => setEditForm({ ...editForm, observations: e.target.value })}
                    className="w-full p-2 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary min-h-[80px]"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {[
                  { label: 'Nome', value: client.name },
                  { label: 'CPF', value: client.cpf },
                  { label: 'Email', value: client.email },
                  { label: 'Telefone', value: client.phone },
                  { label: 'Endereço', value: client.address },
                  { label: 'Profissão', value: client.profession },
                  { label: 'Renda Bruta', value: client.grossIncome },
                  { label: 'Tipo de Renda', value: client.incomeType },
                  { label: 'Cotista', value: client.cotista },
                  { label: 'Fator Social', value: client.socialFactor },
                  { label: 'Cidade de Interesse', value: client.regionOfInterest },
                  { label: 'Bairro', value: client.neighborhood },
                  { label: 'Empreendimento', value: client.development },
                  { label: 'Construtora', value: client.builder },
                  { label: 'Valor', value: client.intendedValue },
                  { label: 'Observações', value: client.observations },
                ].filter(item => item.value).map(({ label, value }) => (
                  <div key={label}>
                    <label className="text-xs text-text-secondary uppercase tracking-wider">{label}</label>
                    <p className="text-text-primary font-medium">{value}</p>
                  </div>
                ))}
              </div>
            )}
          </PremiumCard>
        </section>

        <section>
          <SectionHeader
            title="Proponentes"
            action={
              <button
                type="button"
                onClick={() => setShowAddProponentForm(prev => !prev)}
                className="text-gold-600 dark:text-gold-400 text-sm font-medium flex items-center gap-1"
              >
                <Plus size={12} /> Adicionar
              </button>
            }
          />
          <div className="space-y-3">
            <PremiumCard className="space-y-2">
              <p className="text-xs text-text-secondary uppercase tracking-wider">Proponente 1 (Titular da ficha)</p>
              <p className="text-sm text-text-primary font-semibold">{client.name}</p>
              <p className="text-sm text-text-secondary">CPF: {client.cpf || 'Não informado'} • Renda: {client.grossIncome || 'Não informada'}</p>
            </PremiumCard>

            {(client.proponents || []).map((proponent, index) => {
              const isEditing = editingProponentId === proponent.id;

              if (isEditing) {
                return (
                  <PremiumCard key={proponent.id} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-text-primary">Proponente {index + 2}</p>
                      <div className="flex gap-2">
                        <button onClick={cancelEditProponent} className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-100"><X size={13} /></button>
                        <button onClick={saveEditProponent} className="h-7 w-7 flex items-center justify-center rounded-md text-green-600 hover:bg-green-50"><Save size={13} /></button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input value={editingProponent.name} onChange={e => setEditingProponent(prev => ({ ...prev, name: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Nome" />
                      <input value={editingProponent.cpf} onChange={e => setEditingProponent(prev => ({ ...prev, cpf: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="CPF" />
                      <input value={editingProponent.email} onChange={e => setEditingProponent(prev => ({ ...prev, email: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Email" />
                      <input value={editingProponent.phone} onChange={e => setEditingProponent(prev => ({ ...prev, phone: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Telefone" />
                      <input value={editingProponent.address} onChange={e => setEditingProponent(prev => ({ ...prev, address: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Endereço" />
                      <input value={editingProponent.profession} onChange={e => setEditingProponent(prev => ({ ...prev, profession: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Profissão" />
                      <input value={editingProponent.grossIncome} onChange={e => setEditingProponent(prev => ({ ...prev, grossIncome: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Renda Bruta" />
                      <select value={editingProponent.incomeType} onChange={e => setEditingProponent(prev => ({ ...prev, incomeType: e.target.value as 'Formal' | 'Informal' }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary">
                        <option value="Formal">Tipo de renda: Formal</option>
                        <option value="Informal">Tipo de renda: Informal</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <select value={editingProponent.cotista} onChange={e => setEditingProponent(prev => ({ ...prev, cotista: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary">
                        <option value="Não">Cotista: Não</option>
                        <option value="Sim">Cotista: Sim</option>
                      </select>
                      <select value={editingProponent.socialFactor} onChange={e => setEditingProponent(prev => ({ ...prev, socialFactor: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary">
                        <option value="Não">Fator Social: Não</option>
                        <option value="Sim">Fator Social: Sim</option>
                      </select>
                    </div>
                  </PremiumCard>
                );
              }

              return (
                <PremiumCard key={proponent.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setOpenProponentIndex(prev => (prev === index ? null : index))}
                      className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-gold-700 transition-colors"
                    >
                      Proponente {index + 2}
                      {openProponentIndex === index ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => startEditProponent(proponent)} className="h-7 w-7 flex items-center justify-center rounded-md text-gold-600 hover:bg-gold-50"><Edit2 size={12} /></button>
                      <button onClick={() => handleDeleteProponent(proponent.id)} className="h-7 w-7 flex items-center justify-center rounded-md text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
                    </div>
                  </div>
                  {openProponentIndex === index && (
                    <>
                      <p className="text-sm text-text-primary font-medium">{proponent.name}</p>
                      <p className="text-xs text-text-secondary">CPF: {proponent.cpf || 'Não informado'} • Email: {proponent.email || 'Não informado'}</p>
                      <p className="text-xs text-text-secondary">Telefone: {proponent.phone || 'Não informado'} • Endereço: {proponent.address || 'Não informado'}</p>
                      <p className="text-xs text-text-secondary">Profissão: {proponent.profession || 'Não informada'}</p>
                      <p className="text-xs text-text-secondary">Renda: {proponent.grossIncome || 'Não informada'} • Tipo: {proponent.incomeType || 'Não informado'}</p>
                      <p className="text-xs text-text-secondary">Cotista: {proponent.cotista || 'Não informado'} • Fator Social: {proponent.socialFactor || 'Não informado'}</p>
                    </>
                  )}
                </PremiumCard>
              );
            })}

            {(!client.proponents || client.proponents.length === 0) && !showAddProponentForm && (
              <PremiumCard>
                <p className="text-sm text-text-secondary">Nenhum proponente adicional cadastrado.</p>
              </PremiumCard>
            )}

            {showAddProponentForm && (
              <PremiumCard className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowAddProponentForm(prev => !prev)}
                    className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-gold-700 transition-colors"
                  >
                    Adicionar proponente adicional
                    {showAddProponentForm ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button onClick={() => setShowAddProponentForm(false)} className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-100"><X size={13} /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={newProponent.name} onChange={e => setNewProponent(prev => ({ ...prev, name: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Nome" />
                  <input value={newProponent.cpf} onChange={e => setNewProponent(prev => ({ ...prev, cpf: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="CPF" />
                  <input value={newProponent.email} onChange={e => setNewProponent(prev => ({ ...prev, email: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Email" />
                  <input value={newProponent.phone} onChange={e => setNewProponent(prev => ({ ...prev, phone: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Telefone" />
                  <input value={newProponent.address} onChange={e => setNewProponent(prev => ({ ...prev, address: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Endereço" />
                  <input value={newProponent.profession} onChange={e => setNewProponent(prev => ({ ...prev, profession: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Profissão" />
                  <input value={newProponent.grossIncome} onChange={e => setNewProponent(prev => ({ ...prev, grossIncome: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary" placeholder="Renda Bruta" />
                  <select value={newProponent.incomeType} onChange={e => setNewProponent(prev => ({ ...prev, incomeType: e.target.value as 'Formal' | 'Informal' }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary">
                    <option value="Formal">Tipo de renda: Formal</option>
                    <option value="Informal">Tipo de renda: Informal</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select value={newProponent.cotista} onChange={e => setNewProponent(prev => ({ ...prev, cotista: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary">
                    <option value="Não">Cotista: Não</option>
                    <option value="Sim">Cotista: Sim</option>
                  </select>
                  <select value={newProponent.socialFactor} onChange={e => setNewProponent(prev => ({ ...prev, socialFactor: e.target.value }))} className="w-full h-11 px-3 bg-surface-50 rounded-lg border-none focus:ring-2 focus:ring-gold-400 text-sm text-text-primary">
                    <option value="Não">Fator Social: Não</option>
                    <option value="Sim">Fator Social: Sim</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <RoundedButton size="sm" onClick={handleAddProponent}>Salvar Proponente</RoundedButton>
                  <RoundedButton size="sm" variant="secondary" onClick={() => setShowAddProponentForm(false)}>Cancelar</RoundedButton>
                </div>
              </PremiumCard>
            )}
          </div>
        </section>

        {/* Documents */}
        <section>


          <SectionHeader
            title="Documentos Anexados"
            action={
              <div>
                <input
                  type="file"
                  id="document-upload"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                />
                <label
                  htmlFor="document-upload"
                  className={`text-gold-600 dark:text-gold-400 text-sm font-medium flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <UploadCloud size={16} /> {isUploading ? 'Enviando...' : 'Anexar Documento'}
                </label>
              </div>
            }
          />
          <div className="space-y-3">
            {client.documents && client.documents.length > 0 ? (
              client.documents.map(doc => (
                <PremiumCard
                  key={doc.id}
                  className="flex items-center justify-between p-3 cursor-pointer hover:border-gold-300 transition-all"
                  onClick={() => handleOpenDocument((doc as any).file_path, (doc as any).id)}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-lg">
                      <FileText size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">{doc.name}</p>
                      <p className="text-xs text-text-secondary">{doc.uploadDate}</p>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDocument(doc.id);
                    }}
                    className="p-2 text-text-secondary hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                </PremiumCard>
              ))
            ) : (
              <p className="text-sm text-text-secondary text-center py-4">Nenhum documento anexado.</p>
            )}
          </div>
        </section>

        {/* History */}
        <section>
          <SectionHeader title="Histórico de Movimentações" />
          <div className="space-y-4 pl-2 border-l-2 border-surface-200 ml-2">
            {client.history.map((item) => (
              <div key={item.id} className="relative pl-6 pb-2">
                <div className="absolute -left-[9px] top-1 w-4 h-4 rounded-full bg-gold-400 border-2 border-surface-50"></div>
                <p className="text-xs text-text-secondary mb-0.5">
                  {item.date || ((item as any).created_at ? new Date((item as any).created_at).toLocaleDateString('pt-BR') : '—')} • {item.user}
                </p>
                <p className="text-sm text-text-primary font-medium">{item.action}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Modals */}
      <Modal
        isOpen={isSalesMirrorOpen}
        onClose={() => setIsSalesMirrorOpen(false)}
        title="Espelho de vendas"
        panelClassName="max-w-[96vw] lg:max-w-[1240px]"
        contentClassName="p-3 sm:p-5"
      >
        <div className="space-y-4 max-h-[82vh] overflow-y-auto pr-1 w-full">
          {salesMirrorLoading ? (
            <p className="text-sm text-text-secondary">Carregando espelho...</p>
          ) : (
            <>
              <div className="rounded-xl border border-surface-300 bg-card-bg p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-200 bg-surface-50">
                  <p className="text-sm font-semibold text-text-primary">Processo de venda</p>
                </div>
                <div className="p-3 border-b border-surface-200">
                  <label className="text-[10px] text-text-secondary uppercase tracking-[0.08em] block mb-1">DIRETORIA</label>
                  <select
                    value={salesMirrorForm.diretoria || ''}
                    onChange={(e) => setSalesMirrorForm((prev) => ({ ...prev, diretoria: e.target.value }))}
                    className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300 text-sm text-text-primary"
                  >
                    <option value="">Selecione a diretoria</option>
                    {directorates.map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                    {/* Mantém o valor salvo mesmo que a diretoria não exista mais na lista */}
                    {salesMirrorForm.diretoria && !directorates.some((d) => d.name === salesMirrorForm.diretoria) && (
                      <option value={salesMirrorForm.diretoria}>{salesMirrorForm.diretoria}</option>
                    )}
                  </select>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2">
                  {[['CONST./INVEST.', 'constInvest'], ['EMPREENDIMENTO', 'empreendimento'], ['CLIENTE 1', 'cliente1'], ['CPF 1', 'cpf1'], ['CLIENTE 2', 'cliente2'], ['CPF 2', 'cpf2'], ['VGV', 'vgv'], ['ORIGEM', 'origem'], ['UNIDADE', 'unidade'], ['GERENTE', 'gerente'], ['BLOCO', 'bloco'], ['COORDENADOR', 'coordenador']].map(([label, key]) => (
                    <div key={key} className="p-3 border-b border-surface-200 lg:[&:nth-child(odd)]:border-r lg:[&:nth-child(odd)]:border-surface-200">
                      <label className="text-[10px] text-text-secondary uppercase tracking-[0.08em] block mb-1">{label}</label>
                      <input
                        value={(salesMirrorForm as any)[key] || ''}
                        onChange={(e) => {
                          let value = e.target.value;
                          if (key === 'vgv' || key === 'valorAto') value = formatCurrencyInput(value);
                          if (key === 'dataAto' || key === 'dataContrato') value = formatDateInput(value);
                          setSalesMirrorForm((prev) => ({ ...prev, [key]: value }));
                        }}
                        className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300 text-sm text-text-primary"
                      />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 border-t border-surface-200 bg-surface-50">
                  {[['CORRETOR', 'corretor'], ['DATA DO ATO', 'dataAto'], ['VALOR DO ATO', 'valorAto'], ['CCA', 'cca'], ['DATA DO CONTRATO', 'dataContrato']].map(([label, key]) => (
                    <div key={key} className="p-3 border-b xl:border-b-0 xl:border-r border-surface-200 last:border-r-0">
                      <label className="text-[10px] text-text-secondary uppercase tracking-[0.08em] block mb-1">{label}</label>
                      <input
                        value={(salesMirrorForm as any)[key] || ''}
                        onChange={(e) => {
                          let value = e.target.value;
                          if (key === 'valorAto') value = formatCurrencyInput(value);
                          if (key === 'dataAto' || key === 'dataContrato') value = formatDateInput(value);
                          setSalesMirrorForm((prev) => ({ ...prev, [key]: value }));
                        }}
                        className="w-full h-10 px-3 bg-card-bg rounded-md border border-surface-200 focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300 text-sm text-text-primary"
                      />
                    </div>
                  ))}
                  <div className="p-3">
                    <label className="text-[10px] text-text-secondary uppercase tracking-[0.08em] block mb-1">PAGO PELA KAIZEN</label>
                    <select
                      value={salesMirrorForm.pagoPelaKaizen || ''}
                      onChange={(e) => setSalesMirrorForm((prev) => ({ ...prev, pagoPelaKaizen: e.target.value }))}
                      className="w-full h-10 px-3 bg-card-bg rounded-md border border-surface-200 focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300 text-sm text-text-primary"
                    >
                      <option value="">Selecione</option>
                      <option value="SIM">SIM</option>
                      <option value="NÃO">NÃO</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-surface-200">
                  {[['ASS. DO GERENTE', 'assGerente'], ['ASS. DIRETOR DE VENDA', 'assDiretorVenda'], ['ASS. SETOR DE AVULSO', 'assSetorAvulso'], ['ASS. DIRETOR DE FINANCEIRO', 'assDiretorFinanceiro'], ['ASS. DIRETOR COMERCIAL', 'assDiretorComercial']].map(([label, key]) => (
                    <div key={key} className="p-3 border-b border-surface-200 lg:[&:nth-child(odd)]:border-r lg:[&:nth-child(odd)]:border-surface-200">
                      <label className="text-[10px] text-text-secondary uppercase tracking-[0.08em] block mb-1">{label}</label>
                      <input
                        value={(salesMirrorForm as any)[key] || ''}
                        onChange={(e) => setSalesMirrorForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300 text-sm text-text-primary"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 print:hidden">
            <RoundedButton variant="secondary" onClick={printSalesMirrorPdf}>Imprimir</RoundedButton>
            <RoundedButton onClick={saveSalesMirror} disabled={salesMirrorSaving}>{salesMirrorSaving ? 'Salvando...' : 'Salvar'}</RoundedButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isDeleteClientModalOpen}
        onClose={() => setIsDeleteClientModalOpen(false)}
        title="Excluir Cliente"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Tem certeza que deseja excluir este cliente? Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-3 pt-2">
            <RoundedButton variant="secondary" fullWidth onClick={() => setIsDeleteClientModalOpen(false)}>
              Cancelar
            </RoundedButton>
            <RoundedButton fullWidth onClick={confirmDeleteClient} className="!bg-red-500 hover:!bg-red-600 text-white border-none">
              Excluir
            </RoundedButton>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!documentToDelete}
        onClose={() => setDocumentToDelete(null)}
        title="Excluir Documento"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Tem certeza que deseja excluir este documento?
          </p>
          <div className="flex gap-3 pt-2">
            <RoundedButton variant="secondary" fullWidth onClick={() => setDocumentToDelete(null)}>
              Cancelar
            </RoundedButton>
            <RoundedButton fullWidth onClick={confirmDeleteDocument} className="!bg-red-500 hover:!bg-red-600 text-white border-none">
              Excluir
            </RoundedButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
