import { Capacitor } from '@capacitor/core';

/**
 * Whether the app is running inside a native Capacitor shell (iOS/Android)
 * rather than a web browser.
 *
 * Interim native auth transport (until AU-7 / the native header + secure-storage
 * transport ships): native keeps the pre-AU-6 body-token + localStorage scheme
 * exactly as it worked before the web cookie migration, because a Capacitor
 * WebView's origin (`capacitor://localhost` / `https://localhost`) is
 * cross-SITE from the real API host, so a `SameSite=Lax` cookie is never sent
 * to it — precisely the problem `ADR-013`'s own "Problem" statement already
 * names ("cookies don't behave reliably inside a Capacitor WebView"), which is
 * why `AU-1` mandates a header-based transport for native in the first place.
 * Web is unaffected by this check and keeps the cookie transport verified in
 * the AU-6 migration.
 *
 * Wrapped in its own function (rather than calling `Capacitor.isNativePlatform()`
 * inline everywhere) so the platform check lives in one place and is trivial
 * to mock in tests.
 */
export function isNativeAuthTransport(): boolean {
  return Capacitor.isNativePlatform();
}
