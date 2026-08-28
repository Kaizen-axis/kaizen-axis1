// @ts-nocheck — Deno types are not available in the local TypeScript checker.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isAllowedCheckinOrigin } from '../_shared/checkin-cors.ts';
import {
  evaluateCheckinPolicy,
  formatMinutes,
  type CheckinUnitPolicy,
} from '../_shared/checkin-policy.ts';

const DEFAULT_START_MINUTES = 8 * 60;
const DEFAULT_END_MINUTES = 13 * 60 + 30;

function getBRTMinutes(): number {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    Vary: 'Origin',
  };
}

function json(
  body: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get('Origin');
  const configuredOrigins = Deno.env.get('APP_ORIGINS')
    ?? Deno.env.get('APP_ORIGIN')
    ?? '';
  const originAllowed = isAllowedCheckinOrigin(requestOrigin, configuredOrigins);
  const responseHeaders = corsHeaders(originAllowed ? requestOrigin : null);

  if (req.method === 'OPTIONS') {
    return originAllowed
      ? new Response(null, { status: 204, headers: responseHeaders })
      : json({ error: 'origin_not_allowed' }, 403, responseHeaders);
  }

  if (!originAllowed) {
    return json({ error: 'origin_not_allowed' }, 403, responseHeaders);
  }

  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, responseHeaders);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'unauthorized' }, 401, responseHeaders);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('[checkin-geo-v2] missing Supabase environment variables');
    return json({ error: 'server_misconfigured' }, 500, responseHeaders);
  }

  const rawToken = authHeader.slice(7);
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${rawToken}` } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return json({ error: 'unauthorized' }, 401, responseHeaders);
  }

  const userId = user.id;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const checkinWindowStart = new Date(
    Math.floor(Date.now() / 60_000) * 60_000,
  ).toISOString();
  const { data: checkinCount, error: checkinRateError } = await supabase.rpc(
    'increment_request_counter',
    {
      _scope: 'checkin_geo_v2',
      _identifier: userId,
      _window_start: checkinWindowStart,
    },
  );
  if (checkinRateError || (checkinCount ?? 0) >= 3) {
    if (checkinRateError) {
      console.warn('[checkin-geo-v2] rate-limit RPC failed:', checkinRateError.message);
    }
    return json({
      error: 'rate_limit',
      message: 'Muitas tentativas. Aguarde 1 minuto.',
    }, 429, responseHeaders);
  }

  let body: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    qrToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, responseHeaders);
  }

  const { latitude, longitude, accuracy, qrToken } = body;
  if (
    typeof latitude !== 'number'
    || typeof longitude !== 'number'
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
  ) {
    return json({
      error: 'coordenadas_ausentes',
      message: 'Latitude e longitude são obrigatórias.',
    }, 422, responseHeaders);
  }

  if (
    (latitude === 0 && longitude === 0)
    || Math.abs(latitude) > 90
    || Math.abs(longitude) > 180
  ) {
    return json({
      error: 'coordenadas_invalidas',
      message: 'O GPS retornou coordenadas inválidas. Tente novamente.',
    }, 422, responseHeaders);
  }

  if (
    accuracy !== undefined
    && (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0)
  ) {
    return json({
      error: 'precisao_invalida',
      message: 'A precisão informada pelo GPS é inválida.',
    }, 422, responseHeaders);
  }

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('checkin_unit_code')
    .eq('id', userId)
    .single();
  if (profileError || !profileRow?.checkin_unit_code) {
    console.warn('[checkin-geo-v2] profile unit unavailable:', profileError?.message);
    return json({
      error: 'unidade_nao_configurada',
      message: 'Sua unidade de check-in não está configurada. Fale com o administrador.',
    }, 403, responseHeaders);
  }

  const { data: unitRow, error: unitError } = await supabase
    .from('checkin_units')
    .select('code, name, latitude, longitude, max_radius_meters, max_accuracy_meters, active')
    .eq('code', profileRow.checkin_unit_code)
    .eq('active', true)
    .maybeSingle();
  if (unitError || !unitRow) {
    console.warn('[checkin-geo-v2] assigned unit unavailable:', unitError?.message);
    return json({
      error: 'unidade_indisponivel',
      message: 'A unidade vinculada está indisponível. Fale com o administrador.',
    }, 403, responseHeaders);
  }
  const unit = unitRow as CheckinUnitPolicy;

  let startMinutes = DEFAULT_START_MINUTES;
  let endMinutes = DEFAULT_END_MINUTES;
  const { data: settings, error: settingsError } = await supabase
    .from('checkin_settings')
    .select('start_minutes, end_minutes')
    .eq('id', 1)
    .maybeSingle();
  if (settingsError) {
    console.warn('[checkin-geo-v2] settings unavailable, using defaults:', settingsError.message);
  } else if (settings) {
    startMinutes = settings.start_minutes ?? startMinutes;
    endMinutes = settings.end_minutes ?? endMinutes;
  }

  if (typeof qrToken !== 'string' || qrToken.trim().length === 0) {
    return json({
      error: 'qr_obrigatorio',
      message: 'A leitura do QR Code é obrigatória para realizar check-in.',
    }, 403, responseHeaders);
  }

  const normalizedQrToken = qrToken.trim();
  const { data: validQr, error: qrError } = await supabase.rpc(
    'validate_daily_qr',
    { p_token: normalizedQrToken },
  );
  if (qrError) {
    console.error('[checkin-geo-v2] validate_daily_qr failed:', qrError.message);
    return json({ error: 'db_error', message: 'Falha ao validar QR Code.' }, 500, responseHeaders);
  }
  if (!validQr) {
    return json({
      error: 'token_invalido',
      message: 'QR Code inválido ou de outro dia. Peça ao gestor para exibir o QR atual.',
    }, 403, responseHeaders);
  }

  const policyResult = evaluateCheckinPolicy({
    unit,
    latitude,
    longitude,
    accuracy,
    currentMinutes: getBRTMinutes(),
    startMinutes,
    endMinutes,
  });

  if (!policyResult.ok && policyResult.error === 'gps_impreciso') {
    return json({
      error: 'gps_impreciso',
      message: `GPS impreciso (±${Math.round(accuracy ?? 0)}m). Vá para um local aberto e tente novamente.`,
      accuracy: Math.round(accuracy ?? 0),
    }, 403, responseHeaders);
  }

  if (!policyResult.ok && policyResult.error === 'fora_do_horario') {
    return json({
      error: 'fora_do_horario',
      message: `Check-in permitido apenas entre ${formatMinutes(startMinutes)} e ${formatMinutes(endMinutes)}.`,
    }, 403, responseHeaders);
  }

  if (!policyResult.ok && policyResult.error === 'fora_do_raio') {
    return json({
      error: 'fora_do_raio',
      message: `Você está a ${Math.round(policyResult.distance)}m da unidade ${unit.name}. Máximo permitido: ${unit.max_radius_meters}m.`,
      unit: { code: unit.code, name: unit.name },
      distance: Math.round(policyResult.distance),
    }, 403, responseHeaders);
  }

  const { data, error: rpcError } = await supabase.rpc('fazer_checkin', {
    p_user_id: userId,
    p_latitude: latitude,
    p_longitude: longitude,
  });
  if (rpcError) {
    console.error('[checkin-geo-v2] fazer_checkin failed:', rpcError.message);
    return json({
      error: 'db_error',
      message: 'Não foi possível registrar o check-in. Tente novamente.',
    }, 500, responseHeaders);
  }

  const result = data as {
    success: boolean;
    error?: string;
    message?: string;
    position?: number;
    name?: string;
    xp_earned?: number;
  };

  if (!result.success && result.error === 'ja_fez_checkin') {
    return json({
      error: 'ja_fez_checkin',
      message: result.message,
      position: result.position,
      unit: { code: unit.code, name: unit.name },
    }, 409, responseHeaders);
  }

  if (!result.success) {
    return json({
      error: result.error ?? 'checkin_rejeitado',
      message: result.message ?? 'O check-in não pôde ser concluído.',
    }, 403, responseHeaders);
  }

  return json({
    ok: true,
    position: result.position,
    name: result.name,
    xp_earned: result.xp_earned,
    message: 'Check-in realizado com sucesso!',
    distance: Math.round(policyResult.distance),
    unit: { code: unit.code, name: unit.name },
  }, 200, responseHeaders);
});
