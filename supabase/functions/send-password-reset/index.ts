// @ts-nocheck — Deno types are not available in the local TS checker; valid at runtime.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

// Recuperação de senha entregue pelo Resend (canal próprio, confiável) em vez do
// e-mail nativo do Supabase Auth — que depende de SMTP/limites do projeto e não
// estava entregando os links. O fluxo final (link → /reset-password → evento
// PASSWORD_RECOVERY) permanece o mesmo: só trocamos o transporte do e-mail.

type ResetBody = {
  email?: string;
  captchaToken?: string;
};

// Anti-abuso: poucos pedidos por IP por minuto (suficiente p/ uso legítimo).
const RESET_LIMIT = { limit: 5, windowSeconds: 60 };

const CORS_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';
const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  'Vary': 'Origin',
};

// Mensagem genérica: nunca confirma se o e-mail existe (evita enumeração de contas).
const GENERIC_OK = 'Se o e-mail estiver cadastrado, você receberá o link de redefinição em instantes.';

const EMAIL_RE = /^[^\s@"<>()[\],;:\\]+@[^\s@"<>()[\],;:\\]+\.[^\s@"<>()[\],;:\\]{2,}$/;

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

function buildEmail(actionLink: string) {
  const subject = 'Redefinição de senha — Kaizen Axis';
  const text =
    `Recebemos um pedido para redefinir a senha da sua conta Kaizen Axis.\n\n` +
    `Abra o link abaixo para criar uma nova senha (válido por tempo limitado):\n` +
    `${actionLink}\n\n` +
    `Se você não solicitou isso, ignore este e-mail — sua senha permanece inalterada.`;
  const html = `
  <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0f1722">
    <h2 style="color:#2563eb;margin:0 0 16px">Redefinição de senha</h2>
    <p style="font-size:15px;line-height:1.6">Recebemos um pedido para redefinir a senha da sua conta <strong>Kaizen Axis</strong>.</p>
    <p style="font-size:15px;line-height:1.6">Clique no botão abaixo para criar uma nova senha. O link é válido por tempo limitado.</p>
    <p style="text-align:center;margin:28px 0">
      <a href="${actionLink}" style="background:#2563eb;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:600;font-size:15px;display:inline-block">Redefinir minha senha</a>
    </p>
    <p style="font-size:13px;color:#64748b;line-height:1.6">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${actionLink}</span></p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
    <p style="font-size:12px;color:#94a3b8;line-height:1.6">Se você não solicitou a redefinição, ignore este e-mail — sua senha permanece inalterada.</p>
  </div>`;
  return { subject, text, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ message: 'Método não permitido' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const appOrigin = Deno.env.get('APP_ORIGIN') ?? '';

  if (!supabaseUrl || !serviceKey) {
    console.error('[send-password-reset] Missing Supabase env vars');
    return jsonResponse({ message: 'Falha de configuração do servidor' }, 500);
  }
  if (!resendApiKey) {
    console.error('[send-password-reset] RESEND_API_KEY ausente');
    return jsonResponse({ message: 'Serviço de e-mail não configurado' }, 503);
  }

  let body: ResetBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ message: 'JSON inválido' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase();
  const captchaToken = String(body?.captchaToken || '').trim();
  if (!email || !EMAIL_RE.test(email)) {
    return jsonResponse({ message: 'Informe um e-mail válido.' }, 400);
  }

  const ip = resolveIp(req);

  // ── Verificação server-side do Turnstile CAPTCHA (quando configurado) ──────
  const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (turnstileSecret) {
    if (!captchaToken) {
      return jsonResponse({ message: 'Verificação de segurança obrigatória.' }, 400);
    }
    const formData = new FormData();
    formData.append('secret', turnstileSecret);
    formData.append('response', captchaToken);
    formData.append('remoteip', ip);
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
    }).catch(() => null);
    const verifyJson = verifyRes ? await verifyRes.json().catch(() => null) : null;
    if (!verifyJson?.success) {
      console.warn('[send-password-reset] CAPTCHA verification failed', { ip });
      return jsonResponse({ message: 'Verificação de segurança inválida ou expirada. Tente novamente.' }, 400);
    }
  }

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Rate limit por IP ──────────────────────────────────────────────────────
  const windowStart = truncateToWindow(new Date(), RESET_LIMIT.windowSeconds);
  const { data: counter, error: counterError } = await adminClient.rpc('increment_request_counter', {
    _scope: 'password_reset',
    _identifier: ip,
    _window_start: windowStart,
  });
  if (counterError) {
    console.error('[send-password-reset] Rate limit RPC error', { code: counterError.code, message: counterError.message, ip });
    return jsonResponse({ message: 'Falha ao aplicar limite de segurança' }, 500);
  }
  const count = typeof counter === 'number' ? counter : (counter?.count ?? 0);
  if (count >= RESET_LIMIT.limit) {
    console.warn('[send-password-reset] Blocked by rate limit', { ip, count });
    return jsonResponse({ message: 'Muitas solicitações. Aguarde um minuto e tente novamente.' }, 429);
  }

  // ── Gera o link de recuperação (admin) ─────────────────────────────────────
  const redirectTo = `${appOrigin}/reset-password`;
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  // Anti-enumeração: e-mail inexistente / erro de geração → resposta genérica de sucesso.
  if (linkError || !linkData?.properties?.action_link) {
    console.warn('[send-password-reset] generateLink sem link (provável e-mail inexistente)', {
      ip,
      reason: linkError?.message || 'no_action_link',
    });
    return jsonResponse({ message: GENERIC_OK }, 200);
  }

  const actionLink = linkData.properties.action_link;
  const { subject, text, html } = buildEmail(actionLink);

  // ── Envia via Resend ───────────────────────────────────────────────────────
  const RESEND_FROM = Deno.env.get('RESEND_FROM_EMAIL') ?? 'noreply@kaizen-axis.space';
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, text, html }),
    });
    if (!resendRes.ok) {
      const resendData = await resendRes.json().catch(() => ({}));
      console.error('[send-password-reset] resend error', resendRes.status, resendData);
      return jsonResponse({ message: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.' }, 502);
    }
  } catch (e: any) {
    console.error('[send-password-reset] fetch error', e?.message);
    return jsonResponse({ message: 'Falha ao conectar ao serviço de e-mail.' }, 502);
  }

  return jsonResponse({ message: GENERIC_OK }, 200);
});
