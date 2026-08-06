import { registerPlugin } from '@capacitor/core';

interface SMLLocationPlugin {
  startTracking(options: {
    checkinId: string;
    supabaseUrl: string;
    supabaseKey: string;
    accessToken: string;
    /**
     * Supabase refresh token. Lets the native service refresh its own
     * session after the WebView is backgrounded or killed, so tracking
     * keeps authenticating past the ~1h access token expiry.
     */
    refreshToken?: string;
  }): Promise<{ started: boolean }>;

  stopTracking(): Promise<{ stopped: boolean }>;

  isTracking(): Promise<{ tracking: boolean }>;

  /**
   * Push the current session pair to the native store without restarting
   * tracking. Supabase rotates the refresh token on every JS-side refresh,
   * so passing it here keeps the native refresher from holding a stale one.
   */
  updateToken(options: {
    accessToken: string;
    refreshToken?: string;
  }): Promise<{ updated: boolean }>;

  /**
   * Read the pair currently held by the native store. Used on app resume to
   * adopt a natively rotated session into supabase-js (setSession) instead
   * of replaying a stale refresh token, which would revoke the session.
   */
  getTokens(): Promise<{ accessToken: string; refreshToken: string }>;

  /** Wipe the native store on sign-out. */
  clearSession(): Promise<{ cleared: boolean }>;
}

const SMLLocation = registerPlugin<SMLLocationPlugin>('SMLLocation');

export default SMLLocation;
