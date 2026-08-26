import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { RoundedButton } from '@/components/ui/PremiumComponents';
import { ClientInfoForm } from '@/components/clients/ClientInfoForm';
import { useApp } from '@/context/AppContext';
import { Client } from '@/data/clients';

export function EditClientModal({
  isOpen,
  client,
  onClose,
}: {
  isOpen: boolean;
  client: Client | null;
  onClose: () => void;
}) {
  const { updateClient } = useApp();
  const [editForm, setEditForm] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !client) return;
    setEditForm(client);
  }, [isOpen, client]);

  const handleSave = async () => {
    if (!client) return;
    setSaving(true);
    try {
      await updateClient(client.id, editForm);
      onClose();
    } catch {
      alert('Erro ao salvar informações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen && !!client}
      onClose={onClose}
      title={client ? `Editar · ${client.name}` : 'Editar cliente'}
      panelClassName="max-w-2xl"
    >
      <div className="space-y-4">
        <ClientInfoForm value={editForm} onChange={setEditForm} />
        <RoundedButton fullWidth onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : null}
          {saving ? 'Salvando...' : 'Salvar'}
        </RoundedButton>
      </div>
    </Modal>
  );
}
