import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useApp, Appointment } from '@/context/AppContext';

const FIELD_CLASS = 'w-full h-12 px-3 py-0 bg-subtle-bg rounded-xl border border-line-subtle focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-text-primary text-sm';

const APPOINTMENT_TYPES = ['Visita', 'Reunião', 'Assinatura', 'Outro'] as const;

export interface CreateAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  editing?: Appointment | null;
  initialValues?: Partial<Appointment>;
}

export function CreateAppointmentModal({
  isOpen,
  onClose,
  editing = null,
  initialValues,
}: CreateAppointmentModalProps) {
  const { addAppointment, updateAppointment } = useApp();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Appointment>>({
    title: '',
    client_name: '',
    time: '09:00',
    location: '',
    type: 'Visita',
    date: format(new Date(), 'yyyy-MM-dd'),
    completed: false,
  });

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setFormData({ ...editing });
      return;
    }
    setFormData({
      title: '',
      client_name: '',
      time: '09:00',
      location: '',
      type: 'Visita',
      date: format(new Date(), 'yyyy-MM-dd'),
      completed: false,
      ...initialValues,
    });
  // Snapshot values when the modal opens; avoid resetting while the user types.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSave = async () => {
    if (!formData.title || !formData.date || !formData.time) return;
    setIsSaving(true);
    try {
      if (editing) {
        await updateAppointment(editing.id, formData);
      } else {
        await addAppointment(formData as Omit<Appointment, 'id' | 'created_at'>);
      }
      onClose();
    } catch (e: any) {
      alert(`Erro ao salvar: ${e.message ?? 'Erro desconhecido'}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? 'Editar Agendamento' : 'Novo Agendamento'}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Título</label>
          <input
            value={formData.title ?? ''}
            onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="Ex: Visita ao Decorado"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Cliente</label>
          <input
            value={formData.client_name ?? ''}
            onChange={(e) => setFormData((p) => ({ ...p, client_name: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="Nome do cliente"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
          <div className="min-w-0">
            <label className="block text-sm font-medium text-text-secondary mb-1">Data</label>
            <input
              type="date"
              value={formData.date ?? ''}
              onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className={`${FIELD_CLASS} cursor-pointer`}
              aria-label="Data"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium text-text-secondary mb-1">Hora</label>
            <input
              type="time"
              value={formData.time ?? ''}
              onChange={(e) => setFormData((p) => ({ ...p, time: e.target.value }))}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className={`${FIELD_CLASS} cursor-pointer`}
              aria-label="Hora"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Local</label>
          <input
            value={formData.location ?? ''}
            onChange={(e) => setFormData((p) => ({ ...p, location: e.target.value }))}
            className={FIELD_CLASS}
            placeholder="Endereço ou local"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Tipo</label>
          <div className="flex gap-2 flex-wrap">
            {APPOINTMENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setFormData((p) => ({ ...p, type }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  formData.type === type
                    ? 'bg-primary-500/10 border-blue-400 text-blue-700'
                    : 'bg-card-bg border-line-subtle text-text-secondary hover:border-line-strong'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors mt-2"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
          {isSaving ? 'Salvando...' : editing ? 'Salvar Alterações' : 'Criar Agendamento'}
        </button>
      </div>
    </Modal>
  );
}
