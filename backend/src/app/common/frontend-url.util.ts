type ConfigLike = {
  get<T = string>(key: string): T | undefined;
};

const LOCAL_FRONTEND_URL = 'http://localhost:4200';

/**
 * Resolves the canonical frontend origin used for email/action links.
 *
 * In local/test environments we allow a localhost default for convenience.
 * In non-local environments we fail fast when FRONTEND_URL is missing so
 * production/staging emails never contain localhost links.
 */
export function resolveFrontendUrl(config: ConfigLike): string {
  const configured = String(config.get<string>('FRONTEND_URL') || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const nodeEnv = String(
    config.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development',
  )
    .trim()
    .toLowerCase();

  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return LOCAL_FRONTEND_URL;
  }

  throw new Error(
    'FRONTEND_URL environment variable is required outside development/test environments',
  );
}
