import { Modal } from '@/components/ui/Modal';
import SendEmail from '@/pages/SendEmail';
import { Client } from '@/data/clients';

export function SendEmailModal({
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
      title={client ? `Novo Email · ${client.name}` : 'Novo Email'}
      panelClassName="max-w-2xl max-h-[92vh]"
      overlayClassName="z-[60]"
    >
      {client && (
        <SendEmail
          key={client.id}
          clientId={client.id}
          embedded
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
