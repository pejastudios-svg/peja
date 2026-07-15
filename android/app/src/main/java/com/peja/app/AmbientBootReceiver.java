package com.peja.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Resume ambient tracking after a reboot, if it was enabled. Best-effort:
 * Android 14+ restricts location foreground services started from
 * BOOT_COMPLETED on some OEMs; when refused we simply wait for the next
 * app open (the JS bootstrap restarts the service then).
 */
public class AmbientBootReceiver extends BroadcastReceiver {

    private static final String TAG = "AmbientBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        try {
            boolean active = context
                    .getSharedPreferences(AmbientLocationService.PREFS_NAME, Context.MODE_PRIVATE)
                    .getBoolean("is_active", false);
            if (!active) return;
            Intent service = new Intent(context, AmbientLocationService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
            Log.d(TAG, "Ambient tracking resumed after boot");
        } catch (Exception e) {
            Log.w(TAG, "Could not resume ambient tracking after boot", e);
        }
    }
}
