// ─── send-push Edge Function ──────────────────────────────────────────────────
// Recebe { notification } no body e envia Web Push para todos os dispositivos
// do usuário alvo usando VAPID.
//
// Variáveis de ambiente necessárias (Supabase Secrets):
//   VAPID_PUBLIC_KEY   — chave pública P-256 em base64url (65 bytes)
//   VAPID_PRIVATE_KEY  — chave privada P-256 em base64url (32 bytes)
//   VAPID_MAILTO       — ex: mailto:admin@seudominio.com
//   SUPABASE_URL       — preenchida automaticamente pelo Supabase
//   SUPABASE_SERVICE_ROLE_KEY — preenchida automaticamente pelo Supabase
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_MAILTO      = Deno.env.get('VAPID_MAILTO') ?? 'mailto:admin@kaizenaxis.com';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ALLOWED_ROLES = new Set(['ADMIN', 'DIRETOR', 'GERENTE']);
const MAX_PUSH_REQUESTS_PER_MINUTE = 20;

const CORS_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Vary': 'Origin',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

type PushNotificationPayload = {
  id?: string;
  target_user_id?: string | null;
  target_role?: string | null;
  directorate_id?: string | null;
  title?: string;
  message?: string;
  reference_route?: string;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPECTED_ISS = `${SUPABASE_URL}/auth/v1`;

type Claims = {
  sub?: string;
  exp?: number;
  iss?: string;
  aud?: string | string[];
};

type PushSendResult = {
  ok: boolean;
  endpoint: string;
  status: number;
  error?: string;
};

function badRequest(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function logStructured(event: string, payload: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...payload }));
}

function validateClaims(claims: Claims): { valid: boolean; reason?: string } {
  if (!claims?.sub || !UUID_REGEX.test(claims.sub)) {
    return { valid: false, reason: 'invalid_sub' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (!claims?.exp || Number(claims.exp) <= now) {
    return { valid: false, reason: 'token_expired' };
  }

  if (!claims?.iss || claims.iss !== EXPECTED_ISS) {
    return { valid: false, reason: 'invalid_iss' };
  }

  const aud = claims.aud;
  const audAllowed = Array.isArray(aud)
    ? aud.includes('authenticated')
    : aud === 'authenticated';

  if (!audAllowed) {
    return { valid: false, reason: 'invalid_aud' };
  }

  return { valid: true };
}

function pickStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function extractDispatchNotification(body: unknown): PushNotificationPayload | null {
  const root = (body && typeof body === 'object') ? (body as Record<string, unknown>) : null;
  if (!root) return null;
  const candidate = root.record ?? root.notification ?? root;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const notification = candidate as Record<string, unknown>;
  const target_user_id = pickStr(notification, 'target_user_id');
  const target_role = pickStr(notification, 'target_role');
  const directorate_id = pickStr(notification, 'directorate_id');
  if (!target_user_id && !target_role && !directorate_id) return null;

  return {
    id: pickStr(notification, 'id') ?? undefined,
    target_user_id,
    target_role,
    directorate_id,
    title: pickStr(notification, 'title') ?? undefined,
    message: pickStr(notification, 'message') ?? undefined,
    reference_route: pickStr(notification, 'reference_route') ?? undefined,
  };
}

function normalizeNotification(body: unknown): PushNotificationPayload | null {
  const extracted = extractDispatchNotification(body);
  if (!extracted?.target_user_id || !UUID_REGEX.test(extracted.target_user_id)) return null;
  return extracted;
}

// ── Helpers base64url ─────────────────────────────────────────────────────────
function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    b64url.length + (4 - (b64url.length % 4)) % 4, '='
  );
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function bytesToB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Cria JWT VAPID assinado com ES256 ─────────────────────────────────────────
async function createVapidJwt(audience: string): Promise<string> {
  const header  = { alg: 'ES256', typ: 'JWT' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_MAILTO,
  };
  const encode   = (obj: object) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const sigInput = `${encode(header)}.${encode(payload)}`;

  // Extrai coordenadas x e y do ponto não comprimido da chave pública (04 || x || y)
  const pubBytes = b64urlToBytes(VAPID_PUBLIC_KEY); // 65 bytes: 0x04 + x(32) + y(32)
  const x = bytesToB64url(pubBytes.slice(1, 33));
  const y = bytesToB64url(pubBytes.slice(33, 65));

  const privKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE_KEY, x, y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(sigInput)
  );

  return `${sigInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

// ── Envia Web Push para uma subscription ─────────────────────────────────────
async function sendWebPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<PushSendResult> {
  const url      = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt      = await createVapidJwt(audience);

  const response = await fetch(subscription.endpoint, {
    method:  'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Type':  'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
    },
    body: await encryptPayload(subscription.keys, payload),
  });

  if (!response.ok && response.status !== 201) {
    const text = await response.text().catch(() => '');
    return {
      ok: false,
      endpoint: subscription.endpoint,
      status: response.status,
      error: `Push failed ${response.status}: ${text}`,
    };
  }

  return { ok: true, endpoint: subscription.endpoint, status: response.status };
}

// ── Encriptação AES-128-GCM + ECDH (RFC 8291) ────────────────────────────────
async function encryptPayload(
  keys: { p256dh: string; auth: string },
  plaintext: string
): Promise<Uint8Array> {
  const authSecret = b64urlToBytes(keys.auth);            // 16 bytes
  const receiverPubRaw = b64urlToBytes(keys.p256dh);      // 65 bytes (04 x y)

  // Importa chave pública do receptor
  const receiverPub = await crypto.subtle.importKey(
    'raw', receiverPubRaw,
    { name: 'ECDH', namedCurve: 'P-256' }, true, []
  );

  // Gera par efêmero
  const senderPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const senderPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderPair.publicKey));

  // Deriva segredo compartilhado (256 bits)
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPub }, senderPair.privateKey, 256
  ));

  // salt aleatório de 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // PRK via HKDF-SHA256
  const concat = (...arrs: Uint8Array[]) => {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let offset = 0;
    for (const a of arrs) { out.set(a, offset); offset += a.length; }
    return out;
  };
  const hkdfExtract = async (ikm: Uint8Array, salt: Uint8Array) => {
    const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
  };
  const hkdfExpand = async (prk: Uint8Array, info: Uint8Array, length: number) => {
    const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const t    = new Uint8Array(await crypto.subtle.sign('HMAC', key, concat(info, new Uint8Array([1]))));
    return t.slice(0, length);
  };

  const keyInfo  = concat(new TextEncoder().encode('Content-Encoding: aes128gcm\0'), new Uint8Array([0]), new Uint8Array([16]));
  const nonceInfo = concat(new TextEncoder().encode('Content-Encoding: nonce\0'), new Uint8Array([0]), new Uint8Array([12]));

  // ikm = PRK via auth
  const prkCombine = concat(
    new TextEncoder().encode('WebPush: info\0'),
    receiverPubRaw, senderPubRaw
  );
  const prk  = await hkdfExtract(ecdhSecret, authSecret);
  const ikm  = await hkdfExpand(prk, prkCombine, 32);
  const prk2 = await hkdfExtract(ikm, salt);

  const contentKey   = await hkdfExpand(prk2, keyInfo,   16);
  const contentNonce = await hkdfExpand(prk2, nonceInfo, 12);

  // Importa chave AES-GCM
  const aesKey = await crypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['encrypt']);

  // Payload com padding (record size 4096)
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const rs = 4096;
  const paddedContent  = concat(plaintextBytes, new Uint8Array([2])); // delimiter byte
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: contentNonce, tagLength: 128 }, aesKey, paddedContent
  ));

  // Monta header RFC 8291: salt(16) + rs(4) + keyid_len(1) + keyid(65) + ciphertext
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = 65;
  header.set(senderPubRaw, 21);

  return concat(header, encrypted);
}

type AdminClient = ReturnType<typeof createClient>;

async function claimDispatch(supabase: AdminClient, notificationId?: string): Promise<boolean> {
  if (!notificationId || !UUID_REGEX.test(notificationId)) return true;
  const { error } = await supabase
    .from('push_dispatch_log')
    .insert({ notification_id: notificationId });
  if (!error) return true;
  if (error.code === '23505') return false;
  console.warn('push_dispatch_log insert:', error.message);
  return true;
}

async function resolveRecipientIds(supabase: AdminClient, n: PushNotificationPayload): Promise<string[]> {
  if (n.target_user_id && UUID_REGEX.test(n.target_user_id)) return [n.target_user_id];

  if (n.target_role) {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', n.target_role.toUpperCase());
    return (data ?? []).map((p: { id: string }) => p.id);
  }

  if (n.directorate_id && UUID_REGEX.test(n.directorate_id)) {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('directorate_id', n.directorate_id);
    return (data ?? []).map((p: { id: string }) => p.id);
  }

  return [];
}

async function filterPushEnabled(supabase: AdminClient, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await supabase
    .from('profiles')
    .select('id, push_notifications_enabled')
    .in('id', userIds);
  return (data ?? [])
    .filter((p: { push_notifications_enabled?: boolean | null }) => p.push_notifications_enabled !== false)
    .map((p: { id: string }) => p.id);
}

async function sendToUsers(
  supabase: AdminClient,
  userIds: string[],
  notification: PushNotificationPayload,
): Promise<{ sent: number; failed: number }> {
  if (userIds.length === 0) return { sent: 0, failed: 0 };

  const payload = JSON.stringify({
    id: notification.id,
    title: notification.title ?? 'Kaizen Axis',
    body: notification.message ?? 'Nova notificação',
    url: notification.reference_route ?? '/',
  });

  let sent = 0;
  let failed = 0;

  for (const targetUserId of userIds) {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, subscription')
      .eq('user_id', targetUserId);

    if (!subs?.length) continue;

    const results = await Promise.all(
      subs.map(({ endpoint, subscription }) => sendWebPush({
        endpoint,
        keys: subscription.keys,
      }, payload).catch((err) => ({
        ok: false,
        endpoint,
        status: 500,
        error: err?.message || 'unknown_error',
      } as PushSendResult)))
    );

    sent += results.filter((r) => r.ok).length;
    const failures = results.filter((r) => !r.ok);
    failed += failures.length;

    const invalidEndpoints = failures
      .filter((r) => r.status === 404 || r.status === 410)
      .map((r) => r.endpoint);

    if (invalidEndpoints.length > 0) {
      const { error: deleteError } = await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', targetUserId)
        .in('endpoint', invalidEndpoints);
      if (deleteError) {
        console.error('send-push cleanup subscriptions error:', deleteError.message);
      }
    }
  }

  return { sent, failed };
}

// ─── Handler principal ────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return badRequest('Method not allowed', 405);
  }

  try {
    const correlationId = crypto.randomUUID();
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, serviceKey);
    const anonKey = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        result: 'denied',
        deny_reason: 'missing_token',
      });
      return badRequest('Unauthorized', 401);
    }

    const isInternal = token === serviceKey;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return badRequest('Invalid JSON body', 400);
    }

    if (isInternal) {
      const notification = extractDispatchNotification(body);
      if (!notification) {
        logStructured('send_push_denied', {
          correlation_id: correlationId,
          result: 'denied',
          deny_reason: 'invalid_payload',
          actor: 'service_role',
        });
        return badRequest('Invalid payload.', 422);
      }

      const claimed = await claimDispatch(supabase, notification.id);
      if (!claimed) {
        return new Response(JSON.stringify({ sent: 0, failed: 0, note: 'already_dispatched' }), {
          status: 200,
          headers: JSON_HEADERS,
        });
      }

      const recipients = await filterPushEnabled(
        supabase,
        await resolveRecipientIds(supabase, notification),
      );
      const result = await sendToUsers(supabase, recipients, notification);

      logStructured('send_push_result', {
        correlation_id: correlationId,
        actor: 'service_role',
        notification_id: notification.id ?? null,
        recipients: recipients.length,
        result: 'sent',
        sent: result.sent,
        failed: result.failed,
      });

      return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
    }

    let actorClaims: Claims | undefined;
    let userId: string | undefined;
    try {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
      actorClaims = (claimsData?.claims || {}) as Claims;
      userId = actorClaims?.sub;
      const claimsValidation = validateClaims(actorClaims || {});
      if (claimsError || !userId || !claimsValidation.valid) {
        logStructured('send_push_denied', {
          correlation_id: correlationId,
          result: 'denied',
          deny_reason: claimsValidation.reason || 'invalid_claims',
        });
        return badRequest('Unauthorized', 401);
      }
    } catch (claimsException) {
      console.warn('send-push claims validation failed:', claimsException);
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        result: 'denied',
        deny_reason: 'claims_exception',
      });
      return badRequest('Unauthorized', 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();

    const userRole = String(profile?.role || '').toUpperCase();
    if (profileError || !ALLOWED_ROLES.has(userRole)) {
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        actor_user_id: userId,
        role: userRole || null,
        result: 'denied',
        deny_reason: 'role_forbidden',
      });
      return badRequest('Forbidden', 403);
    }

    const notification = normalizeNotification(body);
    if (!notification?.target_user_id) {
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        actor_user_id: userId,
        role: userRole,
        result: 'denied',
        deny_reason: 'invalid_payload',
      });
      return badRequest('Invalid payload. Expected notification.target_user_id (UUID).', 422);
    }

    if (!anonKey) {
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        actor_user_id: userId,
        result: 'denied',
        deny_reason: 'server_misconfigured_no_anon_key',
      });
      return badRequest('Forbidden', 403);
    }

    const scopedClient = createClient(SUPABASE_URL, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: inScope, error: scopeError } = await scopedClient.rpc('app_user_in_scope', {
      target_user_id: notification.target_user_id,
    });

    if (scopeError || inScope !== true) {
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        actor_user_id: userId,
        target_user_id: notification.target_user_id,
        role: userRole,
        result: 'denied',
        deny_reason: 'out_of_scope',
        scope_error: scopeError?.message || null,
      });
      return badRequest('Forbidden', 403);
    }

    const pushWindowStart = new Date(
      Math.floor(Date.now() / 60_000) * 60_000
    ).toISOString();
    const { data: throttleData, error: throttleError } = await supabase.rpc('increment_request_counter', {
      _scope: 'send_push',
      _identifier: userId,
      _window_start: pushWindowStart,
    });

    if (throttleError) {
      console.warn('send-push rate-limit unavailable (fail-closed):', throttleError.message);
    }

    if (throttleError || (throttleData ?? 0) >= MAX_PUSH_REQUESTS_PER_MINUTE) {
      logStructured('send_push_denied', {
        correlation_id: correlationId,
        actor_user_id: userId,
        target_user_id: notification.target_user_id,
        role: userRole,
        result: 'denied',
        deny_reason: 'rate_limit_exceeded',
        throttle_count: throttleData,
      });
      return badRequest('Too many requests', 429);
    }

    const claimed = await claimDispatch(supabase, notification.id);
    if (!claimed) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, note: 'already_dispatched' }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    const recipients = await filterPushEnabled(supabase, [notification.target_user_id]);
    const result = await sendToUsers(supabase, recipients, notification);

    logStructured('send_push_result', {
      correlation_id: correlationId,
      actor_user_id: userId,
      target_user_id: notification.target_user_id,
      role: userRole,
      result: 'sent',
      sent: result.sent,
      failed: result.failed,
    });

    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  } catch (err) {
    console.error('send-push error:', err);
    return badRequest('Internal error', 500);
  }
});
