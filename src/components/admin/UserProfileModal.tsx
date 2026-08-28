import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { useAuthorization } from '@/hooks/useAuthorization';
import { formatCpf, formatPhone } from '@/lib/masks';

interface AdminUserProfile {
  id: string;
  name: string | null;
  role: string | null;
  status: string | null;
  avatar_url: string | null;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  joined_at: string | number | null;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relation: string | null;
  team_name: string | null;
  coordinator_name: string | null;
  directorate_name: string | null;
}

interface ProfileDocument {
  id: string;
  name: string;
  storage_path: string;
  created_at: string;
}

function EmptyValue({ value }: { value?: string | null }) {
  if (value && value.trim()) return <span className="text-text-primary">{value}</span>;
  return <span className="text-text-secondary italic">Não preenchido</span>;
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-0.5">{label}</p>
      <p className="text-sm leading-snug break-words"><EmptyValue value={value} /></p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-200 bg-surface-50/60 p-3 space-y-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gold-600">{title}</p>
      {children}
    </section>
  );
}

function formatAddress(profile: AdminUserProfile) {
  const parts = [
    [profile.address_street, profile.address_number].filter(Boolean).join(', '),
    profile.address_complement,
    profile.address_neighborhood,
    [profile.address_city, profile.address_state].filter(Boolean).join(' / '),
    profile.address_cep ? `CEP ${profile.address_cep}` : '',
  ].filter(part => part && part.trim());
  return parts.join(' · ');
}

function parseProfilePayload(data: unknown): AdminUserProfile | null {
  let raw: unknown = data;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const nested = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)
    ? obj.data as Record<string, unknown>
    : obj;
  return nested as unknown as AdminUserProfile;
}

function formatJoinedAt(value?: string | number | null) {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('pt-BR');
}

export function UserProfileModal({
  userId,
  isOpen,
  onClose,
}: {
  userId: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { uploadFile, getDownloadUrl, user } = useApp();
  const { isAdmin } = useAuthorization();
  const [profile, setProfile] = useState<AdminUserProfile | null>(null);
  const [docs, setDocs] = useState<ProfileDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !userId) {
      setProfile(null);
      setDocs([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('admin_get_user_profile', { p_user_id: userId });
      if (cancelled) return;
      if (rpcError) {
        setError(rpcError.message);
        setProfile(null);
      } else {
        setProfile(parseProfilePayload(data));
      }

      if (isAdmin) {
        const { data: files, error: filesError } = await supabase
          .from('profile_documents')
          .select('id, name, storage_path, created_at')
          .eq('profile_id', userId)
          .order('created_at', { ascending: false });
        if (!cancelled && !filesError) setDocs((files || []) as ProfileDocument[]);
      } else {
        setDocs([]);
      }
      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [isOpen, userId, isAdmin]);

  const handleUpload = async (file: File) => {
    if (!userId || !isAdmin) return;
    setUploading(true);
    const path = `${userId}/${Date.now()}-${file.name}`;
    const stored = await uploadFile(file, path, 'profile-documents');
    if (!stored) {
      alert('Falha no upload do arquivo.');
      setUploading(false);
      return;
    }
    const { data, error: insertError } = await supabase
      .from('profile_documents')
      .insert({
        profile_id: userId,
        name: file.name,
        storage_path: stored,
        uploaded_by: user?.id ?? null,
      })
      .select('id, name, storage_path, created_at')
      .single();
    if (insertError) {
      alert(insertError.message);
    } else if (data) {
      setDocs(prev => [data as ProfileDocument, ...prev]);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleOpenDoc = async (doc: ProfileDocument) => {
    try {
      const url = await getDownloadUrl(doc.storage_path, 'profile-documents');
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e: any) {
      alert(e?.message || 'Não foi possível abrir o arquivo.');
    }
  };

  const handleDeleteDoc = async (doc: ProfileDocument) => {
    if (!confirm(`Excluir ${doc.name}?`)) return;
    await supabase.storage.from('profile-documents').remove([doc.storage_path]);
    const { error: delError } = await supabase.from('profile_documents').delete().eq('id', doc.id);
    if (delError) {
      alert(delError.message);
      return;
    }
    setDocs(prev => prev.filter(item => item.id !== doc.id));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Perfil do colaborador" panelClassName="max-w-lg">
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="animate-spin text-gold-500" size={28} />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !profile ? (
        <p className="text-sm text-text-secondary">Perfil não encontrado.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 pb-1">
            <div className="w-12 h-12 rounded-full bg-surface-200 overflow-hidden flex items-center justify-center font-bold text-text-primary shrink-0">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                (profile.name || '?').charAt(0)
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-text-primary truncate">{profile.name || 'Sem nome'}</p>
              <p className="text-xs text-text-secondary">{profile.role}</p>
            </div>
          </div>

          <Section title="Identidade">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Field label="Data de ingresso" value={formatJoinedAt(profile.joined_at)} />
              <Field label="CPF" value={profile.cpf ? formatCpf(profile.cpf) : profile.cpf} />
            </div>
          </Section>

          <Section title="Contato">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">
              <Field label="E-mail" value={profile.email} />
              <Field label="Telefone" value={profile.phone ? formatPhone(profile.phone) : profile.phone} />
            </div>
          </Section>

          <Section title="Endereço">
            <Field label="Endereço completo" value={formatAddress(profile)} />
          </Section>

          <Section title="Emergência">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-2">
              <Field label="Contato" value={profile.emergency_name} />
              <Field label="Telefone" value={profile.emergency_phone ? formatPhone(profile.emergency_phone) : profile.emergency_phone} />
              <Field label="Parentesco" value={profile.emergency_relation} />
            </div>
          </Section>

          <Section title="Organização">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-3 gap-y-2">
              <Field label="Equipe" value={profile.team_name} />
              <Field label="Coordenação" value={profile.coordinator_name} />
              <Field label="Diretoria" value={profile.directorate_name} />
            </div>
          </Section>

          {isAdmin && (
            <Section title="Anexos (somente admin)">
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-600 hover:text-gold-700"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  Adicionar arquivo
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                />
              </div>
              {docs.length === 0 ? (
                <p className="text-xs text-text-secondary flex items-center gap-1.5">
                  <Paperclip size={12} /> Nenhum arquivo anexado.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {docs.map(doc => (
                    <li key={doc.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-card-bg border border-surface-200">
                      <FileText size={14} className="text-gold-600 shrink-0" />
                      <button type="button" onClick={() => handleOpenDoc(doc)} className="flex-1 text-left text-xs text-text-primary truncate hover:underline">
                        {doc.name}
                      </button>
                      <button type="button" onClick={() => handleDeleteDoc(doc)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      )}
    </Modal>
  );
}
