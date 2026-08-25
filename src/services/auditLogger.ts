import { supabase } from '@/lib/supabase';

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'client_created'
  | 'client_updated'
  | 'client_deleted'
  | 'client_view'
  | 'document_uploaded'
  | 'document_deleted'
  | 'document_downloaded'
  | 'permissions_updated'
  | 'lead_converted'
  | 'sale_updated'
  | 'custom';

export interface AuditEventInput {
  action: AuditAction | string;
  entity: string;
  entityId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

class AuditLogger {
  // Deduplicação: evita gravar o mesmo evento mais de uma vez em 3 segundos
  private readonly _recent = new Map<string, number>();

  log(event: AuditEventInput) {
    if (!event.action || !event.entity) return;
    const key = `${event.action}:${event.entity}:${event.entityId ?? ''}`;
    const now = Date.now();
    if ((this._recent.get(key) ?? 0) > now - 3000) return;
    this._recent.set(key, now);
    queueMicrotask(() => { void this.dispatch(event); });
  }

  async logNow(event: AuditEventInput): Promise<{ ok: boolean; message?: string }> {
    return this.dispatch(event);
  }

  private async dispatch(event: AuditEventInput): Promise<{ ok: boolean; message?: string }> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? null;

      const { data, error } = await supabase.functions.invoke('audit-log', {
        body: {
          action: String(event.action).slice(0, 80),
          entity: String(event.entity).slice(0, 80),
          entityId: event.entityId ?? null,
          metadata: {
            ...(event.metadata ?? {}),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          },
        },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });

      if (error) {
        console.warn('[audit] Falha ao gravar evento via Edge Function:', error.message);
        return { ok: false, message: error.message };
      }
      if (data?.message && data?.status !== 'logged') {
        return { ok: false, message: String(data.message) };
      }
      return { ok: true };
    } catch (err: any) {
      console.warn('[audit] Erro ao gravar evento', err);
      return { ok: false, message: err?.message || String(err) };
    }
  }
}

export const auditLogger = new AuditLogger();
export const logAuditEvent = (input: AuditEventInput) => auditLogger.log(input);
export const logAuditEventNow = (input: AuditEventInput) => auditLogger.logNow(input);
