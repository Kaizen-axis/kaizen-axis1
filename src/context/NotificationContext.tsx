import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useApp } from './AppContext';

export interface Notification {
    id: string;
    title: string;
    message: string;
    type: string;
    target_user_id: string | null;
    target_role: string | null;
    directorate_id: string | null;
    reference_id: string | null;
    reference_route: string | null;
    is_read: boolean;
    created_at: string;
}

interface NotificationContextType {
    notifications: Notification[];
    unreadCount: number;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    deleteNotification: (id: string) => Promise<void>;
    deleteAllNotifications: () => Promise<void>;
    loading: boolean;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// ─── VAPID public key (deve bater com VAPID_PUBLIC_KEY nas Supabase Secrets) ──
const VAPID_PUBLIC_KEY = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY as string | undefined;

// ─── AudioContext persistente — desbloqueado na primeira interação ────────────
let _audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;
        if (!_audioCtx) _audioCtx = new AudioCtx();
        return _audioCtx;
    } catch { return null; }
}

// Desbloqueia o AudioContext na primeira interação do usuário
function unlockAudio() {
    const ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
}

// ─── Som de notificação via Web Audio API ─────────────────────────────────────
async function playNotificationSound() {
    try {
        const ctx = getAudioCtx();
        if (!ctx) return;

        // Resume caso ainda suspenso (política autoplay do browser)
        if (ctx.state === 'suspended') await ctx.resume();
        if (ctx.state !== 'running') return;

        const scheduleNote = (freq: number, startAt: number, duration: number, volume = 0.28) => {
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
            gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
            gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startAt + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
            osc.start(ctx.currentTime + startAt);
            osc.stop(ctx.currentTime + startAt + duration + 0.05);
        };

        // Chime duplo: sol5 (784 Hz) → si5 (987 Hz)
        scheduleNote(784, 0,    0.22);
        scheduleNote(987, 0.18, 0.30);
    } catch {
        // Sem suporte — silêncio
    }
}

// ─── Converte base64url para Uint8Array (necessário para VAPID) ───────────────
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw     = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ─── Registra/atualiza push subscription no banco ────────────────────────────
export async function setupPushSubscription(userId: string) {
    if (!VAPID_PUBLIC_KEY) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (!existing) {
            console.warn('[Push] Service worker não registrado. Instale o PWA ou use o app em produção.');
            return;
        }

        const reg = await navigator.serviceWorker.ready;
        let sub   = await reg.pushManager.getSubscription();

        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly:      true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
        }

        const subJson = sub.toJSON() as { endpoint: string; keys: Record<string, string> };

        await supabase.from('push_subscriptions').upsert(
            {
                user_id:      userId,
                endpoint:     subJson.endpoint,
                subscription: subJson,
                updated_at:   new Date().toISOString(),
            },
            { onConflict: 'user_id,endpoint' }
        );
    } catch (err) {
        console.warn('[Push] Falha ao registrar subscription:', err);
    }
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const { profile, loading: appLoading } = useApp();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading]             = useState(true);
    const pushSetupDone = useRef(false);

    const unreadCount = notifications.filter((n) => !n.is_read).length;

    // ── Desbloqueia AudioContext + solicita permissão push na 1ª interação ──
    // iOS PWA: requestPermission() SOMENTE funciona dentro de um gesto do usuário.
    // Por isso unificamos o desbloqueio de áudio e a solicitação de permissão
    // num único handler de gesto, registrado assim que o profile estiver disponível.
    useEffect(() => {
        const events = ['click', 'touchstart', 'keydown'] as const;

        const handler = async () => {
            // 1. Desbloqueia AudioContext (política de autoplay)
            unlockAudio();

            // 2. Solicita permissão de notificação (deve ser dentro do gesto no iOS)
            if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                try { await Notification.requestPermission(); } catch {}
            }

            // 3. Registra push subscription se permissão foi concedida
            if (
                !pushSetupDone.current &&
                profile?.id &&
                typeof Notification !== 'undefined' &&
                Notification.permission === 'granted'
            ) {
                pushSetupDone.current = true;
                await setupPushSubscription(profile.id);
            }

            events.forEach(e => document.removeEventListener(e, handler));
        };

        events.forEach(e => document.addEventListener(e, handler, { once: true }));
        return () => events.forEach(e => document.removeEventListener(e, handler));
    }, [profile?.id]);

    // ── Para usuários que já concederam permissão em sessões anteriores ──────
    useEffect(() => {
        if (!profile?.id || pushSetupDone.current) return;
        if (typeof Notification === 'undefined') return;
        if (Notification.permission !== 'granted') return;

        // Permissão já concedida — registra subscription diretamente
        pushSetupDone.current = true;
        setupPushSubscription(profile.id);
    }, [profile?.id]);

    // ── Carrega notificações e escuta tempo real ──────────────────────────────
    useEffect(() => {
        if (appLoading || !profile?.id) {
            setNotifications([]);
            setLoading(false);
            return;
        }

        let isMounted = true;

        const fetchNotifications = async () => {
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('notifications')
                    .select('*')
                    .eq('is_read', false)
                    .order('created_at', { ascending: false })
                    .limit(50);

                if (error) throw error;

                const role        = profile.role?.toUpperCase();
                const isLeadership = role === 'ADMIN' || role === 'DIRETOR';

                const filtered = (data as Notification[]).filter(n => {
                    if (isLeadership && n.type === 'chat' && n.target_user_id !== profile.id) return false;
                    return true;
                });

                if (isMounted) setNotifications(filtered);
            } catch (error) {
                console.error('Error fetching notifications:', error);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchNotifications();

        const subscription = supabase
            .channel('public:notifications')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notifications' },
                (payload) => {
                    if (!isMounted) return;

                    if (payload.eventType === 'INSERT') {
                        const newNotif = payload.new as Notification;

                        const isForMe          = newNotif.target_user_id === profile.id;
                        const isForMyRole      =
                            (newNotif.target_role || '').toUpperCase() === (profile.role || '').toUpperCase();
                        const isForMyDirectorate = Boolean(newNotif.directorate_id && newNotif.directorate_id === profile.directorate_id);
                        const isAdmin          = profile.role === 'ADMIN';
                        const role             = profile.role?.toUpperCase();
                        const isLeadership     = role === 'ADMIN' || role === 'DIRETOR';

                        if (isLeadership && newNotif.type === 'chat' && !isForMe) return;

                        if (isForMe || isForMyRole || isForMyDirectorate || isAdmin) {
                            setNotifications((prev) => {
                                if (prev.some(n => n.id === newNotif.id)) return prev;
                                return [newNotif, ...prev];
                            });

                            // App em primeiro plano: só o som. Banner do SO vem do SW
                            // quando nenhuma janela está focada.
                            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                                playNotificationSound();
                            }
                        }
                    } else if (payload.eventType === 'UPDATE') {
                        const updatedNotif = payload.new as Notification;
                        if (updatedNotif.is_read) {
                            setNotifications((prev) => prev.filter((n) => n.id !== updatedNotif.id));
                        } else {
                            setNotifications((prev) =>
                                prev.map((n) => (n.id === updatedNotif.id ? updatedNotif : n))
                            );
                        }
                    } else if (payload.eventType === 'DELETE') {
                        setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
                    }
                }
            )
            .subscribe();

        return () => {
            isMounted = false;
            supabase.removeChannel(subscription);
        };
    }, [profile?.id, profile?.role, profile?.directorate_id, appLoading]);

    const markAsRead = async (id: string) => {
        try {
            setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
            const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
            if (error) throw error;
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    const markAllAsRead = async () => {
        if (!profile?.id) return;
        try {
            const idsToMark = notifications.filter(n => !n.is_read).map(n => n.id);
            if (idsToMark.length === 0) return;
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', idsToMark);
            if (error) throw error;
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    };

    const deleteNotification = async (id: string) => {
        try {
            setNotifications((prev) => prev.filter((n) => n.id !== id));
            const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
            if (error) throw error;
        } catch (error) {
            console.error('Error deleting notification:', error);
        }
    };

    const deleteAllNotifications = async () => {
        if (!profile?.id) return;
        try {
            const ids = notifications.map((n) => n.id);
            if (ids.length === 0) return;
            setNotifications([]);
            const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', ids);
            if (error) throw error;
        } catch (error) {
            console.error('Error clearing all notifications:', error);
        }
    };

    return (
        <NotificationContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification, deleteAllNotifications, loading }}>
            {children}
        </NotificationContext.Provider>
    );
}

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};
