import { Modal } from '@/components/ui/Modal';
import ClientDetails from '@/pages/ClientDetails';
import { Client } from '@/data/clients';

export function ClientFichaModal({
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
      title="Ficha do Cliente"
      panelClassName="max-w-3xl max-h-[92vh]"
      contentClassName="p-3 sm:p-4"
    >
      {client && (
        <ClientDetails
          key={client.id}
          clientId={client.id}
          embedded
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
