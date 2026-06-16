import { registerPlugin } from '@capacitor/core';

interface SMLLocationPlugin {
  startTracking(options: {
    checkinId: string;
    supabaseUrl: string;
    supabaseKey: string;
    accessToken: string;
  }): Promise<{ started: boolean }>;

  stopTracking(): Promise<{ stopped: boolean }>;

  isTracking(): Promise<{ tracking: boolean }>;

  /**
   * Refresh the access token used by the running service for its Supabase
   * writes, without restarting tracking. Lets a long check-in keep
   * authenticating after the original token expires (~1h).
   */
  updateToken(options: { accessToken: string }): Promise<{ updated: boolean }>;
}

const SMLLocation = registerPlugin<SMLLocationPlugin>('SMLLocation');

export default SMLLocation;
