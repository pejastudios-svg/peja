import { registerPlugin } from '@capacitor/core';

interface SOSLocationPlugin {
  startTracking(options: {
    sosId: string;
    supabaseUrl: string;
    supabaseKey: string;
    accessToken: string;
    mode: 'activator' | 'helper';
    helperId?: string;
    sosOwnerId?: string;
    helperName?: string;
  }): Promise<{ started: boolean }>;

  stopTracking(): Promise<{ stopped: boolean }>;

  isTracking(): Promise<{ tracking: boolean }>;
}

const SOSLocation = registerPlugin<SOSLocationPlugin>('SOSLocation');

export default SOSLocation;