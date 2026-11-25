export const environment = {
  production: false,
  // Must match the backend's real global prefix (`/api/v1`) exactly, with no
  // dev-proxy path rewrite — a rewritten path breaks path-scoped cookies
  // (AU-2a's refresh cookie is scoped to `/api/v1/auth/refresh`; the browser
  // matches cookie paths against the URL IT requests, not what a proxy
  // rewrites it to server-side). See `proxy.conf.json` (1:1 passthrough).
  apiBaseUrl: '/api/v1',
  /**
   * Mirrors the backend `document.intelligence` flag. Gates the client-side Document
   * Intelligence UI (receipt capture / OCR / extraction review). Default OFF — when false,
   * no active extraction workflow is exposed. Not enabled in production configuration.
   */
  documentIntelligence: false,
  /**
   * Mirrors the backend `public.groupShare` flag. Gates the owner/admin public-
   * sharing controls in Group Settings. Default OFF — when false, the feature is
   * not exposed. Not enabled in production configuration. (The anonymous
   * `/share/:token` viewer route always exists but resolves data only when the
   * BACKEND flag is ON — an OFF backend returns a generic unavailable.)
   */
  publicGroupShare: false,
};
