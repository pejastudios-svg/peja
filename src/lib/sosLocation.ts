import { registerPlugin } from '@capacitor/core';

interface SOSLocationPlugin {
  startTracking(options: {
    sosId: string;
    supabaseUrl: string;
    supabaseKey: string;
    accessToken: string;
    /**
     * Supabase refresh token. Lets the native service refresh its own
     * session after the WebView is backgrounded or killed, so tracking
     * keeps authenticating past the ~1h access token expiry.
     */
    refreshToken?: string;
    mode: 'activator' | 'helper';
    helperId?: string;
    sosOwnerId?: string;
    helperName?: string;
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
}

const SOSLocation = registerPlugin<SOSLocationPlugin>('SOSLocation');

export default SOSLocation;