// @ts-nocheck — Deno types are not available in the local TS checker; valid at runtime.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function allowedOrigin(req: Request): string {
  const origin = req.headers.get('Origin') ?? '';
  const configured = [
    ...(Deno.env.get('APP_ORIGIN') ?? '').split(','),
    ...(Deno.env.get('APP_ORIGINS') ?? '').split(','),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin) return configured[0] ?? '';
  if (configured.includes(origin)) return origin;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) return origin;
  try {
    const host = new URL(origin).hostname;
    if (host === 'vercel.app' || host.endsWith('.vercel.app')) return origin;
  } catch {
    return configured[0] ?? '';
  }
  return configured[0] ?? '';
}

function corsHeadersFor(req: Request) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(req),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info, x-supabase-api-version',
    'Vary': 'Origin',
  };
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function accessTokenIsValid(token: string): Promise<boolean> {
  const secret = Deno.env.get('JWT_SECRET') ?? '';
  if (!secret) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now() - 5000) return false;
    const role = payload.role ?? payload.app_metadata?.role;
    return role === 'authenticated' || role === 'service_role';
  } catch {
    return false;
  }
}

const cache = new Map<string, { at: number; payload: unknown }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeadersFor(req) },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'unauthorized' }, 401);

  const rawToken = authHeader.slice(7);
  const apiKey = Deno.env.get('BRASIL_ABERTO_API_KEY');
  if (!apiKey) return json(req, { error: 'brasil_aberto_unconfigured' }, 500);
  if (!(await accessTokenIsValid(rawToken))) return json(req, { error: 'unauthorized' }, 401);

  let body: { kind?: string; state?: string; cityId?: number; ibgeId?: number } = {};
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid_json' }, 400);
  }

  const kind = body.kind;
  let url = '';
  let cacheKey = '';

  if (kind === 'states') {
    url = 'https://api.brasilaberto.com/v1/states';
    cacheKey = 'states';
  } else if (kind === 'cities') {
    const uf = String(body.state || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) return json(req, { error: 'invalid_state' }, 400);
    url = `https://api.brasilaberto.com/v1/cities/${uf}`;
    cacheKey = `cities:${uf}`;
  } else if (kind === 'districts') {
    const cityId = Number(body.cityId);
    if (!Number.isFinite(cityId) || cityId <= 0) return json(req, { error: 'invalid_city' }, 400);
    url = `https://api.brasilaberto.com/v1/districts/${cityId}`;
    cacheKey = `districts:${cityId}`;
  } else if (kind === 'districtsByIbge') {
    const ibgeId = Number(body.ibgeId);
    if (!Number.isFinite(ibgeId) || ibgeId <= 0) return json(req, { error: 'invalid_city' }, 400);
    url = `https://api.brasilaberto.com/v1/districts-by-ibge-code/${ibgeId}`;
    cacheKey = `districts-ibge:${ibgeId}`;
  } else {
    return json(req, { error: 'invalid_kind' }, 400);
  }

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return json(req, cached.payload);
  }

  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!upstream.ok) {
    return json(req, { error: 'upstream_failed', status: upstream.status }, 502);
  }

  const payload = await upstream.json();
  cache.set(cacheKey, { at: Date.now(), payload });
  return json(req, payload);
});
