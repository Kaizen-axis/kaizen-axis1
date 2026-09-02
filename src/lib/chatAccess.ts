export const CHAT_FEATURE_LOCKED = true;

export function isChatPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return path === '/chat' || path.startsWith('/chat/');
}
