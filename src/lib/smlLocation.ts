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
}

const SMLLocation = registerPlugin<SMLLocationPlugin>('SMLLocation');

export default SMLLocation;
