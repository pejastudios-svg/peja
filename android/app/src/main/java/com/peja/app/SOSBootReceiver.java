package com.peja.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

public class SOSBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        Log.d("SOSBootReceiver", "Boot completed, checking for active SOS");

        SharedPreferences prefs = context.getSharedPreferences(
                SOSLocationService.PREFS_NAME,
                Context.MODE_PRIVATE
        );

        boolean isActive = prefs.getBoolean("is_active", false);
        if (!isActive) {
            Log.d("SOSBootReceiver", "No active SOS, skipping");
            return;
        }

        String sosId = prefs.getString("sos_id", "");
        String supabaseUrl = prefs.getString("supabase_url", "");
        String supabaseKey = prefs.getString("supabase_key", "");
        String accessToken = prefs.getString("access_token", "");
        String mode = prefs.getString("mode", "activator");
        String helperId = prefs.getString("helper_id", "");
        String sosOwnerId = prefs.getString("sos_owner_id", "");
        String helperName = prefs.getString("helper_name", "");

        if (sosId.isEmpty() || supabaseUrl.isEmpty()) {
            Log.d("SOSBootReceiver", "Missing data, skipping");
            return;
        }

        Log.d("SOSBootReceiver", "Restarting SOS tracking for: " + sosId);

        Intent serviceIntent = new Intent(context, SOSLocationService.class);
        serviceIntent.putExtra(SOSLocationService.EXTRA_SOS_ID, sosId);
        serviceIntent.putExtra(SOSLocationService.EXTRA_SUPABASE_URL, supabaseUrl);
        serviceIntent.putExtra(SOSLocationService.EXTRA_SUPABASE_KEY, supabaseKey);
        serviceIntent.putExtra(SOSLocationService.EXTRA_ACCESS_TOKEN, accessToken);
        serviceIntent.putExtra(SOSLocationService.EXTRA_MODE, mode);
        serviceIntent.putExtra(SOSLocationService.EXTRA_HELPER_ID, helperId);
        serviceIntent.putExtra(SOSLocationService.EXTRA_SOS_OWNER_ID, sosOwnerId);
        serviceIntent.putExtra(SOSLocationService.EXTRA_HELPER_NAME, helperName);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }
}