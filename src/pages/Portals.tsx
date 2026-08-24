import { useState } from 'react';
import { PremiumCard, PageHeader, RoundedButton, cardInteractiveHover } from '@/components/ui/PremiumComponents';
import { Globe, Plus, Edit2, Trash2, ExternalLink, Search, Building2, Landmark } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useAuthorization } from '@/hooks/useAuthorization';
import { useApp, Portal } from '@/context/AppContext';

export default function Portals() {
  const { isBroker, canCreateStrategicResources } = useAuthorization();
  const { portals, addPortal, updatePortal, deletePortal } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPortal, setEditingPortal] = useState<Portal | null>(null);
  const [formData, setFormData] = useState<Partial<Portal>>({
    name: '',
    url: '',
    category: 'Outro',
    description: ''
  });

  const filteredPortals = portals.filter(portal =>
    portal.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    portal.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleOpenModal = (portal?: Portal) => {
    if (portal) {
      setEditingPortal(portal);
      setFormData(portal);
    } else {
      setEditingPortal(null);
      setFormData({
        name: '',
        url: '',
        category: 'Outro',
        description: ''
      });
    }
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.url) return;

    let url = formData.url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (editingPortal) {
      await updatePortal(editingPortal.id, { ...formData, url });
    } else {
      await addPortal({ ...formData, url } as Omit<Portal, 'id' | 'created_at'>);
    }
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    requestConfirm({
      title: 'Excluir portal',
      message: 'Tem certeza que deseja excluir este portal? Esta ação não poderá ser desfeita.',
      confirmLabel: 'Excluir',
      onConfirm: () => deletePortal(id),
    });
  };

  const getIcon = (category: string) => {
    switch (category) {
      case 'Banco': return <Landmark size={20} className="text-blue-600 dark:text-blue-400" />;
      case 'Construtora': return <Building2 size={20} className="text-gold-600 dark:text-gold-400" />;
      default: return <Globe size={20} className="text-text-secondary" />;
    }
  };

  return (
    <div className="p-6 pb-24 min-h-screen bg-surface-50">
      <PageHeader
        eyebrow="Acesso rápido"
        title="Portais"
        subtitle="Acesse rapidamente os portais e sistemas parceiros."
        action={canCreateStrategicResources ? (
          <RoundedButton size="sm" onClick={() => handleOpenModal()} className="flex items-center gap-1">
            <Plus size={16} /> Novo
          </RoundedButton>
        ) : undefined}
      />

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" size={18} />
        <input
          type="text"
          placeholder="Buscar portal..."
          className="w-full pl-10 pr-4 py-3 bg-card-bg rounded-xl text-sm shadow-sm border border-surface-200 focus:outline-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary placeholder:text-text-secondary"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {filteredPortals.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <p>Nenhum portal encontrado.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredPortals.map(portal => (
            <div
              key={portal.id}
              onClick={() => window.open(portal.url, '_blank')}
              className={`group relative flex flex-col rounded-2xl border border-surface-200/60 bg-card-bg p-5 premium-shadow ${cardInteractiveHover}`}
            >
              <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-xl bg-surface-100 flex items-center justify-center flex-shrink-0">
                  {getIcon(portal.category)}
                </div>
                {canCreateStrategicResources && (
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    <button onClick={() => handleOpenModal(portal)} className="p-1.5 rounded-lg text-text-secondary hover:text-primary-400 hover:bg-surface-100 transition-colors">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => handleDelete(portal.id)} className="p-1.5 rounded-lg text-text-secondary hover:text-red-400 hover:bg-surface-100 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
              <h4 className="mt-4 flex items-center gap-1.5 font-bold text-text-primary truncate">
                {portal.name}
                <ExternalLink size={12} className="text-text-secondary opacity-50 transition-colors group-hover:text-primary-400" />
              </h4>
              <p className="mt-1 text-xs text-text-secondary line-clamp-2 min-h-[2rem]">{portal.description || portal.url}</p>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingPortal ? 'Editar Portal' : 'Novo Portal'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Nome</label>
            <input
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
              placeholder="Ex: Portal Caixa"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">URL</label>
            <input
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
              placeholder="https://..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Categoria</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as any }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
            >
              <option value="Banco">Banco</option>
              <option value="Construtora">Construtora</option>
              <option value="Outro">Outro</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Descrição</label>
            <input
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary"
              placeholder="Breve descrição..."
            />
          </div>

          <RoundedButton fullWidth onClick={handleSave} className="mt-4">
            Salvar
          </RoundedButton>
        </div>
      </Modal>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
