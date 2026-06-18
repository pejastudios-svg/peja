package com.peja.app;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Extends the Capacitor push MessagingService so normal notifications keep
 * working, and adds a silent "revive_tracking" path.
 *
 * Aggressive OEM power managers (Transsion HiOS, MIUI, etc.) kill the app on
 * swipe-away and refuse to restart its foreground service. The server cron
 * detects a check-in whose location has gone stale and sends a high-priority
 * data-only FCM message. High-priority data messages are delivered here even
 * when the app process is dead, and grant a short window to start a foreground
 * service from the background — which is the only reliable way to resurrect
 * tracking on those devices.
 *
 * The location services recover their in-flight state from prefs (see
 * SMLLocationService/SOSLocationService onStartCommand), so reviving just means
 * starting the service with no extras.
 */
public class PejaMessagingService extends MessagingService {

    private static final String TAG = "PejaMessaging";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String action = data != null ? data.get("action") : null;

        if ("revive_tracking".equals(action)) {
            Log.d(TAG, "Revive push received");
            reviveIfActive();
            // Silent — do NOT call super, so no notification is shown.
            return;
        }

        super.onMessageReceived(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
    }

    private void reviveIfActive() {
        reviveService(
                SMLLocationService.PREFS_NAME,
                new Intent(getApplicationContext(), SMLLocationService.class));
        reviveService(
                SOSLocationService.PREFS_NAME,
                new Intent(getApplicationContext(), SOSLocationService.class));
    }

    private void reviveService(String prefsName, Intent intent) {
        try {
            boolean active = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
                    .getBoolean("is_active", false);
            if (!active) return;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getApplicationContext().startForegroundService(intent);
            } else {
                getApplicationContext().startService(intent);
            }
            Log.d(TAG, "Revived " + intent.getComponent());
        } catch (Exception e) {
            // Background-start may still be refused on the most hostile OEMs —
            // don't crash; the next cron tick will try again.
            Log.e(TAG, "Failed to revive service", e);
        }
    }
}
