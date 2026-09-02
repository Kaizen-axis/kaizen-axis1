export const QR_SCAN_TIMEOUT_MS = 10_000;
export const VIDEO_READY_TIMEOUT_MS = 2_000;

export function extractCheckinToken(rawValue: string): string | null {
  const raw = rawValue.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const token = (url.searchParams.get('token') || '').trim();
    return token || null;
  } catch {
    return raw;
  }
}

export function shouldFallbackToJsQR(
  hasNativeDetector: boolean,
  nativeResultCount: number,
): boolean {
  if (!hasNativeDetector) return true;
  return nativeResultCount === 0;
}

export async function waitForVideoElement(
  getVideo: () => HTMLVideoElement | null,
  timeoutMs = VIDEO_READY_TIMEOUT_MS,
): Promise<HTMLVideoElement> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const video = getVideo();
    if (video) return video;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Não foi possível iniciar a câmera. Tente novamente.');
}
