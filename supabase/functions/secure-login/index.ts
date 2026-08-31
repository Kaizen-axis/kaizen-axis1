// @ts-nocheck
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyTurnstile } from '../_shared/turnstile.mjs';

type SecureLoginBody = {
  email?: string;
  password?: string;
  captchaToken?: string;
};

const LOGIN_LIMIT = { limit: 10, windowSeconds: 60 };

const CORS_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';
const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  'Vary': 'Origin',
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function resolveIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  if (!forwarded) return '0.0.0.0';
  return forwarded.split(',')[0]?.trim() || '0.0.0.0';
}

function truncateToWindow(date: Date, windowSeconds: number): string {
  const ms = Math.floor(date.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
  return new Date(ms).toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ message: 'Método não permitido' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error('[secure-login] Missing Supabase env vars');
    return jsonResponse({ message: 'Falha de configuração do servidor' }, 500);
  }

  // NOTE: We intentionally do not hard-fail on apikey here.
  // Browser/runtime environments can omit or rewrite this header,
  // and hard-failing would break login for legitimate users.
  // Brute-force protection remains server-side via rate limit by IP.

  let body: SecureLoginBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ message: 'JSON inválido' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const captchaToken = String(body?.captchaToken || '').trim();
  if (!email || !password) {
    return jsonResponse({ message: 'E-mail e senha são obrigatórios' }, 400);
  }

  // ── Verificação server-side do Turnstile CAPTCHA ──────────────────────────
  // REQUIRE_CAPTCHA=true → falha fechado se TURNSTILE_SECRET_KEY não estiver configurada.
  // Sem REQUIRE_CAPTCHA, comportamento legacy: verifica quando a secret existe.
  const requireCaptcha = Deno.env.get('REQUIRE_CAPTCHA') === 'true';
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const turnstileHostnames = Deno.env.get('TURNSTILE_HOSTNAMES');
  if (requireCaptcha && (!turnstileSecret || !turnstileHostnames)) {
    console.error('[secure-login] configuracao obrigatoria do Turnstile ausente');
    return jsonResponse({ message: 'Serviço temporariamente indisponível. Tente novamente em instantes.' }, 503);
  }
  if (turnstileSecret) {
    const ip = resolveIp(req);
    const verified = await verifyTurnstile({
      secret: turnstileSecret,
      token: captchaToken,
      remoteIp: ip,
      expectedAction: 'axis_auth',
      expectedHostnames: turnstileHostnames,
    });
    if (!verified) {
      console.warn('[secure-login] CAPTCHA verification failed', { ip });
      return jsonResponse({ message: 'Verificação de segurança inválida ou expirada. Tente novamente.' }, 400);
    }
  }

  const ip = resolveIp(req);
  const windowStart = truncateToWindow(new Date(), LOGIN_LIMIT.windowSeconds);

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: counter, error: counterError } = await adminClient.rpc('increment_request_counter', {
    _scope: 'login',
    _identifier: ip,
    _window_start: windowStart,
  });

  if (counterError) {
    console.error('[secure-login] Rate limit RPC error', {
      code: counterError.code,
      message: counterError.message,
      ip,
    });
    return jsonResponse({ message: 'Falha ao aplicar limite de segurança' }, 500);
  }

  const count = typeof counter === 'number' ? counter : (counter?.count ?? 0);
  if (count >= LOGIN_LIMIT.limit) {
    console.warn('[secure-login] Login blocked by rate limit', { ip, count });
    return jsonResponse({ message: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, 429);
  }

  // CAPTCHA already verified above by this function — do NOT forward the token
  // to Supabase Auth, which would try to verify it a second time (tokens are single-use).
  const authPayload: Record<string, unknown> = { email, password };

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: anonKey,
  };

  const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(authPayload),
  });

  let authData: any = null;
  try {
    authData = await authRes.json();
  } catch {
    authData = null;
  }

  if (!authRes.ok) {
    const upstreamMessage = String(
      authData?.msg || authData?.message || authData?.error_description || authData?.error || ''
    ).toLowerCase();

    if (upstreamMessage.includes('captcha')) {
      return jsonResponse({ message: 'Verificacao de seguranca invalida ou expirada. Tente novamente.' }, 400);
    }

    if (authRes.status === 400 || authRes.status === 401 || authRes.status === 422) {
      console.warn('[secure-login] Invalid credentials', { ip, status: authRes.status });
      // Audit server-side via service role (não depende de sessão do cliente)
      adminClient.from('audit_logs').insert({
        user_id: null,
        action: 'login_failed',
        entity: 'auth',
        entity_id: null,
        ip_address: ip,
        device_info: req.headers.get('user-agent') || 'unknown',
        metadata: { email_domain: email.split('@')[1] ?? null, reason: 'invalid_credentials' },
      }).then(({ error }) => {
        if (error) console.warn('[secure-login] audit insert failed', error.message);
      });
      return jsonResponse({ message: 'Credenciais inválidas' }, 401);
    }
    if (authRes.status === 429) {
      console.warn('[secure-login] Upstream auth throttled', { ip });
      return jsonResponse({ message: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, 429);
    }

    console.error('[secure-login] Upstream auth error', {
      ip,
      status: authRes.status,
      error: authData?.error || authData?.msg || 'unknown',
    });
    return jsonResponse({ message: 'Não foi possível processar o login agora' }, 500);
  }

  // Return Supabase auth payload so frontend can keep session + MFA flow compatible.
  return jsonResponse(authData || {}, 200);
});
