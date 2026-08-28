import { useState, useEffect } from 'react';
import { PremiumCard, RoundedButton, SectionHeader } from '@/components/ui/PremiumComponents';
import { ChevronLeft, Save, UploadCloud, FileText, X, Loader2, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { CLIENT_STAGES, Client, ClientStage, isStageRestrictedForRole, missingFieldsForConcluido } from '@/data/clients';
import { BUILDERS } from '@/data/builders';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { CpfInput, PhoneInput } from '@/components/ui/MaskedInputs';
import { AddressSelects } from '@/components/ui/AddressSelects';
import { useApp } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { CLIENT_DOCUMENT_ACCEPT, prepareClientUploadFile } from '@/lib/client-document-upload';

const DRAFT_KEY = 'new-client-draft';

export type NewClientPrefill = {
  name?: string;
  phone?: string;
  origin?: string;
  notes?: string;
  stage?: string;
};

const defaultFormData = {
  name: '',
  cpf: '',
  email: '',
  phone: '',
  address: '',
  profession: '',
  grossIncome: '',
  incomeType: 'Formal' as 'Formal' | 'Informal' | 'Mista',
  cotista: 'Não',
  socialFactor: 'Não',
  regionOfInterest: '',
  neighborhood: '',
  development: '',
  builder: '',
  intendedValue: '',
  stage: 'Documentação' as ClientStage,
  observations: '',
};

type DraftProponent = {
  id?: string;
  name: string;
  cpf: string;
  email: string;
  phone: string;
  address: string;
  profession: string;
  grossIncome: string;
  incomeType: 'Formal' | 'Informal';
  cotista: string;
  socialFactor: string;
};

function formFromClient(client: Client) {
  return {
    ...defaultFormData,
    name: client.name || '',
    cpf: client.cpf || '',
    email: client.email || '',
    phone: client.phone || '',
    address: client.address || '',
    profession: client.profession || '',
    grossIncome: client.grossIncome || '',
    incomeType: (client.incomeType || 'Formal') as 'Formal' | 'Informal' | 'Mista',
    cotista: client.cotista || 'Não',
    socialFactor: client.socialFactor || 'Não',
    regionOfInterest: client.regionOfInterest || '',
    neighborhood: client.neighborhood || '',
    development: client.development || '',
    builder: client.builder || '',
    intendedValue: client.intendedValue || '',
    stage: client.stage,
    observations: client.observations || '',
  };
}

function proponentsFromClient(client: Client): DraftProponent[] {
  return (client.proponents || [])
    .filter((p) => !p.isPrimary)
    .map((p) => ({
      id: p.id,
      name: p.name || '',
      cpf: p.cpf || '',
      email: p.email || '',
      phone: p.phone || '',
      address: p.address || '',
      profession: p.profession || '',
      grossIncome: p.grossIncome || '',
      incomeType: p.incomeType === 'Informal' ? 'Informal' as const : 'Formal' as const,
      cotista: p.cotista || 'Não',
      socialFactor: p.socialFactor || 'Não',
    }));
}

const emptyProponent: DraftProponent = {
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
};

export function NewClientForm({
  prefill,
  onSuccess,
  onCancel,
  embedded = false,
  mode = 'create',
  client,
}: {
  prefill?: NewClientPrefill;
  onSuccess: () => void;
  onCancel?: () => void;
  embedded?: boolean;
  mode?: 'create' | 'edit';
  client?: Client;
}) {
  const { addClient, updateClient, uploadFile, addDocumentToClient, addClientProponent, updateClientProponent, deleteClientProponent } = useApp();
  const { role } = useAuthorization();
  const isEdit = mode === 'edit' && !!client;
  // Etapas que o papel atual pode escolher ao criar o cliente (mesma regra do mover)
  const selectableStages = CLIENT_STAGES.filter(s => !isStageRestrictedForRole(s, role));

  const [interestState, setInterestState] = useState('RJ');
  const [formData, setFormData] = useState(() => {
    if (client) return formFromClient(client);
    if (prefill) return defaultFormData;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return defaultFormData;
      const parsed = JSON.parse(saved);
      if (parsed?.formData) {
        return { ...defaultFormData, ...parsed.formData };
      }
      return { ...defaultFormData, ...parsed };
    } catch {
      return defaultFormData;
    }
  });

  const [proponents, setProponents] = useState<DraftProponent[]>(() => {
    if (client) return proponentsFromClient(client);
    if (prefill) return [];
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed?.proponents) ? parsed.proponents : [];
    } catch {
      return [];
    }
  });
  const [openProponentIndex, setOpenProponentIndex] = useState<number | null>(null);
  const [documents, setDocuments] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isEdit || prefill) return;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ formData, proponents }));
  }, [formData, proponents, prefill, isEdit]);

  useEffect(() => {
    if (!isEdit || !client) return;
    setFormData(formFromClient(client));
    setProponents(proponentsFromClient(client));
    setDocuments([]);
  }, [isEdit, client?.id]);

  useEffect(() => {
    if (prefill) {
      const { name, phone, origin, notes, stage } = prefill;
      setFormData(prev => ({
        ...prev,
        name: name || '',
        phone: phone || '',
        observations: notes ? `Origem: ${origin}\n\n${notes}` : '',
        stage: (stage as ClientStage) || prev.stage,
      }));
    }
  }, [prefill]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let { name, value } = e.target;
    if (name === 'intendedValue') {
      let v = value.replace(/\D/g, '');
      if (v) {
        v = (parseInt(v, 10) / 100).toFixed(2);
        value = v.replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      } else {
        value = '';
      }
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setDocuments(prev => [...prev, ...newFiles]);
    }
  };

  const removeDocument = (index: number) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
  };

  const addProponent = () => {
    setProponents(prev => [...prev, { ...emptyProponent }]);
    setOpenProponentIndex(proponents.length);
  };

  const updateProponent = (index: number, field: keyof DraftProponent, value: string) => {
    setProponents(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [field]: value };
    }));
  };

  const removeProponent = (index: number) => {
    setProponents(prev => prev.filter((_, i) => i !== index));
    setOpenProponentIndex(prev => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  };

  const clientPayload = {
    name: formData.name,
    cpf: formData.cpf,
    email: formData.email,
    phone: formData.phone,
    address: formData.address,
    profession: formData.profession,
    grossIncome: formData.grossIncome,
    incomeType: formData.incomeType as 'Formal' | 'Informal' | 'Mista',
    cotista: formData.cotista,
    socialFactor: formData.socialFactor,
    regionOfInterest: formData.regionOfInterest,
    neighborhood: formData.neighborhood,
    development: formData.development,
    builder: formData.builder,
    intendedValue: formData.intendedValue,
    observations: formData.observations,
  };

  const extras = proponents
    .map((p) => ({
      ...p,
      name: p.name.trim(),
      cpf: p.cpf.trim(),
      email: p.email.trim(),
      phone: p.phone.trim(),
      address: p.address.trim(),
      profession: p.profession.trim(),
      grossIncome: p.grossIncome.trim(),
    }))
    .filter((p) => p.name.length > 0);

  const uploadDocumentsFor = async (clientId: string) => {
    let hasDocumentError = false;
    for (const file of documents) {
      try {
        const prepared = await prepareClientUploadFile(file);
        const filePath = `${clientId}/${Date.now()}-${prepared.name}`;
        const uploadedPath = await uploadFile(prepared, filePath, 'client-documents');
        if (!uploadedPath) {
          hasDocumentError = true;
          continue;
        }
        const dbResult = await addDocumentToClient(clientId, prepared.name, uploadedPath);
        if (!dbResult.success) {
          hasDocumentError = true;
          console.error(dbResult.error);
        }
      } catch (err: any) {
        hasDocumentError = true;
        console.error(err?.message || err);
      }
    }
    return hasDocumentError;
  };

  const submitClient = async () => {
    if (isSubmitting) return;

    if (!formData.name.trim()) {
      alert('Por favor, informe o nome do cliente.');
      return;
    }

    if (!isEdit) {
      if (isStageRestrictedForRole(formData.stage, role)) {
        alert('⚠️ Você não tem permissão para criar um cliente diretamente na etapa "' + formData.stage + '". Selecione uma etapa inicial.');
        return;
      }
      if (formData.stage === 'Concluído') {
        const missing = missingFieldsForConcluido(formData);
        if (missing.length > 0) {
          alert(`⚠️ Para criar o cliente já como "Concluído", preencha: ${missing.join(', ')}.`);
          return;
        }
      }
    }

    setIsSubmitting(true);

    try {
      let hasDocumentError = false;
      let hasProponentError = false;

      if (isEdit && client) {
        await updateClient(client.id, clientPayload);

        const originalIds = (client.proponents || []).filter((p) => !p.isPrimary).map((p) => p.id);
        const currentIds = extras.map((p) => p.id).filter((id): id is string => Boolean(id));
        for (const id of originalIds) {
          if (!currentIds.includes(id)) {
            const result = await deleteClientProponent(id);
            if (!result.success) hasProponentError = true;
          }
        }

        for (const prop of extras) {
          const payload = {
            name: prop.name,
            cpf: prop.cpf || undefined,
            email: prop.email || undefined,
            phone: prop.phone || undefined,
            address: prop.address || undefined,
            profession: prop.profession || undefined,
            grossIncome: prop.grossIncome || undefined,
            incomeType: prop.incomeType,
            cotista: prop.cotista,
            socialFactor: prop.socialFactor,
            isPrimary: false,
          };
          const result = prop.id
            ? await updateClientProponent(prop.id, payload)
            : await addClientProponent(client.id, payload);
          if (!result.success) {
            hasProponentError = true;
            console.error('Erro ao salvar proponente:', result.error);
          }
        }

        if (documents.length > 0) {
          hasDocumentError = await uploadDocumentsFor(client.id);
        }
      } else {
        const newClient = await addClient({
          ...clientPayload,
          incomeType: formData.incomeType as 'Formal' | 'Informal',
          stage: formData.stage,
        });
        if (newClient === null || newClient === undefined) {
          alert('Erro ao salvar cliente. Tente novamente.');
          return;
        }

        for (const prop of extras) {
          const result = await addClientProponent(newClient.id, {
            name: prop.name,
            cpf: prop.cpf || undefined,
            email: prop.email || undefined,
            phone: prop.phone || undefined,
            address: prop.address || undefined,
            profession: prop.profession || undefined,
            grossIncome: prop.grossIncome || undefined,
            incomeType: prop.incomeType,
            cotista: prop.cotista,
            socialFactor: prop.socialFactor,
            isPrimary: false,
          });
          if (!result.success) {
            hasProponentError = true;
            console.error('Erro ao salvar proponente:', result.error);
          }
        }

        if (documents.length > 0) {
          hasDocumentError = await uploadDocumentsFor(newClient.id);
        }

        localStorage.removeItem(DRAFT_KEY);
      }

      if (hasDocumentError && hasProponentError) {
        alert('Cliente salvo, mas houve erros ao vincular alguns documentos e proponentes.');
      } else if (hasDocumentError) {
        alert('Cliente salvo, mas houve erros ao vincular alguns documentos no banco de dados.');
      } else if (hasProponentError) {
        alert('Cliente salvo, mas houve erros ao cadastrar alguns proponentes adicionais.');
      } else if (documents.length > 0 && extras.length > 0) {
        alert(`Cliente, proponentes e documentos ${isEdit ? 'atualizados' : 'cadastrados'} com sucesso!`);
      } else if (documents.length > 0) {
        alert(`Cliente e documentos ${isEdit ? 'atualizados' : 'cadastrados'} com sucesso!`);
      } else if (extras.length > 0) {
        alert(`Cliente e proponentes ${isEdit ? 'atualizados' : 'cadastrados'} com sucesso!`);
      } else {
        alert(`Cliente ${isEdit ? 'atualizado' : 'cadastrado'} com sucesso!`);
      }

      onSuccess();
    } catch (err: any) {
      alert(`Erro ao salvar cliente:\n\n${err?.message || 'Tente novamente.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitClient();
  };

  return (
    <div className={embedded ? '' : 'min-h-screen bg-surface-50 pb-24'}>
      {!embedded && (
      <div className="bg-card-bg shadow-sm px-4 py-4 sticky top-0 z-20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => onCancel?.()} className="p-2 rounded-full hover:bg-surface-100 text-text-secondary">
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-lg font-bold text-text-primary">Novo Cliente</h1>
        </div>
        <button
          type="button"
          onClick={submitClient}
          disabled={isSubmitting}
          className="text-gold-600 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      )}

      <form onSubmit={handleSubmit} className={embedded ? 'space-y-6' : 'p-6 space-y-6'}>
        <section>
          <SectionHeader title="Dados Principais" />
          <PremiumCard className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Nome Completo *</label>
              <input
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="Ex: Maria Silva"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">CPF</label>
              <CpfInput
                value={formData.cpf}
                onChange={cpf => setFormData(prev => ({ ...prev, cpf }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
              <input
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="email@exemplo.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Telefone</label>
              <PhoneInput
                value={formData.phone}
                onChange={phone => setFormData(prev => ({ ...prev, phone }))}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Endereço</label>
              <input
                name="address"
                value={formData.address}
                onChange={handleChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="Rua, Número, Bairro"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Profissão</label>
              <input
                name="profession"
                value={formData.profession}
                onChange={handleChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="Ex: Engenheiro"
              />
            </div>
          </PremiumCard>
        </section>

        <section>
          <SectionHeader title="Perfil Financeiro" />
          <PremiumCard className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Renda Bruta</label>
                <input
                  name="grossIncome"
                  value={formData.grossIncome}
                  onChange={handleChange}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                  placeholder="R$ 0,00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Tipo de Renda</label>
                <select
                  name="incomeType"
                  value={formData.incomeType}
                  onChange={handleChange}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none"
                >
                  <option value="Formal">Formal</option>
                  <option value="Informal">Informal</option>
                  <option value="Mista">Mista</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Cotista (3 anos FGTS)</label>
                <select
                  name="cotista"
                  value={formData.cotista}
                  onChange={handleChange}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Fator Social (Dependente)</label>
                <select
                  name="socialFactor"
                  value={formData.socialFactor}
                  onChange={handleChange}
                  className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none"
                >
                  <option value="Não">Não</option>
                  <option value="Sim">Sim</option>
                </select>
              </div>
            </div>
          </PremiumCard>
        </section>

        <section>
          <SectionHeader
            title="Proponentes"
            action={
              <button
                type="button"
                onClick={addProponent}
                className="text-gold-600 dark:text-gold-400 text-sm font-medium flex items-center gap-1"
              >
                <Plus size={12} /> Adicionar
              </button>
            }
          />
          <PremiumCard className="space-y-4">
            <div className="p-3 rounded-xl bg-primary-500/10 border border-primary-500/20 text-xs text-text-secondary">
              Proponente 1 e o titular da ficha (dados principais acima). Adicione aqui os proponentes adicionais.
            </div>

            {proponents.length === 0 && (
              <p className="text-sm text-text-secondary">Nenhum proponente adicional cadastrado.</p>
            )}

            {proponents.map((prop, index) => (
              <div key={index} className="rounded-xl border border-surface-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setOpenProponentIndex(prev => (prev === index ? null : index))}
                    className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-gold-700 transition-colors"
                  >
                    Proponente {index + 2}
                    {openProponentIndex === index ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setOpenProponentIndex(prev => (prev === index ? null : index))}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-100 transition-colors"
                      title={openProponentIndex === index ? 'Recolher' : 'Expandir'}
                    >
                      {openProponentIndex === index ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeProponent(index)}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-red-500 hover:text-red-600 hover:bg-danger-subtle transition-colors"
                      title="Remover proponente"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {openProponentIndex === index && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input value={prop.name} onChange={(e) => updateProponent(index, 'name', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="Nome completo" />
                      <input value={prop.cpf} onChange={(e) => updateProponent(index, 'cpf', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="CPF" />
                      <input type="email" value={prop.email} onChange={(e) => updateProponent(index, 'email', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="Email" />
                      <input value={prop.phone} onChange={(e) => updateProponent(index, 'phone', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="Telefone" />
                      <input value={prop.address} onChange={(e) => updateProponent(index, 'address', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="Endereco" />
                      <input value={prop.profession} onChange={(e) => updateProponent(index, 'profession', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="Profissao" />
                      <input value={prop.grossIncome} onChange={(e) => updateProponent(index, 'grossIncome', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary" placeholder="Renda bruta" />
                      <select value={prop.incomeType} onChange={(e) => updateProponent(index, 'incomeType', e.target.value)} className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none">
                        <option value="Formal">Tipo de renda: Formal</option>
                        <option value="Informal">Tipo de renda: Informal</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Cotista (3 anos FGTS)</label>
                        <select
                          value={prop.cotista}
                          onChange={(e) => updateProponent(index, 'cotista', e.target.value)}
                          className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none"
                        >
                          <option value="Não">Não</option>
                          <option value="Sim">Sim</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-text-secondary mb-1">Fator Social (Dependente)</label>
                        <select
                          value={prop.socialFactor}
                          onChange={(e) => updateProponent(index, 'socialFactor', e.target.value)}
                          className="w-full h-12 px-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none"
                        >
                          <option value="Não">Não</option>
                          <option value="Sim">Sim</option>
                        </select>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </PremiumCard>
        </section>

        <section>
          <SectionHeader title="Interesse" />
          <PremiumCard className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Estado, cidade e bairro de interesse</label>
              <AddressSelects
                value={{
                  state: interestState,
                  city: formData.regionOfInterest,
                  neighborhood: formData.neighborhood,
                }}
                onChange={({ state, city, neighborhood }) => {
                  setInterestState(state);
                  setFormData(prev => ({ ...prev, regionOfInterest: city, neighborhood }));
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Empreendimento</label>
              <input
                name="development"
                value={formData.development}
                onChange={handleChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="Selecione ou digite"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Construtora</label>
              <SearchableSelect
                value={formData.builder}
                onChange={(v) => setFormData(prev => ({ ...prev, builder: v }))}
                options={BUILDERS}
                placeholder="Selecione a construtora"
                searchPlaceholder="Buscar construtora..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Valor</label>
              <input
                name="intendedValue"
                value={formData.intendedValue}
                onChange={handleChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
                placeholder="R$ 0,00"
              />
            </div>
          </PremiumCard>
        </section>

        <section>
          <SectionHeader title="Documentos" />
          <PremiumCard className="space-y-4">
            <div className="border-2 border-dashed border-surface-200 rounded-xl p-6 flex flex-col items-center justify-center text-center hover:bg-surface-50 transition-colors cursor-pointer relative">
              <input
                type="file"
                accept={CLIENT_DOCUMENT_ACCEPT}
                multiple
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="w-12 h-12 bg-accent-subtle rounded-full flex items-center justify-center text-gold-600 dark:text-gold-400 mb-2">
                <UploadCloud size={24} />
              </div>
              <p className="text-sm font-medium text-text-primary">Toque para adicionar arquivos</p>
              <p className="text-xs text-text-secondary mt-1">PDF, imagens, RG, CPF, comprovante de renda</p>
            </div>

            {documents.length > 0 && (
              <div className="space-y-2">
                {documents.map((doc, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-surface-50 rounded-lg">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-8 h-8 bg-red-50 text-red-500 rounded flex items-center justify-center flex-shrink-0">
                        <FileText size={16} />
                      </div>
                      <span className="text-sm text-text-primary truncate">{doc.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDocument(index)}
                      className="p-1 text-text-secondary hover:text-red-500"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </PremiumCard>
        </section>

        <section>
          <SectionHeader title="Observações" />
          <PremiumCard>
            <textarea
              name="observations"
              value={formData.observations}
              onChange={handleChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary min-h-[120px]"
              placeholder="Observações estratégicas sobre o cliente..."
            />
          </PremiumCard>
        </section>

        {!isEdit && (
        <section>
          <SectionHeader title="Estágio Inicial" />
          <PremiumCard>
            <label className="block text-sm font-medium text-text-secondary mb-2">Selecione o estágio atual</label>
            <select
              name="stage"
              value={formData.stage}
              onChange={handleChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary appearance-none"
            >
              {selectableStages.map(stage => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </PremiumCard>
        </section>
        )}

        <RoundedButton type="submit" fullWidth className="mt-4" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />} {isSubmitting ? 'Salvando...' : isEdit ? 'Salvar' : 'Salvar Cliente'}
        </RoundedButton>
      </form>
    </div>
  );
}
