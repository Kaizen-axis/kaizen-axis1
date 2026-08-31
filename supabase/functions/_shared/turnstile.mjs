const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile({
  secret,
  token,
  remoteIp,
  expectedAction,
  expectedHostnames,
  fetchImpl = globalThis.fetch,
}) {
  const hostnames = new Set(
    String(expectedHostnames ?? '')
      .split(',')
      .map((hostname) => hostname.trim())
      .filter(Boolean),
  );
  if (
    typeof secret !== 'string' || secret.length === 0 || /\s/.test(secret) ||
    typeof token !== 'string' || token.length === 0 || token.length > 2048 ||
    typeof expectedAction !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(expectedAction) ||
    hostnames.size === 0 || typeof fetchImpl !== 'function'
  ) {
    return false;
  }

  let result;
  try {
    const response = await fetchImpl(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: String(remoteIp ?? ''),
      }),
    });
    if (!response.ok) return false;
    result = await response.json();
  } catch {
    return false;
  }

  return result?.success === true &&
    result.action === expectedAction &&
    hostnames.has(result.hostname);
}
