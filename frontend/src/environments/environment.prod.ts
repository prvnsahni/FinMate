export const environment = {
  production: true,
  // Absolute origin — production has no dev-server proxy (proxy.conf.json
  // only applies to `ng serve`) and Cloudflare Pages has no reverse proxy
  // configured, so a relative '/api' would resolve against the Pages origin
  // itself instead of the backend. Must include /api/v1: the backend's
  // global prefix (backend/src/main.ts) is 'api/v1', not 'api' — locally
  // that gap is papered over by proxy.conf.json's pathRewrite.
  apiBaseUrl: 'https://finmate-api.prvnsahni.com/api/v1',
  // Document Intelligence (receipt capture / OCR) stays OFF in production until verified.
  documentIntelligence: false,
  // Public group-share owner controls. Stays OFF in production until the backend
  // FEATURE_PUBLIC_GROUP_SHARE flag and TRUST_PROXY (PUBLIC-1D / SEC-W9) are verified.
  publicGroupShare: false,
};
