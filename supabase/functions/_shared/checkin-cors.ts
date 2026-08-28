const PRODUCTION_ORIGINS = new Set([
  'https://kaizen-axis.space',
  'https://www.kaizen-axis.space',
  'https://kaizen-axis1.vercel.app',
  'https://kaizen-axis1-hokma-tech.vercel.app',
]);

const KAIZEN_VERCEL_PREVIEW = /^https:\/\/kaizen-axis1(?:-[a-z0-9]+)*-hokma-tech\.vercel\.app$/;

export function isAllowedCheckinOrigin(
  origin: string | null,
  configuredOrigins = '',
): boolean {
  if (!origin) return true;
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  if (KAIZEN_VERCEL_PREVIEW.test(origin)) return true;

  const allowedFromEnvironment = configuredOrigins
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return allowedFromEnvironment.includes(origin);
}
