import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PremiumCard, StatusBadge, PageHeader, RoundedButton } from '@/components/ui/PremiumComponents';
import { Search, MapPin, Building2, Filter, ChevronRight, Plus, Upload, X, FileText, Image as ImageIcon, Loader2, Edit2, Trash2 } from 'lucide-react';
import { FAB } from '@/components/Layout';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useApp, Development } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { supabase } from '@/lib/supabase';

export default function Developments() {
  const navigate = useNavigate();
  const { developments, addDevelopment, updateDevelopment, deleteDevelopment, loading } = useApp();
  const { isBroker, canCreateStrategicResources } = useAuthorization();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();
  const [filter, setFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingDevId, setEditingDevId] = useState<string | null>(null);

  const initialDevState: Partial<Development> = {
    name: '', builder: '', location: '', address: '', price: '', min_income: '',
    type: 'Apartamento', status: 'Lançamento', description: '',
    differentials: [], images: [], contact: { name: '', phone: '', email: '', role: '', avatar: '' }
  };

  const [newDev, setNewDev] = useState<Partial<Development>>(initialDevState);
  const [differentialsInput, setDifferentialsInput] = useState('');
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingBook, setUploadingBook] = useState(false);
  const [bookUploadProgress, setBookUploadProgress] = useState<number | null>(null);
  const [bookUploadProcessing, setBookUploadProcessing] = useState(false);
  const [bookUploadError, setBookUploadError] = useState<string | null>(null);
  const [bookInputMode, setBookInputMode] = useState<'upload' | 'link'>('upload');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
  const sanitizePath = (path: string) =>
    path.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9.\-_/]/g, '_');

  // Upload simples (imagens pequenas)
  const uploadToStorage = async (file: File, path: string): Promise<string | null> => {
    const sanitized = sanitizePath(path);
    const { error } = await supabase.storage.from('developments').upload(sanitized, file, { upsert: true, contentType: file.type });
    if (error) { console.error('Upload error:', error.message); return null; }
    const { data } = supabase.storage.from('developments').getPublicUrl(sanitized);
    return data.publicUrl;
  };

  // Upload com progresso via XHR (PDFs grandes) — retorna {url, error}
  const uploadWithProgress = (
    file: File,
    path: string,
    onProgress: (pct: number) => void,
    onProcessing: (v: boolean) => void,
  ): Promise<{ url: string | null; error: string | null }> => {
    return new Promise(async (resolve) => {
      const sanitized = sanitizePath(path);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        resolve({ url: null, error: 'Sessão expirada. Faça login novamente para enviar o arquivo.' });
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${supabaseUrl}/storage/v1/object/developments/${sanitized}`);
      xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
      xhr.setRequestHeader('apikey', import.meta.env.VITE_SUPABASE_ANON_KEY as string);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'true');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          onProgress(pct);
          if (pct === 100) onProcessing(true); // bytes enviados, aguardando resposta do servidor
        }
      };

      xhr.onload = () => {
        onProcessing(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          const { data } = supabase.storage.from('developments').getPublicUrl(sanitized);
          resolve({ url: data.publicUrl, error: null });
        } else {
          let msg = `Erro ${xhr.status}`;
          try { msg = JSON.parse(xhr.responseText)?.message || msg; } catch { }
          console.error('Book upload failed:', xhr.status, xhr.responseText);
          resolve({ url: null, error: msg });
        }
      };

      xhr.onerror = () => {
        onProcessing(false);
        resolve({ url: null, error: 'Erro de rede. Verifique sua conexão.' });
      };

      xhr.ontimeout = () => {
        onProcessing(false);
        resolve({ url: null, error: 'Timeout: o arquivo é muito grande ou a conexão está lenta.' });
      };

      xhr.timeout = 10 * 60 * 1000; // 10 minutos
      xhr.send(file);
    });
  };

  const toggleFilterType = (val: string) =>
    setFilterTypes(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  const toggleFilterStatus = (val: string) =>
    setFilterStatuses(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  const clearFilters = () => { setFilterTypes([]); setFilterStatuses([]); };
  const activeFiltersCount = filterTypes.length + filterStatuses.length;

  const filteredDevelopments = developments.filter(dev => {
    const matchesSearch =
      dev.name.toLowerCase().includes(filter.toLowerCase()) ||
      (dev.builder || '').toLowerCase().includes(filter.toLowerCase());
    const matchesType = filterTypes.length === 0 || filterTypes.includes(dev.type || '');
    const matchesStatus = filterStatuses.length === 0 || filterStatuses.includes(dev.status || '');
    return matchesSearch && matchesType && matchesStatus;
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNewDev(prev => ({ ...prev, [name]: value }));
  };

  const handleContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setNewDev(prev => ({ ...prev, contact: { ...prev.contact!, [name]: value } }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImages(true);
    const path = `images/${Date.now()}_${file.name}`;
    const url = await uploadToStorage(file, path);
    if (url) setNewDev(prev => ({ ...prev, images: [...(prev.images || []), url] }));
    setUploadingImages(false);
    e.target.value = '';
  };

  const handleBookUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBookUploadError(null);

    if (file.size > MAX_PDF_BYTES) {
      setBookUploadError(
        `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
        'O limite atual é 100 MB. Use "Link externo" para PDFs maiores.'
      );
      setBookInputMode('link');
      e.target.value = '';
      return;
    }

    setUploadingBook(true);
    setBookUploadProgress(0);
    const path = `pdf/${Date.now()}_${file.name}`;
    const { url, error } = await uploadWithProgress(file, path, setBookUploadProgress, setBookUploadProcessing);
    if (url) {
      setNewDev(prev => ({ ...prev, book_pdf_url: url }));
    } else {
      setBookUploadError(error || 'Falha no upload. Tente novamente.');
    }
    setUploadingBook(false);
    setBookUploadProgress(null);
    e.target.value = '';
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const path = `avatars/${Date.now()}_${file.name}`;
    const url = await uploadToStorage(file, path);
    if (url) setNewDev(prev => ({ ...prev, contact: { ...prev.contact!, avatar: url } }));
    setUploadingAvatar(false);
    e.target.value = '';
  };

  const handleOpenModal = (dev?: Development) => {
    if (dev) {
      setEditingDevId(dev.id);
      setNewDev(dev);
      setDifferentialsInput(dev.differentials?.join('\n') || '');
    } else {
      setEditingDevId(null);
      setNewDev(initialDevState);
      setDifferentialsInput('');
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!newDev.name) return;
    setIsSaving(true);
    try {
      const payload = {
        ...newDev,
        differentials: differentialsInput.split('\n').filter(d => d.trim())
      } as Partial<Development>;

      if (editingDevId) {
        await updateDevelopment(editingDevId, payload);
      } else {
        await addDevelopment(payload as Omit<Development, 'id' | 'created_at'>);
      }

      setIsModalOpen(false);
      setNewDev(initialDevState);
      setDifferentialsInput('');
      setEditingDevId(null);
    } finally { setIsSaving(false); }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    requestConfirm({
      title: 'Excluir empreendimento',
      message: 'Tem certeza que deseja excluir este empreendimento? Esta ação não poderá ser desfeita.',
      confirmLabel: 'Excluir',
      onConfirm: () => deleteDevelopment(id),
    });
  };

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <PageHeader
        eyebrow="Catálogo"
        title="Empreendimentos"
        subtitle="Explore o catálogo exclusivo de empreendimentos."
        action={canCreateStrategicResources ? (
          <RoundedButton size="sm" onClick={() => handleOpenModal()} className="flex items-center gap-1">
            <Plus size={16} /> Novo
          </RoundedButton>
        ) : undefined}
      />

      <div className="flex gap-3 mb-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
          <input type="text" placeholder="Buscar por nome, construtora..."
            className="w-full pl-10 pr-4 py-3 bg-card-bg rounded-xl text-sm shadow-sm border border-surface-200 focus:outline-none focus:ring-2 focus:ring-gold-200 text-text-primary placeholder:text-text-secondary"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button
          onClick={() => setShowFilters(p => !p)}
          className={`relative p-3 rounded-xl border shadow-sm transition-colors ${showFilters || activeFiltersCount > 0 ? 'bg-gold-500 text-white border-gold-500' : 'bg-card-bg text-text-secondary border-surface-200 hover:bg-surface-100'}`}
        >
          <Filter size={20} />
          {activeFiltersCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {activeFiltersCount}
            </span>
          )}
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="mb-5 p-4 bg-card-bg border border-surface-200 rounded-xl shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold text-text-primary">Filtros</span>
            {activeFiltersCount > 0 && (
              <button onClick={clearFilters} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                <X size={12} /> Limpar
              </button>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary uppercase mb-2">Tipo</p>
            <div className="flex flex-wrap gap-2">
              {['Apartamento', 'Casa', 'Flat', 'Lote'].map(t => (
                <button key={t} onClick={() => toggleFilterType(t)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filterTypes.includes(t) ? 'bg-gold-500 text-white border-gold-500' : 'bg-surface-50 text-text-secondary border-surface-200 hover:border-gold-300'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-text-secondary uppercase mb-2">Status</p>
            <div className="flex flex-wrap gap-2">
              {['Lançamento', 'Em Construção', 'Pronto'].map(s => (
                <button key={s} onClick={() => toggleFilterStatus(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filterStatuses.includes(s) ? 'bg-gold-500 text-white border-gold-500' : 'bg-surface-50 text-text-secondary border-surface-200 hover:border-gold-300'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 size={32} className="animate-spin text-gold-400" /></div>
        ) : filteredDevelopments.length === 0 ? (
          <div className="text-center py-16 text-text-secondary">
            <Building2 size={48} className="mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum empreendimento cadastrado</p>
            {canCreateStrategicResources && (
              <RoundedButton size="sm" className="mt-4 mx-auto" onClick={() => handleOpenModal()}>
                <Plus size={14} className="mr-1" /> Adicionar Empreendimento
              </RoundedButton>
            )}
          </div>
        ) : (
          filteredDevelopments.map((dev) => (
            <PremiumCard key={dev.id} interactive className="p-0 overflow-hidden group border-none" onClick={() => navigate(`/developments/${dev.id}`)}>
              <div className="relative h-40 bg-surface-100">
                {dev.images && dev.images.length > 0 ? (
                  <img src={dev.images[0]} alt={dev.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-secondary/30">
                    <Building2 size={48} />
                  </div>
                )}

                {/* Status Badge */}
                <div className="absolute top-3 right-3">
                  <StatusBadge status={dev.status || ''} className="bg-card-bg/90 dark:bg-black/80 backdrop-blur-sm shadow-sm" />
                </div>

                {/* Admin Actions */}
                {canCreateStrategicResources && (
                  <div className="absolute top-3 left-3 flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleOpenModal(dev); }}
                      className="p-2 bg-black/50 text-white rounded-lg hover:bg-gold-500 transition-colors backdrop-blur-sm shadow-sm"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={(e) => handleDelete(dev.id, e)}
                      className="p-2 bg-black/50 text-white rounded-lg hover:bg-red-500 transition-colors backdrop-blur-sm shadow-sm"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                  <h3 className="text-white font-bold text-lg">{dev.name}</h3>
                  <p className="text-white/80 text-xs flex items-center gap-1"><Building2 size={12} /> {dev.builder}</p>
                </div>
              </div>
              <div className="p-4 space-y-3 bg-card-bg">
                <div className="flex justify-between items-start">
                  <div className="text-xs text-text-secondary flex items-center gap-1"><MapPin size={14} className="text-gold-500" /> {dev.location}</div>
                  <span className="text-xs font-medium px-2 py-1 bg-surface-100 rounded-md text-text-secondary">{dev.type}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-surface-100">
                  <div>
                    <p className="text-[10px] text-text-secondary uppercase tracking-wider">Preço</p>
                    <p className="text-sm font-bold text-text-primary">{dev.price}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-secondary uppercase tracking-wider">Renda Mínima</p>
                    <p className="text-sm font-bold text-text-primary">{dev.min_income}</p>
                  </div>
                </div>
                <button className="w-full mt-2 py-2 text-sm font-medium text-primary-400 hover:bg-primary-500/10 rounded-lg transition-colors flex items-center justify-center gap-1">
                  Ver Detalhes <ChevronRight size={16} />
                </button>
              </div>
            </PremiumCard>
          ))
        )}
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingDevId ? "Editar Empreendimento" : "Novo Empreendimento"}>
        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
          <section className="space-y-4">
            <h4 className="text-sm font-bold text-text-secondary uppercase">Dados Gerais</h4>
            <input name="name" placeholder="Nome do Empreendimento" value={newDev.name} onChange={handleInputChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            <input name="builder" placeholder="Construtora" value={newDev.builder} onChange={handleInputChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            <input name="location" placeholder="Localização (Bairro, Cidade)" value={newDev.location} onChange={handleInputChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            <input name="address" placeholder="Endereço Completo" value={newDev.address} onChange={handleInputChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            <div className="grid grid-cols-2 gap-4">
              <input name="price" placeholder="Faixa de Preço" value={newDev.price} onChange={handleInputChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
              <input name="min_income" placeholder="Renda Mínima" value={newDev.min_income} onChange={handleInputChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <select name="type" value={newDev.type} onChange={handleInputChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option>Apartamento</option><option>Casa</option><option>Flat</option><option>Lote</option>
              </select>
              <select name="status" value={newDev.status} onChange={handleInputChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary">
                <option>Lançamento</option><option>Em Construção</option><option>Pronto</option>
              </select>
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-bold text-text-secondary uppercase">Detalhes</h4>
            <textarea name="description" placeholder="Descrição do empreendimento..." value={newDev.description} onChange={handleInputChange}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary h-24" />
            <textarea placeholder="Diferenciais (um por linha)" value={differentialsInput} onChange={(e) => setDifferentialsInput(e.target.value)}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary h-24" />
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-bold text-text-secondary uppercase">Mídia</h4>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-2">Fotos</label>
              <div className="flex items-center gap-4 overflow-x-auto pb-2">
                <label className={`w-20 h-20 flex flex-col items-center justify-center bg-surface-50 border-2 border-dashed border-surface-200 rounded-xl cursor-pointer hover:bg-surface-100 flex-shrink-0 ${uploadingImages ? 'pointer-events-none opacity-60' : ''}`}>
                  {uploadingImages ? <Loader2 size={20} className="animate-spin text-gold-400" /> : <Upload size={20} className="text-text-secondary" />}
                  <span className="text-[10px] text-text-secondary mt-1">{uploadingImages ? 'Enviando...' : 'Adicionar'}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImages} />
                </label>
                {newDev.images?.map((img, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 group">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => setNewDev(p => ({ ...p, images: p.images?.filter((_, i) => i !== idx) }))}
                      className="absolute top-1 right-1 p-1 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-text-secondary">Book Digital (PDF)</label>
                <div className="flex gap-1 bg-surface-100 rounded-lg p-0.5">
                  <button type="button"
                    onClick={() => { setBookInputMode('upload'); setBookUploadError(null); }}
                    className={`text-[11px] px-2 py-1 rounded-md transition-colors ${bookInputMode === 'upload' ? 'bg-card-bg dark:bg-card-bg shadow-sm text-text-primary font-medium' : 'text-text-secondary'}`}>
                    Upload
                  </button>
                  <button type="button"
                    onClick={() => { setBookInputMode('link'); setBookUploadError(null); }}
                    className={`text-[11px] px-2 py-1 rounded-md transition-colors ${bookInputMode === 'link' ? 'bg-card-bg dark:bg-card-bg shadow-sm text-text-primary font-medium' : 'text-text-secondary'}`}>
                    Link externo
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {bookInputMode === 'upload' ? (
                  <>
                    <div className="flex items-center gap-3">
                      <label className={`flex items-center gap-2 px-4 py-2 bg-surface-50 rounded-lg cursor-pointer hover:bg-surface-100 border border-surface-200 ${uploadingBook ? 'pointer-events-none opacity-60' : ''}`}>
                        {uploadingBook ? <Loader2 size={16} className="animate-spin text-gold-400" /> : <Upload size={16} className="text-text-secondary" />}
                        <span className="text-sm text-text-primary">
                          {!uploadingBook ? 'Upload PDF' : bookUploadProcessing ? 'Processando...' : `Enviando ${bookUploadProgress ?? 0}%`}
                        </span>
                        <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleBookUpload} disabled={uploadingBook} />
                      </label>
                      {newDev.book_pdf_url && !uploadingBook && (
                        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1 rounded-lg">
                          <FileText size={14} /><span>Book anexado</span>
                          <button onClick={() => setNewDev(p => ({ ...p, book_pdf_url: undefined }))} className="text-red-500 ml-2"><X size={14} /></button>
                        </div>
                      )}
                    </div>
                    {uploadingBook && bookUploadProgress !== null && (
                      <div className="space-y-1">
                        <div className="w-full bg-surface-100 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${bookUploadProcessing ? 'bg-gold-300 animate-pulse' : 'bg-gold-400'}`}
                            style={{ width: bookUploadProcessing ? '100%' : `${bookUploadProgress}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-text-secondary">
                          {bookUploadProcessing ? 'Processando no servidor...' : `Enviando: ${bookUploadProgress}%`}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      type="url"
                      placeholder="https://drive.google.com/... ou link direto do PDF"
                      value={newDev.book_pdf_url || ''}
                      onChange={(e) => setNewDev(p => ({ ...p, book_pdf_url: e.target.value || undefined }))}
                      className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary text-sm"
                    />
                    <p className="text-[11px] text-text-secondary">Cole o link do Google Drive, Dropbox ou qualquer URL pública do PDF.</p>
                  </>
                )}

                {bookUploadError && (
                  <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                    <X size={12} className="flex-shrink-0 mt-0.5" />
                    <span>{bookUploadError}</span>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h4 className="text-sm font-bold text-text-secondary uppercase">Viabilizador Responsável</h4>
            <div className="flex items-center gap-4 mb-4">
              <div className="relative w-16 h-16 rounded-full bg-surface-100 overflow-hidden flex-shrink-0">
                {newDev.contact?.avatar ? (
                  <img src={newDev.contact.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-text-secondary"><ImageIcon size={24} /></div>
                )}
                <label className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 cursor-pointer transition-opacity">
                  {uploadingAvatar ? <Loader2 size={16} className="animate-spin text-white" /> : <Upload size={16} className="text-white" />}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
                </label>
              </div>
              <div className="flex-1 space-y-2">
                <input name="name" placeholder="Nome do Responsável" value={newDev.contact?.name} onChange={handleContactChange}
                  className="w-full p-2 bg-surface-50 rounded-lg border-none text-sm" />
                <input name="role" placeholder="Cargo" value={newDev.contact?.role} onChange={handleContactChange}
                  className="w-full p-2 bg-surface-50 rounded-lg border-none text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input name="phone" placeholder="Telefone / WhatsApp" value={newDev.contact?.phone} onChange={handleContactChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
              <input name="email" placeholder="Email" value={newDev.contact?.email} onChange={handleContactChange}
                className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 text-text-primary" />
            </div>
          </section>

          <RoundedButton fullWidth onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? <><Loader2 size={16} className="animate-spin" /> Salvando...</> : editingDevId ? 'Atualizar Empreendimento' : 'Salvar Empreendimento'}
          </RoundedButton>
        </div>
      </Modal>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
