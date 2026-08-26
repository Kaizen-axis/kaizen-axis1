import { Modal } from '@/components/ui/Modal';
import { NewClientForm } from '@/components/clients/NewClientForm';
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
  return (
    <Modal
      isOpen={isOpen && !!client}
      onClose={onClose}
      title={client ? `Editar · ${client.name}` : 'Editar cliente'}
      panelClassName="max-w-2xl"
    >
      {client && (
        <NewClientForm
          key={client.id}
          embedded
          mode="edit"
          client={client}
          onSuccess={onClose}
        />
      )}
    </Modal>
  );
}
