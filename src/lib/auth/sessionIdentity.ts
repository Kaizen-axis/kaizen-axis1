export type SessionIdentity = {
  user?: { id?: string | null; email?: string | null } | null;
} | null | undefined;

export type ProfileIdentity = { id?: string | null } | null | undefined;

export function profileMatchesSession(
  profile: ProfileIdentity,
  session: SessionIdentity,
): boolean {
  const profileId = profile?.id;
  const sessionUserId = session?.user?.id;
  if (!profileId || !sessionUserId) return false;
  return profileId === sessionUserId;
}

export function hasStaleProfile(
  profile: ProfileIdentity,
  session: SessionIdentity,
): boolean {
  const profileId = profile?.id;
  const sessionUserId = session?.user?.id;
  if (!profileId || !sessionUserId) return false;
  return profileId !== sessionUserId;
}

export function authEventRequiresProfileReload(
  event: string,
  prevUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): boolean {
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
    return true;
  }
  if (event === 'TOKEN_REFRESHED' && prevUserId !== nextUserId) {
    return true;
  }
  return false;
}

export function assertSessionEmail(session: SessionIdentity, email: string): void {
  const sessionEmail = String(session?.user?.email || '').trim().toLowerCase();
  const expected = String(email || '').trim().toLowerCase();
  if (!sessionEmail || sessionEmail !== expected) {
    throw new Error('Sessão não corresponde ao e-mail informado.');
  }
}
