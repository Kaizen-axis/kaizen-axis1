import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import jsQR from 'jsqr';
import {
  QrCode, MapPin, CheckCircle, AlertCircle,
  Loader2, Clock, Users, Trophy, ScanLine, Sparkles, Camera, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CheckinRecord {
  id: string;
  user_id: string;
  position_in_queue: number | null;
  checkin_time: string;
  profiles: { name: string | null; avatar_url: string | null; role: string | null } | null;
}

type Step = 'idle' | 'locating' | 'sending' | 'success' | 'error' | 'already' | 'login';

interface CheckinResult {
  position?: number;
  message: string;
  distance?: number;
  xp_earned?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getBRTMinutes() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCHours() * 60 + brt.getUTCMinutes();
}

const LEAD_ELIGIBLE_ROLES = new Set(['CORRETOR', 'COORDENADOR', 'GERENTE']);

function normalizeRole(role?: string | null) {
  return (role || '').trim().toUpperCase();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CheckIn() {
  const { user, profile, signOut } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const qrToken = searchParams.get('token'); // token vindo do QR scan

  const [step, setStep]       = useState<Step>('idle');
  const [result, setResult]   = useState<CheckinResult | null>(null);
  const [queue, setQueue]           = useState<CheckinRecord[]>([]);
  const [brtMinutes, setBrtMinutes] = useState(getBRTMinutes());
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopScanner = useCallback(() => {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
  }, []);

  const applyScannedValue = useCallback((rawValue: string) => {
    const raw = rawValue.trim();
    if (!raw) return false;

    let token = '';
    try {
      const url = new URL(raw);
      token = (url.searchParams.get('token') || '').trim();
    } catch {
      token = raw;
    }

    if (!token) return false;

    setScannerOpen(false);
    setScannerError(null);
    stopScanner();
    navigate(`/checkin?token=${encodeURIComponent(token)}`, { replace: true });
    return true;
  }, [navigate, stopScanner]);

  const startScanner = useCallback(async () => {
    setScannerError(null);
    stopScanner();

    if (!navigator.mediaDevices?.getUserMedia) {
      setScannerError('Seu dispositivo não permite leitura de câmera neste navegador.');
      return;
    }

    const NativeBarcodeDetector = (window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => {
        detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
      };
    }).BarcodeDetector;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      videoRef.current.setAttribute('playsinline', 'true');
      await videoRef.current.play();

      const detector = NativeBarcodeDetector ? new NativeBarcodeDetector({ formats: ['qr_code'] }) : null;

      scanIntervalRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video) return;

        try {
          if (detector) {
            const barcodes = await detector.detect(video);
            if (!barcodes.length) return;
            const rawValue = (barcodes[0]?.rawValue || '').trim();
            if (rawValue) applyScannedValue(rawValue);
            return;
          }

          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
          const width = video.videoWidth;
          const height = video.videoHeight;
          if (!width || !height) return;

          if (!scanCanvasRef.current) {
            scanCanvasRef.current = document.createElement('canvas');
          }

          const canvas = scanCanvasRef.current;
          if (!canvas) return;

          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }

          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;

          ctx.drawImage(video, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const qr = jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
          if (qr?.data) {
            applyScannedValue(qr.data);
          }
        } catch {
          // Ignora erro intermitente de frame e mantém scanner ativo.
        }
      }, 300);
    } catch {
      setScannerError('Não foi possível acessar a câmera. Verifique a permissão e tente novamente.');
    }
  }, [applyScannedValue, stopScanner]);

  useEffect(() => {
    const t = setInterval(() => setBrtMinutes(getBRTMinutes()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return;
    }
    void startScanner();
  }, [scannerOpen, startScanner, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  const handleConfirmLogout = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } finally {
      setIsSigningOut(false);
      setIsLogoutConfirmOpen(false);
    }
  };

  // Bloqueio de horário: Check-in disponível das 08:00 às 13:30
  const isOpen = brtMinutes >= (8 * 60) && brtMinutes <= (13 * 60 + 30);

  // ── Fila do dia ───────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from('daily_checkins')
      .select('id, user_id, position_in_queue, checkin_time, profiles(name, avatar_url, role)')
      .eq('checkin_date', today)
      .order('position_in_queue', { ascending: true });

    const realQueue = (data ?? []) as unknown as CheckinRecord[];

    const { data: alwaysPresentRows } = await supabase
      .from('checkin_always_present_users')
      .select('user_id')
      .eq('enabled', true)
      .lte('start_date', today);

    const alwaysPresentIds = Array.from(new Set((alwaysPresentRows ?? []).map((r: { user_id: string }) => r.user_id)));
    const realIds = new Set(realQueue.map((row) => row.user_id));
    const missingIds = alwaysPresentIds.filter((id) => !realIds.has(id));

    let syntheticQueue: CheckinRecord[] = [];
    if (missingIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, name, avatar_url, role')
        .in('id', missingIds);

      syntheticQueue = (profilesData ?? []).map((p: { id: string; name: string | null; avatar_url: string | null; role: string | null }) => ({
        id: `auto-${p.id}-${today}`,
        user_id: p.id,
        position_in_queue: null,
        checkin_time: `${today}T08:00:00.000Z`,
        profiles: {
          name: p.name,
          avatar_url: p.avatar_url,
          role: p.role,
        },
      }));
    }

    setQueue([...realQueue, ...syntheticQueue]);
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // ── Check-in via QR ───────────────────────────────────────────────────────
  // iOS Safari bloqueia getCurrentPosition se não for disparado por gesto do usuário.
  // Por isso NÃO auto-submitamos: apenas mostramos o banner de confirmação e o botão.
  // O usuário toca no botão → dispara o gesto → iOS permite a solicitação de GPS.
  // (o useEffect anterior que fazia auto-submit foi removido intencionalmente)

  // ── Lógica de check-in ────────────────────────────────────────────────────
  async function submitCheckin(token: string) {
    if (!token.trim()) {
      setStep('error');
      setResult({ message: 'Leitura do QR Code é obrigatória. Escaneie o QR exibido na recepção e tente novamente.' });
      return;
    }

    setStep('locating');
    setResult(null);

    // iOS Safari: tenta alta precisão (GPS) primeiro.
    // Se der timeout (indoor/sinal fraco), cai para baixa precisão (WiFi/rede) — suficiente para 100m.
    type GeoResult = GeolocationPosition | GeolocationPositionError | null;

    const tryGeo = (highAccuracy: boolean, timeout: number) =>
      new Promise<GeoResult>(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          pos => resolve(pos),
          err => resolve(err),
          { enableHighAccuracy: highAccuracy, timeout, maximumAge: 60_000 },
        );
      });

    // 1ª tentativa: GPS de alta precisão (15s)
    let geoResult = await tryGeo(true, 15_000);

    // 2ª tentativa: se deu timeout, usa WiFi/rede (sem GPS — mais rápido indoor)
    if (geoResult && 'code' in geoResult && (geoResult as GeolocationPositionError).code === 3) {
      geoResult = await tryGeo(false, 10_000);
    }

    // Determina se é erro ou posição válida
    const isError = !geoResult || 'code' in geoResult;
    if (isError) {
      const code = (geoResult as GeolocationPositionError | null)?.code ?? 0;
      const isIOS     = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      let msg: string;
      if (code === 1) {
        // PERMISSION_DENIED — cada plataforma tem um caminho diferente
        if (isIOS) {
          msg = 'Permissão de localização negada no Safari.\n\nPasso a passo:\n1. Abra o app Ajustes do iPhone\n2. Role até Safari > Avançado > Dados de Sites\n3. Procure "kaizen-axis" e deslize para apagar\n4. Feche esta aba e abra o link novamente\n5. Quando o Safari perguntar, toque em "Permitir"\n\nSe ainda não funcionar: Ajustes > Privacidade e Segurança > Serviços de Localização > Sites do Safari > "Ao Usar o App".';
        } else if (isAndroid) {
          msg = 'Permissão de localização negada. Toque no ícone de cadeado 🔒 na barra de endereço > Permissões > Localização > Permitir. Depois recarregue a página.';
        } else {
          // Desktop (Chrome, Edge, Firefox…)
          msg = 'Permissão de localização bloqueada no navegador. Clique no ícone de cadeado 🔒 à esquerda da barra de endereço, vá em "Permissões do site" (ou "Configurações do site") > Localização > Permitir. Em seguida recarregue a página (F5).';
        }
      } else if (code === 2) {
        msg = 'Sinal de localização indisponível. No computador, verifique se o Windows tem permissão de localização: Configurações > Privacidade > Localização.';
      } else if (code === 3) {
        msg = 'Localização demorou para responder. Tente novamente ou verifique as permissões do navegador.';
      } else {
        msg = 'Seu navegador não suporta localização. Use Chrome ou Edge atualizados.';
      }
      setStep('error');
      setResult({ message: msg });
      return;
    }

    const pos = geoResult as GeolocationPosition;

    setStep('sending');

    const { data: { session: freshSession } } = await supabase.auth.getSession();
    const accessToken = freshSession?.access_token ?? null;

    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 20_000);

    try {
      const { data, error } = await supabase.functions.invoke('checkin-geo', {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: {
          latitude:  pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy:  pos.coords.accuracy,
          qrToken: token.trim(),
        },
        signal: abortCtrl.signal,
      });
      clearTimeout(timeoutId);

      if (error) {
        const errName = (error as { name?: string }).name;

        if (errName === 'FunctionsHttpError') {
          const status = (error as any).context?.status as number | undefined;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const body: any = await (error as any).context?.json().catch(() => ({}));

          if (status === 401) { setStep('login'); return; }

          if (status === 409) {
            setStep('already');
            setResult({ position: body?.position, message: body?.message || 'Você já fez check-in hoje.' });
            fetchQueue();
            return;
          }

          const safeMessage = body?.error === 'fora_do_raio'
            ? 'Não foi possível validar sua presença neste local.'
            : body?.error === 'gps_impreciso'
            ? 'Não foi possível validar sua localização. Tente novamente.'
            : body?.message || body?.error || `Erro ${status}`;

          setStep('error');
          setResult({ message: safeMessage });
          return;
        }

        if (errName === 'FunctionsRelayError') {
          console.error('[checkin] FunctionsRelayError:', error);
          setStep('error');
          setResult({ message: 'Servidor de check-in indisponível no momento. Tente novamente em instantes.' });
          return;
        }

        if (errName === 'FunctionsFetchError') {
          console.error('[checkin] FunctionsFetchError:', error);
          setStep('error');
          setResult({ message: 'Não foi possível conectar ao servidor de check-in. Tente trocar de rede e tente novamente.' });
          return;
        }

        console.error('[checkin] Unknown function error:', error);
        setStep('error');
        setResult({ message: (error as { message?: string })?.message || 'Falha ao validar check-in. Tente novamente.' });
        return;
      }

      // Sucesso 200
      setStep('success');
      setResult({
        position: data.position,
        message: data.message,
        xp_earned: data.xp_earned
      });
      fetchQueue();
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const isAbort = err instanceof Error && err.name === 'AbortError';
      setStep('error');
      setResult({ message: isAbort ? 'Servidor demorou demais. Tente novamente.' : 'Erro inesperado. Tente novamente.' });
    }
  }

  function handleButtonClick() {
    if (step === 'error') { setStep('idle'); setResult(null); return; }
    if (!isOpen || step !== 'idle' || alreadyDone || isLoading) return;
    if (!cameFromQR || !qrToken) {
      setScannerError(null);
      setScannerOpen(true);
      return;
    }
    submitCheckin(qrToken);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const myCheckin       = queue.find(c => c.user_id === user?.id);
  const eligibleQueue   = queue.filter(c => LEAD_ELIGIBLE_ROLES.has(normalizeRole(c.profiles?.role)));
  const canReceiveLeads = LEAD_ELIGIBLE_ROLES.has(normalizeRole(profile?.role));
  const alreadyDone     = !!myCheckin || step === 'already' || step === 'success';
  const isLoading       = step === 'locating' || step === 'sending';
  const displayPosition = canReceiveLeads ? (result?.position ?? myCheckin?.position_in_queue) : undefined;
  const cameFromQR      = typeof qrToken === 'string' && qrToken.trim().length > 0;

  const btnColor = !isOpen
    ? 'bg-surface-200 text-text-secondary cursor-not-allowed'
    : alreadyDone
    ? 'bg-green-500 text-white shadow-green-400/30'
    : step === 'error'
    ? 'bg-red-500 text-white shadow-red-400/30 cursor-pointer'
    : scannerOpen
    ? 'bg-blue-500 text-white shadow-blue-400/35 cursor-pointer'
    : cameFromQR
    ? 'bg-gold-400 text-white shadow-gold-400/40 cursor-pointer'
    : 'bg-blue-500 text-white shadow-blue-400/35 cursor-pointer';

  const btnLabel = isLoading
    ? (step === 'locating' ? 'Localizando...' : 'Verificando...')
    : alreadyDone ? 'Feito!'
    : step === 'error' ? 'Tentar novamente'
    : scannerOpen ? 'Lendo QR...'
    : cameFromQR ? 'Confirmar check-in'
    : 'Escanear QR';

  const btnHint = alreadyDone
    ? 'Check-in concluído com sucesso.'
    : isLoading
    ? 'Aguarde, estamos confirmando sua localização.'
    : step === 'error'
    ? 'Houve um erro. Toque para tentar novamente.'
    : scannerOpen
    ? 'Aponte a câmera para o QR da recepção.'
    : cameFromQR
    ? 'QR lido. Toque para confirmar o check-in.'
    : 'Toque no botão para abrir a câmera e ler o QR.';

  return (
    <div className="flex flex-col min-h-screen bg-surface-50 pb-24">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="border-b border-surface-200 px-5 pt-10 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary-400">Presença</p>
        <h1 className="v3-serif text-2xl sm:text-3xl text-text-primary tracking-tight mt-1">Check-in</h1>
        <p className="text-sm text-text-secondary mt-1.5 flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-400' : 'bg-surface-500'}`} />
          {isOpen ? 'Janela de check-in aberta' : 'Disponível das 08:00 às 13:30'}
        </p>
      </div>

      <div className="flex-1 px-5 pt-6 space-y-5">

        {/* ── QR escaneado: banner de confirmação ───────────────────────── */}
        <AnimatePresence>
          {cameFromQR && !alreadyDone && step !== 'error' && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 bg-gold-400/10 border border-gold-400/30 rounded-2xl px-4 py-3"
            >
              <ScanLine size={18} className="text-gold-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gold-600 dark:text-gold-400">QR Code escaneado</p>
                <p className="text-xs text-gold-600/70 dark:text-gold-400/70">
                  {isLoading ? 'Validando sua localização...' : 'Toque no botão abaixo para liberar o GPS e confirmar'}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Button area ───────────────────────────────────────────────── */}
        <div className="flex flex-col items-center py-6 gap-5">

          {/* Time badge */}
          <div className={cn(
            'flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold',
            isOpen
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-surface-100 text-text-secondary',
          )}>
            <Clock size={13} />
            {isOpen ? 'Aberto · 08:00–13:30' : 'Fechado · abre às 08:00'}
          </div>

          {/* Main button */}
          <div className="relative">
            <AnimatePresence>
              {scannerOpen && !alreadyDone && !isLoading && (
                <motion.span
                  initial={{ opacity: 0.65, scale: 0.95 }}
                  animate={{ opacity: [0.65, 0.2, 0.65], scale: [0.95, 1.08, 0.95] }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="pointer-events-none absolute -inset-2 rounded-full border-2 border-blue-300/70"
                />
              )}
            </AnimatePresence>

            <AnimatePresence>
              {cameFromQR && !alreadyDone && !scannerOpen && !isLoading && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: [0.5, 0.15, 0.5], scale: [0.94, 1.06, 0.94] }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  className="pointer-events-none absolute -inset-2 rounded-full border-2 border-gold-300/70"
                />
              )}
            </AnimatePresence>

            <motion.button
              whileTap={isOpen && !alreadyDone && !isLoading ? { scale: 0.96 } as any : undefined}
              onClick={handleButtonClick}
              disabled={isLoading || alreadyDone || (!isOpen && step !== 'error')}
              className={cn(
                'relative overflow-hidden w-44 h-44 rounded-full flex flex-col items-center justify-center gap-2',
                'shadow-xl transition-all duration-300',
                !alreadyDone && isOpen && !isLoading && 'hover:scale-[1.02] hover:shadow-2xl',
                btnColor,
              )}
            >
              <span
                className={cn(
                  'pointer-events-none absolute inset-0',
                  scannerOpen
                    ? 'bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]'
                    : cameFromQR
                    ? 'bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.28),transparent_55%)]'
                    : 'bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]',
                )}
              />

              <span className="relative z-10 flex flex-col items-center justify-center gap-2">
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    <motion.div key="loading"
                      initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                      <Loader2 size={38} className="animate-spin" />
                    </motion.div>
                  ) : alreadyDone ? (
                    <motion.div key="ok"
                      initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                      <CheckCircle size={38} />
                    </motion.div>
                  ) : step === 'error' ? (
                    <motion.div key="err"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <AlertCircle size={38} />
                    </motion.div>
                  ) : scannerOpen ? (
                    <motion.div key="scan"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Camera size={38} className="animate-pulse" />
                    </motion.div>
                  ) : cameFromQR ? (
                    <motion.div key="qr"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <ScanLine size={38} />
                    </motion.div>
                  ) : (
                    <motion.div key="idle"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <QrCode size={38} />
                    </motion.div>
                  )}
                </AnimatePresence>
                <span className="text-sm font-semibold text-center leading-tight px-3">{btnLabel}</span>
              </span>
            </motion.button>
          </div>

          <p className="text-xs text-text-secondary text-center max-w-xs -mt-1">{btnHint}</p>

          {/* Result card */}
          <AnimatePresence>
            {(result || myCheckin) && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={cn(
                  'w-full max-w-xs rounded-2xl p-4 text-center border',
                  alreadyDone
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800',
                )}
              >
                {(alreadyDone) && displayPosition && (
                  <>
                    <p className="text-4xl font-bold text-green-600 dark:text-green-400">
                      #{displayPosition}
                    </p>
                    <p className="text-[11px] text-green-600/60 dark:text-green-400/60 mt-0.5 mb-2">
                      na fila de distribuição hoje
                    </p>
                  </>
                )}
                <p className={cn(
                  'text-sm font-medium',
                  step === 'error' ? 'text-left whitespace-pre-line' : 'text-center',
                  alreadyDone
                    ? 'text-green-700 dark:text-green-400'
                    : 'text-red-700 dark:text-red-400',
                )}>
                  {result?.message || 'Check-in registrado!'}
                </p>
                {result?.xp_earned !== undefined && alreadyDone && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 }}
                    className="mt-3 flex items-center justify-center gap-2 bg-gold-400/20 dark:bg-gold-400/10 rounded-full px-4 py-2"
                  >
                    <Sparkles size={14} className="text-gold-600 dark:text-gold-400" />
                    <span className="text-xs font-bold text-gold-700 dark:text-gold-400">
                      +{result.xp_earned} XP
                    </span>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sessão expirada — mostra card com botão de login */}
          {step === 'login' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-xs rounded-2xl p-5 text-center border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 space-y-3"
            >
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Sessão expirada
              </p>
              <p className="text-xs text-amber-600/80 dark:text-amber-400/70">
                Sua sessão venceu. Faça login novamente para continuar.
              </p>
              <button
                onClick={() => setIsLogoutConfirmOpen(true)}
                className="w-full py-2 rounded-full bg-amber-500 text-white text-sm font-semibold"
              >
                Ir para Login
              </button>
            </motion.div>
          )}
        </div>

        {/* ── Fila do dia ───────────────────────────────────────────────── */}
        {eligibleQueue.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3 px-1">
              <Users size={14} className="text-text-secondary" />
              <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-widest">
                Fila de hoje · {eligibleQueue.length} {eligibleQueue.length === 1 ? 'profissional' : 'profissionais'}
              </p>
            </div>
            <div className="bg-card-bg rounded-2xl border border-surface-100 overflow-hidden divide-y divide-surface-50">
              {eligibleQueue.map((c) => {
                const isMe = c.user_id === user?.id;
                const p    = c.profiles as { name: string | null; role: string | null } | null;
                return (
                  <div key={c.id} className={cn('flex items-center gap-3 px-4 py-3', isMe && 'bg-gold-400/5')}>
                    <div className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold',
                      c.position_in_queue === 1 ? 'bg-gold-400 text-white' : 'bg-surface-100 text-text-secondary',
                    )}>
                      {c.position_in_queue === 1 ? <Trophy size={12} /> : c.position_in_queue}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-sm font-medium truncate',
                        isMe ? 'text-gold-600 dark:text-gold-400' : 'text-text-primary',
                      )}>
                        {p?.name || 'Usuário'}{isMe ? ' · você' : ''}
                      </p>
                      <p className="text-xs text-text-secondary">{formatTime(c.checkin_time)}</p>
                    </div>
                    {p?.role && (
                      <span className="text-[10px] text-text-secondary capitalize flex-shrink-0">{p.role}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Info cards (só quando idle e fila vazia) ──────────────────── */}
        {!alreadyDone && step === 'idle' && eligibleQueue.length === 0 && (
          <div className="space-y-2.5 pt-2">
            {[
               { icon: QrCode,   label: 'Leitura obrigatória', value: 'QR Code da recepção' },
               { icon: Clock,    label: 'Horário de check-in', value: '08:00 – 13:30' },
               { icon: MapPin,   label: 'Validação ativa',     value: 'Presença no local' },
               { icon: Users,    label: 'Distribuição ativa',  value: '08:00 – 22:00, Round-Robin' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 bg-card-bg rounded-xl p-4 border border-surface-100">
                <div className="w-8 h-8 rounded-full bg-gold-400/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={15} className="text-gold-500" />
                </div>
                <div>
                  <p className="text-xs text-text-secondary">{label}</p>
                  <p className="text-sm font-medium text-text-primary">{value}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {scannerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="w-full max-w-sm rounded-2xl bg-gray-950 border border-gray-800 p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-white">Escanear QR Code</p>
                <button
                  onClick={() => setScannerOpen(false)}
                  className="w-8 h-8 rounded-full bg-card-bg/10 text-white flex items-center justify-center"
                  aria-label="Fechar scanner"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="rounded-xl overflow-hidden border border-gray-800 bg-black aspect-[3/4] flex items-center justify-center">
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
              </div>

              <p className="text-xs text-gray-300 mt-3">
                Aponte a câmera para o QR da recepção. Ao reconhecer, o token será preenchido automaticamente.
              </p>

              {scannerError && (
                <div className="mt-3 rounded-lg bg-red-900/25 border border-red-800 px-3 py-2 text-xs text-red-300">
                  {scannerError}
                </div>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setScannerOpen(false)}
                  className="flex-1 rounded-lg bg-surface-200 text-text-primary py-2 text-sm font-medium"
                >
                  Fechar
                </button>
                <button
                  onClick={() => void startScanner()}
                  className="flex-1 rounded-lg bg-gold-400 text-white py-2 text-sm font-semibold"
                >
                  Tentar novamente
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        isOpen={isLogoutConfirmOpen}
        onClose={() => !isSigningOut && setIsLogoutConfirmOpen(false)}
        title="Confirmar saída"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Deseja realmente encerrar a sessão e voltar para o login?
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsLogoutConfirmOpen(false)}
              disabled={isSigningOut}
              className="px-4 py-2 rounded-lg border border-surface-200 text-text-secondary hover:bg-surface-100 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => { void handleConfirmLogout(); }}
              disabled={isSigningOut}
              className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
            >
              {isSigningOut ? 'Saindo...' : 'Sair agora'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
