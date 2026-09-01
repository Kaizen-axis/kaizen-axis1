export const LOGIN_LIMIT = Object.freeze({ limit: 10, windowSeconds: 60 });

export function isLoginCaptchaRequired(rawValue) {
  return rawValue !== 'false';
}

function truncateToWindow(date, windowSeconds) {
  const ms = Math.floor(date.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
  return new Date(ms).toISOString();
}

export async function checkLoginRateLimit({ adminClient, ip, now = new Date() }) {
  const windowStart = truncateToWindow(now, LOGIN_LIMIT.windowSeconds);
  const { data, error } = await adminClient.rpc('increment_request_counter', {
    _scope: 'login',
    _identifier: ip,
    _window_start: windowStart,
  });

  if (error) {
    return { ok: false, status: 500, count: null, reason: 'counter_error' };
  }

  const count = typeof data === 'number' ? data : (data?.count ?? 0);
  if (count >= LOGIN_LIMIT.limit) {
    return { ok: false, status: 429, count, reason: 'rate_limited' };
  }

  return { ok: true, status: 200, count, reason: null };
}

async function revokeIssuedSession(adminClient, accessToken) {
  try {
    const { error } = await adminClient.auth.admin.signOut(accessToken, 'global');
    return error?.message || null;
  } catch {
    return 'revocation_exception';
  }
}

export async function enforceActiveProfile({ adminClient, userId, accessToken }) {
  if (!userId || !accessToken) {
    return {
      ok: false,
      status: 500,
      reason: 'invalid_auth_response',
      revocationError: null,
    };
  }

  const { data, error } = await adminClient
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();

  if (error) {
    const revocationError = await revokeIssuedSession(adminClient, accessToken);
    return {
      ok: false,
      status: 500,
      reason: 'profile_lookup_failed',
      revocationError,
    };
  }

  const status = String(data?.status || '').trim().toLowerCase();
  if (status === 'inativo' || status === 'inactive') {
    const revocationError = await revokeIssuedSession(adminClient, accessToken);
    return {
      ok: false,
      status: 403,
      reason: 'inactive_profile',
      revocationError,
    };
  }

  return { ok: true, status: 200, reason: null, revocationError: null };
}
