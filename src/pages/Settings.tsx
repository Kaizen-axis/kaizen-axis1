import { useState, useEffect, useRef } from 'react';
import { PremiumCard, PageHeader, RoundedButton } from '@/components/ui/PremiumComponents';
import {
  Shield, Key, Bell, User, ChevronRight, LogOut,
  Smartphone, Camera, Trash2, CheckCircle, AlertCircle, Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { supabase } from '@/lib/supabase';
import { GamificationProfile } from '@/components/gamification/GamificationProfile';
import { useApp } from '@/context/AppContext';

// ─── tipos ──────────────────────────────────────────────────────────────────
interface Profile {
  id: string;
  name: string;
  role: string;
  cpf: string;
  avatar_url: string;
  push_notifications_enabled: boolean;
}

type ToastType = 'success' | 'error' | 'info';

// ─── componente de toast inline ─────────────────────────────────────────────
function Toast({ message, type, onClose }: { message: string; type: ToastType; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const colors: Record<ToastType, string> = {
    success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  };
  const icons = { success: CheckCircle, error: AlertCircle, info: AlertCircle };
  const Icon = icons[type];
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border text-sm font-medium ${colors[type]}`}>
      <Icon size={18} className="flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

// ─── toggle switch reutilizável ──────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={`w-12 h-6 rounded-full transition-colors relative flex-shrink-0 ${value ? 'bg-gold-500' : 'bg-surface-300'}`}
    >
      <div className={`w-4 h-4 rounded-full bg-card-bg absolute top-1 transition-transform ${value ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Settings() {
  const navigate = useNavigate();
  const { signOut } = useApp();
  const { requestConfirm, confirmDialogProps } = useConfirmDialog();

  // ── estado de dados ──────────────────────────────────────────────────────
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [loading, setLoading] = useState(true);

  // ── toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const showToast = (message: string, type: ToastType = 'success') => setToast({ message, type });

  // ── modais ────────────────────────────────────────────────────────────────
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [is2FAModalOpen, setIs2FAModalOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  // ── formulários ───────────────────────────────────────────────────────────
  const [editProfile, setEditProfile] = useState({ name: '', cpf: '', avatar_url: '' });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [emailData, setEmailData] = useState({ new: '', confirm: '' });
  const [passwordData, setPasswordData] = useState({ new: '', confirm: '' });
  const [saving, setSaving] = useState(false);

  // ── 2FA ──────────────────────────────────────────────────────────────────
  const [mfaQrUri, setMfaQrUri] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaChallengeId, setMfaChallengeId] = useState('');
  const [mfaStep, setMfaStep] = useState<'qr' | 'verify' | 'unenroll'>('qr');
  const [mfaEnrollId, setMfaEnrollId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── carregar dados do Supabase ────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { navigate('/login'); return; }

        setUserEmail(user.email ?? '');

        const { data: p } = await supabase
          .from('profiles')
          .select('id, name, role, cpf, avatar_url, push_notifications_enabled')
          .eq('id', user.id)
          .single();

        if (p) setProfile(p as Profile);

        // 2FA - verificar fatores ativos
        const { data: mfaData } = await supabase.auth.mfa.listFactors();
        const totp = mfaData?.totp?.find(f => f.status === 'verified');
        if (totp) { setIs2FAEnabled(true); setMfaFactorId(totp.id); }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [navigate]);

  // ── notificações push ─────────────────────────────────────────────────────
  const toggleNotifications = async () => {
    if (!profile) return;
    const next = !profile.push_notifications_enabled;

    if (next && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'denied') {
        showToast('Permissão de notificação negada pelo navegador.', 'error');
        return;
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({ push_notifications_enabled: next })
      .eq('id', profile.id);

    if (error) { showToast('Erro ao salvar preferência.', 'error'); return; }
    setProfile(prev => prev ? { ...prev, push_notifications_enabled: next } : prev);
    showToast(next ? 'Notificações ativadas!' : 'Notificações desativadas.');
  };

  // ── abrir modal de perfil ─────────────────────────────────────────────────
  const handleOpenProfileModal = () => {
    setEditProfile({ name: profile?.name ?? '', cpf: profile?.cpf ?? '', avatar_url: profile?.avatar_url ?? '' });
    setAvatarFile(null);
    setAvatarPreview(profile?.avatar_url ?? '');
    setIsProfileModalOpen(true);
  };

  // ── trocar avatar (preview local) ────────────────────────────────────────
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  // ── salvar perfil ──────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      let avatarUrl = editProfile.avatar_url;

      if (avatarFile) {
        const ext = avatarFile.name.split('.').pop();
        const path = `${profile.id}/avatar.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, avatarFile, { upsert: true, contentType: avatarFile.type });
        if (upErr) throw new Error(`Upload de avatar: ${upErr.message}`);
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
        avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ name: editProfile.name, cpf: editProfile.cpf, avatar_url: avatarUrl })
        .eq('id', profile.id);

      if (error) throw new Error(error.message);

      setProfile(prev => prev ? { ...prev, name: editProfile.name, cpf: editProfile.cpf, avatar_url: avatarUrl } : prev);
      setIsProfileModalOpen(false);
      showToast('Perfil atualizado com sucesso!');
    } catch (e: unknown) {
      showToast(`Erro: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── alterar email ──────────────────────────────────────────────────────────
  const handleUpdateEmail = async () => {
    if (!emailData.new || !emailData.confirm) { showToast('Preencha todos os campos.', 'error'); return; }
    if (emailData.new !== emailData.confirm) { showToast('Os emails não coincidem.', 'error'); return; }
    if (!emailData.new.includes('@')) { showToast('Email inválido.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: emailData.new });
      if (error) throw new Error(error.message);
      setIsEmailModalOpen(false);
      setEmailData({ new: '', confirm: '' });
      showToast('Confirmação enviada para o novo email! Clique no link para confirmar a troca.', 'info');
    } catch (e: unknown) {
      showToast(`Erro: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── alterar senha ──────────────────────────────────────────────────────────
  const handleUpdatePassword = async () => {
    if (!passwordData.new || !passwordData.confirm) { showToast('Preencha todos os campos.', 'error'); return; }
    if (passwordData.new !== passwordData.confirm) { showToast('As senhas não coincidem.', 'error'); return; }
    if (passwordData.new.length < 6) { showToast('A senha deve ter no mínimo 6 caracteres.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordData.new });
      if (error) throw new Error(error.message);
      setIsPasswordModalOpen(false);
      setPasswordData({ new: '', confirm: '' });
      showToast('Senha alterada com sucesso!');
    } catch (e: unknown) {
      showToast(`Erro: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 2FA: iniciar enrollment ───────────────────────────────────────────────
  const handle2FAOpen = async () => {
    if (is2FAEnabled) {
      setMfaStep('unenroll');
      setIs2FAModalOpen(true);
      return;
    }
    setSaving(true);
    try {
      // 1. Limpar qualquer fator "unverified" que tenha ficado travado antes
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const unverifiedFactors = factors?.all?.filter(f => f.factor_type === 'totp' && f.status === 'unverified');
      if (unverifiedFactors && unverifiedFactors.length > 0) {
        for (const f of unverifiedFactors) {
          await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
      }

      // 2. Iniciar novo enrollment limpo
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Kaizen Axis' });
      if (error) throw new Error(error.message);
      setMfaEnrollId(data.id);
      setMfaQrUri(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setMfaStep('qr');
      setIs2FAModalOpen(true);
    } catch (e: unknown) {
      showToast(`Erro ao iniciar 2FA: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 2FA: ir para verificação ──────────────────────────────────────────────
  const handle2FAChallenge = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.auth.mfa.challenge({ factorId: mfaEnrollId });
      if (error) throw new Error(error.message);
      setMfaChallengeId(data.id);
      setMfaStep('verify');
    } catch (e: unknown) {
      showToast(`Erro: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 2FA: verificar código ─────────────────────────────────────────────────
  const handle2FAVerify = async () => {
    if (mfaCode.length !== 6) { showToast('O código deve ter 6 dígitos.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.mfa.verify({ factorId: mfaEnrollId, challengeId: mfaChallengeId, code: mfaCode });
      if (error) throw new Error(error.message);
      setIs2FAEnabled(true);
      setMfaFactorId(mfaEnrollId);
      setIs2FAModalOpen(false);
      setMfaCode('');
      showToast('Autenticação em 2 fatores ativada!');
    } catch (e: unknown) {
      showToast(`Código inválido. Tente novamente.`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── 2FA: desativar ────────────────────────────────────────────────────────
  const handle2FAUnenroll = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
      if (error) throw new Error(error.message);
      setIs2FAEnabled(false);
      setMfaFactorId('');
      setIs2FAModalOpen(false);
      showToast('2FA desativado.');
    } catch (e: unknown) {
      showToast(`Erro: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── logout ─────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    setIsLogoutConfirmOpen(true);
  };

  const handleConfirmLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } catch (e: unknown) {
      showToast(`Erro ao sair: ${(e as Error).message}`, 'error');
    } finally {
      setIsSigningOut(false);
      setIsLogoutConfirmOpen(false);
    }
  };

  // ── loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin text-gold-500" size={32} />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  const cls = {
    input: 'w-full p-3 bg-surface-50 rounded-xl border-none focus:ring-2 focus:ring-gold-200 dark:focus:ring-gold-800 text-text-primary text-sm',
    label: 'block text-sm font-medium text-text-secondary mb-1',
    row: 'flex items-center gap-3',
    icon: 'w-10 h-10 rounded-full bg-surface-100 flex items-center justify-center text-text-primary flex-shrink-0',
    divider: 'w-full h-px bg-surface-100',
  };

  return (
    <div className="p-6 pb-28 min-h-screen bg-surface-50 space-y-6">
      <PageHeader title="Configurações" subtitle="Gerencie seu perfil, preferências e segurança." />

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Perfil ──────────────────────────────────────────────────────── */}
      <PremiumCard
        className="flex items-center gap-4 cursor-pointer hover:bg-surface-100 transition-colors group"
        onClick={handleOpenProfileModal}
      >
        <div className="w-16 h-16 rounded-full bg-surface-100 flex items-center justify-center text-gold-500 overflow-hidden border-2 border-transparent group-hover:border-gold-200 transition-colors flex-shrink-0">
          {profile?.avatar_url
            ? <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            : <User size={32} />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-text-primary text-lg truncate">{profile?.name || 'Sem nome'}</h3>
          <p className="text-sm text-text-secondary">{profile?.role}</p>
          {profile?.cpf && <p className="text-xs text-text-secondary mt-0.5">CPF: {profile.cpf}</p>}
        </div>
        <ChevronRight className="text-text-secondary group-hover:text-gold-500 transition-colors flex-shrink-0" />
      </PremiumCard>

      {/* ── Gamificação ─────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3 ml-1">Seu Progresso & Conquistas</h3>
        <GamificationProfile />
      </section>

      {/* ── Segurança ───────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3 ml-1">Segurança</h3>
        <PremiumCard className="space-y-5">
          {/* Email */}
          <button onClick={() => { setEmailData({ new: '', confirm: '' }); setIsEmailModalOpen(true); }}
            className="flex items-center justify-between w-full group">
            <div className={cls.row}>
              <div className={cls.icon}><Smartphone size={20} /></div>
              <div className="text-left">
                <p className="font-medium text-text-primary group-hover:text-gold-600 transition-colors">Alterar Email</p>
                <p className="text-xs text-text-secondary truncate max-w-[180px]">{userEmail}</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-text-secondary group-hover:text-gold-600 transition-colors" />
          </button>

          <div className={cls.divider} />

          {/* 2FA */}
          <div className="flex items-center justify-between">
            <div className={cls.row}>
              <div className={cls.icon}><Shield size={20} /></div>
              <div>
                <p className="font-medium text-text-primary">Autenticação em 2 Fatores</p>
                <p className="text-xs text-text-secondary">
                  {is2FAEnabled ? '✅ Ativado — Google Authenticator' : 'Camada extra de segurança'}
                </p>
              </div>
            </div>
            <button
              onClick={handle2FAOpen}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${is2FAEnabled
                ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 hover:bg-red-100'
                : 'bg-gold-50 text-gold-700 dark:bg-gold-900/20 dark:text-gold-400 hover:bg-gold-100'
                }`}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : (is2FAEnabled ? 'Desativar' : 'Ativar')}
            </button>
          </div>

          <div className={cls.divider} />

          {/* Senha */}
          <button onClick={() => { setPasswordData({ new: '', confirm: '' }); setIsPasswordModalOpen(true); }}
            className="flex items-center justify-between w-full group">
            <div className={cls.row}>
              <div className={cls.icon}><Key size={20} /></div>
              <div className="text-left">
                <p className="font-medium text-text-primary group-hover:text-gold-600 transition-colors">Alterar Senha</p>
                <p className="text-xs text-text-secondary">Atualize sua senha de acesso</p>
              </div>
            </div>
            <ChevronRight size={20} className="text-text-secondary group-hover:text-gold-600 transition-colors" />
          </button>
        </PremiumCard>
      </section>

      {/* ── Notificações ───────────────────────────────────────────────── */}
      <section>
        <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3 ml-1">Notificações</h3>
        <PremiumCard>
          <div className="flex items-center justify-between">
            <div className={cls.row}>
              <div className={cls.icon}><Bell size={20} /></div>
              <div>
                <p className="font-medium text-text-primary">Notificações Push</p>
                <p className="text-xs text-text-secondary">Receba alertas importantes</p>
              </div>
            </div>
            <Toggle value={profile?.push_notifications_enabled ?? true} onChange={toggleNotifications} />
          </div>
        </PremiumCard>
      </section>

      {/* ── Sair ───────────────────────────────────────────────────────── */}
      <RoundedButton variant="outline" fullWidth
        className="border-red-200 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
        onClick={handleLogout}>
        <LogOut size={18} className="mr-2" /> Sair da Conta
      </RoundedButton>
      <p className="text-center text-xs text-text-secondary pb-4">Kaizen Axis v1.0.0</p>

      {/* ════════ MODAL: Perfil ════════════════════════════════════════ */}
      <Modal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} title="Editar Perfil">
        <div className="space-y-6">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative w-24 h-24 rounded-full bg-surface-100 overflow-hidden border-4 border-surface-50 shadow-lg">
              {avatarPreview
                ? <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-gold-500"><User size={48} /></div>}
              <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                <Camera className="text-white" size={24} />
                <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
              </label>
            </div>
            <div className="flex gap-3 text-xs">
              <label className="font-medium text-gold-600 dark:text-gold-400 cursor-pointer hover:underline">
                Alterar Foto
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
              </label>
              {avatarPreview && (
                <>
                  <span className="text-text-secondary">•</span>
                  <button onClick={() => { setAvatarPreview(''); setAvatarFile(null); setEditProfile(p => ({ ...p, avatar_url: '' })); }}
                    className="text-red-500 hover:underline">Remover</button>
                </>
              )}
            </div>
          </div>

          {/* Campos */}
          <div className="space-y-4">
            <div>
              <label className={cls.label}>Nome Completo</label>
              <input value={editProfile.name} onChange={e => setEditProfile(p => ({ ...p, name: e.target.value }))} className={cls.input} />
            </div>
            <div>
              <label className={cls.label}>Cargo (Role)</label>
              <div className="w-full p-3 bg-surface-100 rounded-xl text-text-secondary flex items-center gap-2 cursor-not-allowed text-sm">
                <Shield size={14} /> {profile?.role}
              </div>
              <p className="text-[10px] text-text-secondary mt-1 ml-1">O cargo é definido pelo administrador.</p>
            </div>
            <div>
              <label className={cls.label}>CPF</label>
              <input value={editProfile.cpf} onChange={e => setEditProfile(p => ({ ...p, cpf: e.target.value }))}
                className={cls.input} placeholder="000.000.000-00" />
            </div>
          </div>

          <div className="pt-2 space-y-3">
            <RoundedButton fullWidth onClick={handleSaveProfile} disabled={saving}>
              {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
              Salvar Alterações
            </RoundedButton>
            <button
              onClick={() => {
                requestConfirm({
                  title: 'Excluir perfil',
                  message: 'Tem certeza que deseja excluir sua conta? Esta ação é irreversível e não poderá ser desfeita.',
                  confirmLabel: 'Excluir perfil',
                  onConfirm: async () => {
                    await supabase.auth.signOut();
                    navigate('/login');
                  },
                });
              }}
              className="w-full py-3 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <Trash2 size={16} /> Excluir Perfil
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={isLogoutConfirmOpen}
        onClose={() => !isSigningOut && setIsLogoutConfirmOpen(false)}
        onConfirm={handleConfirmLogout}
        title="Confirmar saída"
        message="Tem certeza que deseja sair? Você precisará fazer login novamente para acessar o sistema."
        confirmLabel="Sair agora"
        loading={isSigningOut}
      />

      {/* ════════ MODAL: Email ════════════════════════════════════════ */}
      <Modal isOpen={isEmailModalOpen} onClose={() => setIsEmailModalOpen(false)} title="Alterar Email">
        <div className="space-y-4">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs text-blue-700 dark:text-blue-300">
            Após salvar, você receberá um link de confirmação no <strong>novo email</strong>. A troca só ocorre após clicar no link.
          </div>
          <div>
            <label className={cls.label}>Email Atual</label>
            <div className="w-full p-3 bg-surface-100 rounded-xl text-text-secondary text-sm cursor-not-allowed">{userEmail}</div>
          </div>
          <div>
            <label className={cls.label}>Novo Email</label>
            <input type="email" value={emailData.new} onChange={e => setEmailData(p => ({ ...p, new: e.target.value }))}
              className={cls.input} placeholder="novo@email.com" />
          </div>
          <div>
            <label className={cls.label}>Confirmar Novo Email</label>
            <input type="email" value={emailData.confirm} onChange={e => setEmailData(p => ({ ...p, confirm: e.target.value }))}
              className={cls.input} placeholder="novo@email.com" />
          </div>
          <RoundedButton fullWidth onClick={handleUpdateEmail} disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
            Enviar Confirmação
          </RoundedButton>
        </div>
      </Modal>

      {/* ════════ MODAL: Senha ════════════════════════════════════════ */}
      <Modal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} title="Alterar Senha">
        <div className="space-y-4">
          <div>
            <label className={cls.label}>Nova Senha</label>
            <input type="password" value={passwordData.new} onChange={e => setPasswordData(p => ({ ...p, new: e.target.value }))}
              className={cls.input} placeholder="Mínimo 6 caracteres" />
          </div>
          <div>
            <label className={cls.label}>Confirmar Nova Senha</label>
            <input type="password" value={passwordData.confirm} onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))}
              className={cls.input} />
          </div>
          <RoundedButton fullWidth onClick={handleUpdatePassword} disabled={saving}>
            {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
            Atualizar Senha
          </RoundedButton>
        </div>
      </Modal>

      {/* ════════ MODAL: 2FA ════════════════════════════════════════ */}
      <Modal isOpen={is2FAModalOpen} onClose={() => setIs2FAModalOpen(false)} title="Autenticação em 2 Fatores">
        {mfaStep === 'unenroll' && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Ao desativar, o código do Google Authenticator não será mais solicitado no login.
            </p>
            <RoundedButton fullWidth className="bg-red-500 hover:bg-red-600 text-white" onClick={handle2FAUnenroll} disabled={saving}>
              {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
              Confirmar Desativação
            </RoundedButton>
          </div>
        )}
        {mfaStep === 'qr' && (
          <div className="space-y-5">
            <p className="text-sm text-text-secondary">
              1. Abra o <strong>Google Authenticator</strong> ou <strong>Authy</strong> no seu celular.<br />
              2. Escaneie o QR code abaixo (ou insira o código manualmente).
            </p>
            <div className="flex justify-center">
              {mfaQrUri ? (
                <img
                  src={mfaQrUri}
                  alt="QR Code 2FA"
                  width={200}
                  height={200}
                  className="rounded-xl border border-surface-200 p-2 bg-white"
                />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center rounded-xl border border-surface-200 bg-card-bg">
                  <Loader2 size={24} className="animate-spin text-text-secondary" />
                </div>
              )}
            </div>
            <div className="p-3 bg-surface-100 rounded-xl">
              <p className="text-xs text-text-secondary mb-1">Código manual (se não puder escanear):</p>
              <p className="font-mono text-sm text-text-primary tracking-widest break-all">{mfaSecret}</p>
            </div>
            <RoundedButton fullWidth onClick={handle2FAChallenge} disabled={saving}>
              {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
              Já escaneei → Próximo
            </RoundedButton>
          </div>
        )}
        {mfaStep === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">
              Digite o código de 6 dígitos gerado pelo seu app autenticador para confirmar a ativação.
            </p>
            <div>
              <label className={cls.label}>Código de verificação</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className={`${cls.input} text-center tracking-[0.5em] text-lg font-mono`}
                placeholder="000000"
              />
            </div>
            <RoundedButton fullWidth onClick={handle2FAVerify} disabled={saving || mfaCode.length !== 6}>
              {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : null}
              Confirmar e Ativar
            </RoundedButton>
          </div>
        )}
      </Modal>

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
