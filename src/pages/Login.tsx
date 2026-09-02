import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoundedButton } from '@/components/ui/PremiumComponents';
import { Building2, Mail, Lock, User, Users, ShieldCheck, Loader2, ArrowLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { logAuditEvent } from '@/services/auditLogger';
import { assertSessionEmail } from '@/lib/auth/sessionIdentity';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/motion';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, any>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export default function Login() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  // Dados de formulário básico
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  // Estado MFA
  const [showMfaInput, setShowMfaInput] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaFactorId, setMfaFactorId] = useState('');
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  // Estado de redefinição de senha (vindo do link do e-mail)
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaHint, setCaptchaHint] = useState('');
  const captchaContainerRef = useRef<HTMLDivElement | null>(null);
  const captchaWidgetIdRef = useRef<string | null>(null);

  const resetCaptcha = () => {
    setCaptchaToken('');
    if (!TURNSTILE_SITE_KEY) return;
    if (captchaWidgetIdRef.current && window.turnstile) {
      window.turnstile.reset(captchaWidgetIdRef.current);
    }
  };

  const getCaptchaTokenIfRequired = () => {
    if (!TURNSTILE_SITE_KEY) return null;
    if (!captchaToken) {
      throw new Error('Confirme a verificacao de seguranca antes de continuar.');
    }
    return captchaToken;
  };

  const consumeCaptchaTokenIfRequired = () => {
    const token = getCaptchaTokenIfRequired();
    resetCaptcha();
    return token;
  };

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || showMfaInput || showResetPassword) return;

    let isCancelled = false;

    const removeExistingWidget = () => {
      if (captchaWidgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(captchaWidgetIdRef.current); } catch { /* ignore */ }
        captchaWidgetIdRef.current = null;
      }
      // Limpa o container manualmente para evitar Error 300010
      if (captchaContainerRef.current) {
        captchaContainerRef.current.innerHTML = '';
      }
      setCaptchaToken('');
    };

    const renderCaptcha = () => {
      if (isCancelled || !captchaContainerRef.current || !window.turnstile) return;
      // Remove qualquer widget anterior antes de criar um novo
      removeExistingWidget();
      if (isCancelled) return;
      captchaWidgetIdRef.current = window.turnstile.render(captchaContainerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: 'auto',
        callback: (token: string) => {
          setCaptchaToken(token || '');
          if (token) setCaptchaHint('');
        },
        'expired-callback': () => {
          setCaptchaToken('');
          setCaptchaHint('A verificação expirou. Complete de novo e tente novamente.');
        },
        'error-callback': () => {
          setCaptchaToken('');
          setCaptchaHint('Não foi possível validar a verificação. Tente novamente.');
        },
      });
    };

    if (window.turnstile) {
      renderCaptcha();
      return () => {
        isCancelled = true;
        removeExistingWidget();
      };
    }

    const existingScript = document.querySelector('script[data-turnstile="true"]') as HTMLScriptElement | null;
    const onLoad = () => renderCaptcha();

    if (existingScript) {
      existingScript.addEventListener('load', onLoad);
      return () => {
        isCancelled = true;
        existingScript.removeEventListener('load', onLoad);
        removeExistingWidget();
      };
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = 'true';
    script.addEventListener('load', onLoad);
    document.head.appendChild(script);

    return () => {
      isCancelled = true;
      script.removeEventListener('load', onLoad);
      removeExistingWidget();
    };
  }, [showMfaInput, showResetPassword, isLogin]);

  // Detecta evento PASSWORD_RECOVERY do Supabase
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowResetPassword(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      alert('As senhas não coincidem.');
      return;
    }
    if (newPassword.length < 8) {
      alert('A senha deve ter pelo menos 8 caracteres.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      alert('Erro ao redefinir senha: ' + error.message);
    } else {
      alert('Senha redefinida com sucesso! Faça login com sua nova senha.');
      setShowResetPassword(false);
      window.history.replaceState(null, '', window.location.pathname);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const ensureUserIsActive = async (userId?: string | null) => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();
    if (error) throw error;

    const status = String(data?.status || '').toLowerCase();
    if (status === 'inativo' || status === 'inactive') {
      await supabase.auth.signOut();
      throw new Error('Sua conta está inativa. Fale com o administrador para reativação.');
    }
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!isLogin) {
        if (formData.password !== formData.confirmPassword) {
          alert('As senhas não coincidem.');
          setLoading(false);
          return;
        }

        const captchaTokenValue = consumeCaptchaTokenIfRequired();

        const { data, error } = await supabase.functions.invoke('send-signup-confirmation', {
          body: {
            email: formData.email,
            password: formData.password,
            name: formData.name,
            captchaToken: captchaTokenValue,
          },
        });

        if (error) {
          let message = 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.';
          try {
            const response = (error as any).context;
            if (response) {
              const errData = await response.json().catch(() => ({}));
              message = errData?.message || message;
            }
          } catch { /* mantém mensagem genérica */ }
          throw new Error(message);
        }

        alert(data?.message || 'Cadastro realizado com sucesso! Verifique seu e-mail ou faça login.');
        setIsLogin(true);
        setLoading(false);
      } else {
        const captchaTokenValue = consumeCaptchaTokenIfRequired();

        const { data: existingSessionData } = await supabase.auth.getSession();
        const existingEmail = existingSessionData.session?.user?.email;
        if (existingEmail && existingEmail.trim().toLowerCase() !== formData.email.trim().toLowerCase()) {
          await supabase.auth.signOut();
        }

        // Login protegido no backend: secure-login aplica rate limit por IP antes de autenticar.
        const { data: loginData, error: loginError } = await supabase.functions.invoke('secure-login', {
          body: { email: formData.email, password: formData.password, captchaToken: captchaTokenValue },
        });

        if (loginError) {
          let status = 500;
          let message = 'Falha no login seguro. Tente novamente.';
          try {
            const response = (loginError as any).context;
            if (response) {
              status = response.status || status;
              const errData = await response.json().catch(() => ({}));
              message = errData?.message || message;
            }
          } catch {
            // ignore parse failure, keep generic message
          }

          if (status === 429) throw new Error(message || 'Muitas tentativas. Aguarde antes de tentar novamente.');
          if (status === 400) throw new Error(message || 'Dados de login inválidos.');
          if (status === 401) throw new Error(message || 'Credenciais inválidas.');
          throw new Error(message);
        }

        const accessToken = loginData?.access_token;
        const refreshToken = loginData?.refresh_token;
        if (!accessToken || !refreshToken) {
          throw new Error('Resposta de autenticação inválida.');
        }

        const { data: sessionSetData, error: sessionSetError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionSetError) throw sessionSetError;

        const session = sessionSetData?.session;
        try {
          assertSessionEmail(session, formData.email);
        } catch (identityError) {
          await supabase.auth.signOut();
          throw identityError;
        }
        setPendingUserId(session?.user?.id || loginData?.user?.id || null);

        await ensureUserIsActive(session?.user?.id || loginData?.user?.id || null);

        // Verificar se requer MFA (Assurance Level AAL2 não atingido)
        if (session && session.user) {
          const { data: mfaData, error: mfaError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
          if (mfaError) throw mfaError;

          if (mfaData.nextLevel === 'aal2' && mfaData.nextLevel !== mfaData.currentLevel) {
            // Requer MFA. Pegar o fator TOTP ativo.
            const { data: factors } = await supabase.auth.mfa.listFactors();
            const totpFactor = factors?.totp?.find(f => f.status === 'verified');

            if (totpFactor) {
              setMfaFactorId(totpFactor.id);
              setShowMfaInput(true);
              setLoading(false);
              return; // Para aqui e aguarda o código MFA
            }

            // MFA é exigido mas nenhum fator verificado encontrado — bloqueia acesso
            await supabase.auth.signOut();
            logAuditEvent({ action: 'login_failed', entity: 'auth', metadata: { reason: 'mfa_required_no_factor' } });
            throw new Error('Autenticação em dois fatores é obrigatória. Configure o 2FA nas configurações da sua conta.');
          }
        }

        // Login direto bem-sucedido (não tem MFA ativado)
        finishLogin(session?.user?.id || loginData?.user?.id || null);
        setPendingUserId(null);
      }
    } catch (error: any) {
      console.error('Erro na autenticação:', error.message);
      logAuditEvent({
        action: 'login_failed',
        entity: 'auth',
        metadata: { reason: error.message }
      });
      alert(error.message);
      if (/verificação de segurança/i.test(String(error.message || ''))) {
        setCaptchaHint('Verificação inválida ou expirada. Complete de novo e tente novamente.');
      }
      resetCaptcha();
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaCode.length !== 6) {
      alert('O código deve ter 6 dígitos.');
      return;
    }

    setLoading(true);
    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challengeError) throw challengeError;

      const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode
      });

      if (verifyError) throw verifyError;

      await ensureUserIsActive(pendingUserId || verifyData?.user?.id || null);

      // Código verificado com sucesso, entra no sistema
      finishLogin(pendingUserId || verifyData?.user?.id || null);
      setPendingUserId(null);
    } catch (error: any) {
      console.error('Erro MFA:', error.message);
      logAuditEvent({
        action: 'login_failed',
        entity: 'auth',
        metadata: { stage: 'mfa', reason: error.message }
      });
      alert(error.message || 'Código inválido. Tente novamente.');
      setLoading(false);
    }
  };

  const finishLogin = (userId?: string | null) => {
    logAuditEvent({
      action: 'login_success',
      entity: 'auth',
      userId: userId ?? null,
      metadata: { email_domain: formData.email.split('@')[1] }
    });
    navigate('/');
  };

  // ── GSAP: glow flutuante + entrada em stagger ──────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-reveal]', { opacity: 0, y: 20, duration: 0.6, ease: 'power3.out', stagger: 0.08 });
      gsap.to('.login-glow-1', { x: 40, y: 30, duration: 12, ease: 'sine.inOut', repeat: -1, yoyo: true });
      gsap.to('.login-glow-2', { x: -34, y: -40, duration: 15, ease: 'sine.inOut', repeat: -1, yoyo: true });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={rootRef} className="v3-login relative min-h-screen w-full overflow-hidden bg-surface-50 lg:grid lg:grid-cols-2">
      {/* Aurora glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="login-glow-1 absolute -top-40 -left-32 h-[36rem] w-[36rem] rounded-full blur-[120px]" style={{ background: 'radial-gradient(circle, #2563eb55, transparent 70%)' }} />
        <div className="login-glow-2 absolute -bottom-48 -right-40 h-[34rem] w-[34rem] rounded-full blur-[120px]" style={{ background: 'radial-gradient(circle, #1e3a8a4d, transparent 70%)' }} />
        <div className="absolute inset-0 opacity-[0.4]" style={{ backgroundImage: 'linear-gradient(to right, rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.05) 1px, transparent 1px)', backgroundSize: '40px 40px', maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 75%)' }} />
      </div>

      {/* ── Painel de marca (desktop) ── */}
      <div className="relative z-10 hidden lg:flex flex-col justify-between px-14 pt-14 pb-8 xl:px-16 xl:pt-16 xl:pb-8">
        {/* Marca */}
        <div data-reveal className="flex items-center gap-3">
          <img src="/pwa-192x192.png" alt="Kaizen Axis" className="h-10 w-10 rounded-xl object-cover shadow-lg shadow-primary-500/30" />
          <div>
            <p className="v3-serif text-lg text-text-primary leading-none">Kaizen</p>
            <p className="text-[10px] text-primary-400 font-semibold uppercase tracking-[0.24em] mt-1">Axis</p>
          </div>
        </div>

        {/* Hero */}
        <div className="max-w-md">
          <h1 data-reveal className="v3-serif text-[2.5rem] xl:text-[2.9rem] font-medium leading-[1.15] tracking-[-0.015em] text-text-primary">
            Melhoria contínua,<br /><span className="text-primary-400">conquistas duradouras.</span>
          </h1>
          <p data-reveal className="mt-6 text-[15px] leading-relaxed text-text-secondary">
            A plataforma da Kaizen para acompanhar clientes, metas e resultados —
            transformando o esforço de cada dia em conquistas que duram.
          </p>

          <div data-reveal className="mt-9 h-px w-14 bg-primary-500/40" />

          <div className="mt-8 space-y-4">
            {[
              { icon: Users, label: 'Gestão de carteira e funil de vendas' },
              { icon: ShieldCheck, label: 'Apuração de renda e relatórios' },
              { icon: Building2, label: 'Agenda, check-in e empreendimentos' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} data-reveal className="flex items-center gap-3.5 text-sm text-text-secondary">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-primary-500/20 bg-primary-500/10 text-primary-400"><Icon size={16} /></span>
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Rodapé */}
        <p data-reveal className="text-xs text-text-secondary/55">© 2026 Kaizen Axis · Plataforma de gestão da Kaizen</p>
      </div>

      {/* ── Painel do formulário ── */}
      <div className="relative z-10 flex min-h-screen items-center justify-center p-5 sm:p-8 lg:p-10">
        <div data-reveal className="w-full max-w-md rounded-2xl border border-surface-200/80 bg-card-bg/70 p-7 sm:p-9 shadow-2xl shadow-black/40 backdrop-blur-xl">

        <div data-reveal className="mb-6 flex justify-center lg:hidden">
          <img src="/pwa-192x192.png" alt="Kaizen Axis" className="h-14 w-14 rounded-2xl object-cover shadow-lg shadow-primary-500/30" />
        </div>

        <div className="mb-8 text-center">
          <h2 className="v3-serif text-3xl text-text-primary tracking-tight">
            {showResetPassword ? 'Nova Senha' : showMfaInput ? 'Autenticação' : (isLogin ? 'Bem-vindo de volta' : 'Criar Nova Conta')}
          </h2>
          <p className="text-sm text-text-secondary mt-2">
            {showResetPassword
              ? 'Digite e confirme sua nova senha'
              : showMfaInput
              ? 'Proteção em Dois Fatores'
              : 'Insira suas credenciais para acessar a plataforma'}
          </p>
        </div>

        {/* ── Tela Redefinir Senha ───────────────────────────────────────────── */}
        {showResetPassword ? (
          <form onSubmit={handleResetPasswordSubmit} className="space-y-5 animate-in fade-in duration-300">
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-gold-500 transition-colors" size={20} />
              <input
                type="password"
                placeholder="Nova senha"
                required
                minLength={8}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary focus:outline-none"
              />
            </div>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-gold-500 transition-colors" size={20} />
              <input
                type="password"
                placeholder="Confirme a nova senha"
                required
                minLength={8}
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary focus:outline-none"
              />
            </div>
            <RoundedButton type="submit" fullWidth className="py-4 text-base font-semibold shadow-gold-500/20 shadow-lg" disabled={loading}>
              {loading ? <Loader2 size={20} className="animate-spin" /> : 'Salvar Nova Senha'}
            </RoundedButton>
          </form>
        ) : showMfaInput ? (
          <form onSubmit={handleMfaSubmit} className="space-y-6 animate-in slide-in-from-right-8 duration-300">
            <div className="text-center text-sm text-text-secondary bg-surface-50 dark:bg-surface-800 p-4 rounded-xl">
              Abra seu Google Authenticator ou Authy e digite o código de 6 dígitos para o Kaizen Axis.
            </div>

            <div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="w-full py-4 text-center tracking-[0.75em] text-3xl font-mono bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary placeholder:tracking-normal placeholder:text-lg focus:outline-none"
                placeholder="000000"
                autoFocus
                required
              />
            </div>

            <RoundedButton type="submit" fullWidth className="py-4 text-base font-semibold shadow-gold-500/20 shadow-lg" disabled={loading || mfaCode.length !== 6}>
              {loading ? <Loader2 size={20} className="animate-spin" /> : 'Verificar e Entrar'}
            </RoundedButton>

            <button
              type="button"
              onClick={() => { setShowMfaInput(false); setMfaCode(''); }}
              className="flex items-center justify-center gap-2 text-sm font-medium text-text-secondary hover:text-text-primary w-full mt-2 transition-colors py-2"
              disabled={loading}
            >
              <ArrowLeft size={16} /> Voltar ao Login
            </button>
          </form>
        ) : (
          /* ── Tela Login/Cadastro Padrão ───────────────────────────────────── */
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="animate-in slide-in-from-top-4 duration-300">
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-gold-500 transition-colors" size={20} />
                  <input
                    type="text"
                    name="name"
                    placeholder="Nome completo"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className="w-full pl-12 pr-4 py-3.5 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-gold-500 transition-colors" size={20} />
              <input
                type="email"
                name="email"
                placeholder="E-mail profissional"
                required
                value={formData.email}
                onChange={handleChange}
                className="w-full pl-12 pr-4 py-3.5 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary focus:outline-none"
              />
            </div>

            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-gold-500 transition-colors" size={20} />
              <input
                type="password"
                name="password"
                placeholder="Senha"
                required
                value={formData.password}
                onChange={handleChange}
                className="w-full pl-12 pr-4 py-3.5 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary focus:outline-none"
              />
            </div>

            {!isLogin && (
              <div className="relative animate-in slide-in-from-top-4 duration-300 group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary group-focus-within:text-gold-500 transition-colors" size={20} />
                <input
                  type="password"
                  name="confirmPassword"
                  placeholder="Confirme a senha"
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3.5 bg-surface-50 dark:bg-surface-800/50 rounded-xl border border-surface-200 dark:border-surface-700 focus:ring-2 focus:ring-gold-500 focus:border-gold-500 transition-all text-sm text-text-primary focus:outline-none"
                />
              </div>
            )}

            {isLogin && (
              <div className="flex justify-end items-center px-1">
                <button
                  type="button"
                  className="text-xs font-semibold text-gold-600 hover:text-gold-500 transition-colors disabled:opacity-50"
                  disabled={loading}
                  onClick={async () => {
                    try {
                      const email = formData.email.trim();
                      if (!email) {
                        alert('Digite seu e-mail no campo acima antes de clicar em "Esqueceu a senha?".');
                        return;
                      }

                      const captchaTokenValue = consumeCaptchaTokenIfRequired();

                      setLoading(true);
                      // Reset entregue pela edge function via Resend (e-mail nativo do
                      // Supabase Auth não estava entregando os links de recuperação).
                      const { data, error } = await supabase.functions.invoke('send-password-reset', {
                        body: { email, captchaToken: captchaTokenValue },
                      });
                      if (error) {
                        let message = 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.';
                        try {
                          const response = (error as any).context;
                          if (response) {
                            const errData = await response.json().catch(() => ({}));
                            message = errData?.message || message;
                          }
                        } catch { /* mantém mensagem genérica */ }
                        if (/verificação de segurança/i.test(message)) {
                          setCaptchaHint('Verificação inválida ou expirada. Complete de novo e tente novamente.');
                        }
                        alert(message);
                      } else {
                        alert(data?.message || 'Se o e-mail estiver cadastrado, você receberá o link de redefinição em instantes.');
                      }
                    } catch (error: any) {
                      alert(error?.message || 'Falha ao iniciar redefinicao de senha.');
                      resetCaptcha();
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Esqueceu a senha?
                </button>
              </div>
            )}

            {TURNSTILE_SITE_KEY && (
              <div className="pt-1">
                <div ref={captchaContainerRef} className="flex justify-center" />
                {captchaHint && (
                  <p className="mt-2 text-xs text-center text-red-500">{captchaHint}</p>
                )}
              </div>
            )}

            <RoundedButton type="submit" fullWidth className="mt-8 py-4 text-base font-semibold shadow-gold-500/20 shadow-lg" disabled={loading}>
              {loading ? <Loader2 size={20} className="animate-spin" /> : (isLogin ? 'Entrar na Plataforma' : 'Cadastrar Conta')}
            </RoundedButton>
          </form>
        )}

        {!showMfaInput && !showResetPassword && (
          <div className="mt-8 text-center border-t border-surface-100 dark:border-surface-800 pt-6">
            <p className="text-sm text-text-secondary">
              {isLogin ? 'Novo por aqui?' : 'Já faz parte da equipe?'}
              <button
                onClick={() => setIsLogin(!isLogin)}
                className="ml-1.5 font-bold text-gold-600 hover:text-gold-500 transition-colors"
              >
                {isLogin ? 'Solicite acesso' : 'Faça login'}
              </button>
            </p>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
