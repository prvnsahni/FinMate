export const environment = {
  production: false,
  apiBaseUrl: '/api',
  /**
   * Mirrors the backend `document.intelligence` flag. Gates the client-side Document
   * Intelligence UI (receipt capture / OCR / extraction review). Default OFF — when false,
   * no active extraction workflow is exposed. Not enabled in production configuration.
   */
  documentIntelligence: false,
};
