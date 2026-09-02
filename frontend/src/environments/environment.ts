export const environment = {
  production: false,
  apiBaseUrl: '/api',
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
